/**
 * Independent consistency check for the Brand Drift and Rule Health maths.
 *
 *   bun run eval:analytics
 *
 * It does not read the database. It regenerates the deterministic 90-day
 * history, aggregates it with the production functions, then recomputes the
 * same numbers with a separate, deliberately naive implementation and asserts
 * that the two agree. It also checks idempotency (running the aggregation twice
 * produces byte-identical rows) and reports the top drifting channel.
 *
 * Everything here is deterministic: no network, no model, fixed clock.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import {
  buildHealthRows,
  buildSuggestion,
  ruleSummaries,
  type RawDecision,
  type RawFinding,
  type RawSubmission,
} from "../src/convex/lib/analytics";
import { HISTORY_DAYS, planHistory } from "../src/convex/lib/history";
import { RULES } from "../src/convex/lib/lumora";

const NOW = Date.parse("2026-10-24T09:30:00.000Z");
const DAY = 86_400_000;

const planned = planHistory({ fromDay: 0, toDay: HISTORY_DAYS, nowMs: NOW });

const submissions: RawSubmission[] = planned.map((s, i) => ({
  id: `s${i}`,
  team: s.team,
  channel: s.channel,
  createdAt: s.createdAt,
  status: s.status,
  updatedAt: s.updatedAt,
  synthetic: true,
}));

const findings: RawFinding[] = [];
const decisions: RawDecision[] = [];
planned.forEach((submission, i) => {
  submission.findings.forEach((finding, j) => {
    findings.push({
      findingId: `f${i}-${j}`,
      submissionId: `s${i}`,
      ruleId: finding.ruleId,
      ruleTitle: finding.title,
      severity: finding.severity,
      createdAt: finding.atMs,
      status: finding.status,
      spanText: finding.spanText,
    });
    if (finding.decision) {
      decisions.push({
        ruleId: finding.ruleId,
        decision: finding.decision.kind,
        submissionId: `s${i}`,
        findingId: `f${i}-${j}`,
        createdAt: finding.decision.atMs,
        actorRole: finding.decision.actorRole,
        synthetic: true,
      });
    }
  });
});

const ruleIds = RULES.map((r) => r.ruleId);
const from = NOW - HISTORY_DAYS * DAY;
const to = NOW;

const health = buildHealthRows({
  submissions,
  findings,
  decisions,
  ruleIds,
  fromMs: from,
  toMs: to,
});

const summaries = ruleSummaries({
  health,
  rules: RULES.map((r) => ({ ruleId: r.ruleId, title: r.title })),
});

/* ------------------------------------------------------------------ */
/* Independent recomputation (no shared helpers)                       */
/* ------------------------------------------------------------------ */

const failures: string[] = [];

const naive = new Map<
  string,
  { findings: number; accepted: number; edited: number; rejected: number; escalated: number }
>();
for (const ruleId of ruleIds) {
  naive.set(ruleId, { findings: 0, accepted: 0, edited: 0, rejected: 0, escalated: 0 });
}
for (const f of findings) {
  if (f.createdAt < from || f.createdAt > to) continue;
  const entry = naive.get(f.ruleId);
  if (entry) entry.findings += 1;
}
for (const d of decisions) {
  if (d.createdAt < from || d.createdAt > to) continue;
  const entry = naive.get(d.ruleId);
  if (!entry) continue;
  if (d.decision === "accept") entry.accepted += 1;
  else if (d.decision === "edit") entry.edited += 1;
  else if (d.decision === "reject") entry.rejected += 1;
  else entry.escalated += 1;
}

/** Wilson score interval, written out again on purpose. */
function wilson(successes: number, n: number): { low: number; high: number } {
  if (n <= 0) return { low: 0, high: 0 };
  const z = 1.96;
  const phat = successes / n;
  const denom = 1 + (z * z) / n;
  const centre = phat + (z * z) / (2 * n);
  const half = z * Math.sqrt((phat * (1 - phat)) / n + (z * z) / (4 * n * n));
  return {
    low: Math.max(0, (centre - half) / denom),
    high: Math.min(1, (centre + half) / denom),
  };
}

for (const summary of summaries) {
  const entry = naive.get(summary.ruleId)!;
  const decisionsCount = entry.accepted + entry.edited + entry.rejected + entry.escalated;
  const overridden = entry.edited + entry.rejected + entry.escalated;
  const rate = decisionsCount
    ? Math.round((overridden / decisionsCount) * 1000) / 10
    : 0;
  const ci = wilson(overridden, decisionsCount);
  const checks: [string, number, number][] = [
    ["findings", summary.findings, entry.findings],
    ["decisions", summary.decisions, decisionsCount],
    ["accepted", summary.accepted, entry.accepted],
    ["edited", summary.edited, entry.edited],
    ["rejected", summary.rejected, entry.rejected],
    ["overrideRate", summary.overrideRate, rate],
    ["ciLow", summary.ciLow, Math.round(ci.low * 1000) / 10],
    ["ciHigh", summary.ciHigh, Math.round(ci.high * 1000) / 10],
  ];
  for (const [label, stored, recomputed] of checks) {
    if (stored !== recomputed) {
      failures.push(
        `${summary.ruleId}.${label}: stored ${stored} vs recomputed ${recomputed}`,
      );
    }
  }
}

