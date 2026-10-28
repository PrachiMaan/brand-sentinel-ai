import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import {
  appendAudit,
  brandState,
  requireMember,
  requireRole,
} from "./helpers";
import { REVIEWERS } from "./lib/types";
import type { Finding } from "./lib/types";
import { GUIDELINE_DOCUMENT } from "./lib/lumora";

export const beginReview = internalMutation({
  args: {
    submissionId: v.id("submissions"),
    /** Set only by the API path, which authenticates with a key instead of a session. */
    apiKeyId: v.optional(v.id("apiKeys")),
  },
  handler: async (ctx, args) => {
    const apiKey = args.apiKeyId ? await ctx.db.get(args.apiKeyId) : null;
    const session = apiKey ? null : await requireRole(ctx, ["creator", "admin"]);
    const submission = await ctx.db.get(args.submissionId);
    const workspaceId = apiKey?.workspaceId ?? session!.workspace._id;
    if (!submission || submission.workspaceId !== workspaceId) {
      throw new Error("Submission not found.");
    }
    if (apiKey?.revokedAt) throw new Error("That API key is revoked.");
    if (["approved", "receipt_exported", "rejected"].includes(submission.status)) {
      throw new Error("This submission is closed. Start a new version instead.");
    }
    const existing = await ctx.db
      .query("runs")
      .withIndex("by_submission", (q) => q.eq("submissionId", submission._id))
      .order("desc")
      .first();
    if (
      existing &&
      ["queued", "running"].includes(existing.status) &&
      Date.now() - existing.startedAt < 8 * 60 * 1000
    ) {
      return { runId: existing._id, reused: true, version: existing.version };
    }
    if (submission.status === "ai_review" && existing) {
      return { runId: existing._id, reused: true, version: existing.version };
    }

    const versions = await ctx.db
      .query("versions")
      .withIndex("by_submission", (q) => q.eq("submissionId", submission._id))
      .collect();
    const current = versions.find(
      (ver) => ver.version === submission.currentVersion,
    );
    if (!current) throw new Error("The current version is missing.");
    if (!current.text.trim()) throw new Error("This version has no content to review.");

    const now = Date.now();
    const runId = await ctx.db.insert("runs", {
      submissionId: submission._id,
      workspaceId: submission.workspaceId,
      versionId: current._id,
      version: current.version,
      status: "queued",
      startedAt: now,
      fastMs: 0,
      progress: REVIEWERS.map((reviewer) => ({ reviewer, status: "pending" })),
      createdAt: now,
    });
    await ctx.db.patch(submission._id, {
      status: "ai_review",
      lastRunId: runId,
      updatedAt: now,
    });
    await appendAudit(ctx, {
      workspaceId: submission.workspaceId,
      actorId: apiKey ? `api:${apiKey._id}` : session!.userId,
      actorRole: apiKey ? apiKey.scope : session!.membership.role,
      actorName: apiKey ? `API key ${apiKey.prefix}` : session!.membership.displayName,
      action: "review.started",
      entityType: "run",
      entityId: runId,
      payload: {
        submissionId: submission._id,
        version: current.version,
        contentHash: current.contentHash,
        reviewers: REVIEWERS,
      },
    });
    return { runId, reused: false, version: current.version };
  },
});

