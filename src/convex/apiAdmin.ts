import { v } from "convex/values";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { appendAudit, requireMember, requireRole } from "./helpers";

/** Key and webhook administration (V8 runtime). Secrets are stored hashed. */

export const keys = query({
  args: {},
  handler: async (ctx) => {
    const session = await requireMember(ctx);
    const rows = await ctx.db
      .query("apiKeys")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", session.workspace._id))
      .collect();
    return rows
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((row) => ({
        id: row._id,
        name: row.name,
        prefix: row.prefix,
        scope: row.scope,
        createdBy: row.createdBy,
        createdAt: row.createdAt,
        lastUsedAt: row.lastUsedAt ?? null,
        revoked: Boolean(row.revokedAt),
      }));
  },
});

export const revokeKey = mutation({
  args: { keyId: v.id("apiKeys") },
  handler: async (ctx, args) => {
    const session = await requireRole(ctx, ["admin"]);
    const key = await ctx.db.get(args.keyId);
    if (!key || key.workspaceId !== session.workspace._id) throw new Error("Key not found.");
    if (key.revokedAt) return { revoked: true };
    await ctx.db.patch(key._id, { revokedAt: Date.now() });
    await appendAudit(ctx, {
      workspaceId: session.workspace._id,
      actorId: session.userId,
      actorRole: session.membership.role,
      actorName: session.membership.displayName,
      action: "api_key.revoked",
      entityType: "apiKey",
      entityId: key._id,
      payload: { prefix: key.prefix, name: key.name },
    });
    return { revoked: true };
  },
});

export const endpoints = query({
  args: {},
  handler: async (ctx) => {
    const session = await requireMember(ctx);
    const rows = await ctx.db
      .query("webhookEndpoints")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", session.workspace._id))
      .collect();
    return rows.map((row) => ({
      id: row._id,
      url: row.url,
      description: row.description,
      events: row.events,
      active: row.active,
      createdAt: row.createdAt,
      secretPrefix: row.secret.slice(0, 12),
    }));
  },
});

export const setEndpointActive = mutation({
  args: { endpointId: v.id("webhookEndpoints"), active: v.boolean() },
  handler: async (ctx, args) => {
    const session = await requireRole(ctx, ["admin"]);
    const endpoint = await ctx.db.get(args.endpointId);
    if (!endpoint || endpoint.workspaceId !== session.workspace._id) {
      throw new Error("Endpoint not found.");
    }
    await ctx.db.patch(endpoint._id, { active: args.active });
    await appendAudit(ctx, {
      workspaceId: session.workspace._id,
      actorId: session.userId,
      actorRole: session.membership.role,
      actorName: session.membership.displayName,
      action: args.active ? "webhook.endpoint_enabled" : "webhook.endpoint_disabled",
      entityType: "webhookEndpoint",
      entityId: endpoint._id,
      payload: { url: endpoint.url },
    });
    return { active: args.active };
  },
});

export const access = internalQuery({
  args: {},
  handler: async (ctx) => {
    const session = await requireRole(ctx, ["admin"]);
    return {
      workspaceId: session.workspace._id,
      displayName: session.membership.displayName,
      role: session.membership.role,
    };
  },
});

export const storeKey = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    name: v.string(),
    prefix: v.string(),
    keyHash: v.string(),
    scope: v.union(v.literal("creator"), v.literal("reviewer"), v.literal("approver")),
    createdBy: v.string(),
  },
  handler: async (ctx, args) => {
    const id = await ctx.db.insert("apiKeys", {
      workspaceId: args.workspaceId,
      name: args.name,
      prefix: args.prefix,
      keyHash: args.keyHash,
      scope: args.scope,
      createdBy: args.createdBy,
      createdAt: Date.now(),
    });
    await appendAudit(ctx, {
      workspaceId: args.workspaceId,
      actorId: args.createdBy,
      actorRole: "admin",
      actorName: args.createdBy,
      action: "api_key.created",
      entityType: "apiKey",
      entityId: id,
      payload: { name: args.name, prefix: args.prefix, scope: args.scope },
    });
    return id;
  },
});

export const storeEndpoint = internalMutation({
  args: {
    url: v.string(),
    description: v.string(),
    events: v.array(v.string()),
    secret: v.string(),
  },
  handler: async (ctx, args) => {
    const session = await requireRole(ctx, ["admin"]);
    const id = await ctx.db.insert("webhookEndpoints", {
      workspaceId: session.workspace._id,
      url: args.url,
      description: args.description.slice(0, 120) || args.url,
      secret: args.secret,
      events: args.events,
      active: true,
      createdBy: session.membership.displayName,
      createdAt: Date.now(),
    });
    await appendAudit(ctx, {
      workspaceId: session.workspace._id,
      actorId: session.userId,
      actorRole: session.membership.role,
      actorName: session.membership.displayName,
      action: "webhook.endpoint_created",
      entityType: "webhookEndpoint",
      entityId: id,
      payload: { url: args.url, events: args.events },
    });
    return id;
  },
});
