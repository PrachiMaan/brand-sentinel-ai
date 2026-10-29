import { describe, expect, it } from "bun:test";
import {
  buildHealthRows,
  dayKey,
  median,
  MIN_SAMPLE,
  percentile,
  ruleSummaries,
  wilsonInterval,
} from "../src/convex/lib/analytics";

const DAY = Date.parse("2026-03-02T10:00:00Z");
const FROM = Date.parse("2026-01-01T00:00:00Z");
const TO = Date.parse("2026-04-01T00:00:00Z");

function scenario() {
  const submissions = [
    {
      id: "s1",
      team: "Social",
      channel: "instagram",
      createdAt: DAY,
      status: "approved",
      updatedAt: DAY,
      synthetic: true,
    },
  ];
  const findings = [
    { findingId: "f1", submissionId: "s1", ruleId: "R-TERM-01", ruleTitle: "Naming", severity: "critical", createdAt: DAY, status: "accepted", spanText: "Glow Serum" },
    { findingId: "f2", submissionId: "s1", ruleId: "R-TERM-01", ruleTitle: "Naming", severity: "medium", createdAt: DAY, status: "rejected", spanText: "lumora" },
    { findingId: "f3", submissionId: "s1", ruleId: "R-OUTSIDE", ruleTitle: "Unknown", severity: "low", createdAt: DAY, status: "pending", spanText: "x" },
  ];
  const decisions = [
    { ruleId: "R-TERM-01", decision: "accept" as const, submissionId: "s1", findingId: "f1", createdAt: DAY, actorRole: "reviewer", synthetic: true },
    { ruleId: "R-TERM-01", decision: "reject" as const, submissionId: "s1", findingId: "f2", createdAt: DAY, actorRole: "approver", synthetic: true },
    { ruleId: "R-OUTSIDE", decision: "accept" as const, submissionId: "s1", findingId: "f3", createdAt: DAY, actorRole: "reviewer", synthetic: true },
  ];
  return { submissions, findings, decisions };
}

describe("rule health aggregation", () => {
  it("buckets by day, rule, team and channel and ignores unknown rules", () => {
    const s = scenario();
    const rows = buildHealthRows({
      submissions: s.submissions,
      findings: s.findings,
      decisions: s.decisions,
      ruleIds: ["R-TERM-01"],
      fromMs: FROM,
      toMs: TO,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      day: "2026-03-02",
      ruleId: "R-TERM-01",
      team: "Social",
      channel: "instagram",
      findings: 2,
      accepted: 1,
      rejected: 1,
      synthetic: true,
    });
    expect(rows[0].driftScore).toBeCloseTo(0.5, 3);
  });

  it("is idempotent: the same input aggregates to the same rows", () => {
    const s = scenario();
    const args = {
      submissions: s.submissions,
      findings: s.findings,
      decisions: s.decisions,
      ruleIds: ["R-TERM-01"],
      fromMs: FROM,
      toMs: TO,
    };
    const first = buildHealthRows(args);
    const second = buildHealthRows(args);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it("ignores rows outside the window", () => {
    const s = scenario();
    const rows = buildHealthRows({
      submissions: s.submissions,
      findings: s.findings,
      decisions: s.decisions,
      ruleIds: ["R-TERM-01"],
      fromMs: TO,
      toMs: TO + 1,
    });
    expect(rows).toHaveLength(0);
  });
});

describe("rule summaries", () => {
  it("computes override rate with a Wilson interval and a sample gate", () => {
    const s = scenario();
    const health = buildHealthRows({
      submissions: s.submissions,
      findings: s.findings,
      decisions: s.decisions,
      ruleIds: ["R-TERM-01"],
      fromMs: FROM,
      toMs: TO,
    });
    const summaries = ruleSummaries({
      health,
      rules: [
        { ruleId: "R-TERM-01", title: "Naming" },
        { ruleId: "R-TONE-01", title: "Tone" },
      ],
    });
    const naming = summaries.find((x) => x.ruleId === "R-TERM-01")!;
    expect(naming.decisions).toBe(2);
    expect(naming.overrideRate).toBe(50);
    expect(naming.ciLow).toBeLessThan(50);
    expect(naming.ciHigh).toBeGreaterThan(50);
    expect(naming.enoughData).toBe(false); // 2 < MIN_SAMPLE
    const tone = summaries.find((x) => x.ruleId === "R-TONE-01")!;
    expect(tone.decisions).toBe(0);
    expect(tone.enoughData).toBe(false);
  });

  it("marks a rule with enough decisions as judgeable", () => {
    const s = scenario();
    const many = Array.from({ length: MIN_SAMPLE }, (_, i) => ({
      ruleId: "R-TERM-01",
      decision: (i % 2 ? "reject" : "accept") as "reject" | "accept",
      submissionId: "s1",
      findingId: `f-${i}`,
      createdAt: DAY,
      actorRole: "reviewer",
      synthetic: true,
    }));
    const health = buildHealthRows({
      submissions: s.submissions,
      findings: s.findings,
      decisions: many,
      ruleIds: ["R-TERM-01"],
      fromMs: FROM,
      toMs: TO,
    });
    const naming = ruleSummaries({
      health,
      rules: [{ ruleId: "R-TERM-01", title: "Naming" }],
    })[0];
    expect(naming.enoughData).toBe(true);
    expect(naming.ciLow).toBeGreaterThan(0);
    expect(naming.ciHigh).toBeLessThanOrEqual(100);
  });
});

describe("wilson interval", () => {
  it("stays within [0, 1] and widens as n shrinks", () => {
    const wide = wilsonInterval(5, 10);
    const narrow = wilsonInterval(500, 1000);
    expect(wide.low).toBeGreaterThanOrEqual(0);
    expect(wide.high).toBeLessThanOrEqual(1);
    expect(wide.high - wide.low).toBeGreaterThan(narrow.high - narrow.low);
  });

  it("returns zeros for an empty sample", () => {
    expect(wilsonInterval(0, 0)).toEqual({ low: 0, high: 0 });
  });

  it("centres on the observed rate", () => {
    const ci = wilsonInterval(50, 100);
    expect((ci.low + ci.high) / 2).toBeCloseTo(0.5, 1);
  });
});

describe("helpers", () => {
  it("median and percentile sort correctly", () => {
    expect(median([5, 1, 3, 2, 4])).toBe(3);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([])).toBe(0);
    expect(percentile([0, 10, 20, 30, 40, 50, 60, 70, 80, 90], 0.9)).toBe(80);
    expect(percentile([1, 2, 3, 4], 0.5)).toBe(2);
    expect(percentile([], 0.5)).toBe(0);
  });

  it("dayKey produces an ISO date", () => {
    expect(dayKey(Date.parse("2026-03-02T23:59:59Z"))).toBe("2026-03-02");
  });
});
