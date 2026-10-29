/**
 * Visual Consistency Engine v2 — deterministic, no model.
 *
 * Every number this module reports is measured from the page pixels or the PDF
 * text layer. It runs in the browser (on a pdf.js rasterisation), in Convex for
 * verification, and in the Bun eval, from one implementation.
 */

import type { Finding } from "./types";
import { deltaE76, hexToLab, rgbToLab } from "./color";
import type { SeedRule } from "./lumora";
import { sha256Hex } from "./sha256";

export type RgbaImage = { width: number; height: number; data: Uint8ClampedArray };

export type GrayImage = { width: number; height: number; data: Float32Array };

export type BBox = { x: number; y: number; w: number; h: number };

export type LogoMatch = {
  /** Normalised box (0..1) relative to the page. */
  bbox: BBox;
  confidence: number;
  /** Detected logo height in page pixels. */
  pixelHeight: number;
};

export type TextItem = {
  text: string;
  fontFamily: string;
  sizePt: number;
  x: number;
  y: number;
  w: number;
  h: number;
};

export type PageInput = {
  page: number;
  image: RgbaImage;
  text: TextItem[];
};

export type VisualThresholds = {
  logoMinConfidence: number;
  clearSpaceRatio: number;
  marginFraction: number;
  paletteDeltaE: number;
  bodySizeTolerance: number;
  minBodyPt: number;
  maxInkRatio: number;
  allowedFamilies: string[];
};

export const DEFAULT_THRESHOLDS: VisualThresholds = {
  logoMinConfidence: 0.55,
  clearSpaceRatio: 0.5,
  marginFraction: 0.04,
  paletteDeltaE: 12,
  bodySizeTolerance: 0.18,
  minBodyPt: 8,
  maxInkRatio: 0.6,
  allowedFamilies: ["sans-serif", "helvetica", "arial", "inter", "söhne", "sohne"],
};

/**
 * The Lumora logo used by the fixtures: a solid mark with a square notch cut
 * out of the lower-left corner. The template is generated, not loaded, so the
 * engine has no asset dependency and the fixtures cannot drift from it.
 */
export const LOGO_GEOMETRY = { size: 64, notch: 22, inset: 6 };

export function logoMask(size = 32): GrayImage {
  const data = new Float32Array(size * size);
  const notch = Math.round((LOGO_GEOMETRY.notch / LOGO_GEOMETRY.size) * size);
  const inset = Math.round((LOGO_GEOMETRY.inset / LOGO_GEOMETRY.size) * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const inNotch = x < inset + notch && y >= size - inset - notch;
      // Values are expected luminance, not ink coverage: the mark is a dark
      // square with a paper-coloured notch cut out of its lower-left corner.
      data[y * size + x] = inNotch ? 1 : 0;
    }
  }
  return { width: size, height: size, data };
}

export function toGray(image: RgbaImage): GrayImage {
  const data = new Float32Array(image.width * image.height);
  for (let i = 0, p = 0; i < data.length; i++, p += 4) {
    data[i] =
      (0.2126 * image.data[p] + 0.7152 * image.data[p + 1] + 0.0722 * image.data[p + 2]) / 255;
  }
  return { width: image.width, height: image.height, data };
}

export function resizeGray(image: GrayImage, width: number, height: number): GrayImage {
  const data = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    const sy = Math.min(image.height - 1, Math.floor((y / height) * image.height));
    for (let x = 0; x < width; x++) {
      const sx = Math.min(image.width - 1, Math.floor((x / width) * image.width));
      data[y * width + x] = image.data[sy * image.width + sx];
    }
  }
  return { width, height, data };
}

function integral(image: GrayImage) {
  const w = image.width + 1;
  const sum = new Float64Array(w * (image.height + 1));
  const sumSq = new Float64Array(w * (image.height + 1));
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const v = image.data[y * image.width + x];
      sum[(y + 1) * w + x + 1] = v + sum[y * w + x + 1] + sum[(y + 1) * w + x] - sum[y * w + x];
      sumSq[(y + 1) * w + x + 1] =
        v * v + sumSq[y * w + x + 1] + sumSq[(y + 1) * w + x] - sumSq[y * w + x];
    }
  }
  return { w, sum, sumSq };
}

function windowSum(table: Float64Array, stride: number, x: number, y: number, w: number, h: number) {
  return (
    table[(y + h) * stride + x + w] -
    table[y * stride + x + w] -
    table[(y + h) * stride + x] +
    table[y * stride + x]
  );
}

/**
 * Multi-scale normalised cross-correlation of the brand mark against the page.
 * Coarse, deterministic and fast enough to run on a 1200px render.
 */
type Template = { data: Float32Array; norm: number };

