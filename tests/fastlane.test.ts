import { describe, expect, it } from "bun:test";
import { runFastLane, paletteFindings } from "../src/convex/lib/fastlane";
import { CLAIMS, GLOSSARY, PALETTE, RULES } from "../src/convex/lib/lumora";

const base = {
  channel: "instagram",
  altText: "",
  hasImage: false,
  rules: RULES,
  claims: CLAIMS,
  glossary: GLOSSARY,
};

describe("fast lane: banned terms and naming", () => {
  it("flags the banned word 'miracle' with its replacement", () => {
    const result = runFastLane({
      ...base,
      text: "This serum is a miracle for your skin.",
    });
    const hit = result.findings.find((f) => f.ruleId === "R-TERM-02");
    expect(hit).toBeDefined();
    expect(hit!.spanText.toLowerCase()).toContain("miracle");
    expect(hit!.suggestedFix).toContain("visible improvement");
    expect(hit!.source).toBe("deterministic");
  });

  it("flags a lowercase brand name and the short product name", () => {
    const result = runFastLane({
      ...base,
      text: "Meet lumora. Glow Serum is back in stock.",
    });
    const naming = result.findings.filter((f) => f.ruleId === "R-TERM-01");
    expect(naming.length).toBeGreaterThanOrEqual(2);
  });

  it("leaves clean copy alone", () => {
    const result = runFastLane({
      ...base,
      text: "Lumora Glow Serum is a daily serum for dry skin. Use it morning and evening.",
    });
    expect(result.findings.filter((f) => f.ruleId === "R-TERM-02")).toHaveLength(0);
  });

  it("reports why and a fix on every finding", () => {
    const result = runFastLane({
      ...base,
      text: "A guaranteed cure, in ALL CAPS shouting.",
    });
    for (const f of result.findings) {
      expect(f.whyItMatters.length).toBeGreaterThan(10);
      expect(f.ruleId.length).toBeGreaterThan(0);
    }
  });
});

describe("fast lane: accessibility and colour", () => {
  it("flags a missing alt text when an image is attached", () => {
    const result = runFastLane({
      ...base,
      hasImage: true,
      altText: "",
      text: "A portrait of the Lumora Glow Serum bottle on a bathroom shelf.",
    });
    expect(result.findings.some((f) => f.ruleId === "R-A11Y-02")).toBe(true);
  });

  it("accepts a described image", () => {
    const result = runFastLane({
      ...base,
      hasImage: true,
      altText: "Amber glass bottle of Lumora Glow Serum beside a folded towel.",
      text: "A portrait of the Lumora Glow Serum bottle on a bathroom shelf.",
    });
    expect(result.findings.some((f) => f.ruleId === "R-A11Y-02")).toBe(false);
  });

  it("flags text that fails WCAG contrast against its background", () => {
    const result = runFastLane({
      ...base,
      text: "Warm light on skin, morning and night.",
      design: { textHex: "#EDE7DC", bgHex: "#F7F3EC" },
    });
    expect(result.findings.some((f) => f.ruleId === "R-A11Y-01")).toBe(true);
  });

  it("accepts text that passes contrast", () => {
    const result = runFastLane({
      ...base,
      text: "Warm light on skin, morning and night.",
      design: { textHex: "#1F1D1A", bgHex: "#F7F3EC" },
    });
    expect(result.findings.some((f) => f.ruleId === "R-A11Y-01")).toBe(false);
  });
});

describe("fast lane: palette distance", () => {
  it("flags an off-palette accent and names the nearest swatch", () => {
    const issues = paletteFindings({
      dominant: [
        { hex: "#F4EFE6", share: 0.6 },
        { hex: "#FF2E93", share: 0.3 },
      ],
      palette: PALETTE,
      rules: RULES,
      text: "Lumora Glow Serum on a bright background.",
    });
    expect(issues).toHaveLength(1);
    expect(issues[0].measuredValue).toContain("ΔE");
    expect(issues[0].suggestedFix).toContain("#");
  });

  it("stays quiet when every colour is in the palette", () => {
    const issues = paletteFindings({
      dominant: [
        { hex: "#F4EFE6", share: 0.7 },
        { hex: "#B4643C", share: 0.3 },
      ],
      palette: PALETTE,
      rules: RULES,
      text: "Lumora Glow Serum on a warm background.",
    });
    expect(issues).toHaveLength(0);
  });
});
