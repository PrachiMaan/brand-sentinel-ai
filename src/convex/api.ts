import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { appendAudit, requireRole } from "./helpers";
import { canonicalJson, sha256Hex } from "./lib/sha256";
import type { Id } from "./_generated/dataModel";

/**
 * Domain functions behind /api/v1. They run without a browser session, so the
 * HTTP layer passes the authenticated key id and every rule is re-checked here:
 * scope, workspace isolation, state machine and the same approval gate the UI
 * uses. Errors are returned as codes so the HTTP layer can map status codes.
 */

export type ApiError = { error: { code: string; message: string } };

const RATE_LIMIT = 60;
const WINDOW_MS = 60_000;

export const authenticate = internalMutation({
  args: { keyHash: v.string() },
  handler: async (ctx, args) => {
    const key = await ctx.db
      .query("apiKeys")
      .withIndex("by_hash", (q) => q.eq("keyHash", args.keyHash))
      .first();
    if (!key) {
      return { ok: false as const, code: "unauthorized", message: "Unknown API key." };
    }
    if (key.revokedAt) {
      return { ok: false as const, code: "unauthorized", message: "That API key is revoked." };
    }
    const now = Date.now();
    const windowStart = key.windowStart ?? 0;
    const inWindow = now - windowStart < WINDOW_MS;
    const count = inWindow ? (key.windowCount ?? 0) + 1 : 1;
    if (count > RATE_LIMIT) {
      return {
        ok: false as const,
        code: "rate_limited",
        message: `Rate limit is ${RATE_LIMIT} requests per minute for this key.`,
        retryAfter: Math.ceil((windowStart + WINDOW_MS - now) / 1000),
      };
    }
    await ctx.db.patch(key._id, {
      lastUsedAt: now,
      windowStart: inWindow ? windowStart : now,
      windowCount: count,
    });
    return {
      ok: true as const,
      keyId: key._id,
      workspaceId: key.workspaceId,
      scope: key.scope,
      prefix: key.prefix,
      name: key.name,
      remaining: RATE_LIMIT - count,
    };
  },
});

