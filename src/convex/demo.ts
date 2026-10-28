import { mutation, query } from "./_generated/server";
import { appendAudit, requireMember } from "./helpers";

/**
 * The first-visit checklist. Every tick comes from a real event row, never from
 * a client flag, so it cannot be faked by clicking through pages.
 */
export const progress = query({
  args: {},
  handler: async (ctx) => {
    const session = await requireMember(ctx);
    const row = await ctx.db
      .query("demoProgress")
      .withIndex("by_user", (q) =>
        q.eq("workspaceId", session.workspace._id).eq("userId", session.userId),
      )
      .first();
    const submissions = await ctx.db
      .query("submissions")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", session.workspace._id))
      .collect();
    const approved = submissions.some(
      (s) =>
        Boolean(s.sampleId) &&
        ["approved", "receipt_exported"].includes(s.status),
    );
    return {
      dismissed: Boolean(row?.dismissedAt),
      steps: [
        {
          key: "sample",
          label: "Load the Lumora sample content",
          done: Boolean(row?.sampleLoadedAt),
          to: "/app/submit",
        },
        {
          key: "findings",
          label: "Open the report and read the findings",
          done: Boolean(row?.findingDecidedAt) || approved,
          to: "/app",
        },
        {
          key: "decide",
          label: "Accept or reject one finding",
          done: Boolean(row?.findingDecidedAt),
          to: "/app",
        },
        {
          key: "approve",
          label: "Approve as Ines and export the receipt",
          done: Boolean(row?.receiptAt) || approved,
          to: "/app",
        },
      ],
    };
  },
});

export const dismissChecklist = mutation({
  args: {},
  handler: async (ctx) => {
    const session = await requireMember(ctx);
    const now = Date.now();
    const row = await ctx.db
      .query("demoProgress")
      .withIndex("by_user", (q) =>
        q.eq("workspaceId", session.workspace._id).eq("userId", session.userId),
      )
      .first();
    if (row) {
      await ctx.db.patch(row._id, { dismissedAt: now, updatedAt: now });
    } else {
      await ctx.db.insert("demoProgress", {
        workspaceId: session.workspace._id,
        userId: session.userId,
        dismissedAt: now,
        updatedAt: now,
      });
    }
    await appendAudit(ctx, {
      workspaceId: session.workspace._id,
      actorId: session.userId,
      actorRole: session.membership.role,
      actorName: session.membership.displayName,
      action: "demo.checklist_dismissed",
      entityType: "membership",
      entityId: session.membership._id,
      payload: {},
    });
    return { dismissed: true };
  },
});

/** Stored model state for the admin panel. Live probing is a separate action. */
export const modelStatus = query({
  args: {},
  handler: async (ctx) => {
    const session = await requireMember(ctx);
    const state = await ctx.db
      .query("modelState")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", session.workspace._id))
      .first();
    const since = Date.now() - 24 * 3_600_000;
    const calls = await ctx.db
      .query("llmCalls")
      .withIndex("by_created", (q) => q.gte("createdAt", since))
      .collect();
    const today = calls.filter((c) => c.createdAt >= since);
    return {
      role: session.membership.role,
      consecutiveFailures: state?.consecutiveFailures ?? 0,
      openedUntil: state?.openedUntil ?? null,
      lastSuccessAt: state?.lastSuccessAt ?? null,
      lastErrorAt: state?.lastErrorAt ?? null,
      lastError: state?.lastError ?? null,
      lastCause: state?.lastCause ?? null,
      lastModel: state?.lastModel ?? null,
      callsToday: today.length,
      failuresToday: today.filter((c) => !c.ok).length,
      cachedRuns: (
        await ctx.db
          .query("cachedRuns")
          .withIndex("by_workspace", (q) => q.eq("workspaceId", session.workspace._id))
          .collect()
      ).length,
    };
  },
});
