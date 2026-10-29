import { query } from "./_generated/server";
import { brandState, requireMember } from "./helpers";
import { PALETTE } from "./lib/lumora";

export const overview = query({
  args: {},
  handler: async (ctx) => {
    const session = await requireMember(ctx);
    const brand = await brandState(ctx, session.workspace._id);
    const submissions = await ctx.db
      .query("submissions")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", session.workspace._id))
      .order("desc")
      .collect();
    const calls = await ctx.db
      .query("llmCalls")
      .withIndex("by_created")
      .order("desc")
      .take(40);
    const overrides = await ctx.db
      .query("ruleOverrides")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", session.workspace._id))
      .collect();
    const findings = await ctx.db
      .query("findings")
      .withIndex("by_submission")
      .collect();
    const workspaceFindingCount = findings.filter(
      (f) => f.workspaceId === session.workspace._id,
    );
    const decided = workspaceFindingCount.filter((f) =>
      ["accepted", "edited", "rejected", "escalated_legal"].includes(f.status),
    ).length;
    return {
      role: session.membership.role,
      displayName: session.membership.displayName,
      workspace: { name: session.workspace.name, id: session.workspace._id },
      brandPack: brand.pack
        ? {
            name: brand.pack.name,
            version: brand.pack.version,
            palette: brand.pack.palette,
            voice: brand.pack.voice,
          }
        : null,
      accent: PALETTE,
      counts: {
        submissions: submissions.length,
        awaitingReview: submissions.filter((s) =>
          ["findings_ready", "human_review"].includes(s.status),
        ).length,
        approved: submissions.filter((s) =>
          ["approved", "receipt_exported"].includes(s.status),
        ).length,
        findings: workspaceFindingCount.length,
        decided,
        overrides: overrides.filter((o) => !o.seeded).length,
        rules: brand.rules.length,
        claims: brand.claims.length,
        expiringClaims: brand.claims.filter((c) => c.status !== "approved").length,
        modelCalls: calls.length,
      },
      recentSubmissions: submissions.slice(0, 5).map((s) => ({
        id: s._id,
        title: s.title,
        status: s.status,
        channel: s.channel,
        version: s.currentVersion,
        brandFit: s.brandFit,
        updatedAt: s.updatedAt,
      })),
    };
  },
});

export const rulebook = query({
  args: {},
  handler: async (ctx) => {
    const session = await requireMember(ctx);
    const brand = await brandState(ctx, session.workspace._id);
    return {
      pack: brand.pack
        ? {
            name: brand.pack.name,
            version: brand.pack.version,
            status: brand.pack.status,
            palette: brand.pack.palette,
            voice: brand.pack.voice,
            updatedAt: brand.pack.updatedAt,
          }
        : null,
      rules: brand.allRules,
      claims: brand.claims,
      glossary: brand.glossary,
    };
  },
});

export const compileJobs = query({
  args: {},
  handler: async (ctx) => {
    const session = await requireMember(ctx);
    const jobs = await ctx.db
      .query("compileJobs")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", session.workspace._id))
      .order("desc")
      .take(10);
    return jobs;
  },
});

export const modelLog = query({
  args: {},
  handler: async (ctx) => {
    await requireMember(ctx);
    const calls = await ctx.db
      .query("llmCalls")
      .withIndex("by_created")
      .order("desc")
      .take(60);
    return calls.map((c) => ({
      id: c._id,
      purpose: c.purpose,
      model: c.model,
      provider: c.provider,
      promptHash: c.promptHash.slice(0, 12),
      latencyMs: c.latencyMs,
      inputTokens: c.inputTokens ?? null,
      outputTokens: c.outputTokens ?? null,
      ok: c.ok,
      error: c.error ?? null,
      redactions: c.redactions,
      createdAt: c.createdAt,
    }));
  },
});
