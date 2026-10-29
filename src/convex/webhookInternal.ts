import { v } from "convex/values";
import {
  action,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { appendAudit, requireMember, requireRole } from "./helpers";
import { buildPayload, MAX_ATTEMPTS, nextAttemptAt } from "./lib/webhooks";
import { canonicalJson, sha256Hex } from "./lib/sha256";

function appBase() {
  return process.env.APP_BASE_URL ?? "https://brandsentinel.freebuff.app";
}

/** Queue one delivery per active endpoint subscribed to this event. */
export const emit = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    submissionId: v.id("submissions"),
    type: v.union(v.literal("findings_ready"), v.literal("approved")),
  },
  handler: async (ctx, args): Promise<{ queued: number; eventId?: string }> => {
    const submission = await ctx.db.get(args.submissionId);
    if (!submission) return { queued: 0 };
    const endpoints = await ctx.db
      .query("webhookEndpoints")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .collect();
    const active = endpoints.filter(
      (endpoint) => endpoint.active && endpoint.events.includes(args.type),
    );
    if (!active.length) return { queued: 0 };

    const findings = await ctx.db
      .query("findings")
      .withIndex("by_submission", (q) => q.eq("submissionId", args.submissionId))
      .collect();
    const counts = findings.reduce<Record<string, number>>((acc, row) => {
      acc[row.severity] = (acc[row.severity] ?? 0) + 1;
      return acc;
    }, {});
    counts.total = findings.length;
    counts.pending = findings.filter((row) => row.status === "pending").length;

    const eventId = `evt_${sha256Hex(
      canonicalJson({
        submission: args.submissionId,
        type: args.type,
        version: submission.currentVersion,
      }),
    ).slice(0, 24)}`;
    const payload = buildPayload({
      eventId,
      type: args.type,
      workspace: args.workspaceId,
      submissionId: args.submissionId,
      status: submission.status,
      counts,
      baseUrl: appBase(),
    });
    const body = JSON.stringify(payload);

    let queued = 0;
    for (const endpoint of active) {
      const deliveryId = await ctx.db.insert("webhookDeliveries", {
        workspaceId: args.workspaceId,
        endpointId: endpoint._id,
        eventId,
        eventType: args.type,
        payload: body,
        payloadHash: sha256Hex(body),
        idempotencyKey: `${eventId}:${endpoint._id}`,
        attempt: 1,
        status: "pending",
        nextAttemptAt: Date.now(),
        createdAt: Date.now(),
      });
      await ctx.scheduler.runAfter(0, internal.webhookDeliver.deliver, { deliveryId });
      queued += 1;
    }
    await appendAudit(ctx, {
      workspaceId: args.workspaceId,
      actorId: "system",
      actorRole: "system",
      actorName: "BrandSentinel",
      action: "webhook.queued",
      entityType: "submission",
      entityId: args.submissionId,
      payload: { eventId, type: args.type, endpoints: queued, counts },
    });
    return { queued, eventId };
  },
});

export const delivery = internalQuery({
  args: { deliveryId: v.id("webhookDeliveries") },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.deliveryId);
    if (!row) return null;
    const endpoint = await ctx.db.get(row.endpointId);
    if (!endpoint || !endpoint.active || row.status === "delivered") return null;
    return {
      url: endpoint.url,
      secret: endpoint.secret,
      payload: row.payload,
      eventType: row.eventType,
      idempotencyKey: row.idempotencyKey,
    };
  },
});

