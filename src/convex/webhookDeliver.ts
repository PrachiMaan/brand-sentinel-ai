"use node";

import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { headerValue } from "./lib/webhooks";

/**
 * One delivery attempt. Kept in its own module so the retry scheduler in
 * webhookInternal.ts can reference it without a circular function type.
 */
export const deliver = internalAction({
  args: { deliveryId: v.id("webhookDeliveries") },
  handler: async (
    ctx,
    args,
  ): Promise<{ status: string; responseCode?: number; error?: string }> => {
    const data = await ctx.runQuery(internal.webhookInternal.delivery, {
      deliveryId: args.deliveryId,
    });
    if (!data) return { status: "skipped" };
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = headerValue(data.secret, timestamp, data.payload);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    let responseCode: number | undefined;
    let error: string | undefined;
    try {
      const response = await fetch(data.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "user-agent": "BrandSentinel-Webhooks/1.0",
          "x-brandsentinel-signature": signature,
          "x-brandsentinel-event": data.eventType,
          "x-brandsentinel-delivery": data.idempotencyKey,
        },
        body: data.payload,
        signal: controller.signal,
        redirect: "error",
      });
      responseCode = response.status;
      if (!response.ok) error = `HTTP ${response.status}`;
    } catch (caught) {
      error =
        caught instanceof Error
          ? caught.name === "AbortError"
            ? "Timed out after 10s"
            : caught.message
          : String(caught);
    } finally {
      clearTimeout(timer);
    }

    await ctx.runMutation(internal.webhookInternal.recordAttempt, {
      deliveryId: args.deliveryId,
      ok: !error,
      responseCode,
      error,
    });
    return { status: error ? "failed" : "delivered", responseCode, error };
  },
});
