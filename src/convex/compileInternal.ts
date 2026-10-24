import { v } from "convex/values";
import { internalMutation, internalQuery, mutation } from "./_generated/server";
import { appendAudit, brandState, requireMember, requireRole } from "./helpers";
import { proposedRuleSchema } from "./lib/types";

export const startJob = mutation({
  args: { filename: v.string(), chars: v.number() },
  handler: async (ctx, args) => {
    const session = await requireRole(ctx, ["admin"]);
    if (args.chars < 80) {
      throw new Error(
        "That document has almost no extractable text. Try another file or paste the guidelines.",
      );
    }
    const jobId = await ctx.db.insert("compileJobs", {
      workspaceId: session.workspace._id,
      filename: args.filename.slice(0, 160),
      status: "extracting",
      chars: args.chars,
      createdBy: session.userId,
      createdAt: Date.now(),
    });
    await appendAudit(ctx, {
      workspaceId: session.workspace._id,
      actorId: session.userId,
      actorRole: session.membership.role,
      actorName: session.membership.displayName,
      action: "brandpack.compile_started",
      entityType: "compileJob",
      entityId: jobId,
      payload: { filename: args.filename, chars: args.chars },
    });
    return jobId;
  },
});

export const access = internalQuery({
  args: {},
  handler: async (ctx) => {
    const session = await requireRole(ctx, ["admin"]);
    return {
      workspaceId: session.workspace._id,
      userId: session.userId,
      role: session.membership.role,
    };
  },
});

export const saveProposal = internalMutation({
  args: {
    jobId: v.id("compileJobs"),
    proposalJson: v.optional(v.string()),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const session = await requireMember(ctx);
    const job = await ctx.db.get(args.jobId);
    if (!job || job.workspaceId !== session.workspace._id) {
      throw new Error("Compile job not found.");
    }
    await ctx.db.patch(job._id, {
      status: args.error ? "failed" : "proposed",
      proposal: args.proposalJson,
      error: args.error,
    });
    await appendAudit(ctx, {
      workspaceId: job.workspaceId,
      actorId: session.userId,
      actorRole: session.membership.role,
      actorName: session.membership.displayName,
      action: args.error ? "brandpack.compile_failed" : "brandpack.rules_proposed",
      entityType: "compileJob",
      entityId: job._id,
      payload: args.error
        ? { error: args.error.slice(0, 300) }
        : { proposalChars: args.proposalJson?.length ?? 0, filename: job.filename },
    });
  },
});

/** Publishing is a human action: the admin has seen and can edit every rule. */
export const publish = mutation({
  args: {
    jobId: v.id("compileJobs"),
    rulesJson: v.string(),
    glossaryJson: v.string(),
  },
  handler: async (ctx, args) => {
    const session = await requireRole(ctx, ["admin"]);
    const job = await ctx.db.get(args.jobId);
    if (!job || job.workspaceId !== session.workspace._id) {
      throw new Error("Compile job not found.");
    }
    const parsed = JSON.parse(args.rulesJson);
    if (!Array.isArray(parsed)) throw new Error("Rules must be an array.");
    const checked = parsed.map((r: unknown) => proposedRuleSchema.parse(r));
    if (!checked.length) throw new Error("There are no rules to publish.");

    const brand = await brandState(ctx, session.workspace._id);
    let nextOrder = brand.allRules.length;
    let created = 0;
    let updated = 0;
    for (const rule of checked) {
      const existing = brand.allRules.find((r) => r.ruleId === rule.rule_id);
      if (existing) {
        await ctx.db.patch(existing._id, {
          category: rule.category,
          type: rule.type,
          title: rule.title,
          description: rule.description,
          severity: rule.severity,
          sourceExcerpt: rule.source_excerpt,
          published: true,
          updatedAt: Date.now(),
        });
        updated++;
      } else {
        await ctx.db.insert("rules", {
          workspaceId: session.workspace._id,
          ruleId: rule.rule_id,
          category: rule.category,
          type: rule.type,
          title: rule.title,
          description: rule.description,
          severity: rule.severity,
          sourceExcerpt: rule.source_excerpt,
          published: true,
          order: nextOrder++,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
        created++;
      }
    }

    const glossary = JSON.parse(args.glossaryJson) as {
      term: string;
      status: "preferred" | "banned" | "deprecated";
      replacement?: string;
      note?: string;
    }[];
    let glossaryAdded = 0;
    if (Array.isArray(glossary)) {
      const current = await ctx.db
        .query("glossary")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", session.workspace._id))
        .collect();
      for (const term of glossary.slice(0, 40)) {
        if (!term?.term) continue;
        const existing = current.find(
          (g) => g.term.toLowerCase() === term.term.toLowerCase(),
        );
        if (existing) {
          await ctx.db.patch(existing._id, {
            status: term.status,
            replacement: term.replacement,
            note: term.note,
          });
        } else {
          await ctx.db.insert("glossary", {
            workspaceId: session.workspace._id,
            term: term.term,
            status: term.status,
            replacement: term.replacement,
            note: term.note,
          });
          glossaryAdded++;
        }
      }
    }

    await ctx.db.patch(job._id, { status: "published" });
    await appendAudit(ctx, {
      workspaceId: session.workspace._id,
      actorId: session.userId,
      actorRole: session.membership.role,
      actorName: session.membership.displayName,
      action: "brandpack.published",
      entityType: "compileJob",
      entityId: job._id,
      payload: {
        filename: job.filename,
        rulesCreated: created,
        rulesUpdated: updated,
        glossaryAdded,
        reviewer: "admin",
      },
    });
    return { created, updated, glossaryAdded, total: checked.length };
  },
});