function templateFor(size: number, cache: Map<number, Template>): Template {
  const cached = cache.get(size);
  if (cached) return cached;
  const mask = resizeGray(logoMask(32), size, size);
  const n = size * size;
  const mean = mask.data.reduce((a, b) => a + b, 0) / n;
  const zero = mask.data.map((v) => v - mean);
  const tpl: Template = {
    data: zero,
    norm: Math.sqrt(zero.reduce((a, b) => a + b * b, 0)),
  };
  cache.set(size, tpl);
  return tpl;
}

/**
 * Coarse-to-fine search. The coarse pass finds plausible windows; the fine pass
 * pins the mark's true edge so the reported box is its real size, not a window
 * that happens to sit inside the dark body.
 */
export function scanLogo(
  image: RgbaImage,
  options: { workWidth?: number } = {},
): { score: number; bbox: BBox } | null {
  const workWidth = options.workWidth ?? 320;
  const scale = Math.min(1, workWidth / image.width);
  const gray = resizeGray(
    toGray(image),
    Math.max(16, Math.round(image.width * scale)),
    Math.max(16, Math.round(image.height * scale)),
  );
  const { w: stride, sum, sumSq } = integral(gray);
  const templates = new Map<number, Template>();

  const scoreAt = (x: number, y: number, size: number): number => {
    const n = size * size;
    const s = windowSum(sum, stride, x, y, size, size);
    const sq = windowSum(sumSq, stride, x, y, size, size);
    const mean = s / n;
    const variance = sq - n * mean * mean;
    // A flat window has no shape to match. Without this floor a slightly noisy
    // background scores a perfect correlation.
    if (variance / n < 0.01) return 0;
    const tpl = templateFor(size, templates);
    let dot = 0;
    for (let ty = 0; ty < size; ty++) {
      const row = (y + ty) * gray.width + x;
      const trow = ty * size;
      for (let tx = 0; tx < size; tx++) dot += tpl.data[trow + tx] * gray.data[row + tx];
    }
    return dot / (Math.sqrt(variance) * tpl.norm + 1e-9);
  };

  const minSize = Math.max(6, Math.round(gray.height * 0.03));
  const maxSize = Math.max(minSize + 4, Math.round(gray.height * 0.18));
  const step = Math.max(2, Math.round(gray.width / 110));
  const sizeStep = Math.max(2, Math.round(minSize / 3));
  const candidates: { score: number; x: number; y: number; size: number }[] = [];

  for (let size = minSize; size <= maxSize; size += sizeStep) {
    for (let y = 0; y + size <= gray.height; y += step) {
      for (let x = 0; x + size <= gray.width; x += step) {
        const score = scoreAt(x, y, size);
        if (score < 0.45) continue;
        candidates.push({ score, x, y, size });
      }
    }
  }
  candidates.sort((a, b) => b.score - a.score);

  const refine = (candidate: { x: number; y: number; size: number }) => {
    let best: { score: number; x: number; y: number; size: number } | null = null;
    for (let size = Math.max(minSize, candidate.size - 4); size <= candidate.size + 4; size++) {
      for (let dy = -step; dy <= step; dy++) {
        for (let dx = -step; dx <= step; dx++) {
          const x = candidate.x + dx;
          const y = candidate.y + dy;
          if (x < 0 || y < 0 || x + size > gray.width || y + size > gray.height) continue;
          if (!hasCleanEdges(gray, x, y, size)) continue;
          const score = scoreAt(x, y, size);
          if (!best || score > best.score) best = { score, x, y, size };
        }
      }
    }
    return best;
  };

  let best: { score: number; x: number; y: number; size: number } | null = null;
  const tried: { x: number; y: number }[] = [];
  for (const candidate of candidates.slice(0, 24)) {
    if (tried.some((t) => Math.abs(t.x - candidate.x) < 4 && Math.abs(t.y - candidate.y) < 4)) {
      continue;
    }
    tried.push({ x: candidate.x, y: candidate.y });
    const refined = refine(candidate);
    if (refined && (!best || refined.score > best.score)) best = refined;
    if (best && best.score > 0.9) break;
  }

  if (!best) return null;

  // The correlation window can sit a pixel or two inside the mark. Grow each
  // side out to the real ink edge so clear-space is measured from the mark and
  // not from somewhere inside it.
  const lum = (px: number, py: number) => {
    if (px < 0 || py < 0 || px >= gray.width || py >= gray.height) return 1;
    return gray.data[py * gray.width + px];
  };
  const midX = best.x + Math.floor(best.size / 2);
  const midY = best.y + Math.floor(best.size / 2);
  let left = best.x;
  let right = best.x + best.size - 1;
  let top = best.y;
  let bottom = best.y + best.size - 1;
  let guard = 0;
  while (left > 0 && lum(left - 1, midY) < 0.55 && guard++ < 12) left -= 1;
  guard = 0;
  while (right < gray.width - 1 && lum(right + 1, midY) < 0.55 && guard++ < 12) right += 1;
  guard = 0;
  while (top > 0 && lum(midX, top - 1) < 0.55 && guard++ < 12) top -= 1;
  guard = 0;
  while (bottom < gray.height - 1 && lum(midX, bottom + 1) < 0.55 && guard++ < 12) {
    bottom += 1;
  }

  return {
    score: best.score,
    bbox: {
      x: left / gray.width,
      y: top / gray.height,
      w: (right - left + 1) / gray.width,
      h: (bottom - top + 1) / gray.height,
    },
  };
}

