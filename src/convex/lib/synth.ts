import type { Finding, Severity } from "./types";
import { SEVERITY_RANK } from "./types";

export type SynthesisResult = {
  findings: Finding[];
  brandFit: number;
  counts: Record<Severity, number>;
  duplicateCount: number;
  summary: string;
};

const overlap = (a: Finding, b: Finding) => {
  if (a.spanStart === b.spanStart && a.spanEnd === b.spanEnd) return true;
  const start = Math.max(a.spanStart, b.spanStart);
  const end = Math.min(a.spanEnd, b.spanEnd);
  const intersection = Math.max(0, end - start);
  const shortest = Math.min(
    a.spanEnd - a.spanStart || 1,
    b.spanEnd - b.spanStart || 1,
  );
  return intersection / shortest > 0.6;
};

/**
 * Deduplicate and rank. Nothing is rewritten here: fixes stay suggestions and
 * every finding keeps its reviewer, evidence and rule.
 */
export function synthesize(findings: Finding[]): SynthesisResult {
  const ordered = [...findings].sort((a, b) => {
    // Deterministic evidence wins ties: it was computed, not quoted.
    if (a.source !== b.source) return a.source === "deterministic" ? -1 : 1;
    if (a.severity !== b.severity) {
      return SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    }
    return b.confidence - a.confidence;
  });

  const kept: Finding[] = [];
  let duplicateCount = 0;
  for (const f of ordered) {
    const duplicate = kept.find(
      (k) => k.ruleId === f.ruleId && overlap(k, f),
    );
    if (duplicate) {
      duplicateCount++;
      continue;
    }
    kept.push(f);
  }

  kept.sort((a, b) => {
    const sev = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    if (sev !== 0) return sev;
    if (a.bucket !== b.bucket) return a.bucket === "verified" ? -1 : 1;
    return b.confidence - a.confidence;
  });

  const counts: Record<Severity, number> = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
  };
  for (const f of kept) counts[f.severity]++;

  const weight = { critical: 14, high: 8, medium: 3, low: 1 };
  let penalty = 0;
  for (const f of kept) {
    const half = f.bucket === "needs_human" ? 0.5 : 1;
    penalty += weight[f.severity] * half;
  }
  const brandFit = Math.max(0, Math.min(100, Math.round(100 - penalty)));

  const summary = kept.length
    ? `${kept.length} verified issue${kept.length === 1 ? "" : "s"}: ${(
        ["critical", "high", "medium", "low"] as Severity[]
      )
        .filter((s) => counts[s] > 0)
        .map((s) => `${counts[s]} ${s}`)
        .join(", ")}.`
    : "No verified issues. Nothing in this version contradicted the published rulebook.";

  return { findings: kept, brandFit, counts, duplicateCount, summary };
}
