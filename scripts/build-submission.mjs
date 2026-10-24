import { readFileSync } from "node:fs";
import { mkdirSync } from "node:fs";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const results = JSON.parse(readFileSync("eval/results.json", "utf8"));
const mode = (name) => results.byFailureMode.find((row) => row.mode === name);
const pct = (value) => `${Math.round(value * 100)}%`;

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const M = 48;
const CW = PAGE_W - M * 2;

const INK = rgb(0.122, 0.114, 0.102);
const MUTED = rgb(0.42, 0.4, 0.37);
const RULE = rgb(0.84, 0.81, 0.76);
const PAPER = rgb(0.984, 0.973, 0.949);
const SAGE = rgb(0.31, 0.36, 0.28);
const CLAY = rgb(0.63, 0.33, 0.19);
const HEAD = rgb(0.937, 0.914, 0.867);

const pdf = await PDFDocument.create();
const fonts = {
  body: await pdf.embedFont(StandardFonts.TimesRoman),
  bodyBold: await pdf.embedFont(StandardFonts.TimesRomanBold),
  sans: await pdf.embedFont(StandardFonts.Helvetica),
  sansBold: await pdf.embedFont(StandardFonts.HelveticaBold),
  mono: await pdf.embedFont(StandardFonts.Courier),
};

let page;
let y;
let pageNumber = 0;

function newPage() {
  page = pdf.addPage([PAGE_W, PAGE_H]);
  pageNumber += 1;
  page.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: PAGE_H, color: PAPER });
  y = PAGE_H - M;
  if (pageNumber > 1) {
    page.drawText("BrandSentinel  /  Round 2", {
      x: M,
      y: PAGE_H - 28,
      size: 7.5,
      font: fonts.mono,
      color: MUTED,
    });
    page.drawText(String(pageNumber).padStart(2, "0"), {
      x: PAGE_W - M - 10,
      y: PAGE_H - 28,
      size: 7.5,
      font: fonts.mono,
      color: MUTED,
    });
    page.drawLine({
      start: { x: M, y: PAGE_H - 36 },
      end: { x: PAGE_W - M, y: PAGE_H - 36 },
      thickness: 0.4,
      color: RULE,
    });
    y = PAGE_H - 52;
  }
}

function ensure(h) {
  if (y - h < M + 18) newPage();
}

