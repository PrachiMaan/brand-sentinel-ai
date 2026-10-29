import { RULES } from "./lumora";
import { mulberry32 } from "./analytics";

/**
 * Deterministic 90-day synthetic history for the Lumora demo workspace. It is
 * ordinary data written through the ordinary tables, flagged synthetic so the
 * UI can label it. The generator is seeded, so two runs produce the same shape.
 */

export type PlannedFinding = {
  ruleId: string;
  severity: string;
  title: string;
  spanText: string;
  atMs: number;
  status: "pending" | "accepted" | "edited" | "rejected" | "escalated_legal";
  decision?: {
    kind: "accept" | "edit" | "reject";
    reason?: string;
    editedFix?: string;
    atMs: number;
    actorRole: string;
  };
};

export type PlannedSubmission = {
  title: string;
  team: string;
  channel: string;
  audience: string;
  status: string;
  createdAt: number;
  updatedAt: number;
  creatorName: string;
  text: string;
  findings: PlannedFinding[];
};

const SPANS: Record<string, string> = {
  "R-TONE-01": "before it sells out!!",
  "R-TONE-02": "clinical-grade actives",
  "R-TERM-01": "Glow Serum",
  "R-TERM-02": "a miracle for tired skin",
  "R-TERM-03": "THE RESULTS YOU HAVE BEEN WAITING FOR",
  "R-TERM-04": "instant transformation",
  "R-CLAIM-01": "removes wrinkles in 7 days",
  "R-CLAIM-02": "treats blemishes",
  "R-CLAIM-03": "visibly lifts skin in 3 days",
  "R-VIS-01": "an off-palette pink block",
  "R-VIS-02": "the logo sits 4px from the page edge",
  "R-A11Y-01": "caption contrast measures 3.1:1",
  "R-A11Y-02": "the image has no alt text",
  "R-CHAN-01": "the subject line runs to 84 characters",
};

const REASONS: Record<string, string[]> = {
  "R-TONE-01": [
    "Campaign line was signed off by the brand lead; the urgency is the point.",
    "Launch timing makes the exclamation mark acceptable this once.",
  ],
  "R-TONE-02": [
    "Ingredients list needs the technical term for regulatory reasons.",
    "Legal asked us to keep the clinical phrase in this channel.",
  ],
  "R-TERM-01": [
    "Short form is needed inside the paid character limit.",
    "This placement repeats the name from the previous line.",
  ],
  "R-TERM-03": [
    "The all-caps line is part of the campaign lockup.",
    "Subject line was tested and approved by the email team.",
  ],
  "R-CLAIM-01": [
    "Figure came from the study summary, not the ledger entry.",
    "The time window was approved verbally; the ledger is out of date.",
  ],
  "R-CLAIM-03": [
    "Claim was already removed; the sentence is a legacy footnote.",
    "We are re-testing this claim, so we kept the wording.",
  ],
  "R-VIS-01": [
    "The seasonal accent was signed off for this campaign.",
    "The printer shifted the colour; the file uses Clay.",
  ],
  "R-VIS-02": [
    "Template constrains the logo position; design cannot move it.",
    "Clear space is measured from the artboard, not the crop.",
  ],
  "R-A11Y-01": [
    "Background is a photo, so the contrast sample is misleading.",
    "The caption is repeated in the alt text.",
  ],
  "R-A11Y-02": [
    "Alt text is written in the CMS, not the asset.",
    "This is a decorative image, so no alt text was supplied.",
  ],
  "R-CHAN-01": [
    "Subject line length is set by the CRM template.",
    "We need the whole offer inside the preview text.",
  ],
};

const AMBIGUOUS = new Set(["R-TONE-02", "R-VIS-02", "R-CHAN-01", "R-TERM-03"]);

const TEAM_CHANNEL: { team: string; channel: string }[] = [
  { team: "Social", channel: "instagram" },
  { team: "Email", channel: "email" },
  { team: "Web", channel: "landing" },
  { team: "Paid", channel: "linkedin" },
  { team: "Social", channel: "print" },
];

const TITLES = [
  "Launch caption",
  "Spring refresh email",
  "Landing page hero",
  "Paid social variant",
  "Print insert",
  "Retargeting copy",
  "Newsletter block",
];

