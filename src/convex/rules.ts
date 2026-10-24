import { query } from "./_generated/server";
import { brandState, requireMember } from "./helpers";

/**
 * Override rate per rule. An override is a human disagreeing with the machine:
 * edit, reject or escalate. Accept is agreement. Seeded demo history is counted
 * separately so the table is never mistaken for live performance data.
 */
export const overrideStats = query({
  args: {},
  handler: async (ctx) => {
    const session = await requireMember(ctx);
    const brand = await brandState(ctx, session.workspace._id);
    const rows = await ctx.db
      .query("ruleOverrides")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", session.workspace._id))
      .collect();
    const byRule = new Map<
      string,
      {
        ruleId: string;
        title: string;
        accept: number;
        edit: number;
        reject: number;
        escalate: number;
        seeded: number;
        real: number;
        total: number;
      }
    >();
    for (const rule of brand.allRules) {
      byRule.set(rule.ruleId, {
        ruleId: rule.ruleId,
        title: rule.title,
        accept: 0,
        edit: 0,
        reject: 0,
        escalate: 0,
        seeded: 0,
        real: 0,
        total: 0,
      });
    }
    for (const row of rows) {
      const entry =
        byRule.get(row.ruleId) ??
        {
          ruleId: row.ruleId,
          title: "Retired rule",
          accept: 0,
          edit: 0,
          reject: 0,
          escalate: 0,
          seeded: 0,
          real: 0,
          total: 0,
        };
      if (row.decision === "escalate") entry.escalate++;
      else entry[row.decision]++;
      entry.total++;
      if (row.seeded) entry.seeded++;
      else entry.real++;
      byRule.set(row.ruleId, entry);
    }
    return {
      rows: Array.from(byRule.values())
        .filter((r) => r.total > 0)
        .map((r) => ({
          ...r,
          overrideRate:
            r.total === 0
              ? 0
              : Math.round(((r.edit + r.reject + r.escalate) / r.total) * 1000) / 10,
        }))
        .sort((a, b) => b.total - a.total),
      seededTotal: rows.filter((r) => r.seeded).length,
      realTotal: rows.filter((r) => !r.seeded).length,
    };
  },
});
