"use node";

import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { action, internalAction } from "./_generated/server";
import { runDeterministic, runPipeline } from "./ai/pipeline";
import {
  configuration,
  errorCodeOf,
  hasModelAccess,
  LIMITS,
} from "./ai/gateway";
import { verifyCachedFindings } from "./lib/verifier";
import { REVIEWERS } from "./lib/types";
import type { Finding } from "./lib/types";

type RunSummary = {
  runId: Id<"runs">;
  reused: boolean;
  findings: number;
  degraded: boolean;
  source: "live" | "saved_run" | "deterministic";
  cause?: string;
  suppressed?: number;
  errors?: string[];
  deepMs?: number;
  fastMs?: number;
  savedOn?: string;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
};

/**
 * Deep lane. Five reviewers run in parallel; every finding then passes the
 * verifier. If the model is unavailable the run still completes from the fast
 * lane, and a seeded sample may replay a previously verified live result.
 */
export const runReview = action({
  args: { submissionId: v.id("submissions") },
  handler: async (ctx, args): Promise<RunSummary> => {
    const begin: { runId: Id<"runs">; reused: boolean; version: number } =
      await ctx.runMutation(internal.reviewInternal.beginReview, {
        submissionId: args.submissionId,
      });
    if (begin.reused) {
      return { runId: begin.runId, reused: true, findings: 0, degraded: false, source: "live" };
    }

    const data = await ctx.runQuery(internal.reviewInternal.prepare, {
      runId: begin.runId,
    });
    const workspaceId = data.workspaceId as Id<"workspaces">;
    const verifyInput = {
      runText: data.input.text,
      rules: data.brand.rules,
      claims: data.brand.claims,
      guidelineText: data.guidelineText,
      pageCount: data.pageCount,
    };

    const log = async (entry: {
      purpose: string;
      provider: string;
      model: string;
      promptHash: string;
      latencyMs: number;
      inputTokens?: number;
      outputTokens?: number;
      ok: boolean;
      error?: string;
      redactions: number;
    }) => {
      await ctx.runMutation(internal.reviewInternal.logCall, {
        workspaceId,
        submissionId: args.submissionId,
        runId: begin.runId,
        ...entry,
      });
    };

    const replayCache = async (reason: string): Promise<RunSummary | null> => {
      if (!data.sampleId) return null;
      const cache = await ctx.runQuery(internal.reviewInternal.findCache, {
        workspaceId,
        contentHash: data.version.contentHash,
        rulebookVersion: data.rulebookVersion,
      });
      if (!cache) return null;
      const stored = JSON.parse(cache.findingsJson) as Finding[];
      const rechecked = verifyCachedFindings(stored, verifyInput);
      if (!rechecked.findings.length && stored.length) return null;
      const savedOn = new Date(cache.createdAt).toISOString().slice(0, 10);
      const verifier = {
        total: stored.length,
        kept: rechecked.findings.length,
        dropped: stored.length - rechecked.findings.length,
        needsHuman: rechecked.findings.filter((f) => f.bucket === "needs_human").length,
        droppedSpan: 0,
        droppedRule: 0,
        droppedExcerpt: 0,
        droppedClaim: 0,
        evidenceRate: stored.length
          ? Math.round((rechecked.findings.length / stored.length) * 1000) / 10
          : 100,
        mode: "saved-recheck",
        recheckReasons: rechecked.reasons.slice(0, 10),
      };
      await ctx.runMutation(internal.reviewInternal.saveResults, {
        runId: begin.runId,
        findingsJson: JSON.stringify(rechecked.findings),
        verifierJson: JSON.stringify(verifier),
        droppedJson: JSON.stringify(
          rechecked.reasons.map((r) => ({ reviewer: "visual", ruleId: "", spanText: "", reason: "span_not_found", detail: r })),
        ),
        countsJson: cache.countsJson,
        summary: cache.summary,
        brandFit: cache.brandFit,
        fastMs: 0,
        deepMs: 0,
        model: `Saved from a live run on ${savedOn} · ${cache.model}`,
        source: "saved_run",
        progressJson: JSON.stringify(
          REVIEWERS.map((reviewer) => ({ reviewer, status: "saved" })),
        ),
      });
      return {
        runId: begin.runId,
        reused: false,
        findings: rechecked.findings.length,
        degraded: false,
        source: "saved_run",
        cause: reason,
        savedOn,
        model: cache.model,
        inputTokens: cache.inputTokens,
        outputTokens: cache.outputTokens,
      };
    };

    // No credentials at all: do not spend 25 seconds per reviewer failing.
    if (!hasModelAccess()) {
      const cached = await replayCache("No model credentials are configured on this deployment.");
      if (cached) return cached;
      const fallback = runDeterministic(data.input, data.brand, {
        guidelineText: data.guidelineText,
      });
      await ctx.runMutation(internal.reviewInternal.saveResults, {
        runId: begin.runId,
        findingsJson: JSON.stringify(fallback.findings),
        verifierJson: JSON.stringify({
          total: 0,
          kept: 0,
          dropped: 0,
          needsHuman: 0,
          droppedSpan: 0,
          droppedRule: 0,
          droppedExcerpt: 0,
          droppedClaim: 0,
          evidenceRate: 0,
          mode: "deterministic-only",
        }),
        droppedJson: "[]",
        countsJson: JSON.stringify(fallback.counts),
        summary: fallback.summary,
        brandFit: fallback.brandFit,
        fastMs: fallback.fastMs,
        deepMs: 0,
        model: "none · deterministic only",
        source: "deterministic",
        degradedCause: "unconfigured",
        error:
          "No model credentials are configured on this deployment, so only the fast lane ran.",
        progressJson: JSON.stringify(
          REVIEWERS.map((reviewer) => ({ reviewer, status: "skipped" })),
        ),
      });
      await ctx.runMutation(internal.reviewInternal.recordModelState, {
        workspaceId,
        ok: false,
        cause: "unconfigured",
        error: "No model credentials are configured on this deployment.",
      });
      return {
        runId: begin.runId,
        reused: false,
        findings: fallback.findings.length,
        degraded: true,
        source: "deterministic",
        cause: "No model credentials are configured on this deployment.",
        errors: ["Deep lane skipped: no model credentials."],
      };
    }

    try {
      const result = await runPipeline(data.input, data.brand, {
        guidelineText: data.guidelineText,
        onLog: log,
        onProgress: async (p) => {
          await ctx.runMutation(internal.reviewInternal.updateProgress, {
            runId: begin.runId,
            reviewer: p.reviewer,
            status: p.status,
            ms: p.ms,
          });
        },
      });

      const allFailed = result.errors.length >= REVIEWERS.length;
      if (allFailed) {
        const cached = await replayCache(
          `The live model failed for every reviewer (${result.degradedCause ?? "gateway_down"}).`,
        );
        if (cached) {
          await ctx.runMutation(internal.reviewInternal.recordModelState, {
            workspaceId,
            ok: false,
            cause: result.degradedCause ?? "gateway_down",
            error: result.errors[0] ?? "All reviewers failed.",
            model: result.model,
          });
          return cached;
        }
      }

      const source: RunSummary["source"] = result.errors.length ? "deterministic" : "live";
      const findingsJson = JSON.stringify(result.findings);
      await ctx.runMutation(internal.reviewInternal.saveResults, {
        runId: begin.runId,
        findingsJson,
        verifierJson: JSON.stringify(result.verifier),
        droppedJson: JSON.stringify(result.droppedLog),
        countsJson: JSON.stringify(result.counts),
        summary: result.summary,
        brandFit: result.brandFit,
        fastMs: result.fastMs,
        deepMs: result.deepMs,
        model: `${result.model} · ${result.provider}`,
        source: result.errors.length ? "deterministic" : "live",
        degradedCause: result.degradedCause ?? undefined,
        error: result.errors.length
          ? `${result.errors.length} of ${REVIEWERS.length} reviewers failed (${result.degradedCause ?? "gateway_down"}): ${result.errors
              .map((e) => e.slice(0, 160))
              .join(" · ")}`
          : undefined,
        progressJson: JSON.stringify(result.progress),
      });

      await ctx.scheduler.runAfter(0, internal.webhookInternal.emit, {
        workspaceId,
        submissionId: args.submissionId,
        type: "findings_ready",
      });

      if (!result.errors.length && data.sampleId) {
        await ctx.runMutation(internal.reviewInternal.cacheRun, {
          workspaceId,
          contentHash: data.version.contentHash,
          sampleId: data.sampleId,
          findingsJson,
          verifierJson: JSON.stringify(result.verifier),
          countsJson: JSON.stringify(result.counts),
          summary: result.summary,
          brandFit: result.brandFit,
          model: result.model,
          sourceRunId: begin.runId,
          rulebookVersion: data.rulebookVersion,
        });
      }

      await ctx.runMutation(internal.reviewInternal.recordModelState, {
        workspaceId,
        ok: result.errors.length === 0,
        cause: result.degradedCause ?? undefined,
        error: result.errors[0],
        model: result.model,
      });

      return {
        runId: begin.runId,
        reused: false,
        findings: result.findings.length,
        suppressed: result.verifier.dropped,
        degraded: result.errors.length > 0,
        source,
        cause: result.degradedCause ?? undefined,
        errors: result.errors,
        deepMs: result.deepMs,
        fastMs: result.fastMs,
      };
    } catch (error) {
      const code = errorCodeOf(error);
      const message = error instanceof Error ? error.message : String(error);
      const cached = await replayCache(message);
      if (cached) return cached;
      const fallback = runDeterministic(data.input, data.brand, {
        guidelineText: data.guidelineText,
      });
      await ctx.runMutation(internal.reviewInternal.saveResults, {
        runId: begin.runId,
        findingsJson: JSON.stringify(fallback.findings),
        verifierJson: JSON.stringify({
          total: 0,
          kept: 0,
          dropped: 0,
          needsHuman: 0,
          droppedSpan: 0,
          droppedRule: 0,
          droppedExcerpt: 0,
          droppedClaim: 0,
          evidenceRate: 0,
          mode: "deterministic-only",
        }),
        droppedJson: "[]",
        countsJson: JSON.stringify(fallback.counts),
        summary: fallback.summary,
        brandFit: fallback.brandFit,
        fastMs: fallback.fastMs,
        deepMs: 0,
        model: "none · deterministic only",
        source: "deterministic",
        degradedCause: code,
        error: `${message.slice(0, 400)} Fast-lane findings are complete.`,
        progressJson: JSON.stringify(
          REVIEWERS.map((reviewer) => ({ reviewer, status: "error" })),
        ),
      });
      await ctx.runMutation(internal.reviewInternal.recordModelState, {
        workspaceId,
        ok: false,
        cause: code,
        error: message,
      });
      return {
        runId: begin.runId,
        reused: false,
        findings: fallback.findings.length,
        degraded: true,
        source: "deterministic",
        cause: message,
        errors: [message],
      };
    }
  },
});