export function findLogo(
  image: RgbaImage,
  options: { minConfidence?: number; workWidth?: number; minScore?: number } = {},
): LogoMatch | null {
  const best = scanLogo(image, options);
  if (!best || best.score < (options.minScore ?? 0.35)) return null;
  // Correlation alone will happily match a plain square. The mark has a light
  // notch inside a dark body, so check that composition before believing it.
  if (!isMarkLike(image, best.bbox)) return null;
  return {
    bbox: best.bbox,
    confidence: Math.max(0, Math.min(1, best.score)),
    pixelHeight: best.bbox.h * image.height,
  };
}

/** Does this box look like the Lumora mark: dark body, background-coloured notch? */
export function isMarkLike(image: RgbaImage, bbox: BBox): boolean {
  const x0 = Math.max(0, Math.round(bbox.x * image.width));
  const y0 = Math.max(0, Math.round(bbox.y * image.height));
  const w = Math.max(3, Math.round(bbox.w * image.width));
  const h = Math.max(3, Math.round(bbox.h * image.height));
  if (x0 + w > image.width || y0 + h > image.height) return false;
  const lum = (x: number, y: number) => {
    const p = (y * image.width + x) * 4;
    return (
      (0.2126 * image.data[p] + 0.7152 * image.data[p + 1] + 0.0722 * image.data[p + 2]) /
      255
    );
  };
  const inset = Math.max(1, Math.round(w * (6 / 64)));
  const notch = Math.max(2, Math.round(w * (22 / 64)));
  // Sample the body away from the notch: centre-right, upper-middle.
  let ink = 0;
  let inkCount = 0;
  for (let y = y0 + Math.round(h * 0.3); y < y0 + Math.round(h * 0.55); y++) {
    for (let x = x0 + Math.round(w * 0.45); x < x0 + Math.round(w * 0.9); x++) {
      ink += lum(x, y);
      inkCount += 1;
    }
  }
  let notchLum = 0;
  let notchCount = 0;
  for (let y = y0 + h - inset - notch; y < y0 + h - inset; y++) {
    for (let x = x0 + inset; x < x0 + inset + notch; x++) {
      if (x >= image.width || y >= image.height) continue;
      notchLum += lum(x, y);
      notchCount += 1;
    }
  }
  if (!inkCount || !notchCount) return false;
  const inkMean = ink / inkCount;
  const notchMean = notchLum / notchCount;
  const bg = backgroundColour(image);
  const bgLum = (0.2126 * bg.r + 0.7152 * bg.g + 0.0722 * bg.b) / 255;
  return inkMean < 0.5 && Math.abs(notchMean - bgLum) < 0.3 && notchMean > inkMean + 0.2;
}

/** Are the four box borders the edge of a dark object on light paper? */
function hasCleanEdges(gray: GrayImage, x: number, y: number, size: number): boolean {
  const outside = 2;
  const lum = (px: number, py: number) => {
    if (px < 0 || py < 0 || px >= gray.width || py >= gray.height) return 1;
    return gray.data[py * gray.width + px];
  };
  let ok = 0;
  let total = 0;
  const check = (insideX: number, insideY: number, outX: number, outY: number) => {
    total += 1;
    if (lum(insideX, insideY) < 0.55 && lum(outX, outY) > 0.7) ok += 1;
  };
  const midY = y + Math.floor(size / 2);
  const midX = x + Math.floor(size / 2);
  check(x, midY, x - outside, midY);
  check(x + size - 1, midY, x + size - 1 + outside, midY);
  check(midX, y, midX, y - outside);
  check(midX, y + size - 1, midX, y + size - 1 + outside);
  // The corner nearest the notch is paper, so it is not evidence either way.
  return ok / total >= 0.75;
}

function backgroundColour(image: RgbaImage) {
  const sample: [number, number][] = [
    [2, 2],
    [image.width - 3, 2],
    [2, image.height - 3],
    [image.width - 3, image.height - 3],
  ];
  const sums = [0, 0, 0];
  for (const [x, y] of sample) {
    const p = (Math.max(0, y) * image.width + Math.max(0, x)) * 4;
    sums[0] += image.data[p];
    sums[1] += image.data[p + 1];
    sums[2] += image.data[p + 2];
  }
  return { r: sums[0] / 4, g: sums[1] / 4, b: sums[2] / 4 };
}

