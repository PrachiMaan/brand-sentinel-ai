import { describe, expect, it } from "bun:test";
import { verifyFindings, verifyCachedFindings } from "../src/convex/lib/verifier";
import { CLAIMS, GUIDELINE_DOCUMENT, RULES } from "../src/convex/lib/lumora";
import type { ModelFinding } from "../src/convex/lib/types";

const CONTENT = "Our Lumora Glow Serum gives visible improvement in two weeks. " +
  "It is a miracle cure for every skin complaint you have ever had.";

const TERM_RULE = RULES.find((r) => r.ruleId === "R-TERM-02")!;

function modelFinding(over: Partial<ModelFinding> = {}): ModelFinding {
  return {
    severity: "critical",
    confidence: 0.9,
    span_text: "miracle cure",
    rule_id: "R-TERM-02",
    guideline_excerpt: TERM_RULE.sourceExcerpt,
    why_it_matters: "Prohibited claim language.",
    suggested_fix: "Replace with “visible improvement”.",
    ...over,
  } as ModelFinding;
}

const input = {
  runText: CONTENT,
  rules: RULES,
  claims: CLAIMS,
  guidelineText: GUIDELINE_DOCUMENT,
};

describe("evidence-or-silence verifier", () => {
  it("keeps a finding whose quote, rule and excerpt are all real", () => {
    const { findings, stats } = verifyFindings({
      raw: [{ ...modelFinding(), reviewer: "terminology" }],
      input,
    });
    expect(findings).toHaveLength(1);
    expect(stats.kept).toBe(1);
    expect(stats.dropped).toBe(0);
    expect(findings[0].spanStart).toBeGreaterThanOrEqual(0);
    expect(findings[0].guidelineExcerpt).toBe(TERM_RULE.sourceExcerpt);
  });

  it("drops a quote that is not in the submitted content", () => {
    const { findings, stats, droppedLog } = verifyFindings({
      raw: [{ ...modelFinding({ span_text: "clinically proven overnight" }), reviewer: "terminology" }],
      input,
    });
    expect(findings).toHaveLength(0);
    expect(stats.droppedSpan).toBe(1);
    expect(droppedLog[0].reason).toBe("span_not_found");
  });

  it("drops a rule id that does not exist in the rulebook", () => {
    const { stats, droppedLog } = verifyFindings({
      raw: [{ ...modelFinding({ rule_id: "R-FAKE-99" }), reviewer: "terminology" }],
      input,
    });
    expect(stats.droppedRule).toBe(1);
    expect(droppedLog[0].reason).toBe("unknown_rule");
  });

  it("drops a guideline excerpt that is not from the rulebook", () => {
    const { stats, droppedLog } = verifyFindings({
      raw: [
        {
          ...modelFinding({ guideline_excerpt: "We always allow miracles here." }),
          reviewer: "terminology",
        },
      ],
      input,
    });
    expect(stats.droppedExcerpt).toBe(1);
    expect(droppedLog[0].reason).toBe("excerpt_not_in_rulebook");
  });

  it("routes a low-confidence finding to Needs human instead of dropping it", () => {
    const { findings } = verifyFindings({
      raw: [{ ...modelFinding({ confidence: 0.4 }), reviewer: "terminology" }],
      input,
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].bucket).toBe("needs_human");
  });

  it("drops a claim finding that cites a claim outside the ledger", () => {
    const { stats, droppedLog } = verifyFindings({
      raw: [
        {
          ...modelFinding({ claim_id: "C-999", claim_status: "Expired" }),
          reviewer: "claims",
        },
      ],
      input,
    });
    expect(stats.droppedClaim).toBe(1);
    expect(droppedLog[0].reason).toBe("unknown_claim");
  });
});

describe("saved-run re-verification", () => {
  it("keeps findings that still hold and re-indexes their spans", () => {
    const { findings, dropped } = verifyCachedFindings(
      [
        {
          id: "x",
          reviewer: "terminology",
          severity: "critical",
          confidence: 0.9,
          spanText: "miracle cure",
          spanStart: 999,
          spanEnd: 1013,
          ruleId: "R-TERM-02",
          guidelineExcerpt: TERM_RULE.sourceExcerpt,
          whyItMatters: "why",
          suggestedFix: "fix",
          status: "pending",
          source: "model",
          bucket: "verified",
          evidenceType: "verbatim_span",
        } as never,
      ],
      input,
    );
    expect(dropped).toBe(0);
    expect(findings[0].spanStart).not.toBe(999);
  });

  it("drops saved findings whose quote no longer exists or whose rule was retired", () => {
    const base = {
      id: "x",
      reviewer: "terminology",
      severity: "critical",
      confidence: 0.9,
      spanText: "words that were edited away",
      spanStart: 0,
      spanEnd: 4,
      ruleId: "R-TERM-02",
      guidelineExcerpt: TERM_RULE.sourceExcerpt,
      whyItMatters: "why",
      suggestedFix: "fix",
      status: "pending",
      source: "model",
      bucket: "verified",
      evidenceType: "verbatim_span",
    };
    const { dropped } = verifyCachedFindings([base as never], input);
    expect(dropped).toBe(1);

    const retired = verifyCachedFindings(
      [{ ...base, spanText: "miracle cure", ruleId: "R-RETIRED-01" } as never],
      input,
    );
    expect(retired.dropped).toBe(1);
    expect(retired.reasons[0]).toContain("no longer published");
  });
});