/**
 * API path. Same pipeline, same verifier, same audit chain as the web UI; the
 * only difference is that the caller authenticated with an API key.
 */
export const runReviewApi = internalAction({
  args: {
    submissionId: v.id("submissions"),
    apiKeyId: v.id("apiKeys"),
  },
  handler: async (ctx, args): Promise<{ runId: Id<"runs">; findings: number }> => {
    const begin: { runId: Id<"runs">; reused: boolean; version: number } =
      await ctx.runMutation(internal.reviewInternal.beginReview, {
        submissionId: args.submissionId,
        apiKeyId: args.apiKeyId,
      });
    if (begin.reused) {
      return { runId: begin.runId, findings: 0 };
    }
    const data = await ctx.runQuery(internal.reviewInternal.prepare, {
      runId: begin.runId,
      apiKeyId: args.apiKeyId,
    });
    const workspaceId = data.workspaceId as Id<"workspaces">;

    const result = await runPipeline(data.input, data.brand, {
      guidelineText: data.guidelineText,
      onLog: async (entry) => {
        await ctx.runMutation(internal.reviewInternal.logCall, {
          workspaceId,
          submissionId: args.submissionId,
          runId: begin.runId,
          ...entry,
        });
      },
      onProgress: async (p) => {
        await ctx.runMutation(internal.reviewInternal.updateProgress, {
          runId: begin.runId,
          reviewer: p.reviewer,
          status: p.status,
          ms: p.ms,
        });
      },
    });

    await ctx.runMutation(internal.reviewInternal.saveResults, {
      runId: begin.runId,
      findingsJson: JSON.stringify(result.findings),
      verifierJson: JSON.stringify(result.verifier),
      droppedJson: JSON.stringify(result.droppedLog),
      countsJson: JSON.stringify(result.counts),
      summary: result.summary,
      brandFit: result.brandFit,
      fastMs: result.fastMs,
      deepMs: result.deepMs,
      model: `${result.model} · ${result.provider}`,
      source: result.errors.length ? "deterministic" : "live",
      degradedCause: result.degradedCause ?? undefined,
      error: result.errors.length
        ? `${result.errors.length} reviewer(s) failed: ${result.errors.join(" · ")}`
        : undefined,
      progressJson: JSON.stringify(result.progress),
      apiKeyId: args.apiKeyId,
    });

    await ctx.runMutation(internal.reviewInternal.recordModelState, {
      workspaceId,
      ok: result.errors.length === 0,
      cause: result.degradedCause ?? undefined,
      error: result.errors[0],
      model: result.model,
    });

    await ctx.scheduler.runAfter(0, internal.webhookInternal.emit, {
      workspaceId,
      submissionId: args.submissionId,
      type: "findings_ready",
    });

    return { runId: begin.runId, findings: result.findings.length };
  },
});

