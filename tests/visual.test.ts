import { describe, expect, it } from "bun:test";
import {
  bodySize,
  densestBlock,
  inkRatio,
  logoMask,
  median,
  offPaletteRegions,
  thresholdsFromRules,
} from "../src/convex/lib/visual";
import { LUMORA_PALETTE } from "../src/convex/lib/color";
import { RULES } from "../src/convex/lib/lumora";

const PALETTE_HEX = LUMORA_PALETTE.map((p) => p.hex);

function page(width: number, height: number, fill: [number, number, number] = [247, 243, 236]) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = fill[0];
    data[i * 4 + 1] = fill[1];
    data[i * 4 + 2] = fill[2];
    data[i * 4 + 3] = 255;
  }
  return { width, height, data };
}

function paint(
  image: { width: number; height: number; data: Uint8ClampedArray },
  box: { x: number; y: number; w: number; h: number },
  colour: [number, number, number],
) {
  for (let y = box.y; y < box.y + box.h; y++) {
    for (let x = box.x; x < box.x + box.w; x++) {
      const p = (y * image.width + x) * 4;
      image.data[p] = colour[0];
      image.data[p + 1] = colour[1];
      image.data[p + 2] = colour[2];
    }
  }
}

describe("off-palette regions", () => {
  it("finds a saturated block that is far from every brand colour", () => {
    const image = page(200, 150);
    paint(image, { x: 20, y: 30, w: 60, h: 40 }, [255, 46, 147]); // hot pink
    const regions = offPaletteRegions(image, PALETTE_HEX, 22);
    expect(regions).toHaveLength(1);
    expect(regions[0].deltaE).toBeGreaterThan(22);
    expect(regions[0].bbox.x).toBeCloseTo(20 / 200, 1);
    expect(regions[0].bbox.y).toBeCloseTo(30 / 150, 1);
  });

  it("never flags neutrals or in-palette colours", () => {
    const neutrals = page(120, 90, [255, 255, 255]);
    paint(neutrals, { x: 10, y: 10, w: 40, h: 40 }, [120, 120, 120]);
    expect(offPaletteRegions(neutrals, PALETTE_HEX, 22)).toHaveLength(0);

    const branded = page(120, 90, [244, 239, 230]); // bone
    paint(branded, { x: 10, y: 10, w: 40, h: 40 }, [180, 100, 60]); // clay
    expect(offPaletteRegions(branded, PALETTE_HEX, 22)).toHaveLength(0);
  });
});

describe("density", () => {
  it("reports the share of ink on a page between 0 and 1", () => {
    const light = page(100, 100);
    expect(inkRatio(light)).toBeLessThan(0.05);

    const heavy = page(100, 100);
    paint(heavy, { x: 0, y: 0, w: 100, h: 70 }, [30, 30, 30]);
    expect(inkRatio(heavy)).toBeGreaterThan(0.4);
  });

  it("locates the densest block inside the page bounds", () => {
    const image = page(200, 150);
    paint(image, { x: 140, y: 100, w: 50, h: 35 }, [20, 20, 20]);
    const block = densestBlock(image);
    expect(block.bbox.x).toBeGreaterThanOrEqual(0);
    expect(block.bbox.x + block.bbox.w).toBeLessThanOrEqual(1);
    expect(block.bbox.y + block.bbox.h).toBeLessThanOrEqual(1);
    expect(block.ratio).toBeGreaterThan(0.4);
    // The dark patch sits in the right-most column and bottom row.
    expect(block.bbox.x).toBeCloseTo(0.75, 5);
    expect(block.bbox.y).toBeCloseTo(2 / 3, 5);
  });
});

describe("typography statistics", () => {
  it("median and lower-quartile body size ignore the headline", () => {
    const sizes = [48, 12, 12, 14, 13];
    expect(median(sizes)).toBe(13);
    expect(bodySize(sizes)).toBe(12);
    expect(bodySize([])).toBe(0);
  });
});

describe("thresholds from the rulebook", () => {
  it("reads the published thresholds out of rule config", () => {
    const thresholds = thresholdsFromRules(RULES);
    expect(typeof thresholds.paletteDeltaE).toBe("number");
    expect(thresholds.paletteDeltaE).toBeGreaterThan(0);
  });

  it("falls back to defaults when a config block is malformed", () => {
    const broken = [{ ruleId: "X", config: "not json" }] as never;
    const thresholds = thresholdsFromRules(broken);
    expect(thresholds.paletteDeltaE).toBeGreaterThan(0);
  });
});

describe("logo template", () => {
  it("produces a normalised square mask", () => {
    const mask = logoMask(32);
    expect(mask.width).toBe(32);
    expect(mask.height).toBe(32);
    let min = Infinity;
    let max = -Infinity;
    for (const value of mask.data) {
      min = Math.min(min, value);
      max = Math.max(max, value);
    }
    expect(min).toBeGreaterThanOrEqual(0);
    expect(max).toBeLessThanOrEqual(1);
    expect(max).toBeGreaterThan(min);
  });
});
