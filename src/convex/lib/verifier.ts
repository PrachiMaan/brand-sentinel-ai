import type { Finding, ModelFinding, ReviewerId, Severity } from "./types";
import { SEVERITIES, validBbox } from "./types";
import { firstVerbatimIndex } from "./text";
import type { SeedClaim, SeedRule } from "./lumora";
import { GUIDELINE_DOCUMENT } from "./lumora";
import { intentScore, fixRisk } from "./text";

export type DroppedFinding = {
  reviewer: ReviewerId;
  ruleId: string;
  spanText: string;
  reason:
    | "span_not_found"
    | "unknown_rule"
    | "excerpt_not_in_rulebook"
    | "unknown_claim"
    | "approved_copy"
    | "empty_finding";
  detail: string;
};

export type VerifierStats = {
  total: number;
  kept: number;
  dropped: number;
  needsHuman: number;
  droppedSpan: number;
  droppedRule: number;
  droppedExcerpt: number;
  droppedClaim: number;
  evidenceRate: number;
};

export type VerifyInput = {
  runText: string;
  rules: SeedRule[];
  claims: SeedClaim[];
  guidelineText?: string;
  pageCount?: number;
};

const normalise = (s: string) =>
  s
    .toLowerCase()
    .replace(/[\u2018\u2019\u201c\u201d]/g, "'")
    .replace(/[^a-z0-9%$.\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Is this quote actually present in the rulebook we gave the model? */
function excerptIsFromRulebook(
  excerpt: string,
  rule: SeedRule,
  guidelineText: string,
): boolean {
  const quote = normalise(excerpt);
  if (!quote) return false;
  const rulebook = normalise(`${rule.sourceExcerpt} ${guidelineText}`);
  if (rulebook.includes(quote)) return true;
  // Long quotes are allowed to match on their first clause, but a short quote
  // must appear in full. This catches invented phrasing without punishing a
  // model that appends punctuation.
  if (quote.length > 180) {
    const head = quote.slice(0, 120);
    return rulebook.includes(head);
  }
  return false;
}

function coerceSeverity(value: string): Severity {
  return (SEVERITIES as readonly string[]).includes(value)
    ? (value as Severity)
    : "medium";
}

export function verifyFindings(args: {
  raw: (ModelFinding & { reviewer: ReviewerId })[];
  input: VerifyInput;
}): { findings: Finding[]; stats: VerifierStats; droppedLog: DroppedFinding[] } {
  const { raw, input } = args;
  const guidelineText = input.guidelineText ?? GUIDELINE_DOCUMENT;
  const findings: Finding[] = [];
  const droppedLog: DroppedFinding[] = [];
  let droppedSpan = 0;
  let droppedRule = 0;
  let droppedExcerpt = 0;
  let droppedClaim = 0;
  let needsHuman = 0;

  const drop = (
    f: ModelFinding & { reviewer: ReviewerId },
    reason: DroppedFinding["reason"],
    detail: string,
  ) => {
    if (reason === "span_not_found") droppedSpan++;
    else if (reason === "unknown_rule") droppedRule++;
    else if (reason === "excerpt_not_in_rulebook") droppedExcerpt++;
    else if (reason === "unknown_claim" || reason === "approved_copy") droppedClaim++;
    droppedLog.push({
      reviewer: f.reviewer,
      ruleId: f.rule_id,
      spanText: f.span_text,
      reason,
      detail,
    });
  };

  for (const f of raw) {
    if (!f.span_text?.trim() || !f.rule_id) {
      drop(f, "empty_finding", "No quoted span or rule reference.");
      continue;
    }
    const rule = input.rules.find((r) => r.ruleId === f.rule_id);
    if (!rule) {
      drop(f, "unknown_rule", `Rule ${f.rule_id} is not in the published rulebook.`);
      continue;
    }

    const at = firstVerbatimIndex(input.runText, f.span_text);
    if (at < 0) {
      drop(
        f,
        "span_not_found",
        `"${f.span_text.slice(0, 80)}" does not appear verbatim in the submitted content.`,
      );
      continue;
    }

    if (!excerptIsFromRulebook(f.guideline_excerpt, rule, guidelineText)) {
      drop(
        f,
        "excerpt_not_in_rulebook",
        `"${f.guideline_excerpt.slice(0, 80)}" is not a quote from the rulebook.`,
      );
      continue;
    }

    // The Claim Ledger is authoritative. If the quoted span is an approved
    // claim (or contains one), no reviewer may report it: the copy has already
    // been cleared by scientific affairs. Expired and expiring claims are not
    // protected here, so a real expiry violation still surfaces.
    const span = normalise(f.span_text);
    const approved = input.claims.find((claim) => {
      if (claim.status === "expired") return false;
      const approvedText = normalise(claim.approvedWording ?? "");
      const claimText = normalise(claim.text);
      const candidates = [approvedText, claimText].filter((text) => text.length >= 20);
      return candidates.some((text) => span === text || span.includes(text) || text.includes(span));
    });
    if (approved && f.claim_status !== "Expired") {
      drop(
        f,
        "approved_copy",
        `The quoted span is approved copy from ${approved.claimId}, which is not expired.`,
      );
      continue;
    }

    let claimStatus = f.claim_status;
    let claimId = f.claim_id;
    if (f.reviewer === "claims" || claimStatus) {
      if (claimStatus && ["Supported", "Expired", "Contradicts"].includes(claimStatus)) {
        const claim = input.claims.find((c) => c.claimId === claimId);
        if (!claim) {
          drop(
            f,
            "unknown_claim",
            `Claim ${claimId ?? "(missing id)"} is not in the Claim Ledger.`,
          );
          continue;
        }
        if (claim.status === "expired") claimStatus = "Expired";
      }
      if (claimStatus === "Unsupported") claimId = claimId || undefined;
    }

    const confidence = Math.max(0, Math.min(1, f.confidence));
    const score = intentScore(f.span_text, f.suggested_fix ?? "");
    const finding: Finding = {
      id: `f-${f.reviewer}-${at}-${f.rule_id}`,
      reviewer: f.reviewer,
      severity: coerceSeverity(f.severity),
      confidence,
      spanText: f.span_text,
      spanStart: at,
      spanEnd: at + f.span_text.length,
      ruleId: f.rule_id,
      guidelineExcerpt: rule.sourceExcerpt,
      whyItMatters: f.why_it_matters,
      suggestedFix: f.suggested_fix ?? "",
      status: "pending",
      source: "model",
      bucket: confidence < 0.6 ? "needs_human" : "verified",
      evidenceType: "verbatim_span",
      claimStatus,
      claimId,
      intentScore: f.suggested_fix ? score : undefined,
      fixRisk: f.suggested_fix ? fixRisk(score) : undefined,
    };
    if (finding.bucket === "needs_human") needsHuman++;
    findings.push(finding);
  }

  const total = raw.length;
  const kept = findings.length;
  const stats: VerifierStats = {
    total,
    kept,
    dropped: total - kept,
    needsHuman,
    droppedSpan,
    droppedRule,
    droppedExcerpt,
    droppedClaim,
    evidenceRate: total ? Math.round((kept / total) * 1000) / 10 : 1,
  };

  return { findings, stats, droppedLog };
}

/** Deterministic findings pass the same rule/excerpt check, without a span. */
export function verifyDeterministic(finding: Finding, input: VerifyInput): boolean {
  const rule = input.rules.find((r) => r.ruleId === finding.ruleId);
  if (!rule) return false;
  if (
    !excerptIsFromRulebook(
      finding.guidelineExcerpt,
      rule,
      input.guidelineText ?? GUIDELINE_DOCUMENT,
    )
  ) {
    return false;
  }
  if (!verifyVisualFields(finding, input)) return false;
  if (finding.evidenceType === "verbatim_span") {
    return firstVerbatimIndex(input.runText, finding.spanText) >= 0;
  }
  return true;
}

/**
 * Visual evidence is a measurement, not an opinion. A finding without a page in
 * range, a box inside the page and a measured value is inadmissible.
 */
export function verifyVisualFields(
  finding: Pick<Finding, "page" | "bbox" | "measured" | "reviewer" | "source">,
  input: Pick<VerifyInput, "pageCount">,
): boolean {
  if (finding.page === undefined && finding.bbox === undefined) return true;
  if (finding.page === undefined || !finding.bbox) return false;
  if (!Number.isInteger(finding.page) || finding.page < 1) return false;
  if (input.pageCount !== undefined && finding.page > input.pageCount) return false;
  if (!validBbox(finding.bbox)) return false;
  if (!finding.measured?.trim()) return false;
  return true;
}

/**
 * Re-admission check for a stored (cached) result. The rulebook may have moved
 * on since the run was cached, so every quote and every box is checked again
 * against the current rules and the current content.
 */
export function verifyCachedFindings(
  findings: Finding[],
  input: VerifyInput,
): { findings: Finding[]; dropped: number; reasons: string[] } {
  const kept: Finding[] = [];
  const reasons: string[] = [];
  for (const finding of findings) {
    const rule = input.rules.find((r) => r.ruleId === finding.ruleId);
    if (!rule) {
      reasons.push(`${finding.ruleId}: rule is no longer published`);
      continue;
    }
    if (
      !excerptIsFromRulebook(
        finding.guidelineExcerpt,
        rule,
        input.guidelineText ?? GUIDELINE_DOCUMENT,
      )
    ) {
      reasons.push(`${finding.ruleId}: guideline excerpt no longer matches the rulebook`);
      continue;
    }
    if (!verifyVisualFields(finding, input)) {
      reasons.push(`${finding.ruleId}: visual evidence is incomplete`);
      continue;
    }
    if (finding.evidenceType === "verbatim_span") {
      const at = firstVerbatimIndex(input.runText, finding.spanText);
      if (at < 0) {
        reasons.push(`${finding.ruleId}: quoted span is not in the current content`);
        continue;
      }
      kept.push({ ...finding, spanStart: at, spanEnd: at + finding.spanText.length });
      continue;
    }
    kept.push(finding);
  }
  return { findings: kept, dropped: findings.length - kept.length, reasons };
}