/** Admin probe: is the gateway answering right now? One small call. */
export const probeModel = action({
  args: {},
  returns: v.object({
    configured: v.boolean(),
    provider: v.string(),
    model: v.string(),
    reachable: v.boolean(),
    latencyMs: v.number(),
    cause: v.optional(v.string()),
    message: v.optional(v.string()),
    limits: v.object({
      timeoutMs: v.number(),
      maxTokensPerCall: v.number(),
      maxCallsPerReview: v.number(),
    }),
  }),
  handler: async (ctx) => {
    const access: { workspaceId: Id<"workspaces"> } = await ctx.runQuery(
      internal.reviewInternal.probeAccess,
      {},
    );
    const config = configuration();
    const started = Date.now();
    if (!config.configured) {
      await ctx.runMutation(internal.reviewInternal.recordModelState, {
        workspaceId: access.workspaceId,
        ok: false,
        cause: "unconfigured",
        error: "No model credentials are configured on this deployment.",
      });
      return {
        configured: false,
        provider: config.provider,
        model: config.model,
        reachable: false,
        latencyMs: 0,
        cause: "unconfigured",
        message: "No model credentials are configured on this deployment.",
        limits: {
          timeoutMs: LIMITS.timeoutMs,
          maxTokensPerCall: LIMITS.maxTokensPerCall,
          maxCallsPerReview: LIMITS.maxCallsPerReview,
        },
      };
    }
    try {
      const { completeJSON } = await import("./ai/gateway");
      const { z } = await import("zod");
      await completeJSON({
        system: "Reply with JSON only: {\"ok\":true}.",
        user: "Connection probe.",
        schema: z.object({ ok: z.boolean() }),
        purpose: "probe",
        bypassBreaker: true,
        maxTokens: 32,
        tier: "fast",
        onLog: async (entry) => {
          await ctx.runMutation(internal.reviewInternal.logCall, {
            workspaceId: access.workspaceId,
            ...entry,
          });
        },
      });
      await ctx.runMutation(internal.reviewInternal.recordModelState, {
        workspaceId: access.workspaceId,
        ok: true,
        model: config.model,
      });
      return {
        configured: true,
        provider: config.provider,
        model: config.model,
        reachable: true,
        latencyMs: Date.now() - started,
        limits: {
          timeoutMs: LIMITS.timeoutMs,
          maxTokensPerCall: LIMITS.maxTokensPerCall,
          maxCallsPerReview: LIMITS.maxCallsPerReview,
        },
      };
    } catch (error) {
      const code = errorCodeOf(error);
      const message = error instanceof Error ? error.message : String(error);
      await ctx.runMutation(internal.reviewInternal.recordModelState, {
        workspaceId: access.workspaceId,
        ok: false,
        cause: code,
        error: message,
        model: config.model,
      });
      return {
        configured: true,
        provider: config.provider,
        model: config.model,
        reachable: false,
        latencyMs: Date.now() - started,
        cause: code,
        message: message.slice(0, 300),
        limits: {
          timeoutMs: LIMITS.timeoutMs,
          maxTokensPerCall: LIMITS.maxTokensPerCall,
          maxCallsPerReview: LIMITS.maxCallsPerReview,
        },
      };
    }
  },
});

