import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { brandState, ensureWorkspace } from "./helpers";

export const seed = internalMutation({
  args: {},
  handler: async (ctx) => {
    return await ensureWorkspace(ctx);
  },
});

export const brand = internalQuery({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    const brand = await brandState(ctx, args.workspaceId);
    if (!brand.pack) throw new Error("Brand pack missing.");
    return {
      name: brand.pack.name,
      palette: brand.pack.palette,
      voice: brand.pack.voice,
      rules: brand.rules.map((r) => ({
        ruleId: r.ruleId,
        category: r.category,
        type: r.type,
        title: r.title,
        description: r.description,
        severity: r.severity,
        sourceExcerpt: r.sourceExcerpt,
      })),
      claims: brand.claims.map((c) => ({
        claimId: c.claimId,
        text: c.text,
        status: c.status,
        approvedWording: c.approvedWording,
        evidence: c.evidence,
        owner: c.owner,
        expiresAt: c.expiresAt ?? null,
      })),
      glossary: brand.glossary.map((g) => ({
        term: g.term,
        status: g.status,
        replacement: g.replacement,
        note: g.note,
      })),
    };
  },
});