export const prepare = internalQuery({
  args: { runId: v.id("runs"), apiKeyId: v.optional(v.id("apiKeys")) },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run) throw new Error("Run not found.");
    if (args.apiKeyId) {
      const key = await ctx.db.get(args.apiKeyId);
      if (!key || key.workspaceId !== run.workspaceId) throw new Error("Run not found.");
    } else {
      const session = await requireMember(ctx);
      if (run.workspaceId !== session.workspace._id) throw new Error("Run not found.");
    }
    const submission = await ctx.db.get(run.submissionId);
    const version = await ctx.db.get(run.versionId);
    if (!submission || !version) throw new Error("Run data is incomplete.");
    const brand = await brandState(ctx, run.workspaceId);
    if (!brand.pack) throw new Error("No published brand pack in this workspace.");

    let imagePalette: { hex: string; share: number }[] = [];
    if (submission.imagePalette) {
      try {
        imagePalette = JSON.parse(submission.imagePalette);
      } catch {
        imagePalette = [];
      }
    }

    return {
      runId: run._id,
      workspaceId: run.workspaceId,
      submissionId: submission._id,
      version: {
        number: version.version,
        text: version.text,
        channel: version.channel,
        audience: version.audience,
        altText: version.altText,
        contentHash: version.contentHash,
      },
      sampleId: submission.sampleId ?? null,
      pageCount: version.pageCount ?? 1,
      input: {
        text: version.text,
        channel: version.channel,
        audience: version.audience,
        altText: version.altText,
        hasImage: Boolean(submission.imageStorageId) || (version.pageCount ?? 1) > 1,
        design:
          submission.designTextColor && submission.designBgColor
            ? {
                textHex: submission.designTextColor,
                bgHex: submission.designBgColor,
              }
            : undefined,
        imagePalette,
      },
      brand: {
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
          config: r.config,
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
      },
      guidelineText: GUIDELINE_DOCUMENT,
    };
  },
});

export const updateProgress = internalMutation({
  args: {
    runId: v.id("runs"),
    reviewer: v.string(),
    status: v.string(),
    ms: v.optional(v.number()),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run) return;
    const progress = run.progress.map((p) =>
      p.reviewer === args.reviewer ? { ...p, status: args.status, ms: args.ms } : p,
    );
    await ctx.db.patch(run._id, {
      progress,
      status: run.status === "queued" ? "running" : run.status,
      error: args.note ? `${run.error ? run.error + " · " : ""}${args.note}` : run.error,
    });
  },
});

export const saveResults = internalMutation({
  args: {
    runId: v.id("runs"),
    findingsJson: v.string(),
    verifierJson: v.string(),
    droppedJson: v.string(),
    countsJson: v.string(),
    summary: v.string(),
    brandFit: v.number(),
    fastMs: v.number(),
    deepMs: v.number(),
    model: v.string(),
    error: v.optional(v.string()),
    progressJson: v.string(),
    source: v.string(),
    degradedCause: v.optional(v.string()),
    apiKeyId: v.optional(v.id("apiKeys")),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run) throw new Error("Run not found.");
    let actorId = "system";
    let actorRole = "system";
    let actorName = "BrandSentinel";
    if (args.apiKeyId) {
      const key = await ctx.db.get(args.apiKeyId);
      if (!key || key.workspaceId !== run.workspaceId) throw new Error("Run not found.");
      actorId = `api:${key._id}`;
      actorRole = key.scope;
      actorName = `API key ${key.prefix}`;
    } else {
      const session = await requireMember(ctx);
      if (run.workspaceId !== session.workspace._id) throw new Error("Run not found.");
    }
    const existing = await ctx.db
      .query("findings")
      .withIndex("by_run", (q) => q.eq("runId", run._id))
      .collect();
    for (const row of existing) await ctx.db.delete(row._id);

    const findings = JSON.parse(args.findingsJson) as Finding[];
    for (const [index, f] of findings.entries()) {
      await ctx.db.insert("findings", {
        runId: run._id,
        submissionId: run.submissionId,
        workspaceId: run.workspaceId,
        findingId: f.id || `finding-${index}`,
        reviewer: f.reviewer,
        severity: f.severity,
        confidence: f.confidence,
        spanText: f.spanText,
        spanStart: f.spanStart,
        spanEnd: f.spanEnd,
        ruleId: f.ruleId,
        guidelineExcerpt: f.guidelineExcerpt,
        whyItMatters: f.whyItMatters,
        suggestedFix: f.suggestedFix,
        status: "pending",
        source: f.source,
        bucket: f.bucket,
        evidenceType: f.evidenceType,
        measuredValue: f.measuredValue,
        claimStatus: f.claimStatus,
        claimId: f.claimId,
        intentScore: f.intentScore,
        fixRisk: f.fixRisk,
        page: f.page,
        bbox: f.bbox,
        measured: f.measured,
        threshold: f.threshold,
        order: index,
        createdAt: Date.now(),
      });
    }

    const now = Date.now();
    await ctx.db.patch(run._id, {
      status: args.error ? "degraded" : "complete",
      finishedAt: now,
      fastMs: args.fastMs,
      deepMs: args.deepMs,
      verifier: args.verifierJson,
      droppedLog: args.droppedJson,
      counts: args.countsJson,
      summary: args.summary,
      brandFit: args.brandFit,
      model: args.model,
      error: args.error,
      source: args.source,
      degradedCause: args.degradedCause,
      progress: JSON.parse(args.progressJson),
    });
    const submission = await ctx.db.get(run.submissionId);
    if (submission) {
      await ctx.db.patch(submission._id, {
        status: ["draft", "ai_review"].includes(submission.status)
          ? "findings_ready"
          : submission.status,
        brandFit: args.brandFit,
        updatedAt: now,
      });
    }
    await appendAudit(ctx, {
      workspaceId: run.workspaceId,
      actorId,
      actorRole,
      actorName,
      action: args.error ? "review.degraded" : "review.completed",
      entityType: "run",
      entityId: run._id,
      payload: {
        version: run.version,
        findings: findings.length,
        verifier: JSON.parse(args.verifierJson),
        brandFit: args.brandFit,
        model: args.model,
        source: args.source,
        degradedCause: args.degradedCause ?? null,
        error: args.error ?? null,
      },
    });
    return { findings: findings.length };
  },
});

