/**
 * Brand Drift and Rule Health maths. Pure functions so the Convex mutation, the
 * browser and the independent eval check all use the same definitions.
 */

export type DecisionKind = "accept" | "edit" | "reject" | "escalate";

export type RawDecision = {
  ruleId: string;
  decision: DecisionKind;
  submissionId: string;
  findingId: string;
  createdAt: number;
  actorRole: string;
  synthetic: boolean;
};

export type RawSubmission = {
  id: string;
  team: string;
  channel: string;
  createdAt: number;
  status: string;
  updatedAt: number;
  synthetic: boolean;
};

export type RawFinding = {
  findingId: string;
  submissionId: string;
  ruleId: string;
  ruleTitle: string;
  severity: string;
  createdAt: number;
  status: string;
  spanText: string;
};

export type HealthRow = {
  day: string;
  ruleId: string;
  team: string;
  channel: string;
  findings: number;
  accepted: number;
  edited: number;
  rejected: number;
  overridden: number;
  driftScore: number;
  synthetic: boolean;
};

export const MIN_SAMPLE = 20;
export const SUGGESTION_MIN_SAMPLE = 12;
export const SUGGESTION_OVERRIDE_THRESHOLD = 0.25;

export function dayKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function wilsonInterval(
  successes: number,
  n: number,
  z = 1.96,
): { low: number; high: number } {
  if (n <= 0) return { low: 0, high: 0 };
  const p = successes / n;
  const denom = 1 + (z * z) / n;
  const centre = p + (z * z) / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return {
    low: Math.max(0, (centre - margin) / denom),
    high: Math.min(1, (centre + margin) / denom),
  };
}

export function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1);
  return sorted[Math.max(0, index)];
}

/** Per-day, per-rule, per-team, per-channel counts. Sparse: only observed days. */
export function buildHealthRows(args: {
  submissions: RawSubmission[];
  findings: RawFinding[];
  decisions: RawDecision[];
  ruleIds: string[];
  fromMs: number;
  toMs: number;
}): HealthRow[] {
  const byId = new Map(args.submissions.map((s) => [s.id, s]));
  const ruleSet = new Set(args.ruleIds);
  const buckets = new Map<string, HealthRow>();

  const bucketOf = (submissionId: string, ruleId: string, at: number) => {
    if (!ruleSet.has(ruleId)) return null;
    const submission = byId.get(submissionId);
    const day = dayKey(at);
    const team = submission?.team ?? "Unknown";
    const channel = submission?.channel ?? "unknown";
    const key = `${day}|${ruleId}|${team}|${channel}`;
    let row = buckets.get(key);
    if (!row) {
      row = {
        day,
        ruleId,
        team,
        channel,
        findings: 0,
        accepted: 0,
        edited: 0,
        rejected: 0,
        overridden: 0,
        driftScore: 0,
        synthetic: submission?.synthetic ?? false,
      };
      buckets.set(key, row);
    }
    return row;
  };

  for (const finding of args.findings) {
    if (finding.createdAt < args.fromMs || finding.createdAt > args.toMs) continue;
    const row = bucketOf(finding.submissionId, finding.ruleId, finding.createdAt);
    if (row) row.findings += 1;
  }

  for (const decision of args.decisions) {
    if (decision.createdAt < args.fromMs || decision.createdAt > args.toMs) continue;
    const row = bucketOf(decision.submissionId, decision.ruleId, decision.createdAt);
    if (!row) continue;
    if (decision.decision === "accept") row.accepted += 1;
    else if (decision.decision === "edit") row.edited += 1;
    else if (decision.decision === "reject") row.rejected += 1;
    else row.overridden += 1;
  }

  for (const row of buckets.values()) {
    const decided = row.accepted + row.edited + row.rejected + row.overridden;
    row.driftScore = decided ? Math.round(((decided - row.accepted) / decided) * 1000) / 1000 : 0;
  }

  return Array.from(buckets.values()).sort((a, b) =>
    a.day === b.day ? a.ruleId.localeCompare(b.ruleId) : a.day.localeCompare(b.day),
  );
}

export type RuleSummary = {
  ruleId: string;
  title: string;
  findings: number;
  decisions: number;
  accepted: number;
  edited: number;
  rejected: number;
  escalated: number;
  overridden: number;
  overrideRate: number;
  ciLow: number;
  ciHigh: number;
  enoughData: boolean;
};

export function ruleSummaries(args: {
  health: HealthRow[];
  rules: { ruleId: string; title: string }[];
}): RuleSummary[] {
  const map = new Map<string, RuleSummary>();
  for (const rule of args.rules) {
    map.set(rule.ruleId, {
      ruleId: rule.ruleId,
      title: rule.title,
      findings: 0,
      decisions: 0,
      accepted: 0,
      edited: 0,
      rejected: 0,
      escalated: 0,
      overridden: 0,
      overrideRate: 0,
      ciLow: 0,
      ciHigh: 0,
      enoughData: false,
    });
  }
  for (const row of args.health) {
    const entry = map.get(row.ruleId);
    if (!entry) continue;
    entry.findings += row.findings;
    entry.accepted += row.accepted;
    entry.edited += row.edited;
    entry.rejected += row.rejected;
    entry.escalated += row.overridden;
  }
  for (const entry of map.values()) {
    entry.decisions =
      entry.accepted + entry.edited + entry.rejected + entry.escalated;
    entry.overridden = entry.edited + entry.rejected + entry.escalated;
    entry.overrideRate = entry.decisions
      ? Math.round((entry.overridden / entry.decisions) * 1000) / 10
      : 0;
    const ci = wilsonInterval(entry.overridden, entry.decisions);
    entry.ciLow = Math.round(ci.low * 1000) / 10;
    entry.ciHigh = Math.round(ci.high * 1000) / 10;
    entry.enoughData = entry.decisions >= MIN_SAMPLE;
  }
  return Array.from(map.values()).sort((a, b) => b.overrideRate - a.overrideRate);
}