function differs(
  image: RgbaImage,
  x: number,
  y: number,
  bg: { r: number; g: number; b: number },
  tolerance = 26,
) {
  if (x < 0 || y < 0 || x >= image.width || y >= image.height) return false;
  const p = (y * image.width + x) * 4;
  return (
    Math.abs(image.data[p] - bg.r) +
      Math.abs(image.data[p + 1] - bg.g) +
      Math.abs(image.data[p + 2] - bg.b) >
    tolerance
  );
}

export type ClearSpaceResult = {
  /** Smallest measured gap on any side, as a fraction of logo height. */
  minRatio: number;
  sides: { side: "top" | "right" | "bottom" | "left"; ratio: number }[];
  box: BBox;
};

/**
 * Measures the gap between the logo box and the nearest non-background pixel on
 * each side, then returns the box extended to that intrusion.
 */
export function measureClearSpace(
  image: RgbaImage,
  bbox: BBox,
  maxRatio = 1,
): ClearSpaceResult {
  const bg = backgroundColour(image);
  let x0 = Math.max(0, Math.round(bbox.x * image.width));
  let y0 = Math.max(0, Math.round(bbox.y * image.height));
  let w = Math.max(1, Math.round(bbox.w * image.width));
  let h = Math.max(1, Math.round(bbox.h * image.height));

  // Snap to the mark's real ink edge. The detector works on a downscaled page,
  // so its box can be a pixel or two inside the artwork.
  const midY = y0 + Math.floor(h / 2);
  const midX = x0 + Math.floor(w / 2);
  for (let i = 0; i < 6; i++) {
    if (x0 > 0 && differs(image, x0 - 1, midY, bg)) {
      x0 -= 1;
      w += 1;
    } else break;
  }
  for (let i = 0; i < 6; i++) {
    if (x0 + w < image.width && differs(image, x0 + w, midY, bg)) w += 1;
    else break;
  }
  for (let i = 0; i < 6; i++) {
    if (y0 > 0 && differs(image, midX, y0 - 1, bg)) {
      y0 -= 1;
      h += 1;
    } else break;
  }
  for (let i = 0; i < 6; i++) {
    if (y0 + h < image.height && differs(image, midX, y0 + h, bg)) h += 1;
    else break;
  }

  const limit = Math.max(2, Math.round(h * maxRatio));

  /** Gap in pixels between the mark's edge and the first foreign pixel. */
  const measure = (side: "top" | "right" | "bottom" | "left"): { distance: number } => {
    let distance = limit;
    const slack = 1;
    if (side === "top") {
      for (let x = x0; x < x0 + w; x++) {
        for (let d = slack; d <= limit; d++) {
          if (differs(image, x, y0 - d, bg)) {
            distance = Math.min(distance, d - slack);
            break;
          }
        }
      }
    } else if (side === "bottom") {
      for (let x = x0; x < x0 + w; x++) {
        for (let d = slack; d <= limit; d++) {
          if (differs(image, x, y0 + h - 1 + d, bg)) {
            distance = Math.min(distance, d - slack);
            break;
          }
        }
      }
    } else if (side === "left") {
      for (let y = y0; y < y0 + h; y++) {
        for (let d = slack; d <= limit; d++) {
          if (differs(image, x0 - d, y, bg)) {
            distance = Math.min(distance, d - slack);
            break;
          }
        }
      }
    } else {
      for (let y = y0; y < y0 + h; y++) {
        for (let d = slack; d <= limit; d++) {
          if (differs(image, x0 + w - 1 + d, y, bg)) {
            distance = Math.min(distance, d - slack);
            break;
          }
        }
      }
    }
    return { distance };
  };

  const sides = (["top", "right", "bottom", "left"] as const).map((side) => {
    const { distance } = measure(side);
    return { side, ratio: Math.round((distance / h) * 100) / 100 };
  });
  const minRatio = Math.min(...sides.map((s) => s.ratio));
  // The reported box is the logo plus the missing clear space on the sides that
  // actually fail, so it lines up with the intrusion a reviewer can see.
  const padFor = (side: "top" | "right" | "bottom" | "left") => {
    const entry = sides.find((s) => s.side === side);
    return entry && entry.ratio < maxRatio ? Math.round(h * maxRatio) : 0;
  };
  const padLeft = padFor("left");
  const padRight = padFor("right");
  const padTop = padFor("top");
  const padBottom = padFor("bottom");

  return {
    minRatio,
    sides,
    box: {
      x: (x0 - padLeft) / image.width,
      y: (y0 - padTop) / image.height,
      w: (w + padLeft + padRight) / image.width,
      h: (h + padTop + padBottom) / image.height,
    },
  };
}

