"use node";

import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { api, internal } from "./_generated/api";
import { action } from "./_generated/server";
import { compilerOutputSchema } from "./lib/types";
import { compilerPrompt } from "./lib/prompts";
import { completeJSON } from "./ai/gateway";
import { redactPII } from "./lib/text";

/**
 * Tier 2: turn a guideline document into typed, source-linked rules. The model
 * only proposes. An admin edits and publishes; nothing changes the rulebook on
 * its own.
 */
export const compile = action({
  args: { filename: v.string(), documentText: v.string() },
  handler: async (ctx, args): Promise<{
    jobId: Id<"compileJobs">;
    rules: number;
    claims: number;
    glossary: number;
    model: string;
    latencyMs: number;
  }> => {
    const jobId = await ctx.runMutation(api.compileInternal.startJob, {
      filename: args.filename,
      chars: args.documentText.length,
    });
    const access = await ctx.runQuery(internal.compileInternal.access, {});
    const workspaceId = access.workspaceId as Id<"workspaces">;
    const redaction = redactPII(args.documentText);
    try {
      const result = await completeJSON({
        system:
          "You compile brand guideline documents into machine-readable rules. You only extract what the document states, with verbatim source excerpts. Return only JSON.",
        user: compilerPrompt(redaction.text, "Lumora"),
        schema: compilerOutputSchema,
        purpose: "compile:rules",
        redactions: redaction.count,
        tier: "strong",
        maxTokens: 2600,
        onLog: async (log) => {
          await ctx.runMutation(internal.reviewInternal.logCall, {
            workspaceId,
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
      });
      await ctx.runMutation(internal.compileInternal.saveProposal, {
        jobId,
        proposalJson: JSON.stringify({
          ...result.data,
          model: result.model,
          latencyMs: result.latencyMs,
        }),
      });
      return {
        jobId,
        rules: result.data.rules.length,
        claims: result.data.claims?.length ?? 0,
        glossary: result.data.glossary?.length ?? 0,
        model: result.model,
        latencyMs: result.latencyMs,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await ctx.runMutation(internal.compileInternal.saveProposal, {
        jobId,
        error: message,
      });
      throw new Error(`The compiler could not read this document: ${message}`);
    }
  },
});
