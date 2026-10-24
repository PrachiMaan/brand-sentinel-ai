import { z } from "zod";

/** Shared vocabulary for the whole product. */

export const REVIEWERS = [
  "tone",
  "terminology",
  "claims",
  "visual",
  "accessibility",
] as const;
export type ReviewerId = (typeof REVIEWERS)[number];

export const REVIEWER_META: Record<
  ReviewerId,
  { label: string; short: string; remit: string }
> = {
  tone: {
    label: "Tone & Voice",
    short: "Tone",
    remit: "Voice drift, hype, urgency, register, rhythm and punctuation.",
  },
  terminology: {
    label: "Terminology & Messaging",
    short: "Terms",
    remit: "Product naming, casing, banned and deprecated terms, messaging pillars.",
  },
  claims: {
    label: "Claims",
    short: "Claims",
    remit: "Claim-ledger matching, expiry, substantiation and approved wording.",
  },
  visual: {
    label: "Visual",
    short: "Visual",
    remit: "Palette use, colour pairings, image treatment and caption design.",
  },
  accessibility: {
    label: "Accessibility",
    short: "A11y",
    remit: "Contrast, alt text, readable language and assistive-technology needs.",
  },
};

export const SEVERITIES = ["critical", "high", "medium", "low"] as const;
export type Severity = (typeof SEVERITIES)[number];
export const SEVERITY_RANK: Record<Severity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};
export const SEVERITY_LABEL: Record<Severity, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
};

export const FINDING_STATUSES = [
  "pending",
  "accepted",
  "edited",
  "rejected",
  "escalated_legal",
] as const;
export type FindingStatus = (typeof FINDING_STATUSES)[number];

export const CLAIM_LABELS = [
  "Supported",
  "Unsupported",
  "Expired",
  "Contradicts",
] as const;
export type ClaimLabel = (typeof CLAIM_LABELS)[number];

export const SUBMISSION_STATUSES = [
  "draft",
  "ai_review",
  "findings_ready",
  "human_review",
  "needs_revision",
  "approved",
  "rejected",
  "receipt_exported",
] as const;
export type SubmissionStatus = (typeof SUBMISSION_STATUSES)[number];

export const STATUS_LABEL: Record<SubmissionStatus, string> = {
  draft: "Draft",
  ai_review: "AI review",
  findings_ready: "Findings ready",
  human_review: "Human review",
  needs_revision: "Needs revision",
  approved: "Approved",
  rejected: "Rejected",
  receipt_exported: "Receipt exported",
};

export const ROLE_LABEL: Record<string, string> = {
  creator: "Creator",
  reviewer: "Reviewer",
  approver: "Approver",
  admin: "Admin",
};

/** A finding exactly as it is stored and shown. */
export type Finding = {
  id: string;
  reviewer: ReviewerId;
  severity: Severity;
  confidence: number;
  spanText: string;
  spanStart: number;
  spanEnd: number;
  ruleId: string;
  guidelineExcerpt: string;
  whyItMatters: string;
  suggestedFix: string;
  status: FindingStatus;
  source: "model" | "deterministic";
  bucket: "verified" | "needs_human";
  evidenceType: "verbatim_span" | "computed";
  measuredValue?: string;
  claimStatus?: ClaimLabel;
  claimId?: string;
  intentScore?: number;
  fixRisk?: "low" | "medium" | "high";
  order?: number;
};

/** Structured output requested from one specialist reviewer. */
export const modelFindingSchema = z.object({
  severity: z.enum(SEVERITIES),
  confidence: z.number().min(0).max(1),
  span_text: z.string().min(1).max(600),
  rule_id: z.string().min(1),
  guideline_excerpt: z.string().min(1).max(600),
  why_it_matters: z.string().min(1).max(700),
  suggested_fix: z.string().max(900).default(""),
  claim_status: z.enum(CLAIM_LABELS).optional(),
  claim_id: z.string().optional(),
});

export const reviewerOutputSchema = z.object({
  findings: z.array(modelFindingSchema).max(8),
});

export type ModelFinding = z.infer<typeof modelFindingSchema>;

export const proposedRuleSchema = z.object({
  rule_id: z.string().min(1).max(40),
  category: z.enum([
    "tone",
    "terminology",
    "claims",
    "visual",
    "accessibility",
    "naming",
    "channel",
  ]),
  type: z.enum(["deterministic", "measurable", "judgment"]),
  title: z.string().min(1).max(140),
  description: z.string().min(1).max(600),
  severity: z.enum(SEVERITIES),
  source_excerpt: z.string().min(1).max(700),
});

export const compilerOutputSchema = z.object({
  brand_name: z.string().max(80).optional(),
  rules: z.array(proposedRuleSchema).min(1).max(24),
  claims: z
    .array(
      z.object({
        text: z.string().min(1).max(400),
        status: z.enum(["approved", "expiring", "expired"]).default("approved"),
        approved_wording: z.string().max(400).optional(),
        evidence: z.string().max(300).optional(),
      }),
    )
    .max(20)
    .optional(),
  glossary: z
    .array(
      z.object({
        term: z.string().min(1).max(120),
        status: z.enum(["preferred", "banned", "deprecated"]),
        replacement: z.string().max(120).optional(),
        note: z.string().max(300).optional(),
      }),
    )
    .max(40)
    .optional(),
});

export type ModelRule = z.infer<typeof proposedRuleSchema>;

export function findingKey(f: {
  ruleId: string;
  spanText: string;
  reviewer: ReviewerId;
}) {
  return `${f.ruleId}::${f.reviewer}::${f.spanText.trim().toLowerCase()}`;
}

export function isBlocking(f: Finding) {
  return f.severity === "critical" || f.severity === "high";
}