export const createSubmission = internalMutation({
  args: {
    keyId: v.id("apiKeys"),
    title: v.string(),
    text: v.string(),
    channel: v.string(),
    audience: v.string(),
    team: v.string(),
    externalRef: v.optional(v.string()),
    idempotencyKey: v.string(),
    requestHash: v.string(),
  },
  handler: async (ctx, args) => {
    const key = await ctx.db.get(args.keyId);
    if (!key || key.revokedAt) {
      return { error: { code: "unauthorized", message: "That API key is revoked." } } as const;
    }
    if (key.scope !== "creator" && key.scope !== "reviewer" && key.scope !== "approver") {
      return { error: { code: "forbidden", message: "This key cannot create submissions." } } as const;
    }
    const text = args.text.trim();
    if (!text) {
      return { error: { code: "unprocessable", message: "Content is empty." } } as const;
    }
    if (text.length > 20_000) {
      return {
        error: {
          code: "payload_too_large",
          message: "Content is over 20,000 characters.",
        },
      } as const;
    }

    const existing = await ctx.db
      .query("idempotencyKeys")
      .withIndex("by_key", (q) =>
        q.eq("workspaceId", key.workspaceId).eq("key", args.idempotencyKey),
      )
      .first();
    if (existing) {
      if (existing.requestHash !== args.requestHash) {
        return {
          error: {
            code: "conflict",
            message: "This Idempotency-Key was used with a different request body.",
          },
        } as const;
      }
      return {
        submissionId: existing.submissionId,
        status: "replayed",
        response: JSON.parse(existing.responseJson) as Record<string, unknown>,
      } as const;
    }

    const now = Date.now();
    const submissionId = await ctx.db.insert("submissions", {
      workspaceId: key.workspaceId,
      creatorId: key.createdBy as unknown as Id<"users">,
      creatorName: `API · ${key.name}`,
      title: args.title.trim().slice(0, 120) || "API submission",
      channel: args.channel,
      audience: args.audience.trim() || "General audience",
      team: args.team,
      currentVersion: 1,
      status: "draft",
      altText: "",
      legalFlag: false,
      kind: "text",
      apiOrigin: true,
      externalRef: args.externalRef,
      createdAt: now,
      updatedAt: now,
    });
    const contentHash = sha256Hex(
      canonicalJson({
        text,
        channel: args.channel,
        audience: args.audience,
        altText: "",
      }),
    );
    await ctx.db.insert("versions", {
      submissionId,
      workspaceId: key.workspaceId,
      version: 1,
      text,
      channel: args.channel,
      audience: args.audience.trim() || "General audience",
      altText: "",
      contentHash,
      pageCount: 1,
      createdAt: now,
      createdBy: key.createdBy as unknown as Id<"users">,
    });
    await appendAudit(ctx, {
      workspaceId: key.workspaceId,
      actorId: `api:${key._id}`,
      actorRole: key.scope,
      actorName: `API key ${key.prefix}`,
      action: "submission.created",
      entityType: "submission",
      entityId: submissionId,
      payload: { title: args.title, channel: args.channel, via: "api", contentHash },
    });

    const response = {
      id: submissionId,
      status: "draft",
      statusUrl: `/api/v1/submissions/${submissionId}`,
      findingsUrl: `/api/v1/submissions/${submissionId}/findings`,
    };
    await ctx.db.insert("idempotencyKeys", {
      workspaceId: key.workspaceId,
      key: args.idempotencyKey,
      requestHash: args.requestHash,
      responseJson: JSON.stringify(response),
      submissionId,
      createdAt: now,
    });
    await ctx.scheduler.runAfter(0, internal.review.runReviewApi, {
      submissionId,
      apiKeyId: key._id,
    });
    return { submissionId, status: "created", response } as const;
  },
});

export const getSubmission = internalQuery({
  args: { workspaceId: v.id("workspaces"), submissionId: v.id("submissions") },
  handler: async (ctx, args) => {
    const submission = await ctx.db.get(args.submissionId);
    if (!submission || submission.workspaceId !== args.workspaceId) return null;
    const run = submission.lastRunId
      ? await ctx.db.get(submission.lastRunId)
      : await ctx.db
          .query("runs")
          .withIndex("by_submission", (q) => q.eq("submissionId", submission._id))
          .order("desc")
          .first();
    const findings = run
      ? await ctx.db.query("findings").withIndex("by_run", (q) => q.eq("runId", run._id)).collect()
      : [];
    return {
      id: submission._id,
      title: submission.title,
      status: submission.status,
      version: submission.currentVersion,
      channel: submission.channel,
      team: submission.team ?? null,
      externalRef: submission.externalRef ?? null,
      degraded: run ? ["degraded", "failed"].includes(run.status) : false,
      degradedCause: run?.degradedCause ?? null,
      source: run?.source ?? null,
      counts: findings.reduce<Record<string, number>>((acc, row) => {
        acc[row.severity] = (acc[row.severity] ?? 0) + 1;
        return acc;
      }, {}),
      updatedAt: submission.updatedAt,
    };
  },
});