export type Region = { bbox: BBox; hex: string; deltaE: number; nearest: string; share: number };

/** Off-palette, non-neutral colour regions, measured in CIELAB. */
export function offPaletteRegions(
  image: RgbaImage,
  paletteHex: string[],
  threshold: number,
  minShare = 0.004,
): Region[] {
  const bins = new Map<
    string,
    { count: number; r: number; g: number; b: number; minX: number; minY: number; maxX: number; maxY: number }
  >();
  const total = image.width * image.height;
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const p = (y * image.width + x) * 4;
      if (image.data[p + 3] < 32) continue;
      const r = image.data[p];
      const g = image.data[p + 1];
      const b = image.data[p + 2];
      const key = `${r >> 4}-${g >> 4}-${b >> 4}`;
      const bin =
        bins.get(key) ??
        { count: 0, r: 0, g: 0, b: 0, minX: x, minY: y, maxX: x, maxY: y };
      bin.count += 1;
      bin.r += r;
      bin.g += g;
      bin.b += b;
      bin.minX = Math.min(bin.minX, x);
      bin.minY = Math.min(bin.minY, y);
      bin.maxX = Math.max(bin.maxX, x);
      bin.maxY = Math.max(bin.maxY, y);
      bins.set(key, bin);
    }
  }

  const paletteLabs = paletteHex
    .map((hex) => ({ hex, lab: hexToLab(hex) }))
    .filter((p): p is { hex: string; lab: NonNullable<ReturnType<typeof hexToLab>> } => Boolean(p.lab));

  const regions: Region[] = [];
  for (const bin of bins.values()) {
    const share = bin.count / total;
    if (share < minShare) continue;
    const rgb = { r: bin.r / bin.count, g: bin.g / bin.count, b: bin.b / bin.count };
    const lab = rgbToLab(rgb);
    const chroma = Math.hypot(lab.a, lab.b);
    // Neutral (white, black, grays) is never an off-palette accent.
    if (chroma < 9) continue;
    if (lab.l > 96 || lab.l < 8) continue;
    let nearest = { hex: "", deltaE: Number.POSITIVE_INFINITY };
    for (const swatch of paletteLabs) {
      const d = deltaE76(lab, swatch.lab);
      if (d < nearest.deltaE) nearest = { hex: swatch.hex, deltaE: d };
    }
    if (!Number.isFinite(nearest.deltaE) || nearest.deltaE <= threshold) continue;
    regions.push({
      bbox: {
        x: bin.minX / image.width,
        y: bin.minY / image.height,
        w: (bin.maxX - bin.minX + 1) / image.width,
        h: (bin.maxY - bin.minY + 1) / image.height,
      },
      hex: `#${[rgb.r, rgb.g, rgb.b]
        .map((v) => Math.round(v).toString(16).padStart(2, "0"))
        .join("")
        .toUpperCase()}`,
      deltaE: Math.round(nearest.deltaE * 10) / 10,
      nearest: nearest.hex,
      share: Math.round(share * 1000) / 10,
    });
  }
  return regions.sort((a, b) => b.share - a.share).slice(0, 4);
}

/** Share of the page covered by non-background ink or imagery. */
export function inkRatio(image: RgbaImage): number {
  const bg = backgroundColour(image);
  let ink = 0;
  let total = 0;
  for (let y = 0; y < image.height; y += 2) {
    for (let x = 0; x < image.width; x += 2) {
      total += 1;
      if (differs(image, x, y, bg, 20)) ink += 1;
    }
  }
  return total ? Math.round((ink / total) * 1000) / 1000 : 0;
}

/**
 * The dense region of a page: every grid cell whose ink ratio is within five
 * points of the densest cell, merged into one box. A single cell on a page
 * whose content fills two rows is arbitrary; the merged box points at the area
 * a designer has to open up.
 */
export function densestBlock(
  image: RgbaImage,
  grid: { cols: number; rows: number } = { cols: 4, rows: 3 },
): { bbox: BBox; ratio: number; cells: number } {
  const bg = backgroundColour(image);
  const cells: { bbox: BBox; ratio: number }[] = [];
  let max = 0;
  for (let gy = 0; gy < grid.rows; gy++) {
    for (let gx = 0; gx < grid.cols; gx++) {
      const x0 = Math.floor((gx / grid.cols) * image.width);
      const x1 = Math.floor(((gx + 1) / grid.cols) * image.width);
      const y0 = Math.floor((gy / grid.rows) * image.height);
      const y1 = Math.floor(((gy + 1) / grid.rows) * image.height);
      let ink = 0;
      let total = 0;
      for (let y = y0; y < y1; y += 2) {
        for (let x = x0; x < x1; x += 2) {
          total += 1;
          if (differs(image, x, y, bg, 20)) ink += 1;
        }
      }
      const ratio = total ? ink / total : 0;
      max = Math.max(max, ratio);
      cells.push({
        bbox: {
          x: gx / grid.cols,
          y: gy / grid.rows,
          w: 1 / grid.cols,
          h: 1 / grid.rows,
        },
        ratio,
      });
    }
  }
  const dense = cells.filter((cell) => cell.ratio >= max - 0.05);
  const x0 = Math.min(...dense.map((cell) => cell.bbox.x));
  const y0 = Math.min(...dense.map((cell) => cell.bbox.y));
  const x1 = Math.max(...dense.map((cell) => cell.bbox.x + cell.bbox.w));
  const y1 = Math.max(...dense.map((cell) => cell.bbox.y + cell.bbox.h));
  return {
    bbox: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 },
    ratio: Math.round(max * 1000) / 1000,
    cells: dense.length,
  };
}