/* Idempotency: two runs over identical input must be identical. */
const healthAgain = buildHealthRows({
  submissions,
  findings,
  decisions,
  ruleIds,
  fromMs: from,
  toMs: to,
});
const idempotent = JSON.stringify(healthAgain) === JSON.stringify(health);
if (!idempotent) failures.push("buildHealthRows is not idempotent over identical input.");

/* ------------------------------------------------------------------ */
/* Drift by channel: first half vs second half of the window           */
/* ------------------------------------------------------------------ */

const midpoint = from + (to - from) / 2;
const byChannel = new Map<string, { early: number[]; late: number[] }>();
for (const f of findings) {
  if (f.createdAt < from || f.createdAt > to) continue;
  const submission = submissions.find((s) => s.id === f.submissionId);
  if (!submission) continue;
  const bucket = byChannel.get(submission.channel) ?? { early: [], late: [] };
  (f.createdAt < midpoint ? bucket.early : bucket.late).push(f.createdAt);
  byChannel.set(submission.channel, bucket);
}
const drift = Array.from(byChannel.entries())
  .map(([channel, buckets]) => {
    const earlyRate = buckets.early.length / Math.max(1, HISTORY_DAYS / 2);
    const lateRate = buckets.late.length / Math.max(1, HISTORY_DAYS / 2);
    return {
      channel,
      earlyPerDay: Math.round(earlyRate * 100) / 100,
      latePerDay: Math.round(lateRate * 100) / 100,
      change: Math.round((lateRate - earlyRate) * 100) / 100,
      findings: buckets.early.length + buckets.late.length,
    };
  })
  .sort((a, b) => b.change - a.change);

/* ------------------------------------------------------------------ */
/* Suggested rewordings from real decisions                            */
/* ------------------------------------------------------------------ */

const decisionsWithEvidence = new Map<string, (RawDecision & { reason?: string; spanText?: string })[]>();
for (const d of decisions) {
  const finding = findings.find((f) => f.findingId === d.findingId);
  const list = decisionsWithEvidence.get(d.ruleId) ?? [];
  list.push({
    ...d,
    reason: reasonFor(d.findingId),
    spanText: finding?.spanText,
  });
  decisionsWithEvidence.set(d.ruleId, list);
}

function reasonFor(findingId: string): string | undefined {
  const match = /^f(\d+)-(\d+)$/.exec(findingId);
  if (!match) return undefined;
  const i = Number(match[1]);
  const j = Number(match[2]);
  return planned[i]?.findings[j]?.decision?.reason;
}

const suggestions = RULES.map((rule) =>
  buildSuggestion({
    ruleId: rule.ruleId,
    title: rule.title,
    description: rule.description,
    sourceExcerpt: rule.sourceExcerpt,
    decisions: decisionsWithEvidence.get(rule.ruleId) ?? [],
  }),
).filter((s): s is NonNullable<typeof s> => Boolean(s));

for (const suggestion of suggestions) {
  if (suggestion.evidenceDecisionIds.length < 2) {
    failures.push(`${suggestion.ruleId}: suggestion cites fewer than two decisions`);
  }
}

const rulesWithDecisions = summaries.filter((s) => s.decisions > 0).length;
const judgeable = summaries.filter((s) => s.enoughData).length;

const report = {
  generatedAt: new Date().toISOString(),
  check: "analytics-consistency",
  input: {
    plannedSubmissions: planned.length,
    plannedFindings: findings.length,
    decisions: decisions.length,
    windowDays: HISTORY_DAYS,
    rules: ruleIds.length,
    note: "Synthetic Lumora data, generated by lib/history.planHistory with a fixed seed and clock.",
  },
  storedVsRecomputed: {
    rulesCompared: summaries.length,
    fieldsPerRule: 8,
    mismatches: failures.filter((f) => !f.startsWith("buildHealthRows")).length,
    idempotent,
  },
  coverage: {
    rulesWithDecisions,
    rulesWithEnoughData: judgeable,
    minSample: 20,
  },
  drift: {
    topChannel: drift[0]?.channel ?? null,
    rows: drift,
  },
  suggestions: {
    count: suggestions.length,
    ruleIds: suggestions.map((s) => s.ruleId),
    methods: Array.from(new Set(suggestions.map((s) => s.method))),
    allCiteEvidence: suggestions.every((s) => s.evidenceDecisionIds.length >= 2),
  },
  failures,
  passed: failures.length === 0,
};

mkdirSync("eval", { recursive: true });
writeFileSync("eval/analytics-results.json", `${JSON.stringify(report, null, 2)}\n`);

console.log(`Analytics check`);
console.log(`  submissions ${report.input.plannedSubmissions} · findings ${report.input.plannedFindings} · decisions ${report.input.decisions}`);
console.log(`  rules compared ${report.storedVsRecomputed.rulesCompared} × ${report.storedVsRecomputed.fieldsPerRule} fields`);
console.log(`  idempotent: ${idempotent}`);
console.log(`  top drifting channel: ${report.drift.topChannel ?? "none"}`);
console.log(`  suggestions: ${suggestions.length} (${suggestions.map((s) => s.ruleId).join(", ") || "none"})`);
if (failures.length) {
  console.error(`FAILURES (${failures.length}):`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("PASS: stored aggregates match the independent recomputation.");