export const getFindings = internalQuery({
  args: { workspaceId: v.id("workspaces"), submissionId: v.id("submissions") },
  handler: async (ctx, args) => {
    const submission = await ctx.db.get(args.submissionId);
    if (!submission || submission.workspaceId !== args.workspaceId) return null;
    const run = submission.lastRunId
      ? await ctx.db.get(submission.lastRunId)
      : await ctx.db
          .query("runs")
          .withIndex("by_submission", (q) => q.eq("submissionId", submission._id))
          .order("desc")
          .first();
    const findings = run
      ? await ctx.db.query("findings").withIndex("by_run", (q) => q.eq("runId", run._id)).collect()
      : [];
    return {
      submissionId: submission._id,
      status: submission.status,
      findings: findings
        .sort((a, b) => a.order - b.order)
        .map((row) => ({
          id: row.findingId,
          reviewer: row.reviewer,
          severity: row.severity,
          confidence: row.confidence,
          spanText: row.spanText,
          spanStart: row.spanStart,
          spanEnd: row.spanEnd,
          ruleId: row.ruleId,
          guidelineExcerpt: row.guidelineExcerpt,
          whyItMatters: row.whyItMatters,
          suggestedFix: row.suggestedFix,
          status: row.status,
          measured: row.measured ?? null,
          page: row.page ?? null,
          bbox: row.bbox ?? null,
        })),
    };
  },
});

