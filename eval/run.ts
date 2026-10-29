/**
 * BrandSentinel evaluation runner.
 *
 * Runs the exact production pipeline module over the seeded Lumora red-team set.
 * No HTTP, no mocks, no tuning: whatever the pipeline returns is what is reported.
 *
 *   bun run eval
 *
 * Requires VLY_INTEGRATION_KEY (or OPENAI_API_KEY) in the local environment.
 * Pull it from the Convex deployment without echoing it:
 *   VLY_INTEGRATION_KEY=$(bunx convex env get VLY_INTEGRATION_KEY) bun run eval
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { runPipeline } from "../src/convex/ai/pipeline";
import type { PipelineBrand } from "../src/convex/ai/pipeline";
import {
  CLAIMS,
  GLOSSARY,
  GUIDELINE_DOCUMENT,
  PALETTE,
  RULES,
  VOICE,
} from "../src/convex/lib/lumora";

type EvalItem = {
  id: string;
  mode: string;
  text: string;
  channel: string;
  audience: string;
  altText: string;
  hasImage: boolean;
  design?: { textHex?: string; bgHex?: string };
  imagePalette?: { hex: string; share: number }[];
  expectedRules: string[];
  expectedModes: string[];
};

const brand: PipelineBrand = {
  name: "Lumora",
  rules: RULES,
  claims: CLAIMS.map((claim) => ({ ...claim, expiresAt: claim.expiresAt ?? null })),
  glossary: GLOSSARY.map((entry) => ({
    term: entry.term,
    status: entry.status,
    replacement: entry.replacement,
    note: entry.note,
  })),
  palette: PALETTE,
  voice: VOICE,
};

const MODES = [
  "tone",
  "naming",
  "terminology",
  "unsupported_claim",
  "expired_claim",
  "visual",
  "accessibility",
] as const;
type Mode = (typeof MODES)[number];

const items: EvalItem[] = JSON.parse(readFileSync("eval/dataset.json", "utf8"));
const CONCURRENCY = Number(process.env.EVAL_CONCURRENCY ?? 4);

function ruleMode(ruleId: string): Mode | "other" {
  if (ruleId.startsWith("R-TONE")) return "tone";
  if (ruleId.startsWith("R-TERM-02")) return "terminology";
  if (ruleId.startsWith("R-TERM") || ruleId.startsWith("R-CHAN")) return "naming";
  if (ruleId.startsWith("R-CLAIM-03")) return "expired_claim";
  if (ruleId.startsWith("R-CLAIM")) return "unsupported_claim";
  if (ruleId.startsWith("R-VIS")) return "visual";
  if (ruleId.startsWith("R-A11Y")) return "accessibility";
  return "other";
}

const median = (values: number[]) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

const round = (value: number) => Math.round(value * 1000) / 1000;

async function runItem(item: EvalItem) {
  try {
    const result = await runPipeline(
      {
        text: item.text,
        channel: item.channel,
        audience: item.audience,
        altText: item.altText,
        hasImage: item.hasImage,
        design: item.design,
        imagePalette: item.imagePalette,
      },
      brand,
      { guidelineText: GUIDELINE_DOCUMENT, today: "2026-10-23" },
    );
    return {
      id: item.id,
      mode: item.mode,
      expectedRules: item.expectedRules,
      expectedModes: item.expectedModes,
      findings: result.findings.map((f) => ({
        ruleId: f.ruleId,
        reviewer: f.reviewer,
        severity: f.severity,
        bucket: f.bucket,
        source: f.source,
        spanText: f.spanText,
        claimStatus: f.claimStatus ?? null,
      })),
      verifier: result.verifier,
      fastMs: result.fastMs,
      deepMs: result.deepMs,
      totalMs: result.totalMs,
      model: result.model,
      provider: result.provider,
      redactions: result.redactions,
      errors: result.errors,
      droppedLog: result.droppedLog.map((d) => ({
        ruleId: d.ruleId,
        reason: d.reason,
      })),
    };
  } catch (error) {
    return {
      id: item.id,
      mode: item.mode,
      expectedRules: item.expectedRules,
      expectedModes: item.expectedModes,
      findings: [],
      verifier: {
        total: 0,
        kept: 0,
        dropped: 0,
        needsHuman: 0,
        droppedSpan: 0,
        droppedRule: 0,
        droppedExcerpt: 0,
        droppedClaim: 0,
        evidenceRate: 0,
      },
      fastMs: 0,
      deepMs: 0,
      totalMs: 0,
      redactions: 0,
      errors: [error instanceof Error ? error.message : String(error)],
      droppedLog: [],
    };
  }
}

console.log(`BrandSentinel eval: ${items.length} seeded items, concurrency ${CONCURRENCY}`);
console.log(
  `Provider: ${process.env.AI_PROVIDER ?? "vly"} · model: ${
    process.env.AI_MODEL_FAST ?? process.env.AI_MODEL ?? "gpt-4o-mini"
  }\n`,
);

const results: Awaited<ReturnType<typeof runItem>>[] = [];
for (let i = 0; i < items.length; i += CONCURRENCY) {
  const chunk = items.slice(i, i + CONCURRENCY);
  const started = Date.now();
  const settled = await Promise.all(chunk.map(runItem));
  results.push(...settled);
  console.log(
    `  ${Math.min(i + CONCURRENCY, items.length)}/${items.length} (${(
      (Date.now() - started) / 1000
    ).toFixed(1)}s)`,
  );
}

const byId = new Map(results.map((result) => [result.id, result]));
const perMode: Record<
  string,
  { expected: number; predicted: number; matched: number; falsePositives: number }
> = Object.fromEntries(
  MODES.map((mode) => [
    mode,
    { expected: 0, predicted: 0, matched: 0, falsePositives: 0 },
  ]),
);

let modelFindings = 0;
let validEvidence = 0;
let suppressed = 0;
let needsHuman = 0;
let errorCount = 0;
let injectionHandled = 0;
let injectionItems = 0;
const fastTimes: number[] = [];
const fullTimes: number[] = [];
const failures: unknown[] = [];

for (const item of items) {
  const result = byId.get(item.id);
  if (!result) continue;
  const predictedModes = new Set(
    result.findings
      .map((finding) => ruleMode(finding.ruleId))
      .filter((mode): mode is Mode => mode !== "other"),
  );
  const expectedModes = new Set(
    item.expectedModes.filter((mode): mode is Mode => MODES.includes(mode as Mode)),
  );
  const missed = [...expectedModes].filter((mode) => !predictedModes.has(mode));
  if (missed.length) {
    failures.push({
      id: item.id,
      mode: item.mode,
      expectedModes: [...expectedModes],
      predictedModes: [...predictedModes],
      expectedRules: item.expectedRules,
      text: item.text.slice(0, 160),
    });
  }
  for (const mode of MODES) {
    if (expectedModes.has(mode)) {
      perMode[mode].expected++;
      if (predictedModes.has(mode)) perMode[mode].matched++;
    }
    if (predictedModes.has(mode)) {
      perMode[mode].predicted++;
      if (!expectedModes.has(mode)) perMode[mode].falsePositives++;
    }
  }
  modelFindings += result.verifier.total;
  validEvidence += result.verifier.kept;
  suppressed += result.verifier.dropped;
  needsHuman += result.verifier.needsHuman;
  errorCount += result.errors.length;
  fastTimes.push(result.fastMs);
  fullTimes.push(result.totalMs);
  if (item.mode === "injection") {
    injectionItems++;
    // A probe is handled when the expected rule findings still fire. Reviewer
    // failures are tracked separately so an unavailable model does not hide
    // whether the injection was obeyed.
    if (missed.length === 0 && result.findings.length > 0) injectionHandled++;
  }
}

const byFailureMode = MODES.map((mode) => {
  const row = perMode[mode];
  return {
    mode,
    expected: row.expected,
    predicted: row.predicted,
    matched: row.matched,
    falsePositives: row.falsePositives,
    precision: round(row.predicted ? row.matched / row.predicted : 0),
    recall: round(row.expected ? row.matched / row.expected : 0),
  };
});

const totalExpected = byFailureMode.reduce((sum, row) => sum + row.expected, 0);
const totalPredicted = byFailureMode.reduce((sum, row) => sum + row.predicted, 0);
const totalMatched = byFailureMode.reduce((sum, row) => sum + row.matched, 0);
const precision = totalPredicted ? totalMatched / totalPredicted : 0;
const recall = totalExpected ? totalMatched / totalExpected : 0;

const deterministicFindings = results.reduce(
  (sum, result) => sum + result.findings.filter((f) => f.source === "deterministic").length,
  0,
);
const modelReturned = results.reduce(
  (sum, result) => sum + result.findings.filter((f) => f.source !== "deterministic").length,
  0,
);
const deepLane = {
  reviewerCalls: items.length * 5,
  reviewerFailures: errorCount,
  available: errorCount < items.length * 5,
};

const notes: string[] = [];
if (!deepLane.available) {
  const allErrors = results.flatMap((r) => r.errors ?? []);
  const cause = allErrors.length
    ? Array.from(
        new Set(
          allErrors.map((error) =>
            /no model credentials/i.test(error)
              ? "no model credentials configured for this run"
              : /quota|budget|spend/i.test(error)
                ? "the model budget was exhausted"
                : /rate limit/i.test(error)
                  ? "the provider rate-limited the run"
                  : "the gateway returned an error",
          ),
        ),
      ).join(", ")
    : "the reviewer calls did not return";
  notes.push(
    `The model-backed deep lane returned no findings in this run: every reviewer call failed (${cause}). The table above therefore measures the deterministic rule engine only. It is not a measurement of the full two-lane pipeline.`,
  );
} else if (deepLane.reviewerFailures) {
  notes.push(
    `The deep lane partially failed: ${deepLane.reviewerFailures} of ${deepLane.reviewerCalls} reviewer calls errored, so this run mixes model and rule-engine findings.`,
  );
}
const weakest = [...byFailureMode].sort((a, b) => a.recall - b.recall)[0];
const noisiest = [...byFailureMode].sort((a, b) => a.precision - b.precision)[0];
notes.push(
  `Weakest recall: ${weakest.mode} at ${Math.round(weakest.recall * 100)}% (${weakest.matched}/${weakest.expected}).`,
);
notes.push(
  `Lowest precision: ${noisiest.mode} at ${Math.round(noisiest.precision * 100)}%, ${noisiest.falsePositives} item(s) flagged without that expected mode.`,
);
notes.push(
  `${suppressed} of ${modelFindings} model findings (${Math.round(
    (suppressed / Math.max(modelFindings, 1)) * 100,
  )}%) were suppressed by the verifier; ${needsHuman} went to the human bucket.`,
);
if (errorCount) {
  notes.push(
    `${errorCount} reviewer error(s) occurred. Affected items keep their fast-lane findings and are counted as misses, not dropped from the set.`,
  );
}
if (injectionItems) {
  notes.push(
    `Prompt injection: ${injectionHandled}/${injectionItems} probes were treated as data while their expected findings still fired.`,
  );
}
notes.push(
  "Matching is item-level per failure mode, not exact wording. Any finding on a clean control counts against that mode's precision, which is why clean controls dominate false positives.",
);

const output = {
  generatedAt: new Date().toISOString(),
  dataset: "eval/dataset.json",
  pipeline: "src/convex/ai/pipeline.ts",
  model: results[0]?.model ?? null,
  provider: results[0]?.provider ?? null,
  itemCount: items.length,
  overall: {
    precision: round(precision),
    recall: round(recall),
    f1: round(precision + recall ? (2 * precision * recall) / (precision + recall) : 0),
    expected: totalExpected,
    predicted: totalPredicted,
    matched: totalMatched,
  },
  byFailureMode,
  evidence: {
    modelFindings,
    validEvidence,
    validityPct: modelFindings
      ? round((validEvidence / modelFindings) * 100)
      : null,
    suppressed,
    needsHuman,
  },
  timing: {
    fastMedianMs: round(median(fastTimes)),
    fullMedianMs: round(median(fullTimes)),
  },
  injection: { items: injectionItems, handled: injectionHandled },
  errors: errorCount,
  deepLane,
  findingsBySource: { deterministic: deterministicFindings, model: modelReturned },
  failures,
  notes,
  items: items.map((item) => {
    const result = byId.get(item.id)!;
    return {
      id: item.id,
      mode: item.mode,
      expectedRules: item.expectedRules,
      ruleIds: result.findings.map((finding) => finding.ruleId),
      findingCount: result.findings.length,
      suppressed: result.verifier.dropped,
      fastMs: result.fastMs,
      totalMs: result.totalMs,
      errors: result.errors,
    };
  }),
};

mkdirSync("eval", { recursive: true });
mkdirSync("public/eval", { recursive: true });
writeFileSync("eval/results.json", JSON.stringify(output, null, 2));
writeFileSync("public/eval/results.json", JSON.stringify(output, null, 2));

const lines = [
  "| Failure mode | Expected | Predicted | Matched | Precision | Recall |",
  "| --- | ---: | ---: | ---: | ---: | ---: |",
  ...byFailureMode.map(
    (row) =>
      `| ${row.mode} | ${row.expected} | ${row.predicted} | ${row.matched} | ${(
        row.precision * 100
      ).toFixed(0)}% | ${(row.recall * 100).toFixed(0)}% |`,
  ),
  `| **Overall** | ${totalExpected} | ${totalPredicted} | ${totalMatched} | ${(
    precision * 100
  ).toFixed(0)}% | ${(recall * 100).toFixed(0)}% |`,
  "",
  `- Items: ${items.length}`,
  `- Evidence validity: ${
    output.evidence.validityPct === null
      ? "not measured (no model findings returned)"
      : `${output.evidence.validityPct}% (${validEvidence}/${modelFindings} model findings kept)`
  }`,
  `- Suppressed by verifier: ${suppressed}`,
  `- Needs human: ${needsHuman}`,
  `- Median fast lane: ${output.timing.fastMedianMs}ms`,
  `- Median full report: ${(output.timing.fullMedianMs / 1000).toFixed(1)}s`,
  `- Prompt-injection probes handled: ${injectionHandled}/${injectionItems}`,
  `- Reviewer errors: ${errorCount}`,
  "",
  ...notes.map((note) => `- ${note}`),
];
writeFileSync("eval/results.md", lines.join("\n") + "\n");

console.log("\n" + lines.join("\n"));
console.log(
  `\nWrote eval/results.json, eval/results.md and public/eval/results.json (${(
    (Date.now() - Number(process.env.EVAL_START ?? Date.now())) / 1000
  ).toFixed(1)}s)`,
);
