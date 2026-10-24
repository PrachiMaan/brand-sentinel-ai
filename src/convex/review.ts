"use node";

import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { action } from "./_generated/server";
import { runPipeline } from "./ai/pipeline";
import { hasModelAccess } from "./ai/gateway";

/**
 * Deep lane. Runs the five reviewers in parallel, verifies evidence, synthesises
 * and persists. The client polls the submission while this runs.
 */
export const runReview = action({
  args: { submissionId: v.id("submissions") },
  handler: async (ctx, args): Promise<{
    runId: Id<"runs">;
    reused: boolean;
    findings: number;
    degraded: boolean;
    suppressed?: number;
    errors?: string[];
    deepMs?: number;
    fastMs?: number;
  }> => {
    const begin: { runId: Id<"runs">; reused: boolean; version: number } =
      await ctx.runMutation(internal.reviewInternal.beginReview, {
        submissionId: args.submissionId,
      });
    if (begin.reused) {
      return { runId: begin.runId, reused: true, findings: 0, degraded: false };
    }
    if (!hasModelAccess()) {
      await ctx.runMutation(internal.reviewInternal.failRun, {
        runId: begin.runId,
        error:
          "No model credentials are configured. Fast-lane results are still available.",
      });
      return {
        runId: begin.runId,
        reused: false,
        findings: 0,
        degraded: true,
        errors: ["No model credentials configured."],
      };
    }

    try {
      const data = await ctx.runQuery(internal.reviewInternal.prepare, {
        runId: begin.runId,
      });
      const workspaceId = data.workspaceId as Id<"workspaces">;
      const result = await runPipeline(data.input, data.brand, {
        guidelineText: data.guidelineText,
        onLog: async (log) => {
          await ctx.runMutation(internal.reviewInternal.logCall, {
            workspaceId,
            submissionId: args.submissionId,
            runId: begin.runId,
            purpose: log.purpose,
            provider: log.provider,
            model: log.model,
            promptHash: log.promptHash,
            latencyMs: log.latencyMs,
            inputTokens: log.inputTokens,
            outputTokens: log.outputTokens,
            ok: log.ok,
            error: log.error,
            redactions: log.redactions,
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
        error: result.errors.length
          ? `${result.errors.length} reviewer(s) failed: ${result.errors.join(" · ")}`
          : undefined,
        progressJson: JSON.stringify(result.progress),
      });

      return {
        runId: begin.runId,
        reused: false,
        findings: result.findings.length,
        suppressed: result.verifier.dropped,
        degraded: result.errors.length > 0,
        errors: result.errors,
        deepMs: result.deepMs,
        fastMs: result.fastMs,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await ctx.runMutation(internal.reviewInternal.failRun, {
        runId: begin.runId,
        error: message,
      });
      throw new Error(
        `The AI review could not finish: ${message}. Fast-lane results are still on the submission, so nothing is blank.`,
      );
    }
  },
});