export const recordAttempt = internalMutation({
  args: {
    deliveryId: v.id("webhookDeliveries"),
    ok: v.boolean(),
    responseCode: v.optional(v.number()),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<void> => {
    const row = await ctx.db.get(args.deliveryId);
    if (!row) return;
    const now = Date.now();
    if (args.ok) {
      await ctx.db.patch(row._id, {
        status: "delivered",
        responseCode: args.responseCode,
        deliveredAt: now,
        error: undefined,
        nextAttemptAt: undefined,
      });
      await appendAudit(ctx, {
        workspaceId: row.workspaceId,
        actorId: "system",
        actorRole: "system",
        actorName: "BrandSentinel",
        action: "webhook.delivered",
        entityType: "webhookDelivery",
        entityId: row._id,
        payload: { eventId: row.eventId, attempt: row.attempt, code: args.responseCode ?? null },
      });
      return;
    }
    const next = nextAttemptAt(row.attempt, now);
    const dead = row.attempt >= MAX_ATTEMPTS || next === null;
    await ctx.db.patch(row._id, {
      status: dead ? "dead" : "failed",
      responseCode: args.responseCode,
      error: args.error?.slice(0, 300),
      nextAttemptAt: dead ? undefined : next,
    });
    await appendAudit(ctx, {
      workspaceId: row.workspaceId,
      actorId: "system",
      actorRole: "system",
      actorName: "BrandSentinel",
      action: dead ? "webhook.dead" : "webhook.retry_scheduled",
      entityType: "webhookDelivery",
      entityId: row._id,
      payload: {
        eventId: row.eventId,
        attempt: row.attempt,
        code: args.responseCode ?? null,
        error: args.error?.slice(0, 160) ?? null,
        nextAttemptAt: dead ? null : next,
      },
    });
    if (!dead && next) {
      await ctx.scheduler.runAfter(Math.max(1000, next - now), internal.webhookDeliver.deliver, {
        deliveryId: row._id,
      });
    }
  },
});

export const replay = mutation({
  args: { deliveryId: v.id("webhookDeliveries") },
  handler: async (ctx, args): Promise<{ status: string }> => {
    const session = await requireRole(ctx, ["admin"]);
    const row = await ctx.db.get(args.deliveryId);
    if (!row || row.workspaceId !== session.workspace._id) {
      throw new Error("Delivery not found.");
    }
    await ctx.db.patch(row._id, {
      status: "pending",
      attempt: 1,
      error: undefined,
      nextAttemptAt: Date.now(),
    });
    await ctx.scheduler.runAfter(0, internal.webhookDeliver.deliver, { deliveryId: row._id });
    await appendAudit(ctx, {
      workspaceId: session.workspace._id,
      actorId: session.userId,
      actorRole: session.membership.role,
      actorName: session.membership.displayName,
      action: "webhook.replayed",
      entityType: "webhookDelivery",
      entityId: row._id,
      payload: { eventId: row.eventId },
    });
    return { status: "pending" };
  },
});

export const queueTest = internalMutation({
  args: { endpointId: v.id("webhookEndpoints") },
  handler: async (ctx, args): Promise<Id<"webhookDeliveries">> => {
    const session = await requireRole(ctx, ["admin"]);
    const endpoint = await ctx.db.get(args.endpointId);
    if (!endpoint || endpoint.workspaceId !== session.workspace._id) {
      throw new Error("Endpoint not found.");
    }
    const eventId = `evt_test_${Date.now()}`;
    const payload = JSON.stringify(
      buildPayload({
        eventId,
        type: "test",
        workspace: endpoint.workspaceId,
        submissionId: "test",
        status: "test",
        counts: { total: 0 },
        baseUrl: appBase(),
      }),
    );
    return await ctx.db.insert("webhookDeliveries", {
      workspaceId: endpoint.workspaceId,
      endpointId: endpoint._id,
      eventId,
      eventType: "test",
      payload,
      payloadHash: sha256Hex(payload),
      idempotencyKey: `${eventId}:${endpoint._id}`,
      attempt: 1,
      status: "pending",
      nextAttemptAt: Date.now(),
      createdAt: Date.now(),
    });
  },
});

export const sendTest = action({
  args: { endpointId: v.id("webhookEndpoints") },
  handler: async (ctx, args): Promise<{ deliveryId: Id<"webhookDeliveries"> }> => {
    const id: Id<"webhookDeliveries"> = await ctx.runMutation(
      internal.webhookInternal.queueTest,
      { endpointId: args.endpointId },
    );
    await ctx.runAction(internal.webhookDeliver.deliver, { deliveryId: id });
    return { deliveryId: id };
  },
});

export const deliveries = query({
  args: {},
  handler: async (ctx) => {
    const session = await requireMember(ctx);
    const rows = await ctx.db
      .query("webhookDeliveries")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", session.workspace._id))
      .order("desc")
      .take(40);
    const endpoints = await ctx.db
      .query("webhookEndpoints")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", session.workspace._id))
      .collect();
    const names = new Map(endpoints.map((e) => [e._id, e.description || e.url]));
    return rows.map((row) => ({
      id: row._id,
      endpoint: names.get(row.endpointId) ?? "removed endpoint",
      eventId: row.eventId,
      eventType: row.eventType,
      attempt: row.attempt,
      status: row.status,
      responseCode: row.responseCode ?? null,
      error: row.error ?? null,
      createdAt: row.createdAt,
      deliveredAt: row.deliveredAt ?? null,
    }));
  },
});