const DAY = 86_400_000;
export const HISTORY_DAYS = 90;
export const BATCH_DAYS = 30;

export const HISTORY_BATCHES = Math.ceil(HISTORY_DAYS / BATCH_DAYS);

/** Plans `[fromDay, toDay)` counted backwards from today. Day 0 is yesterday. */
export function planHistory(args: {
  fromDay: number;
  toDay: number;
  nowMs: number;
  seed?: number;
}): PlannedSubmission[] {
  const random = mulberry32(args.seed ?? 20_261_025);
  const out: PlannedSubmission[] = [];
  const rules = RULES;

  for (let day = args.fromDay; day < Math.min(args.toDay, HISTORY_DAYS); day++) {
    const dayStart = args.nowMs - (day + 1) * DAY;
    const perDay = 2 + Math.floor(random() * 3);
    for (let n = 0; n < perDay; n++) {
      const pair = TEAM_CHANNEL[Math.floor(random() * TEAM_CHANNEL.length)];
      const createdAt = dayStart + Math.floor(random() * 0.7 * DAY);
      const drift = pair.team === "Paid" && day < 45;
      const findings: PlannedFinding[] = [];
      const findingCount = 1 + Math.floor(random() * 3);

      for (let f = 0; f < findingCount; f++) {
        const rule = rules[Math.floor(random() * rules.length)];
        const ambiguous = AMBIGUOUS.has(rule.ruleId);
        const driftRule = drift && (rule.ruleId === "R-TERM-03" || rule.ruleId === "R-CHAN-01");
        const span = SPANS[rule.ruleId] ?? rule.title;
        const atMs = createdAt + Math.floor(random() * 6 * 3_600_000);
        const decided = random() > 0.12;
        const decisionRoll = random();
        const overrideChance = ambiguous ? 0.5 : driftRule ? 0.42 : 0.14;
        const contested = decided && decisionRoll < overrideChance;
        const kind = contested ? (random() < 0.58 ? "edit" : "reject") : "accept";
        const reasons = REASONS[rule.ruleId] ?? ["Reviewer noted an exception."];
        findings.push({
          ruleId: rule.ruleId,
          severity: rule.severity,
          title: rule.title,
          spanText: span,
          atMs,
          status: !decided
            ? "pending"
            : kind === "accept"
              ? "accepted"
              : kind === "edit"
                ? "edited"
                : "rejected",
          decision: decided
            ? {
                kind: kind as "accept" | "edit" | "reject",
                reason: contested
                  ? reasons[Math.floor(random() * reasons.length)]
                  : undefined,
                editedFix:
                  kind === "edit"
                    ? `${rule.title}: use the approved example from Edition 4.`
                    : undefined,
                atMs: atMs + Math.floor(random() * 8 * 3_600_000),
                actorRole: random() < 0.6 ? "reviewer" : "approver",
              }
            : undefined,
        });
      }

      const lastDecision = findings
        .map((f) => f.decision?.atMs ?? 0)
        .reduce((a, b) => Math.max(a, b), createdAt);
      const statusRoll = random();
      const status =
        findings.some((f) => f.status === "escalated_legal")
          ? "human_review"
          : statusRoll < 0.72
            ? "receipt_exported"
            : statusRoll < 0.85
              ? "approved"
              : statusRoll < 0.94
                ? "human_review"
                : "needs_revision";

      out.push({
        title: `${TITLES[Math.floor(random() * TITLES.length)]} · ${pair.team.toLowerCase()}`,
        team: pair.team,
        channel: pair.channel,
        audience: "Skincare-curious adults, 25–44",
        status,
        createdAt,
        updatedAt: Math.max(
          lastDecision,
          status === "approved" || status === "receipt_exported"
            ? createdAt + (2 + random() * 28) * 3_600_000
            : createdAt + 6 * 3_600_000,
        ),
        creatorName: random() < 0.5 ? "Maya Rao" : "Sam Okafor",
        text: `Lumora Glow Serum draft. ${findings.map((f) => f.spanText).join(". ")}. Approved context follows.`,
        findings,
      });
    }
  }

  return out;
}