export function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Lower quartile: a stable "body size" even when a page carries a big headline. */
export function bodySize(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.25))];
}

export type VisualStats = {
  pages: number;
  logoConfidence: number[];
  dropped: number;
  checks: {
    ruleId: string;
    layer: "deterministic" | "needs_human";
    findings: number;
  }[];
  pixelsPerPage: number;
};

const RULE = {
  LOGO_PRESENT: "VIS-LOGO-PRESENT",
  LOGO_CLEARSPACE: "VIS-LOGO-CLEARSPACE",
  LOGO_MARGIN: "VIS-LOGO-MARGIN",
  PALETTE: "VIS-PALETTE",
  TYPE_FAMILY: "VIS-TYPE-FAMILY",
  TYPE_SIZE: "VIS-TYPE-SIZE",
  DENSITY: "VIS-DENSITY",
} as const;

function ruleOf(rules: SeedRule[], ruleId: string) {
  return rules.find((r) => r.ruleId === ruleId);
}

function finding(args: {
  rule: SeedRule;
  severity?: SeedRule["severity"];
  page: number;
  bbox: BBox;
  measured: string;
  threshold: string;
  why: string;
  fix: string;
  confidence?: number;
  spanText: string;
}): Finding {
  return {
    id: `vis-${args.rule.ruleId}-${args.page}-${Math.round(args.bbox.x * 1000)}-${Math.round(args.bbox.y * 1000)}`,
    reviewer: "visual",
    severity: args.severity ?? args.rule.severity,
    confidence: args.confidence ?? 0.97,
    spanText: args.spanText,
    spanStart: 0,
    spanEnd: 0,
    ruleId: args.rule.ruleId,
    guidelineExcerpt: args.rule.sourceExcerpt,
    whyItMatters: args.why,
    suggestedFix: args.fix,
    status: "pending",
    source: "deterministic",
    bucket: args.confidence !== undefined && args.confidence < 0.6 ? "needs_human" : "verified",
    evidenceType: "computed",
    measuredValue: args.measured,
    measured: args.measured,
    threshold: args.threshold,
    page: args.page,
    bbox: args.bbox,
  };
}

/**
 * Runs every visual check over a deck. A clean deck returns no findings.
 */
/** Thresholds published on the Rulebook page are the ones the engine uses. */
export function thresholdsFromRules(rules: SeedRule[]): VisualThresholds {
  const merged: VisualThresholds = { ...DEFAULT_THRESHOLDS };
  for (const rule of rules) {
    if (!rule.config) continue;
    try {
      const parsed = JSON.parse(rule.config) as Partial<VisualThresholds>;
      Object.assign(merged, parsed);
    } catch {
      // A malformed threshold block falls back to the default rather than
      // silently disabling the check.
    }
  }
  return merged;
}

