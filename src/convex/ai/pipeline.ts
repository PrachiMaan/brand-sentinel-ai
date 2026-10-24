"use node";

import { runFastLane, paletteFindings } from "../lib/fastlane";
import { synthesize } from "../lib/synth";
import { verifyFindings, verifyDeterministic } from "../lib/verifier";
import type { DroppedFinding, VerifierStats } from "../lib/verifier";
import { redactPII } from "../lib/text";
import { REVIEWERS, REVIEWER_META, reviewerOutputSchema } from "../lib/types";
import type { Finding, ModelFinding, ReviewerId } from "../lib/types";
import type { SeedClaim, SeedRule } from "../lib/lumora";
import { GUIDELINE_DOCUMENT } from "../lib/lumora";
import { systemPrompt, userPrompt } from "../lib/prompts";
import type { ReviewContext } from "../lib/prompts";
import { completeJSON, modelFor, providerName } from "./gateway";
import type { CallLog } from "./gateway";

export type PipelineRule = SeedRule;
export type PipelineClaim = SeedClaim & { expiresAt?: string | null };

export type PipelineBrand = {
  name: string;
  rules: SeedRule[];
  claims: PipelineClaim[];
  glossary: { term: string; status: string; replacement?: string; note?: string }[];
  palette: { name: string; hex: string; use?: string }[];
  voice: {
    descriptors: string[];
    sounds: string[];
    avoids: string[];
    sample: string;
  };
};

export type PipelineInput = {
  text: string;
  channel: string;
  audience: string;
  altText: string;
  hasImage: boolean;
  design?: { textHex?: string; bgHex?: string };
  imagePalette?: { hex: string; share: number }[];
};

export type PipelineResult = {
  findings: Finding[];
  verifier: VerifierStats;
  droppedLog: DroppedFinding[];
  duplicatesRemoved: number;
  brandFit: number;
  counts: Record<string, number>;
  summary: string;
  fastMs: number;
  deepMs: number;
  totalMs: number;
  model: string;
  provider: string;
  errors: string[];
  redactions: number;
  progress: { reviewer: string; status: string; ms?: number }[];
};

export async function runPipeline(
  input: PipelineInput,
  brand: PipelineBrand,
  options: {
    onLog?: (log: CallLog) => Promise<void>;
    onProgress?: (p: { reviewer: string; status: string; ms?: number }) => Promise<void>;
    guidelineText?: string;
    today?: string;
  } = {},
): Promise<PipelineResult> {
  const totalStart = Date.now();
  const clock = () =>
    typeof performance !== "undefined" ? performance.now() : Date.now();
  const guidelineText = options.guidelineText ?? GUIDELINE_DOCUMENT;

  const fastStart = clock();
  const fast = runFastLane({
    text: input.text,
    channel: input.channel,
    altText: input.altText,
    hasImage: input.hasImage,
    design: input.design,
    rules: brand.rules,
    claims: brand.claims,
    glossary: brand.glossary,
    today: options.today,
  });
  const palette = input.hasImage
    ? paletteFindings({
        dominant: input.imagePalette ?? [],
        palette: brand.palette,
        rules: brand.rules,
        text: input.text,
      })
    : [];
  const deterministic = [...fast.findings, ...palette].filter((f) =>
    verifyDeterministic(f, {
      runText: input.text,
      rules: brand.rules,
      claims: brand.claims,
      guidelineText,
    }),
  );
  const fastMs = clock() - fastStart;

  const redaction = redactPII(input.text);
  const redactedAlt = redactPII(input.altText);
  const imageNote = input.hasImage
    ? input.imagePalette?.length
      ? `dominant colours ${input.imagePalette
          .map((c) => `${c.hex} (${Math.round(c.share * 100)}%)`)
          .join(", ")}; approved palette ${brand.palette.map((p) => p.hex).join(", ")}`
      : "image attached, no colour analysis available"
    : "no image attached";

  const context: ReviewContext = {
    brandName: brand.name,
    channel: input.channel,
    audience: input.audience,
    text: redaction.text,
    altText: redactedAlt.text,
    hasImage: input.hasImage,
    imageNote,
    design: input.design,
    rules: brand.rules,
    claims: brand.claims,
    voice: brand.voice,
  };

  const progress: { reviewer: string; status: string; ms?: number }[] = [];
  const errors: string[] = [];
  const modelFindings: (ModelFinding & { reviewer: ReviewerId })[] = [];
  const deepStart = Date.now();

  const tasks = REVIEWERS.map(async (reviewer) => {
    const started = Date.now();
    progress.push({ reviewer, status: "running" });
    await options.onProgress?.({ reviewer, status: "running" });
    try {
      const result = await completeJSON({
        system: systemPrompt(reviewer),
        user: userPrompt(reviewer, context),
        schema: reviewerOutputSchema,
        purpose: `review:${reviewer}`,
        redactions: redaction.count,
        tier: "fast",
        onLog: options.onLog,
        maxTokens: 1100,
      });
      const findings = result.data.findings.map((f) => ({
        ...f,
        span_text: redaction.restore(f.span_text),
        why_it_matters: redaction.restore(f.why_it_matters),
        suggested_fix: redaction.restore(f.suggested_fix ?? ""),
        reviewer,
      }));
      modelFindings.push(...findings);
      progress.push({
        reviewer,
        status: "done",
        ms: Date.now() - started,
      });
      await options.onProgress?.({
        reviewer,
        status: "done",
        ms: Date.now() - started,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`${REVIEWER_META[reviewer].label}: ${message}`);
      progress.push({
        reviewer,
        status: "error",
        ms: Date.now() - started,
      });
      await options.onProgress?.({
        reviewer,
        status: "error",
        ms: Date.now() - started,
      });
    }
  });

  await Promise.all(tasks);
  const deepMs = Date.now() - deepStart;

  const verified = verifyFindings({
    raw: modelFindings,
    input: {
      runText: input.text,
      rules: brand.rules,
      claims: brand.claims,
      guidelineText,
    },
  });

  const synthesis = synthesize([...deterministic, ...verified.findings]);
  const totalMs = Date.now() - totalStart;

  return {
    findings: synthesis.findings,
    verifier: verified.stats,
    droppedLog: verified.droppedLog,
    duplicatesRemoved: synthesis.duplicateCount,
    brandFit: synthesis.brandFit,
    counts: synthesis.counts,
    summary: synthesis.summary,
    fastMs,
    deepMs,
    totalMs,
    model: modelFor("fast"),
    provider: providerName(),
    errors,
    redactions: redaction.count,
    progress,
  };
}