type SeedOutcome = {
  sampleId: string;
  contentHash: string;
  outcome: "saved" | "already_saved" | "failed" | "skipped";
  findings?: number;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  cause?: string;
};

/**
 * Run the seeded Lumora samples through the model once each and store the
 * result as a saved run (content hash + rulebook version). This is the only
 * place that spends model budget outside an ordinary review, it is limited to
 * submissions that carry a sampleId, and it is admin/approver gated. Replays
 * of these rows always pass through the verifier again.
 */
export const seedSavedRuns = action({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args): Promise<{ results: SeedOutcome[]; stoppedAt?: string }> => {
    const access: { workspaceId: Id<"workspaces"> } = await ctx.runQuery(
      internal.reviewInternal.probeAccess,
      {},
    );
    if (!hasModelAccess()) {
      return {
        results: [],
        stoppedAt: "No model credentials are configured on this deployment.",
      };
    }
    const data = await ctx.runQuery(internal.reviewInternal.sampleReviewData, {
      workspaceId: access.workspaceId,
    });
    const limit = Math.max(1, Math.min(args.limit ?? data.samples.length, 12));
    const results: SeedOutcome[] = [];
    let stoppedAt: string | undefined;

    for (const sample of data.samples.slice(0, limit)) {
      const existing = await ctx.runQuery(internal.reviewInternal.findCache, {
        workspaceId: access.workspaceId,
        contentHash: sample.contentHash,
        rulebookVersion: data.rulebookVersion,
      });
      if (existing) {
        results.push({
          sampleId: sample.sampleId,
          contentHash: sample.contentHash,
          outcome: "already_saved",
        });
        continue;
      }
      let inputTokens = 0;
      let outputTokens = 0;
      try {
        const result = await runPipeline(sample.input, data.brand, {
          guidelineText: data.guidelineText,
          onLog: async (entry) => {
            inputTokens += entry.inputTokens ?? 0;
            outputTokens += entry.outputTokens ?? 0;
            await ctx.runMutation(internal.reviewInternal.logCall, {
              workspaceId: access.workspaceId,
              submissionId: sample.submissionId,
              ...entry,
            });
          },
        });
        if (result.errors.length >= REVIEWERS.length) {
          const cause = result.errors[0] ?? "The model failed for every reviewer.";
          results.push({
            sampleId: sample.sampleId,
            contentHash: sample.contentHash,
            outcome: "failed",
            cause,
          });
          if (result.degradedCause === "budget_exhausted") {
            stoppedAt = cause;
            break;
          }
          continue;
        }
        await ctx.runMutation(internal.reviewInternal.cacheRun, {
          workspaceId: access.workspaceId,
          contentHash: sample.contentHash,
          sampleId: sample.sampleId,
          findingsJson: JSON.stringify(result.findings),
          verifierJson: JSON.stringify(result.verifier),
          countsJson: JSON.stringify(result.counts),
          summary: result.summary,
          brandFit: result.brandFit,
          model: `${result.model} · ${result.provider}`,
          sourceRunId: "",
          rulebookVersion: data.rulebookVersion,
          inputTokens,
          outputTokens,
        });
        results.push({
          sampleId: sample.sampleId,
          contentHash: sample.contentHash,
          outcome: "saved",
          findings: result.findings.length,
          model: `${result.model} · ${result.provider}`,
          inputTokens,
          outputTokens,
        });
      } catch (error) {
        const code = errorCodeOf(error);
        const message = error instanceof Error ? error.message : String(error);
        results.push({
          sampleId: sample.sampleId,
          contentHash: sample.contentHash,
          outcome: "failed",
          cause: message.slice(0, 300),
        });
        if (code === "budget_exhausted") {
          stoppedAt = message.slice(0, 300);
          break;
        }
      }
    }
    return stoppedAt ? { results, stoppedAt } : { results };
  },
});