export type DriftRow = {
  channel: string;
  team: string;
  recentFindings: number;
  recentDecisions: number;
  recentOverrideRate: number;
  baselineFindings: number;
  baselineDecisions: number;
  baselineOverrideRate: number;
  delta: number;
  enoughData: boolean;
};

/** Recent 30-day window versus the 30 days before it. */
export function channelDrift(health: HealthRow[], nowMs: number): DriftRow[] {
  const recentStart = nowMs - 30 * 86_400_000;
  const baselineStart = nowMs - 60 * 86_400_000;
  const map = new Map<string, DriftRow>();
  const touch = (channel: string, team: string) => {
    const key = `${channel}|${team}`;
    let row = map.get(key);
    if (!row) {
      row = {
        channel,
        team,
        recentFindings: 0,
        recentDecisions: 0,
        recentOverrideRate: 0,
        baselineFindings: 0,
        baselineDecisions: 0,
        baselineOverrideRate: 0,
        delta: 0,
        enoughData: false,
      };
      map.set(key, row);
    }
    return row;
  };
  for (const row of health) {
    const at = Date.parse(`${row.day}T00:00:00Z`);
    const target = touch(row.channel, row.team);
    const decided = row.accepted + row.edited + row.rejected + row.overridden;
    const override = row.edited + row.rejected + row.overridden;
    if (at >= recentStart) {
      target.recentFindings += row.findings;
      target.recentDecisions += decided;
      target.recentOverrideRate += override;
    } else if (at >= baselineStart) {
      target.baselineFindings += row.findings;
      target.baselineDecisions += decided;
      target.baselineOverrideRate += override;
    }
  }
  for (const row of map.values()) {
    row.recentOverrideRate = row.recentDecisions
      ? Math.round((row.recentOverrideRate / row.recentDecisions) * 1000) / 10
      : 0;
    row.baselineOverrideRate = row.baselineDecisions
      ? Math.round((row.baselineOverrideRate / row.baselineDecisions) * 1000) / 10
      : 0;
    row.delta = Math.round((row.recentOverrideRate - row.baselineOverrideRate) * 10) / 10;
    row.enoughData = row.recentDecisions >= 10 && row.baselineDecisions >= 10;
  }
  return Array.from(map.values()).sort((a, b) => b.delta - a.delta);
}

export type Suggestion = {
  ruleId: string;
  proposedWording: string;
  rationale: string;
  evidenceDecisionIds: string[];
  method: "template" | "model";
};

/**
 * Deterministic rewording proposal. It quotes the published rule, counts the
 * disagreements and names the contested language from real decisions. It never
 * invents evidence: if there are no decisions with reasons, there is no suggestion.
 */
export function buildSuggestion(args: {
  ruleId: string;
  title: string;
  description: string;
  sourceExcerpt: string;
  decisions: (RawDecision & { reason?: string; spanText?: string })[];
}): Suggestion | null {
  const disagreed = args.decisions.filter((d) => d.decision !== "accept");
  if (disagreed.length < SUGGESTION_MIN_SAMPLE) return null;
  const rate = disagreed.length / Math.max(1, args.decisions.length);
  if (rate < SUGGESTION_OVERRIDE_THRESHOLD) return null;

  const reasons = disagreed
    .map((d) => (d.reason ?? "").trim())
    .filter((r) => r.length > 3);
  const spans = disagreed
    .map((d) => (d.spanText ?? "").trim())
    .filter((s) => s.length > 2);

  const countBy = (values: string[]) => {
    const counts = new Map<string, number>();
    for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  };
  const topReasons = countBy(reasons.map((r) => r.toLowerCase())).slice(0, 2);
  const topSpans = countBy(spans.map((s) => s.toLowerCase())).slice(0, 3);

  if (!topReasons.length && !topSpans.length) return null;

  const evidence = disagreed
    .slice(-8)
    .map((d) => d.findingId)
    .filter(Boolean);

  const conflictLine = topSpans.length
    ? `Reviewers most often disagree on: ${topSpans.map(([s]) => `"${s.slice(0, 60)}"`).join(", ")}.`
    : "";
  const reasonLine = topReasons.length
    ? `Recorded reasons cluster around: ${topReasons.map(([r]) => `"${r.slice(0, 60)}"`).join(", ")}.`
    : "";

  const proposedWording = [
    `${args.title}. ${args.description}`,
    `When a reviewer disagrees, the deciding factor is the published example below, not personal preference.`,
    conflictLine ? `Boundary cases: ${conflictLine.replace("Reviewers most often disagree on: ", "")}` : "",
    `If a case is not covered, escalate it rather than stretching this rule.`,
  ]
    .filter(Boolean)
    .join(" ");

  return {
    ruleId: args.ruleId,
    proposedWording,
    rationale: [
      `Override rate ${(rate * 100).toFixed(0)}% across ${args.decisions.length} decisions (${disagreed.length} disagreements).`,
      reasonLine,
      `Original wording: "${args.sourceExcerpt.slice(0, 180)}"`,
      "Generated from a fixed template over the recorded decisions; no model was used.",
    ]
      .filter(Boolean)
      .join(" "),
    evidenceDecisionIds: evidence,
    method: "template",
  };
}

/** Deterministic PRNG so the synthetic history is reproducible. */
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