export const probeAccess = internalQuery({
  args: {},
  handler: async (ctx) => {
    const session = await requireRole(ctx, ["admin", "approver"]);
    return { workspaceId: session.workspace._id };
  },
});

export const findCache = internalQuery({
  args: { workspaceId: v.id("workspaces"), contentHash: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("cachedRuns")
      .withIndex("by_hash", (q) =>
        q.eq("workspaceId", args.workspaceId).eq("contentHash", args.contentHash),
      )
      .first();
    if (!row) return null;
    return {
      id: row._id,
      findingsJson: row.findingsJson,
      verifierJson: row.verifierJson,
      countsJson: row.countsJson,
      summary: row.summary,
      brandFit: row.brandFit,
      model: row.model,
      createdAt: row.createdAt,
    };
  },
});

/**
 * Only seeded sample content may be cached. The check is on the submission's
 * sampleId, so user-entered copy can never be replayed from a stored run.
 */
export const cacheRun = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    contentHash: v.string(),
    sampleId: v.string(),
    findingsJson: v.string(),
    verifierJson: v.string(),
    countsJson: v.string(),
    summary: v.string(),
    brandFit: v.number(),
    model: v.string(),
    sourceRunId: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("cachedRuns")
      .withIndex("by_hash", (q) =>
        q.eq("workspaceId", args.workspaceId).eq("contentHash", args.contentHash),
      )
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, { ...args, createdAt: Date.now() });
      return existing._id;
    }
    return await ctx.db.insert("cachedRuns", { ...args, createdAt: Date.now() });
  },
});

