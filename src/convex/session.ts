import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import {
  appendAudit,
  brandState,
  currentMembership,
  ensureWorkspace,
  requireUser,
} from "./helpers";
import { workspaceRole } from "./schema";
import { DEMO_PERSONAS } from "./lib/lumora";

/** The signed-in judge, their workspace membership and the active brand pack. */
export const me = query({
  args: {},
  handler: async (ctx) => {
    const session = await currentMembership(ctx);
    if (!session) return null;
    const brand = await brandState(ctx, session.workspace._id);
    return {
      userId: session.userId,
      role: session.membership.role,
      displayName: session.membership.displayName,
      workspace: {
        id: session.workspace._id,
        name: session.workspace.name,
      },
      brand: brand.pack
        ? {
            name: brand.pack.name,
            version: brand.pack.version,
            palette: brand.pack.palette,
            voice: brand.pack.voice,
          }
        : null,
      ruleCount: brand.rules.length,
      claimCount: brand.claims.length,
      hasCompileDraft: false,
    };
  },
});

/**
 * One-click demo entry. Any visitor can enter as one of the four Lumora
 * personas. The session is a normal authenticated Convex user; the persona is
 * a membership row, and every action records the role it was taken under.
 */
export const enterDemo = mutation({
  args: {
    role: workspaceRole,
    displayName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const workspaceId = await ensureWorkspace(ctx);
    const persona = DEMO_PERSONAS.find((p) => p.role === args.role);
    const displayName =
      args.displayName?.trim() ||
      persona?.name ||
      `${args.role[0].toUpperCase()}${args.role.slice(1)} (demo)`;
    const now = Date.now();

    const existing = await ctx.db
      .query("memberships")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        role: args.role,
        displayName,
        isDemo: true,
        updatedAt: now,
        workspaceId,
      });
    } else {
      await ctx.db.insert("memberships", {
        userId,
        workspaceId,
        role: args.role,
        displayName,
        isDemo: true,
        createdAt: now,
        updatedAt: now,
      });
    }

    await ctx.db.patch(userId, { name: displayName });
    await appendAudit(ctx, {
      workspaceId,
      actorId: userId,
      actorRole: args.role,
      actorName: displayName,
      action: existing ? "demo.role_switched" : "demo.session_started",
      entityType: "membership",
      entityId: userId,
      payload: { role: args.role, workspace: "lumora-studio", via: "one-click demo" },
    });

    return { workspaceId, role: args.role, displayName };
  },
});

/** Always-visible role switcher. This is a demo affordance; production RBAC
 * would bind a person to one role per workspace. Every switch is audited. */
export const switchRole = mutation({
  args: { role: workspaceRole },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const session = await currentMembership(ctx);
    if (!session) throw new Error("Enter the demo before switching roles.");
    const persona = DEMO_PERSONAS.find((p) => p.role === args.role);
    const displayName = persona?.name ?? session.membership.displayName;
    await ctx.db.patch(session.membership._id, {
      role: args.role,
      displayName,
      updatedAt: Date.now(),
    });
    await ctx.db.patch(userId, { name: displayName });
    await appendAudit(ctx, {
      workspaceId: session.workspace._id,
      actorId: userId,
      actorRole: args.role,
      actorName: displayName,
      action: "demo.role_switched",
      entityType: "membership",
      entityId: session.membership._id,
      payload: {
        from: session.membership.role,
        to: args.role,
        note: "Demo role switcher",
      },
    });
    return { role: args.role, displayName };
  },
});
