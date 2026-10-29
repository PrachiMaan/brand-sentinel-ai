/**
 * Visual engine eval. Runs the production engine over the fixture decks and
 * measures, per injected violation, whether it was found and how well the
 * reported box matches the ground truth box (IoU).
 *
 * The fixtures are rendered in-process (scripts/lib/raster.mjs) from the same
 * geometry as the PDFs because this environment has no canvas backend for
 * pdf.js. That limitation is printed with the results and recorded in
 * docs/KNOWN_LIMITATIONS.md.
 *
 * Run: bun run eval:visual
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { decodePng } from "../scripts/lib/raster.mjs";
import { analyseDeck } from "../src/convex/lib/visual";
import type { PageInput, TextItem } from "../src/convex/lib/visual";
import { RULES, PALETTE } from "../src/convex/lib/lumora";

type Fixture = {
  deckId: string;
  pdf: string;
  pages: { page: number; png: string; textItems: TextItem[] }[];
  groundTruth: {
    violations: { ruleId: string; page: number; bbox: { x: number; y: number; w: number; h: number }; note: string }[];
  };
};

const fixtures = JSON.parse(readFileSync("eval/visual-fixtures.json", "utf8")) as {
  decks: Fixture[];
};

function iou(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
) {
  const x0 = Math.max(a.x, b.x);
  const y0 = Math.max(a.y, b.y);
  const x1 = Math.min(a.x + a.w, b.x + b.w);
  const y1 = Math.min(a.y + a.h, b.y + b.h);
  const intersection = Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
  const union = a.w * a.h + b.w * b.h - intersection;
  return union > 0 ? intersection / union : 0;
}

const visualRules = RULES.filter((rule) => rule.ruleId.startsWith("VIS-"));
const palette = PALETTE.map((entry) => entry.hex);

const decks = [];
for (const deck of fixtures.decks) {
  const pages: PageInput[] = [];
  for (const page of deck.pages) {
    const png = decodePng(readFileSync(page.png));
    pages.push({ page: page.page, image: png, text: page.textItems });
  }
  const analysisStart = performance.now();
  const result = analyseDeck({ pages, rules: visualRules, palette });
  const analysisMs = performance.now() - analysisStart;
  const violations = deck.groundTruth.violations.map((truth) => {
    const match = result.findings
      .filter((finding) => finding.ruleId === truth.ruleId && finding.page === truth.page)
      .map((finding) => ({
        finding,
        iou: finding.bbox ? iou(finding.bbox, truth.bbox) : 0,
      }))
      .sort((a, b) => b.iou - a.iou)[0];
    return {
      ruleId: truth.ruleId,
      page: truth.page,
      note: truth.note,
      detected: Boolean(match),
      iou: match ? Math.round(match.iou * 1000) / 1000 : 0,
      measured: match?.finding.measured ?? null,
      bbox: match?.finding.bbox ?? null,
      truthBbox: truth.bbox,
    };
  });

  const unexpected = result.findings.filter(
    (finding) =>
      !deck.groundTruth.violations.some(
        (truth) => truth.ruleId === finding.ruleId && truth.page === finding.page,
      ),
  );

  decks.push({
    deckId: deck.deckId,
    pdf: deck.pdf,
    pages: pages.length,
    findings: result.findings.length,
    expected: violations.length,
    detected: violations.filter((v) => v.detected).length,
    detectedWithIou: violations.filter((v) => v.detected && v.iou >= 0.7).length,
    meanIou:
      violations.length
        ? Math.round(
            (violations.reduce((sum, v) => sum + v.iou, 0) / violations.length) * 1000,
          ) / 1000
        : 0,
    analysisMs: Math.round(analysisMs * 100) / 100,
    msPerPage: Math.round((analysisMs / pages.length) * 100) / 100,
    violations,
    unexpected: unexpected.map((finding) => ({
      ruleId: finding.ruleId,
      page: finding.page,
      measured: finding.measured,
    })),
  });
}

// Box accuracy is asserted for the checks whose evidence is a located mark or
// colour region. Typography is a page-level check; its IoU is reported but not a
// pass condition.
const BOX_RULES = ["VIS-LOGO-MARGIN", "VIS-LOGO-CLEARSPACE", "VIS-PALETTE", "VIS-LOGO-PRESENT"];

const expectations = [
  {
    check: "Every injected logo/margin/clear-space and palette violation found",
    pass: decks.every((deck) =>
      deck.violations.filter((v) => BOX_RULES.includes(v.ruleId)).every((v) => v.detected),
    ),
  },
  {
    check: "Those violations have IoU >= 0.70",
    pass: decks.every((deck) =>
      deck.violations.filter((v) => BOX_RULES.includes(v.ruleId)).every((v) => v.iou >= 0.7),
    ),
  },
  {
    check: "Clean deck produces zero visual findings",
    pass: decks.find((deck) => deck.deckId === "clean")?.findings === 0,
  },
  {
    check: "No unexpected findings on the violations deck pages",
    pass: (decks.find((deck) => deck.deckId === "violations")?.unexpected.length ?? 1) === 0,
  },
  {
    check: "Density points at the dense region (IoU >= 0.70)",
    pass: (decks.find((deck) => deck.deckId === "violations")?.violations ?? [])
      .filter((violation) => violation.ruleId === "VIS-DENSITY")
      .every((violation) => violation.detected && violation.iou >= 0.7),
  },
];

const report = {
  generatedAt: new Date().toISOString(),
  engine: "deterministic (lib/visual.ts)",
  raster:
    "Pages decoded from the fixture PNGs generated from the same geometry as the PDFs; no canvas backend in this environment.",
  decks,
  expectations,
  passed: expectations.filter((e) => e.pass).length,
  total: expectations.length,
};

mkdirSync("eval", { recursive: true });
writeFileSync("eval/visual-results.json", `${JSON.stringify(report, null, 2)}\n`);

const lines = [
  "Visual engine eval",
  "==================",
  ...decks.map(
    (deck) =>
      `${deck.deckId.padEnd(11)} pages ${String(deck.pages).padStart(2)}  findings ${String(
        deck.findings,
      ).padStart(2)}  expected ${String(deck.expected).padStart(2)}  detected ${String(
        deck.detected,
      ).padStart(2)}  IoU>=0.7 ${String(deck.detectedWithIou).padStart(2)}  meanIoU ${deck.meanIou}  ${deck.msPerPage} ms/page`,
  ),
  "",
  "Per violation",
  ...decks.flatMap((deck) =>
    deck.violations.map(
      (v) =>
        `  ${deck.deckId.padEnd(10)} p${String(v.page).padStart(2)}  ${v.ruleId.padEnd(20)} ${
          v.detected ? "FOUND" : "MISS "
        }  IoU ${v.iou.toFixed(2)}  ${v.measured ?? ""}`,
    ),
  ),
  "",
  ...report.expectations.map((e) => `  [${e.pass ? "PASS" : "FAIL"}] ${e.check}`),
];
const text = lines.join("\n");
writeFileSync("eval/visual-results.md", `${text}\n`);
console.log(text);
