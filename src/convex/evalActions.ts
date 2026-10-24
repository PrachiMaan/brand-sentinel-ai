"use node";

import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { action } from "./_generated/server";
import { runPipeline } from "./ai/pipeline";
import { GUIDELINE_DOCUMENT } from "./lib/lumora";
import { hasModelAccess } from "./ai/gateway";

type EvalItem = {
  id: string;
  mode: string;
  text: string;
  channel: string;
  audience: string;
  altText: string;
  hasImage: boolean;
  design?: { textHex?: string; bgHex?: string };
  imagePalette?: { hex: string; share: number }[];
  expectedRules: string[];
  expectedModes: string[];
};

export const runBatch = action({
  args: { itemsJson: v.string(), token: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const required = process.env.EVAL_KEY;
    if (required && args.token !== required) {
      throw new Error("Eval key missing or incorrect.");
    }
    if (!hasModelAccess()) {
      throw new Error("No model credentials on the deployment.");
    }
    const items = JSON.parse(args.itemsJson) as EvalItem[];
    if (!Array.isArray(items) || items.length > 12) {
      throw new Error("Send between 1 and 12 items per batch.");
    }
    const workspaceId = (await ctx.runMutation(internal.evalInternal.seed, {})) as Id<"workspaces">;
    const brand = await ctx.runQuery(internal.evalInternal.brand, { workspaceId });

    const results: unknown[] = [];
    const chunkSize = 4;
    for (let i = 0; i < items.length; i += chunkSize) {
      const chunk = items.slice(i, i + chunkSize);
      const settled = await Promise.all(
        chunk.map(async (item) => {
          try {
            const result = await runPipeline(
              {
                text: item.text,
                channel: item.channel,
                audience: item.audience,
                altText: item.altText,
                hasImage: item.hasImage,
                design: item.design,
                imagePalette: item.imagePalette,
              },
              brand,
              {
                guidelineText: GUIDELINE_DOCUMENT,
                today: "2026-10-23",
                onLog: async (log) => {
                  await ctx.runMutation(internal.reviewInternal.logCall, {
                    workspaceId,
                    purpose: `eval:${log.purpose}`,
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
              },
            );
            return {
              id: item.id,
              mode: item.mode,
              expectedRules: item.expectedRules,
              expectedModes: item.expectedModes,
              findings: result.findings.map((f) => ({
                ruleId: f.ruleId,
                reviewer: f.reviewer,
                severity: f.severity,
                bucket: f.bucket,
                source: f.source,
                spanText: f.spanText,
                claimStatus: f.claimStatus ?? null,
              })),
              verifier: result.verifier,
              fastMs: result.fastMs,
              totalMs: result.totalMs,
              redactions: result.redactions,
              errors: result.errors,
              droppedLog: result.droppedLog,
            };
          } catch (error) {
            return {
              id: item.id,
              mode: item.mode,
              expectedRules: item.expectedRules,
              expectedModes: item.expectedModes,
              findings: [],
              verifier: {
                total: 0,
                kept: 0,
                dropped: 0,
                needsHuman: 0,
                droppedSpan: 0,
                droppedRule: 0,
                droppedExcerpt: 0,
                droppedClaim: 0,
                evidenceRate: 0,
              },
              fastMs: 0,
              totalMs: 0,
              redactions: 0,
              errors: [error instanceof Error ? error.message : String(error)],
              droppedLog: [],
            };
          }
        }),
      );
      results.push(...settled);
    }
    return { results };
  },
});