export const decide = internalMutation({
  args: {
    keyId: v.id("apiKeys"),
    submissionId: v.id("submissions"),
    findingId: v.optional(v.string()),
    decision: v.union(
      v.literal("accept"),
      v.literal("edit"),
      v.literal("reject"),
      v.literal("approve"),
      v.literal("reject_submission"),
      v.literal("needs_revision"),
    ),
    reason: v.optional(v.string()),
    editedFix: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const key = await ctx.db.get(args.keyId);
    if (!key || key.revokedAt) {
      return { error: { code: "unauthorized", message: "That API key is revoked." } } as const;
    }
    const submission = await ctx.db.get(args.submissionId);
    if (!submission || submission.workspaceId !== key.workspaceId) {
      return { error: { code: "not_found", message: "Submission not found." } } as const;
    }
    const now = Date.now();
    const actor = {
      id: `api:${key._id}`,
      role: key.scope,
      name: `API key ${key.prefix}`,
    };

    if (args.decision === "approve" || args.decision === "reject_submission" || args.decision === "needs_revision") {
      if (key.scope !== "approver") {
        return {
          error: {
            code: "forbidden",
            message: `A ${key.scope} key cannot make a submission-level decision.`,
          },
        } as const;
      }
      if (!["findings_ready", "human_review"].includes(submission.status)) {
        return {
          error: {
            code: "conflict",
            message: `Submission is ${submission.status}, not waiting for a decision.`,
          },
        } as const;
      }
      const findings = await ctx.db
        .query("findings")
        .withIndex("by_submission", (q) => q.eq("submissionId", submission._id))
        .collect();
      if (args.decision === "approve") {
        const blocking = findings.filter(
          (row) =>
            row.status === "pending" &&
            row.bucket === "verified" &&
            (row.severity === "critical" || row.severity === "high"),
        );
        if (blocking.length) {
          return {
            error: {
              code: "conflict",
              message: `${blocking.length} pending critical/high findings must be decided first.`,
            },
          } as const;
        }
        await ctx.db.patch(submission._id, { status: "approved", updatedAt: now });
        await appendAudit(ctx, {
          workspaceId: key.workspaceId,
          actorId: actor.id,
          actorRole: actor.role,
          actorName: actor.name,
          action: "submission.approved",
          entityType: "submission",
          entityId: submission._id,
          payload: { version: submission.currentVersion, via: "api" },
        });
        await ctx.scheduler.runAfter(0, internal.webhookInternal.emit, {
          workspaceId: key.workspaceId,
          submissionId: submission._id,
          type: "approved",
        });
        return { status: "approved" } as const;
      }
      if (args.decision === "reject_submission") {
        if ((args.reason ?? "").trim().length < 3) {
          return {
            error: { code: "unprocessable", message: "A rejection needs a reason." },
          } as const;
        }
        await ctx.db.patch(submission._id, { status: "rejected", updatedAt: now });
        await appendAudit(ctx, {
          workspaceId: key.workspaceId,
          actorId: actor.id,
          actorRole: actor.role,
          actorName: actor.name,
          action: "submission.rejected",
          entityType: "submission",
          entityId: submission._id,
          payload: { reason: args.reason?.slice(0, 300), via: "api" },
        });
        return { status: "rejected" } as const;
      }
      await ctx.db.patch(submission._id, { status: "needs_revision", updatedAt: now });
      await appendAudit(ctx, {
        workspaceId: key.workspaceId,
        actorId: actor.id,
        actorRole: actor.role,
        actorName: actor.name,
        action: "submission.needs_revision",
        entityType: "submission",
        entityId: submission._id,
        payload: { note: args.reason ?? "", via: "api" },
      });
      return { status: "needs_revision" } as const;
    }

    if (key.scope === "creator") {
      return {
        error: { code: "forbidden", message: "A creator key cannot decide findings." },
      } as const;
    }
    if (!args.findingId) {
      return {
        error: { code: "unprocessable", message: "findingId is required for a finding decision." },
      } as const;
    }
    const finding = await ctx.db
      .query("findings")
      .withIndex("by_findingId", (q) =>
        q.eq("submissionId", submission._id).eq("findingId", args.findingId!),
      )
      .first();
    if (!finding) {
      return { error: { code: "not_found", message: "Finding not found." } } as const;
    }
    if (finding.status !== "pending") {
      return {
        error: { code: "conflict", message: "That finding already has a decision." },
      } as const;
    }
    if (args.decision === "edit" && !args.editedFix?.trim()) {
      return {
        error: { code: "unprocessable", message: "Editing a fix needs the new wording." },
      } as const;
    }
    if (args.decision === "reject" && (args.reason ?? "").trim().length < 3) {
      return {
        error: { code: "unprocessable", message: "Rejecting a finding needs a reason." },
      } as const;
    }
    const status =
      args.decision === "accept" ? "accepted" : args.decision === "edit" ? "edited" : "rejected";
    await ctx.db.patch(finding._id, { status });
    await ctx.db.insert("decisions", {
      findingDocId: finding._id,
      findingId: finding.findingId,
      submissionId: submission._id,
      workspaceId: key.workspaceId,
      decision: args.decision,
      reason: args.reason?.trim(),
      editedFix:
        args.decision === "edit"
          ? args.editedFix?.trim()
          : args.decision === "accept"
            ? finding.suggestedFix
            : undefined,
      actorId: key.createdBy as unknown as Id<"users">,
      actorRole: key.scope,
      actorName: actor.name,
      createdAt: now,
      synthetic: false,
    });
    await ctx.db.insert("ruleOverrides", {
      workspaceId: key.workspaceId,
      ruleId: finding.ruleId,
      decision: args.decision,
      actorRole: key.scope,
      submissionId: submission._id,
      findingId: finding.findingId,
      seeded: false,
      synthetic: false,
      createdAt: now,
    });
    if (submission.status === "findings_ready") {
      await ctx.db.patch(submission._id, { status: "human_review", updatedAt: now });
    }
    await appendAudit(ctx, {
      workspaceId: key.workspaceId,
      actorId: actor.id,
      actorRole: actor.role,
      actorName: actor.name,
      action: `finding.${status}`,
      entityType: "finding",
      entityId: finding.findingId,
      payload: { ruleId: finding.ruleId, reason: args.reason ?? "", via: "api" },
    });
    return { status } as const;
  },
});

/** Admin-only key and endpoint management. */
export const listKeys = internalQuery({
  args: {},
  handler: async (ctx) => {
    const session = await requireRole(ctx, ["admin"]);
    const keys = await ctx.db
      .query("apiKeys")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", session.workspace._id))
      .collect();
    return keys.map((key) => ({
      id: key._id,
      name: key.name,
      prefix: key.prefix,
      scope: key.scope,
      createdBy: key.createdBy,
      createdAt: key.createdAt,
      lastUsedAt: key.lastUsedAt ?? null,
      revoked: Boolean(key.revokedAt),
    }));
  },
});
