"use node";

import { createVlyIntegrations } from "@vly-ai/integrations";
import type { z } from "zod";
import { sha256Hex } from "../lib/sha256";

/**
 * The only file that talks to a model provider. Swap providers with env vars:
 *   AI_PROVIDER=vly | openai
 *   AI_MODEL_FAST, AI_MODEL_STRONG
 *   AI_BASE_URL / AI_API_KEY (OpenAI-compatible endpoints)
 * Output is always validated with zod by the caller.
 */

export type CallLog = {
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
};

type CompleteArgs<T> = {
  system: string;
  user: string;
  schema: z.ZodType<T>;
  purpose: string;
  redactions?: number;
  tier?: "fast" | "strong";
  onLog?: (log: CallLog) => Promise<void>;
  maxTokens?: number;
};

const vly = createVlyIntegrations({
  deploymentToken: process.env.VLY_INTEGRATION_KEY,
  debug: false,
});

function provider(): "vly" | "openai" {
  const configured = (process.env.AI_PROVIDER ?? "vly").toLowerCase();
  if (configured === "openai") return "openai";
  if (process.env.VLY_INTEGRATION_KEY) return "vly";
  if (process.env.OPENAI_API_KEY) return "openai";
  return "vly";
}

export function modelFor(tier: "fast" | "strong" = "fast"): string {
  const fast =
    process.env.AI_MODEL_FAST ??
    process.env.AI_MODEL ??
    "gpt-4o-mini";
  const strong =
    process.env.AI_MODEL_STRONG ??
    process.env.AI_MODEL ??
    "gpt-4o-mini";
  return tier === "strong" ? strong : fast;
}

export function providerName(): string {
  return provider() === "vly" ? "vly-gateway" : "openai-compatible";
}

export function hasModelAccess(): boolean {
  if (provider() === "openai") return Boolean(process.env.OPENAI_API_KEY);
  return Boolean(process.env.VLY_INTEGRATION_KEY);
}

async function callModel(args: {
  system: string;
  user: string;
  model: string;
  maxTokens: number;
}): Promise<{ text: string; inputTokens?: number; outputTokens?: number }> {
  const p = provider();
  if (p === "vly") {
    if (!process.env.VLY_INTEGRATION_KEY) {
      throw new Error(
        "No model credentials on the deployment. Set VLY_INTEGRATION_KEY or OPENAI_API_KEY.",
      );
    }
    const result = await vly.ai.completion({
      model: args.model,
      messages: [
        { role: "system", content: args.system },
        { role: "user", content: args.user },
      ],
      temperature: 0.1,
      maxTokens: args.maxTokens,
    });
    if (!result.success || !result.data) {
      throw new Error(result.error ?? "The model gateway returned no data.");
    }
    return {
      text: result.data.choices?.[0]?.message?.content ?? "",
      inputTokens: result.data.usage?.promptTokens,
      outputTokens: result.data.usage?.completionTokens,
    };
  }

  const base = (process.env.AI_BASE_URL ?? "https://api.openai.com/v1").replace(
    /\/$/,
    "",
  );
  const key = process.env.OPENAI_API_KEY ?? process.env.AI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY is not set.");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45000);
  try {
    const response = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: args.model,
        temperature: 0.1,
        max_tokens: args.maxTokens,
        messages: [
          { role: "system", content: args.system },
          { role: "user", content: args.user },
        ],
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`Model HTTP ${response.status}: ${detail.slice(0, 240)}`);
    }
    const json = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    return {
      text: json.choices?.[0]?.message?.content ?? "",
      inputTokens: json.usage?.prompt_tokens,
      outputTokens: json.usage?.completion_tokens,
    };
  } finally {
    clearTimeout(timer);
  }
}

function extractJson(raw: string): unknown {
  const trimmed = raw.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "");
  try {
    return JSON.parse(trimmed);
  } catch {
    const first = trimmed.indexOf("{");
    const last = trimmed.lastIndexOf("}");
    if (first >= 0 && last > first) {
      return JSON.parse(trimmed.slice(first, last + 1));
    }
    throw new Error("Response was not JSON.");
  }
}

/** One call, one validation, one repair attempt. Every attempt is logged. */
export async function completeJSON<T>(args: CompleteArgs<T>): Promise<{
  data: T;
  model: string;
  provider: string;
  latencyMs: number;
  attempts: number;
}> {
  const model = modelFor(args.tier);
  const prov = providerName();
  const promptHash = sha256Hex(args.system + "\n" + args.user);
  const started = Date.now();
  let lastError = "";
  let totalMs = 0;

  for (let attempt = 1; attempt <= 2; attempt++) {
    const attemptStarted = Date.now();
    try {
      const result = await callModel({
        system:
          attempt === 1
            ? args.system
            : `${args.system}\n\nYour previous reply was invalid. Return only a JSON object matching the requested schema, with no prose or code fences.`,
        user:
          attempt === 1
            ? args.user
            : `${args.user}\n\nThe previous attempt failed validation (${lastError}). This is a correction attempt.`,
        model,
        maxTokens: args.maxTokens ?? 1200,
      });
      const latencyMs = Date.now() - attemptStarted;
      totalMs += latencyMs;
      const parsed = args.schema.safeParse(extractJson(result.text));
      const ok = parsed.success;
      await args.onLog?.({
        purpose: attempt === 1 ? args.purpose : `${args.purpose}:repair`,
        provider: prov,
        model,
        promptHash,
        latencyMs,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        ok,
        error: ok ? undefined : parsed.error.issues.slice(0, 3).map((i) => i.message).join("; "),
        redactions: args.redactions ?? 0,
      });
      if (ok) {
        return {
          data: parsed.data,
          model,
          provider: prov,
          latencyMs: totalMs,
          attempts: attempt,
        };
      }
      lastError = parsed.error.issues.slice(0, 3).map((i) => i.path.join(".") + ": " + i.message).join("; ");
    } catch (error) {
      const latencyMs = Date.now() - attemptStarted;
      totalMs += latencyMs;
      lastError = error instanceof Error ? error.message : String(error);
      await args.onLog?.({
        purpose: attempt === 1 ? args.purpose : `${args.purpose}:repair`,
        provider: prov,
        model,
        promptHash,
        latencyMs,
        ok: false,
        error: lastError.slice(0, 300),
        redactions: args.redactions ?? 0,
      });
    }
  }

  throw new Error(
    `${args.purpose} failed after 2 attempts (${Math.round(totalMs / 100) / 10}s): ${lastError}`,
  );
}