export function analyseDeck(args: {
  pages: PageInput[];
  rules: SeedRule[];
  palette: string[];
  thresholds?: Partial<VisualThresholds>;
  pageKinds?: string[];
}): { findings: Finding[]; stats: VisualStats } {
  const thresholds = { ...thresholdsFromRules(args.rules), ...args.thresholds };
  const findings: Finding[] = [];
  const logoConfidence: number[] = [];
  const checks = new Map<string, { ruleId: string; layer: "deterministic" | "needs_human"; findings: number }>();
  const bump = (ruleId: string, layer: "deterministic" | "needs_human") => {
    const entry = checks.get(ruleId) ?? { ruleId, layer, findings: 0 };
    entry.findings += 1;
    checks.set(ruleId, entry);
  };

  const rules = args.rules;
  const logoRule = ruleOf(rules, RULE.LOGO_PRESENT);
  const clearRule = ruleOf(rules, RULE.LOGO_CLEARSPACE);
  const marginRule = ruleOf(rules, RULE.LOGO_MARGIN);
  const paletteRule = ruleOf(rules, RULE.PALETTE);
  const familyRule = ruleOf(rules, RULE.TYPE_FAMILY);
  const sizeRule = ruleOf(rules, RULE.TYPE_SIZE);
  const densityRule = ruleOf(rules, RULE.DENSITY);

  const bodySizes: number[] = [];
  for (const page of args.pages) {
    const sizes = page.text.map((item) => item.sizePt).filter((s) => s > 0);
    if (sizes.length) bodySizes.push(bodySize(sizes));
  }
  const deckMedian = median(bodySizes);

  const lastPage = args.pages.length;

  for (const page of args.pages) {
    const logo = findLogo(page.image);
    if (logo) logoConfidence.push(Math.round(logo.confidence * 100) / 100);

    const mustHaveLogo =
      page.page === 1 ||
      (lastPage > 1 && page.page === lastPage) ||
      (lastPage === 1 && (args.pageKinds?.[0] ?? "page") !== "page");

    if (!logo) {
      if (mustHaveLogo && logoRule) {
        findings.push(
          finding({
            rule: logoRule,
            page: page.page,
            bbox: { x: 0.02, y: 0.02, w: 0.06, h: 0.06 },
            measured: "logo not detected (best correlation below 0.35)",
            threshold: "brand mark present on first and last page",
            why: "A page without the brand mark reads as a different brand.",
            fix: "Place the approved Lumora mark in the header or footer of this page.",
            spanText: `Page ${page.page}`,
          }),
        );
        bump(logoRule.ruleId, "deterministic");
      }
      continue;
    }

    if (logo.confidence < thresholds.logoMinConfidence) {
      if (clearRule) {
        findings.push(
          finding({
            rule: clearRule,
            page: page.page,
            bbox: logo.bbox,
            measured: `logo match confidence ${logo.confidence.toFixed(2)}`,
            threshold: `match confidence >= ${thresholds.logoMinConfidence}`,
            why: "The mark is present but not certain enough to judge its spacing.",
            fix: "Check this page manually; the automatic clear-space measurement was inconclusive.",
            confidence: logo.confidence,
            spanText: `Page ${page.page}`,
          }),
        );
        bump(clearRule.ruleId, "needs_human");
      }
    } else {
      const space = measureClearSpace(page.image, logo.bbox, thresholds.clearSpaceRatio);
      if (clearRule && space.minRatio < thresholds.clearSpaceRatio) {
        const worst = [...space.sides].sort((a, b) => a.ratio - b.ratio)[0];
        findings.push(
          finding({
            rule: clearRule,
            page: page.page,
            bbox: space.box,
            measured: `${space.minRatio.toFixed(2)}x logo height (${worst.side} side)`,
            threshold: `>= ${thresholds.clearSpaceRatio}x logo height on all sides`,
            why: "Crowding the mark weakens it and looks accidental at small sizes.",
            fix: `Increase the ${worst.side} margin to at least ${thresholds.clearSpaceRatio}x the mark height.`,
            spanText: `Page ${page.page}`,
          }),
        );
        bump(clearRule.ruleId, "deterministic");
      }

      const left = logo.bbox.x;
      const right = 1 - (logo.bbox.x + logo.bbox.w);
      const top = logo.bbox.y;
      const bottom = 1 - (logo.bbox.y + logo.bbox.h);
      const minMargin = Math.min(left, right, top, bottom);
      if (marginRule && minMargin < thresholds.marginFraction) {
        const side =
          minMargin === left ? "left" : minMargin === right ? "right" : minMargin === top ? "top" : "bottom";
        findings.push(
          finding({
            rule: marginRule,
            page: page.page,
            bbox: logo.bbox,
            measured: `${(minMargin * 100).toFixed(1)}% of page width from the ${side} edge`,
            threshold: `>= ${(thresholds.marginFraction * 100).toFixed(1)}%`,
            why: "A mark pressed against the trim edge is clipped by printers and cropped by platforms.",
            fix: `Move the mark inward so the ${side} margin is at least ${(thresholds.marginFraction * 100).toFixed(1)}% of the page width.`,
            spanText: `Page ${page.page}`,
          }),
        );
        bump(marginRule.ruleId, "deterministic");
      }
    }

    if (paletteRule) {
      for (const region of offPaletteRegions(page.image, args.palette, thresholds.paletteDeltaE)) {
        findings.push(
          finding({
            rule: paletteRule,
            page: page.page,
            bbox: region.bbox,
            measured: `${region.hex} is ΔE ${region.deltaE} from the nearest palette colour ${region.nearest} (${region.share}% of the page)`,
            threshold: `ΔE <= ${thresholds.paletteDeltaE}`,
            why: "Off-palette colour is the most visible sign that a page was made outside the system.",
            fix: `Replace ${region.hex} with ${region.nearest}, the nearest approved colour.`,
            spanText: `Page ${page.page}`,
          }),
        );
        bump(paletteRule.ruleId, "deterministic");
      }
    }

    const offFamily = page.text.filter(
      (item) =>
        item.fontFamily &&
        !thresholds.allowedFamilies.includes(item.fontFamily.toLowerCase().trim()),
    );
    if (familyRule && offFamily.length) {
      const families = Array.from(new Set(offFamily.map((i) => i.fontFamily))).join(", ");
      const xs = offFamily.map((i) => i.x);
      const ys = offFamily.map((i) => i.y);
      findings.push(
        finding({
          rule: familyRule,
          page: page.page,
          bbox: {
            x: Math.max(0, Math.min(...xs)),
            y: Math.max(0, Math.min(...ys)),
            w: Math.max(0.01, Math.max(...offFamily.map((i) => i.x + i.w)) - Math.min(...xs)),
            h: Math.max(0.01, Math.max(...offFamily.map((i) => i.y + i.h)) - Math.min(...ys)),
          },
          measured: `${offFamily.length} text item(s) set in ${families}`,
          threshold: `only ${thresholds.allowedFamilies.slice(0, 3).join(", ")}`,
          why: "Typeface is the loudest signal of a different design system.",
          fix: `Reset the flagged text to the brand sans family.`,
          spanText: `Page ${page.page}`,
        }),
      );
      bump(familyRule.ruleId, "deterministic");
    }

    const pageMedian = bodySize(page.text.map((i) => i.sizePt).filter((s) => s > 0));
    if (sizeRule && pageMedian > 0 && deckMedian > 0) {
      const deviation = (pageMedian - deckMedian) / deckMedian;
      if (Math.abs(deviation) > thresholds.bodySizeTolerance) {
        findings.push(
          finding({
            rule: sizeRule,
            page: page.page,
            bbox: { x: 0.06, y: 0.08, w: 0.88, h: 0.8 },
            measured: `median body size ${pageMedian.toFixed(1)}pt across ${page.text.length} items`,
            threshold: `${deckMedian.toFixed(1)}pt ±${(thresholds.bodySizeTolerance * 100).toFixed(0)}% (deck median)`,
            why: "Inconsistent body size makes a deck feel assembled rather than designed.",
            fix: `Set body text to ${deckMedian.toFixed(1)}pt so it matches the rest of the deck.`,
            spanText: `Page ${page.page}`,
          }),
        );
        bump(sizeRule.ruleId, "deterministic");
      }
      const tooSmall = page.text.filter((i) => i.sizePt < thresholds.minBodyPt);
      if (tooSmall.length) {
        findings.push(
          finding({
            rule: sizeRule,
            page: page.page,
            bbox: { x: 0.06, y: 0.08, w: 0.88, h: 0.8 },
            measured: `${tooSmall.length} item(s) below ${thresholds.minBodyPt}pt (smallest ${Math.min(...tooSmall.map((i) => i.sizePt)).toFixed(1)}pt)`,
            threshold: `>= ${thresholds.minBodyPt}pt`,
            why: "Type below the minimum is unreadable at presentation distance.",
            fix: "Raise the flagged text to the minimum body size or remove it.",
            spanText: `Page ${page.page}`,
          }),
        );
        bump(sizeRule.ruleId, "deterministic");
      }
    }

    if (densityRule) {
      const ratio = inkRatio(page.image);
      if (ratio > thresholds.maxInkRatio) {
        const block = densestBlock(page.image);
        findings.push(
          finding({
            rule: densityRule,
            page: page.page,
            bbox: block.bbox,
            measured: `${(ratio * 100).toFixed(1)}% of the page is covered`,
            threshold: `<= ${(thresholds.maxInkRatio * 100).toFixed(1)}%`,
            why: "A page with no breathing room loses the one message it should carry.",
            fix: "Remove or move content off this page until the covered area is under the limit.",
            spanText: `Page ${page.page}`,
          }),
        );
        bump(densityRule.ruleId, "deterministic");
      }
    }
  }

  return {
    findings,
    stats: {
      pages: args.pages.length,
      logoConfidence,
      dropped: 0,
      checks: Array.from(checks.values()).sort((a, b) => a.ruleId.localeCompare(b.ruleId)),
      pixelsPerPage: args.pages.reduce((sum, p) => sum + p.image.width * p.image.height, 0),
    },
  };
}

/** Normalised page geometry used by the fixture generator and the eval. */
export type DeckPageSpec = {
  page: number;
  logo?: { x: number; y: number; size: number };
  background: string;
  blocks?: { x: number; y: number; w: number; h: number; hex: string }[];
  text?: { value: string; font: "Helvetica" | "TimesRoman" | "Courier"; size: number; x: number; y: number }[];
};

export function specHash(spec: unknown) {
  return sha256Hex(JSON.stringify(spec)).slice(0, 16);
}