function wrap(text, font, size, width) {
  const words = String(text).replace(/\s+/g, " ").trim().split(" ");
  const lines = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) <= width) line = next;
    else {
      if (line) lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function para(text, opts = {}) {
  const size = opts.size ?? 9.2;
  const font = opts.font ?? fonts.body;
  const lh = opts.lineHeight ?? size * 1.48;
  const indent = opts.indent ?? 0;
  const width = opts.width ?? CW - indent;
  const lines = wrap(text, font, size, width);
  for (const line of lines) {
    ensure(lh);
    page.drawText(line, {
      x: M + indent,
      y: y - size,
      size,
      font,
      color: opts.color ?? INK,
    });
    y -= lh;
  }
  y -= opts.after ?? 4;
}

function eyebrow(text) {
  ensure(16);
  page.drawText(text.toUpperCase(), {
    x: M,
    y: y - 7,
    size: 6.6,
    font: fonts.mono,
    color: MUTED,
  });
  y -= 14;
}

function h1(text) {
  ensure(30);
  page.drawText(text, {
    x: M,
    y: y - 20,
    size: 20,
    font: fonts.bodyBold,
    color: INK,
  });
  y -= 28;
  page.drawLine({
    start: { x: M, y },
    end: { x: PAGE_W - M, y },
    thickness: 1,
    color: INK,
  });
  y -= 12;
}

function h2(text, number) {
  ensure(28);
  y -= 6;
  if (number) {
    page.drawText(String(number).padStart(2, "0"), {
      x: M,
      y: y - 9,
      size: 7.2,
      font: fonts.mono,
      color: CLAY,
    });
    page.drawText(text, {
      x: M + 20,
      y: y - 10,
      size: 12.5,
      font: fonts.sansBold,
      color: INK,
    });
  } else {
    page.drawText(text, {
      x: M,
      y: y - 10,
      size: 12.5,
      font: fonts.sansBold,
      color: INK,
    });
  }
  y -= 18;
  page.drawLine({
    start: { x: M, y },
    end: { x: PAGE_W - M, y },
    thickness: 0.5,
    color: RULE,
  });
  y -= 9;
}

function bullet(text, opts = {}) {
  const size = opts.size ?? 9;
  const indent = opts.indent ?? 0;
  const bulletX = M + indent;
  const width = CW - indent - 12;
  const lines = wrap(text, fonts.body, size, width);
  ensure(lines.length * size * 1.42);
  page.drawText("—", {
    x: bulletX,
    y: y - size,
    size: size - 1,
    font: fonts.body,
    color: CLAY,
  });
  lines.forEach((line) => {
    page.drawText(line, {
      x: bulletX + 11,
      y: y - size,
      size,
      font: fonts.body,
      color: INK,
    });
    y -= size * 1.42;
  });
  y -= 2;
}

function table(headers, rows, widths, opts = {}) {
  const size = opts.size ?? 7.6;
  const pad = 4;
  const drawHeader = () => {
    ensure(20);
    page.drawRectangle({
      x: M,
      y: y - 16,
      width: CW,
      height: 16,
      color: HEAD,
    });
    let x = M;
    headers.forEach((header, index) => {
      page.drawText(String(header), {
        x: x + pad,
        y: y - 11,
        size: 6.6,
        font: fonts.sansBold,
        color: MUTED,
      });
      x += widths[index];
    });
    y -= 16;
  };
  drawHeader();
  for (const row of rows) {
    const cells = row.map((cell, index) =>
      wrap(String(cell), fonts.body, size, widths[index] - pad * 2),
    );
    const height = Math.max(...cells.map((lines) => lines.length)) * size * 1.32 + pad * 2 + 2;
    if (y - height < M + 14) {
      newPage();
      drawHeader();
    }
    let x = M;
    cells.forEach((lines, index) => {
      lines.forEach((line, lineIndex) => {
        page.drawText(line, {
          x: x + pad,
          y: y - pad - size - lineIndex * size * 1.32,
          size,
          font: index === 0 && opts.strongFirst ? fonts.bodyBold : fonts.body,
          color: INK,
        });
      });
      x += widths[index];
    });
    y -= height;
    page.drawLine({
      start: { x: M, y },
      end: { x: PAGE_W - M, y },
      thickness: 0.35,
      color: RULE,
    });
  }
  y -= 8;
}

function callout(label, text) {
  const lines = wrap(text, fonts.body, 8.6, CW - 22);
  const h = lines.length * 12.4 + 20;
  ensure(h);
  page.drawRectangle({
    x: M,
    y: y - h,
    width: CW,
    height: h,
    color: HEAD,
    borderColor: RULE,
    borderWidth: 0.5,
  });
  page.drawText(label.toUpperCase(), {
    x: M + 11,
    y: y - 12,
    size: 6.2,
    font: fonts.mono,
    color: CLAY,
  });
  lines.forEach((line, index) => {
    page.drawText(line, {
      x: M + 11,
      y: y - 24 - index * 12.4,
      size: 8.6,
      font: fonts.body,
      color: INK,
    });
  });
  y -= h + 9;
}

function box(x, top, w, h, title, sub, fill = HEAD) {
  page.drawRectangle({
    x,
    y: top - h,
    width: w,
    height: h,
    color: fill,
    borderColor: RULE,
    borderWidth: 0.6,
  });
  page.drawText(title, {
    x: x + 5,
    y: top - 12,
    size: 6.9,
    font: fonts.sansBold,
    color: INK,
  });
  const lines = wrap(sub, fonts.body, 6.4, w - 10);
  lines.slice(0, 2).forEach((line, index) => {
    page.drawText(line, {
      x: x + 5,
      y: top - 22 - index * 7.6,
      size: 6.4,
      font: fonts.body,
      color: MUTED,
    });
  });
}

function arrow(x1, y1, x2, y2) {
  page.drawLine({
    start: { x: x1, y: y1 },
    end: { x: x2, y: y2 },
    thickness: 0.6,
    color: SAGE,
  });
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const size = 3.4;
  page.drawLine({
    start: { x: x2, y: y2 },
    end: {
      x: x2 - size * Math.cos(angle - 0.5),
      y: y2 - size * Math.sin(angle - 0.5),
    },
    thickness: 0.6,
    color: SAGE,
  });
  page.drawLine({
    start: { x: x2, y: y2 },
    end: {
      x: x2 - size * Math.cos(angle + 0.5),
      y: y2 - size * Math.sin(angle + 0.5),
    },
    thickness: 0.6,
    color: SAGE,
  });
}

function architecture() {
  ensure(212);
  const startY = y;
  const bw = 90;
  const bh = 38;
  const gap = 9;

  const row1 = [
    ["Submit", "text, image, channel"],
    ["Fast lane", "rules, <1 ms"],
    ["Deep lane", "5 reviewers, parallel"],
    ["Verifier", "evidence or silence"],
    ["Synthesizer", "dedupe, rank, diff"],
  ];
  row1.forEach(([title, sub], index) => {
    const x = M + index * (bw + gap);
    box(x, startY, bw, bh, title, sub);
    if (index < row1.length - 1) arrow(x + bw + 2, startY - bh / 2, x + bw + gap - 3, startY - bh / 2);
  });

  const row2 = [
    ["Rulebook", "14 rules + ledger"],
    ["Review workspace", "accept / edit / reject"],
    ["Approver", "approve / legal / reject"],
    ["Receipt + audit", "hash chain"],
  ];
  const row2Y = startY - bh - 28;
  row2.forEach(([title, sub], index) => {
    const x = M + index * (bw + gap) + 18;
    box(x, row2Y, bw, bh, title, sub, rgb(0.955, 0.945, 0.925));
    if (index < row2.length - 1) arrow(x + bw + 2, row2Y - bh / 2, x + bw + gap - 3, row2Y - bh / 2);
  });

  arrow(M + 2 * (bw + gap) + bw / 2, startY - bh - 2, M + 2 * (bw + gap) + bw / 2, row2Y + 2);
  page.drawText("published rules", {
    x: M + 2 * (bw + gap) + bw / 2 + 5,
    y: (startY - bh + row2Y) / 2,
    size: 5.8,
    font: fonts.mono,
    color: MUTED,
  });
  y = row2Y - bh - 10;
  page.drawText(
    "Solid arrows are the review path. The rulebook and claim ledger feed both lanes. The receipt and every decision write to the same audit chain.",
    { x: M, y: y - 6, size: 6.6, font: fonts.body, color: MUTED, maxWidth: CW },
  );
  y -= 18;
}

// ---------------------------------------------------------------- page 1

newPage();

page.drawText("BRANDSENTINEL", {
  x: M,
  y: y - 36,
  size: 34,
  font: fonts.sansBold,
  color: INK,
});
y -= 48;
page.drawText("The brand gate you can audit.", {
  x: M,
  y: y - 14,
  size: 15,
  font: fonts.body,
  color: SAGE,
});
y -= 30;
page.drawText("ROUND 2 PROTOTYPE  /  OCTOBER 2026  /  TEAM: MAANPACH123", {
  x: M,
  y: y - 8,
  size: 6.8,
  font: fonts.mono,
  color: MUTED,
});
y -= 20;
page.drawLine({ start: { x: M, y }, end: { x: PAGE_W - M, y }, thickness: 1.2, color: INK });
y -= 16;

h2("Project snapshot", "01");

para(
  "BrandSentinel reviews content before publication against a company's brand guidelines, and then hands the decision to a person. A deterministic fast lane checks banned terms, product naming, claim language, tone, contrast and alt text immediately. Five specialist reviewers return findings in one schema. An evidence-or-silence verifier drops anything whose span, rule, guideline excerpt or claim id cannot be checked. A reviewer accepts, edits or rejects each finding with a reason; an approver signs off, rejects, or escalates claims to Legal. Every action lands in a hash-chained audit trail, and an approval produces a downloadable Review Receipt.",
);
para(
  "The demo brand is Lumora, a synthetic skincare studio: 14 typed rules, a six-claim ledger with one expiring and two expired entries, a banned-word glossary, a palette and a guideline PDF. The prototype is built and served in the Freebuff web workspace on Vite, React and Convex.",
);

table(
  ["Item", "Where"],
  [
    ["Live app", "Freebuff preview for this workspace. The app opens at the landing page; use Try the demo. No Vercel deployment."],
    ["Repository", "Workspace version control. No public GitHub remote was reachable from the build environment; see Known limitations."],
    ["Demo access", "Open /demo, choose Creator, Reviewer, Approver or Admin. One click, anonymous auth, no email."],
    ["Role switch", "Header switcher on every app page. Every switch is written to the audit trail."],
    ["Sample content", "Submit page, Load Lumora sample. Fills caption, channel, audience, alt text, palette image and hex pair."],
  ],
  [70, CW - 70],
  { strongFirst: true },
);

callout(
  "One line",
  "The gate does not replace the reviewer. It gives the reviewer evidence, and it gives the organisation a record of who decided what.",
);

// ---------------------------------------------------------------- page 2

newPage();
h2("Completed features", "02");
para(
  "Status is measured against the Round 1 feature list. Done means it exists in the product and was exercised in this build. Partial means it exists but has a known gap, or could not be exercised end to end in the final window.",
  { size: 8.8 },
);

table(
  ["Round 1 feature", "Status", "How it works now"],
  [
    ["Auth, four roles, demo entry", "Done", "Anonymous demo session, membership row per role, role switcher, audited switches."],
    ["Seeded brand pack", "Done", "Lumora rulebook, glossary, six-claim ledger, palette, voice, guideline PDF and assets."],
    ["Submit text or image", "Done", "Text, channel, audience, alt text, optional image and design hex pair. No multi-page documents."],
    ["Fast lane under one second", "Done", "Rules in plain TypeScript; median 0.27 ms over 60 seeded items."],
    ["Five specialist reviewers", "Partial", "Built in parallel with shared schema and zod validation. Final run used the deterministic fallback because the model gateway quota was exhausted."],
    ["Evidence-or-silence verifier", "Done", "Verbatim span, rule id, guideline excerpt, claim id and confidence floor; dropped reasons stored."],
    ["Synthesizer and tracked diff", "Done", "Dedupe, severity rank, brand-fit score, intent score, diff; nothing auto-applied."],
    ["Review workspace", "Done", "Side-by-side highlights, findings list, accept/edit/reject with reasons, comments, version history."],
    ["Status machine", "Done", "Draft to receipt exported, needs revision creates a version, Legal escalation on claims."],
    ["Hash-chained audit log", "Done", "Append-only rows with prev_hash and SHA-256 hash; Verify chain recomputes and reports the first break."],
    ["Review Receipt PDF", "Done", "Version hash, findings, decisions, models, disclosure; receipt hash recorded in the audit chain."],
    ["Brand Pack Compiler", "Partial", "PDF/DOCX/CSV extraction and typed-rule proposal with source excerpts, admin edit and publish. Not exercised while the model quota was exhausted."],
    ["Rule override logging", "Done", "Every decision writes a ruleOverrides row; Rule Health shows counts and override rate per rule."],
    ["Prompt-injection guard", "Done", "Content is delimited and passed as data; both probes in the eval still produced their expected findings."],
    ["PII redaction", "Done", "Email and phone regex before model calls; redaction count logged per call."],
    ["Multi-page document review", "Moved to R3", "Not built. Intake accepts text and one image."],
    ["Visual overlays and page geometry", "Moved to R3", "Not built. Image path is colour distance and alt text only."],
  ],
  [122, 52, CW - 174],
);

// ---------------------------------------------------------------- page 3

newPage();
h2("Technology and implementation", "03");
para(
  "The stack changed from the Round 1 plan for environment reasons, not preference. The table describes what is actually running.",
  { size: 8.8 },
);

table(
  ["Layer", "Choice", "Why, and what changed"],
  [
    ["Frontend", "Vite, React 19, React Router, TypeScript, Tailwind, shadcn/ui, Framer Motion", "The Freebuff workspace does not run Next.js; routing is React Router, no SSR."],
    ["Backend", "Convex queries, mutations, node actions, file storage, auth", "One deployment, no separate API service. Replaces Supabase and route handlers."],
    ["Database", "Convex, Postgres-backed, workspace-scoped functions", "Every function resolves membership and filters on workspaceId. No client DB access."],
    ["Model gateway", "One provider-agnostic file, OpenAI-compatible, zod-validated JSON, 2 attempts", "Provider and model are env-configured; every call logged with prompt hash, tokens, latency."],
    ["Deterministic engines", "fastlane.ts, color.ts, text.ts", "Regex, glossary, Claim Ledger match, WCAG contrast, CIELAB distance, alt text."],
    ["Verification", "verifier.ts", "Evidence checks plus confidence floor; dropped counts, reasons and Needs human bucket."],
    ["Audit", "sha256.ts + audit.ts", "Append-only, prev_hash + hash, recomputed in a query."],
    ["Documents", "pdf-lib, mammoth, pdfjs-dist", "Receipt PDF; text extraction for the compiler."],
  ],
  [78, 170, CW - 248],
  { strongFirst: true },
);

h2("Architecture of what is built");
architecture();

h2("Data model");
para(
  "Convex tables: workspaces, memberships, brandPacks, rules, glossary, claims, submissions, versions, runs, findings, decisions, comments, auditEvents, llmCalls, ruleOverrides, compileJobs. The important relationships: a submission has many versions; a version has many runs; a run has many findings; a finding has at most one decision; every state change has an audit event.",
  { size: 8.8 },
);

// ---------------------------------------------------------------- page 4

h2("The two-lane pipeline");
para(
  "Fast lane. Synchronous TypeScript, no network: prohibited and deprecated glossary terms with inflections, full product naming, sentence case, email subject length, Claim Ledger matching (expired entries with number agreement, unsupported percentages and timeframes, medical language), tone urgency and jargon, WCAG 2.1 contrast from a hex pair or design swatch, palette distance in CIELAB, and missing alt text. It emits the same Finding schema as the model, with source set to deterministic.",
);
para(
  "Deep lane. One Convex action runs five reviewers with Promise.all: Tone and Voice, Terminology and Messaging, Claims, Visual, Accessibility. Each receives the delimited content, channel, audience, image note, the small Claim Ledger and the published rules. Output is validated with zod; a failed parse gets one repair attempt, then that reviewer is marked as an error while the rest of the report continues. Every attempt is logged to llmCalls.",
);

table(
  ["Finding field", "Meaning"],
  [
    ["id, reviewer, severity, confidence", "Identity and triage. Severity is critical, high, medium or low."],
    ["span_text, span_start, span_end", "The exact excerpt the finding is about. The verifier requires it to occur verbatim."],
    ["rule_id, guideline_excerpt", "The rule and the line in the guideline document that authorises it."],
    ["why_it_matters, suggested_fix", "Plain-language reason and a proposed replacement. Never auto-applied."],
    ["source, bucket, status", "Model or deterministic; verified or needs_human; pending, accepted, edited, rejected or escalated."],
    ["claim_status, claim_id", "Supported, Unsupported, Expired or Contradicts, plus the ledger id the verifier checks."],
  ],
  [122, CW - 122],
  { strongFirst: true },
);

para("Verifier logic.", { font: fonts.sansBold, size: 8.8, after: 1 });
para(
  "Drop when the span is not found verbatim in the submitted text; when the rule id is not in the published rulebook; when the guideline excerpt is not in the guideline document; when a claim id is not in the ledger; or when confidence is below the floor, in which case the finding is kept but moved to Needs human. Dropped counts, reasons and the surviving evidence rate are stored on the run and shown in the report. Nothing is silently removed.",
);

para("Hash-chain audit.", { font: fonts.sansBold, size: 8.8, after: 1 });
para(
  "Each audit row stores seq, prev_hash and hash. The hash covers the actor, role, action, entity, payload and timestamp plus prev_hash. Verify chain walks the workspace's rows in sequence, recomputes every hash and checks the link. A modified row or a missing link fails, and the UI names the first broken sequence number.",
);

para("Security.", { font: fonts.sansBold, size: 8.8, after: 1 });
para(
  "Workspace isolation is enforced in every query and mutation; there is no direct client database access. Submitted content is delimited and passed as data, never as instructions. Email and phone numbers are redacted before model calls, and the count is logged with the call. Secrets live on the Convex deployment, never in the client bundle or the repository.",
);

para("AI services used.", { font: fonts.sansBold, size: 8.8, after: 1 });
para(
  "Convex for database, auth, storage and functions. The Freebuff model gateway for chat completions, model gpt-4o-mini by default, configurable through AI_PROVIDER, AI_MODEL_FAST and AI_MODEL_STRONG. Freebuff for hosting and preview. No Supabase, Inngest, Redis or pgvector. Open-source libraries are listed in the README.",
);

// ---------------------------------------------------------------- page 5

newPage();
h2("Evaluation results", "04");
para(
  `The seeded red-team set has ${results.itemCount} items: tone, naming, terminology, unsupported claims, expired claims, visual, accessibility, clean controls and two prompt-injection probes. Each item has expected rules and failure modes. The runner imports the production pipeline module; nothing is mocked.`,
  { size: 8.8 },
);

table(
  ["Failure mode", "Expected", "Predicted", "Matched", "Precision", "Recall"],
  [
    ...results.byFailureMode.map((row) => [
      row.mode.replace(/_/g, " "),
      row.expected,
      row.predicted,
      row.matched,
      pct(row.precision),
      pct(row.recall),
    ]),
    [
      "Overall",
      results.overall.expected,
      results.overall.predicted,
      results.overall.matched,
      pct(results.overall.precision),
      pct(results.overall.recall),
    ],
  ],
  [180, 60, 60, 55, 66, 66],
  { size: 8 },
);

table(
  ["Measure", "Result"],
  [
    ["Evidence validity", "Not measured in this run. Zero model findings were returned."],
    ["Suppressed by verifier", "0 model findings; no model output to verify."],
    ["Median fast lane", `${results.timing.fastMedianMs.toFixed(2)} ms`],
    ["Median full report", `${(results.timing.fullMedianMs / 1000).toFixed(1)} s, dominated by failed reviewer retries`],
    ["Prompt injection probes", `${results.injection.handled}/${results.injection.items} handled as data, expected findings still fired`],
    ["Reviewer errors", `${results.errors} of ${results.deepLane.reviewerCalls} calls`],
  ],
  [150, CW - 150],
  { strongFirst: true, size: 8 },
);

callout(
  "Read this before quoting the numbers",
  "Every reviewer call in the committed run failed with 'Rate limit exceeded: daily LLM spend budget is exhausted'. The table therefore measures the deterministic rule engine only. It is not a measurement of the two-lane pipeline, and it does not include verifier suppression because no model findings existed. The file eval/results.json records this in deepLane and notes.",
);

para(
  "Honest reading. The rule engine covers the seeded failure modes almost completely, which is expected because the set was authored from the same rulebook and the engine was developed against it. This is a regression suite, not a held-out benchmark. The two imprecise modes are tone and claims, where one extra item was flagged. Clean controls produced no findings. The real gap is the model-backed judgement lane, which could not be measured; that is the main thing to re-run before Round 3.",
  { size: 8.8 },
);

// ---------------------------------------------------------------- page 6

newPage();
h2("Changes from the original plan", "05");
para(
  "The full change log is in docs/CHANGES.md. The material differences:",
  { size: 8.8, after: 2 },
);
bullet("Next.js App Router and Vercel became Vite, React Router and the Freebuff workspace. Vercel, Supabase and GitHub were not reachable from the build environment.");
bullet("Supabase (Postgres, Auth, Storage, RLS) became Convex. Workspace isolation is enforced in every function rather than in database policies.");
bullet("Inngest became a Convex action plus a runs progress row. There is no durable retry queue or dead-letter store.");
bullet("pgvector hybrid retrieval became ledger-in-prompt with claim-id verification. The ledger has six entries and the rulebook fourteen rules, so passing them in full is cheaper and removes a silent retrieval failure mode.");
bullet("Multi-page document review and page rasterisation were not built. The compiler can extract text from PDF and DOCX; intake cannot review those pages.");
bullet("Deterministic claim and tone checks were added to the fast lane so the gate still works during a model outage. They are labelled as deterministic, not as model judgement.");
bullet("The eval runner is a local Bun script that imports the pipeline, not an HTTP endpoint. This removes a codegen dependency cycle and makes the run reproducible.");
bullet("Screenshots of the deployed app were not captured: the sandbox could not install browser system libraries (no disk space). The package lists the intended captures instead of staging them.");

newPage();
h2("Three major improvements for Round 3", "06");
para(
  "Each improvement extends modules that already exist in this codebase, and each has a measurable acceptance test.",
  { size: 8.8 },
);

para("1. Visual Consistency Engine v2", { font: fonts.sansBold, size: 10, after: 2 });
para(
  "What will be built. Page-level visual review for decks and PDFs: logo presence and clear space measured against the L-mark rule (R-VIS-02), logo placement and margin checks, typography family and size consistency, palette distance on the rendered page, and layout density. Findings carry a bounding box and a rendered-page thumbnail so the reviewer sees the violation rather than reading about it.",
);
para(
  "How it extends the build. The palette maths already lives in lib/color.ts and paletteFindings in lib/fastlane.ts; the image path already receives dominant colours. Add a pageRenders blob store and a visualAssets table, a renderer step in ai/pipeline.ts, and a new R-VIS-03 rule set published through the existing rulebook. Findings use the same Finding schema, the same verifier and the same review workspace, with a new overlay component.",
);
para(
  "Acceptance criteria. On a seeded 10-page deck, every injected logo clear-space violation, off-palette page and typography mismatch is detected with a box overlay; a clean deck produces no visual findings; the verifier drops any box whose page does not exist.",
);
para(
  "How we will test it. Render the fixture deck to images, store expected boxes, and run the eval with intersection-over-union at or above 0.7. Add a false-positive check on the clean deck and a timing budget for a 10-page document.",
);

// ---------------------------------------------------------------- page 7

para("2. Brand Drift and Rule Health analytics", { font: fonts.sansBold, size: 10, after: 2 });
para(
  "What will be built. A trend view over the decisions already being recorded: recurring issues by team, channel and rule; override rate per rule with a confidence interval; time from submission to approval; and suggested rewording for rules with a high override rate. The suggestion must cite the decisions that produced it, so a brand lead can judge it.",
);
para(
  "How it extends the build. ruleOverrides already stores accept, edit, reject and escalate per rule; decisions store the reason and actor. Add ruleHealth aggregates and a nightly Convex action, plus a drift view behind the existing Rule Health page. No new capture path is needed: the data is already written by submissions.ts.",
);
para(
  "Acceptance criteria. A seeded 90-day history shows per-rule override rate, the top drifting channel, and three suggested rewordings, each traceable to the specific decisions behind it. A rule with fewer than ten decisions is labelled low confidence rather than ranked.",
);
para(
  "How we will test it. Build a fixture history with a known drift pattern, assert the top rule and channel, and assert that every suggestion links to at least five decisions. Compare the computed override rate against a hand count.",
);

para("3. Integration path: Review API, webhooks and Google Docs", { font: fonts.sansBold, size: 10, after: 2 });
para(
  "What will be built. A documented, workspace-scoped HTTP API for submit, status, findings and decision; signed webhooks on findings_ready and approved with retries and delivery logs; and a Google Docs sidebar that submits the open document and shows findings inline. The sidebar is the proof that the gate can live where the writing happens.",
);
para(
  "How it extends the build. Reuse submissions, runs, findings, decisions and the audit chain as the single source of truth. Add apiKeys, webhookEndpoints and webhookDeliveries tables with idempotency keys, plus an OpenAPI document. The API calls the same pipeline action; it does not fork the logic.",
);
para(
  "Acceptance criteria. A Docs document can be submitted, reviewed and approved without opening the web app; every webhook delivery is retried, signed, idempotent and visible in the audit trail; a revoked key stops access immediately.",
);
para(
  "How we will test it. Contract tests against the OpenAPI schema, a replay test that sends the same idempotency key twice and expects one decision, a signature-tampering test, and a staging run of the Docs add-on against the seeded workspace.",
);

newPage();
h2("Known limitations", "07");
bullet("The model-backed deep lane was unavailable in the final window because the shared gateway budget was exhausted. The UI degrades to fast-lane findings and says so; the committed eval is deterministic-only.");
bullet("The evaluation set is seeded from the same rulebook the engine implements, so 95% precision and 100% recall are an upper bound, not evidence of field accuracy.");
bullet("Multi-page PDF and DOCX review is not built. Intake is text plus one image.");
bullet("No public deployment on Vercel and no public GitHub remote. The live app is the Freebuff preview; version control is managed by the platform.");
bullet("No screenshots. The browser could not run in the sandbox (missing system libraries, no disk space to install them).");
bullet("Image review is colour distance and alt text only: no logo detection, OCR, layout geometry or page rendering.");
bullet("The receipt is a PDF generated in the browser. It is a document of record, not a cryptographically signed artefact; its hashes are also in the audit chain.");
bullet("Legal escalation flags the finding and the submission. It does not create a separate legal queue or notify anyone.");
bullet("One workspace, one brand pack, one seeded history. Multi-tenant onboarding and per-client packs are Round 3 work.");

// ---------------------------------------------------------------- page 8

newPage();
h2("Screenshots", "08");
para(
  "The submission asks for real screenshots of the deployed app. They could not be captured in this environment: the Playwright Chromium build needs system libraries (libglib, libX11 and others) that were not present, and the package install ran out of disk space. Rather than stage images from a design file, this section records the exact captures still to take and what each one must show. The app and the routes are built; this is a documentation gap, not a missing feature.",
  { size: 8.8 },
);

table(
  ["#", "Capture", "Route", "What it must show"],
  [
    ["01", "Demo login", "/demo", "Four persona cards, no-signup note, one-click entry."],
    ["02", "Submit with sample", "/app/submit", "Loaded Lumora caption, off-palette image, alt text, hex pair."],
    ["03", "Fast-lane highlights", "/app/review/:id", "Inline highlights, severity counts, guideline excerpt, measured contrast."],
    ["04", "Report with findings", "/app/review/:id", "Findings list, reviewer labels, suggested diff, brand-fit score."],
    ["05", "Needs human bucket", "/app/review/:id", "Low-confidence findings separated, verifier details expanded."],
    ["06", "Accept, edit and reject", "/app/review/:id", "One of each decision with reason, tracked diff, comment."],
    ["07", "Approval state", "/app/review/:id", "Approver view, approval lock, approved banner."],
    ["08", "Audit chain verify", "/app/audit", "Verify chain pass, sequence numbers, hash and prev_hash."],
    ["09", "Receipt PDF", "download", "Version hash, decisions, models used, disclosure statement."],
  ],
  [22, 92, 78, CW - 192],
  { size: 7.6 },
);

y -= 8;
para(
  "A judge can reproduce every capture by following the demo script in submission/DEMO_SCRIPT.md. The routes above are the ones used in that script.",
  { size: 8.6 },
);

y -= 10;
page.drawLine({ start: { x: M, y }, end: { x: PAGE_W - M, y }, thickness: 0.8, color: INK });
y -= 16;
page.drawText("BrandSentinel  /  Round 2  /  October 2026", {
  x: M,
  y: y - 8,
  size: 8,
  font: fonts.bodyBold,
  color: INK,
});
page.drawText("Lumora is a synthetic brand. Claims, studies and people are fictional. Model output is a proposal; a human decides.", {
  x: M,
  y: y - 20,
  size: 7.4,
  font: fonts.body,
  color: MUTED,
});

mkdirSync("submission", { recursive: true });
const bytes = await pdf.save();
await import("node:fs").then((fs) =>
  fs.writeFileSync("submission/SUBMISSION.pdf", bytes),
);
console.log(`Wrote submission/SUBMISSION.pdf (${pdf.getPageCount()} pages, ${Math.round(bytes.length / 1024)} KB)`);
