"use node";

import { z } from "zod";
import { action } from "./_generated/server";
import { completeJSON, modelFor, providerName } from "./ai/gateway";

export const ping = action({
  args: {},
  handler: async () => {
    const schema = z.object({ ok: z.boolean(), note: z.string() });
    const started = Date.now();
    try {
      const result = await completeJSON({
        system: "You return only JSON.",
        user: 'Return {"ok":true,"note":"gateway reachable"}',
        schema,
        purpose: "diag:ping",
        maxTokens: 60,
      });
      return {
        ok: true,
        model: result.model,
        provider: result.provider,
        configured: modelFor("fast"),
        providerName: providerName(),
        latencyMs: Date.now() - started,
        note: result.data.note,
      };
    } catch (error) {
      return {
        ok: false,
        model: modelFor("fast"),
        providerName: providerName(),
        latencyMs: Date.now() - started,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
});