export const recordModelState = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    ok: v.boolean(),
    cause: v.optional(v.string()),
    error: v.optional(v.string()),
    model: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await ctx.db
      .query("modelState")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .first();
    if (!existing) {
      await ctx.db.insert("modelState", {
        workspaceId: args.workspaceId,
        consecutiveFailures: args.ok ? 0 : 1,
        openedUntil: undefined,
        lastSuccessAt: args.ok ? now : undefined,
        lastErrorAt: args.ok ? undefined : now,
        lastError: args.error,
        lastCause: args.cause,
        lastModel: args.model,
        updatedAt: now,
      });
      return;
    }
    await ctx.db.patch(existing._id, {
      consecutiveFailures: args.ok ? 0 : existing.consecutiveFailures + 1,
      openedUntil:
        !args.ok && existing.consecutiveFailures + 1 >= 3
          ? now + 90_000
          : args.ok
            ? undefined
            : existing.openedUntil,
      lastSuccessAt: args.ok ? now : existing.lastSuccessAt,
      lastErrorAt: args.ok ? existing.lastErrorAt : now,
      lastError: args.ok ? existing.lastError : (args.error ?? existing.lastError),
      lastCause: args.ok ? existing.lastCause : (args.cause ?? existing.lastCause),
      lastModel: args.model ?? existing.lastModel,
      updatedAt: now,
    });
  },
});

/** A run that has not finished in three minutes is stale, not in progress. */
export const sweepStuckRun = internalMutation({
  args: { submissionId: v.id("submissions") },
  handler: async (ctx, args) => {
    const run = await ctx.db
      .query("runs")
      .withIndex("by_submission", (q) => q.eq("submissionId", args.submissionId))
      .order("desc")
      .first();
    if (!run) return { swept: false, runId: null };
    if (!["queued", "running"].includes(run.status)) return { swept: false, runId: run._id };
    if (Date.now() - run.startedAt < 3 * 60 * 1000) return { swept: false, runId: run._id };
    await ctx.db.patch(run._id, {
      status: "failed",
      finishedAt: Date.now(),
      degradedCause: "timeout",
      error:
        "This run stopped reporting progress for three minutes. It was marked failed so the submission could be retried.",
    });
    const submission = await ctx.db.get(run.submissionId);
    if (submission && submission.status === "ai_review") {
      await ctx.db.patch(submission._id, { status: "findings_ready", updatedAt: Date.now() });
    }
    await appendAudit(ctx, {
      workspaceId: run.workspaceId,
      actorId: "system",
      actorRole: "system",
      actorName: "BrandSentinel watchdog",
      action: "review.stuck_failed",
      entityType: "run",
      entityId: run._id,
      payload: { timeoutMs: 180_000 },
    });
    return { swept: true, runId: run._id };
  },
});

export const failRun = internalMutation({
  args: { runId: v.id("runs"), error: v.string() },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run) return;
    await ctx.db.patch(run._id, {
      status: "failed",
      finishedAt: Date.now(),
      error: args.error.slice(0, 600),
      verifier: JSON.stringify({
        total: 0,
        kept: 0,
        dropped: 0,
        needsHuman: 0,
        droppedSpan: 0,
        droppedRule: 0,
        droppedExcerpt: 0,
        droppedClaim: 0,
        evidenceRate: 0,
      }),
    });
    const submission = await ctx.db.get(run.submissionId);
    if (submission && submission.status === "ai_review") {
      await ctx.db.patch(submission._id, {
        status: "findings_ready",
        updatedAt: Date.now(),
      });
    }
    await appendAudit(ctx, {
      workspaceId: run.workspaceId,
      actorId: "system",
      actorRole: "system",
      actorName: "BrandSentinel",
      action: "review.failed",
      entityType: "run",
      entityId: run._id,
      payload: { error: args.error.slice(0, 300) },
    });
  },
});

export const logCall = internalMutation({
  args: {
    workspaceId: v.optional(v.id("workspaces")),
    submissionId: v.optional(v.id("submissions")),
    runId: v.optional(v.id("runs")),
    purpose: v.string(),
    provider: v.string(),
    model: v.string(),
    promptHash: v.string(),
    latencyMs: v.number(),
    inputTokens: v.optional(v.number()),
    outputTokens: v.optional(v.number()),
    ok: v.boolean(),
    error: v.optional(v.string()),
    redactions: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("llmCalls", { ...args, createdAt: Date.now() });
  },
});
