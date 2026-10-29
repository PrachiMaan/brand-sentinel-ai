import { describe, expect, it } from "bun:test";
import {
  contrastRatio,
  deltaE76,
  hexToLab,
  hexToRgb,
  LUMORA_PALETTE,
  nearestPalette,
  relativeLuminance,
  rgbToLab,
} from "../src/convex/lib/color";

describe("WCAG contrast", () => {
  it("black on white is 21:1", () => {
    expect(contrastRatio({ r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 })).toBeCloseTo(21, 5);
  });

  it("a colour against itself is 1:1", () => {
    const c = { r: 180, g: 100, b: 60 };
    expect(contrastRatio(c, c)).toBeCloseTo(1, 5);
  });

  it("white has luminance 1 and black has luminance 0", () => {
    expect(relativeLuminance({ r: 255, g: 255, b: 255 })).toBeCloseTo(1, 5);
    expect(relativeLuminance({ r: 0, g: 0, b: 0 })).toBeCloseTo(0, 5);
  });

  it("Lumora Ink on Bone passes AA for normal text (>= 4.5)", () => {
    const ink = hexToRgb(LUMORA_PALETTE[1].hex)!;
    const bone = hexToRgb(LUMORA_PALETTE[0].hex)!;
    expect(contrastRatio(ink, bone)).toBeGreaterThanOrEqual(4.5);
  });
});

describe("CIELAB palette distance", () => {
  it("identical colours are delta-E 0", () => {
    const lab = rgbToLab({ r: 120, g: 60, b: 40 });
    expect(deltaE76(lab, lab)).toBe(0);
  });

  it("distance is symmetric", () => {
    const a = rgbToLab({ r: 180, g: 100, b: 60 });
    const b = rgbToLab({ r: 40, g: 120, b: 200 });
    expect(deltaE76(a, b)).toBeCloseTo(deltaE76(b, a), 9);
  });

  it("a palette colour matches itself with delta-E 0", () => {
    const clay = nearestPalette("#B4643C", LUMORA_PALETTE.map((p) => p.hex))!;
    expect(clay.hex).toBe("#B4643C");
    expect(clay.deltaE).toBeCloseTo(0, 5);
  });

  it("hot pink is far from every Lumora swatch", () => {
    const pink = nearestPalette("#FF2E93", LUMORA_PALETTE.map((p) => p.hex))!;
    expect(pink.deltaE).toBeGreaterThan(30);
  });

  it("rejects malformed hex", () => {
    expect(hexToRgb("not-a-colour")).toBeNull();
    expect(hexToLab("#12")).toBeNull();
  });

  it("white sits near the top of the L axis", () => {
    expect(rgbToLab({ r: 255, g: 255, b: 255 }).l).toBeCloseTo(100, 0);
  });
});
