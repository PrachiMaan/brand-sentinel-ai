/** Colour maths used by the deterministic visual + accessibility engines. */

export type RGB = { r: number; g: number; b: number };
export type Lab = { l: number; a: number; b: number };

export function hexToRgb(hex: string): RGB | null {
  const clean = hex.trim().replace(/^#/, "");
  if (!/^([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(clean)) return null;
  const full =
    clean.length === 3
      ? clean
          .split("")
          .map((c) => c + c)
          .join("")
      : clean;
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  };
}

export function rgbToHex({ r, g, b }: RGB): string {
  const h = (n: number) =>
    Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`.toUpperCase();
}

function pivot(n: number) {
  const c = n / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** WCAG 2.x relative luminance. */
export function relativeLuminance({ r, g, b }: RGB): number {
  return 0.2126 * pivot(r) + 0.7152 * pivot(g) + 0.0722 * pivot(b);
}

/** WCAG 2.1 contrast ratio, 1..21. */
export function contrastRatio(a: RGB, b: RGB): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const light = Math.max(la, lb);
  const dark = Math.min(la, lb);
  return (light + 0.05) / (dark + 0.05);
}

export function rgbToLab(rgb: RGB): Lab {
  const r = pivot(rgb.r);
  const g = pivot(rgb.g);
  const b = pivot(rgb.b);
  const x = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047;
  const y = r * 0.2126 + g * 0.7152 + b * 0.0722;
  const z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return {
    l: 116 * f(y) - 16,
    a: 500 * (f(x) - f(y)),
    b: 200 * (f(y) - f(z)),
  };
}

/** CIE76 distance. Cheap and stable; the palette check only needs a coarse band. */
export function deltaE76(a: Lab, b: Lab): number {
  return Math.sqrt((a.l - b.l) ** 2 + (a.a - b.a) ** 2 + (a.b - b.b) ** 2);
}

export function hexToLab(hex: string): Lab | null {
  const rgb = hexToRgb(hex);
  return rgb ? rgbToLab(rgb) : null;
}

export function nearestPalette(hex: string, palette: string[]) {
  const lab = hexToLab(hex);
  if (!lab) return null;
  let best: { hex: string; deltaE: number } | null = null;
  for (const swatch of palette) {
    const swatchLab = hexToLab(swatch);
    if (!swatchLab) continue;
    const d = deltaE76(lab, swatchLab);
    if (!best || d < best.deltaE) best = { hex: swatch, deltaE: d };
  }
  return best;
}

/**
 * Coarse dominant colours from RGBA pixel data. Bins into a 4-bit per-channel
 * histogram so a photo does not produce a thousand micro-swatches.
 */
export function dominantColors(
  data: Uint8ClampedArray | number[],
  maxColors = 4,
): { hex: string; share: number }[] {
  const bins = new Map<string, { count: number; r: number; g: number; b: number }>();
  let total = 0;
  const step = 4 * 7; // sample every seventh pixel; plenty for a palette read
  for (let i = 0; i + 3 < data.length; i += step) {
    const a = data[i + 3];
    if (a < 32) continue;
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const key = `${r >> 4}-${g >> 4}-${b >> 4}`;
    const bin = bins.get(key) ?? { count: 0, r: 0, g: 0, b: 0 };
    bin.count += 1;
    bin.r += r;
    bin.g += g;
    bin.b += b;
    bins.set(key, bin);
    total += 1;
  }
  if (!total) return [];
  return Array.from(bins.values())
    .sort((x, y) => y.count - x.count)
    .slice(0, maxColors)
    .map((bin) => ({
      hex: rgbToHex({
        r: bin.r / bin.count,
        g: bin.g / bin.count,
        b: bin.b / bin.count,
      }),
      share: Math.round((bin.count / total) * 100) / 100,
    }));
}

export const LUMORA_PALETTE = [
  { name: "Bone", hex: "#F4EFE6" },
  { name: "Ink", hex: "#1F1D1A" },
  { name: "Clay", hex: "#B4643C" },
  { name: "Sage", hex: "#7C8B72" },
  { name: "Sand", hex: "#D9C9AF" },
];
