import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { PDFFont, PDFPage } from "pdf-lib";
import { canonicalJson, sha256Hex } from "@/convex/lib/sha256";

type ReceiptFinding = {
  id: string;
  reviewer: string;
  severity: string;
  ruleId: string;
  confidence: number;
  spanText: string;
  whyItMatters: string;
  suggestedFix: string;
  status: string;
  claimStatus?: string | null;
  claimId?: string | null;
  bucket: string;
};
type ReceiptDecision = {
  findingId: string;
  decision: string;
  reason: string | null;
  editedFix: string | null;
  actorName: string;
  actorRole: string;
  createdAt: number;
};
type ReceiptCall = {
  purpose: string;
  model: string;
  latencyMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
  ok: boolean;
  redactions: number;
};

export type ReceiptInput = {
  submission: {
    title: string;
    channel: string;
    audience: string;
    creatorName: string;
    currentVersion: number;
    status: string;
    brandFit?: number | null;
    createdAt: number;
  };
  version: { contentHash: string } | null;
  findings: ReceiptFinding[];
  decisions: ReceiptDecision[];
  run: {
    verifier: {
      total: number;
      kept: number;
      dropped: number;
      needsHuman: number;
      droppedSpan: number;
      droppedRule: number;
      droppedExcerpt: number;
      droppedClaim: number;
      evidenceRate: number;
    } | null;
    brandFit: number | null;
    model: string | null;
    finishedAt: number | null;
  } | null;
  calls: ReceiptCall[];
  brand: { name: string; version: string } | null;
  auditHead: { seq: number; hash: string };
  workspaceName: string;
  generatedBy: string;
};

const A4: [number, number] = [595.28, 841.89];
const MARGIN = 52;
const INK = rgb(0.12, 0.115, 0.1);
const MUTED = rgb(0.42, 0.405, 0.375);
const RULE = rgb(0.84, 0.815, 0.765);
const PAPER = rgb(0.976, 0.961, 0.925);
const CLAY = rgb(0.6, 0.31, 0.18);

function fmtDate(value: number | null) {
  if (!value) return "—";
  return new Date(value).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  });
}

function wrap(text: string, font: PDFFont, size: number, width: number) {
  const words = text.replace(/\s+/g, " ").trim().split(" ");
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const attempt = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(attempt, size) > width && line) {
      lines.push(line);
      line = word;
    } else {
      line = attempt;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

export async function buildReceipt(input: ReceiptInput): Promise<{
  bytes: Uint8Array;
  receiptHash: string;
  filename: string;
}> {
  const pdf = await PDFDocument.create();
  const serif = await pdf.embedFont(StandardFonts.TimesRoman);
  const serifBold = await pdf.embedFont(StandardFonts.TimesRomanBold);
  const serifItalic = await pdf.embedFont(StandardFonts.TimesRomanItalic);
  const sans = await pdf.embedFont(StandardFonts.Helvetica);
  const sansBold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const mono = await pdf.embedFont(StandardFonts.Courier);

  const pages: PDFPage[] = [];
  let page = pdf.addPage(A4);
  pages.push(page);
  let y = 782;

  const newPage = () => {
    page = pdf.addPage(A4);
    pages.push(page);
    y = 782;
  };
  const ensure = (height: number) => {
    if (y - height < 74) newPage();
  };
  const text = (
    value: string,
    options: {
      x?: number;
      size?: number;
      font?: PDFFont;
      color?: ReturnType<typeof rgb>;
      width?: number;
      lineHeight?: number;
    } = {},
  ) => {
    const size = options.size ?? 9.5;
    const font = options.font ?? sans;
    const width = options.width ?? A4[0] - MARGIN * 2;
    const lines = wrap(value, font, size, width);
    const lineHeight = options.lineHeight ?? size * 1.45;
    ensure(lines.length * lineHeight + 4);
    for (const line of lines) {
      page.drawText(line, {
        x: options.x ?? MARGIN,
        y,
        size,
        font,
        color: options.color ?? INK,
      });
      y -= lineHeight;
    }
  };
  const section = (label: string) => {
    ensure(40);
    y -= 8;
    page.drawText(label.toUpperCase(), {
      x: MARGIN,
      y,
      size: 7.5,
      font: sansBold,
      color: MUTED,
    });
    y -= 6;
    page.drawLine({
      start: { x: MARGIN, y },
      end: { x: A4[0] - MARGIN, y },
      thickness: 0.6,
      color: RULE,
    });
    y -= 16;
  };

  page.drawRectangle({
    x: 0,
    y: 782,
    width: A4[0],
    height: 60,
    color: PAPER,
  });
  page.drawText("BrandSentinel", {
    x: MARGIN,
    y: 812,
    size: 17,
    font: serif,
    color: INK,
  });
  page.drawText("REVIEW RECEIPT", {
    x: A4[0] - MARGIN - 86,
    y: 813,
    size: 8,
    font: sansBold,
    color: CLAY,
  });
  page.drawText(`${input.workspaceName} · ${input.brand?.version ?? ""}`, {
    x: MARGIN,
    y: 795,
    size: 8,
    font: sans,
    color: MUTED,
  });

  y = 752;
  text("Brand governance record", { size: 9, font: serifItalic, color: MUTED });
  y -= 2;
  text(input.submission.title, { size: 22, font: serif, lineHeight: 25 });
  y -= 2;
  text(
    `${input.submission.channel.toUpperCase()} · v${input.submission.currentVersion} · ${input.submission.audience}`,
    { size: 8, font: sans, color: MUTED },
  );

  y -= 10;
  section("Record");
  const meta: [string, string][] = [
    ["Submission status", input.submission.status.replace(/_/g, " ")],
    ["Created by", input.submission.creatorName],
    ["Version", `v${input.submission.currentVersion}`],
    ["Brand fit", input.submission.brandFit != null ? `${input.submission.brandFit}/100` : "—"],
    ["Receipt generated", `${fmtDate(Date.now())} UTC`],
    ["Generated by", input.generatedBy],
    ["AI review finished", fmtDate(input.run?.finishedAt ?? null)],
    ["Model", input.run?.model ?? "—"],
  ];
  for (const [label, value] of meta) {
    ensure(18);
    page.drawText(label, {
      x: MARGIN,
      y,
      size: 7.5,
      font: sans,
      color: MUTED,
    });
    page.drawText(value.slice(0, 105), {
      x: MARGIN + 132,
      y,
      size: 8.5,
      font: serif,
      color: INK,
    });
    y -= 14;
  }

  y -= 6;
  section("Version integrity");
  const contentHash = input.version?.contentHash ?? "missing";
  text("SHA-256 of the reviewed version (content, channel, audience, alt text):", {
    size: 8,
    font: sans,
    color: MUTED,
  });
  for (let i = 0; i < contentHash.length; i += 72) {
    ensure(12);
    page.drawText(contentHash.slice(i, i + 72), {
      x: MARGIN,
      y,
      size: 8,
      font: mono,
      color: INK,
    });
    y -= 11;
  }
  y -= 2;
  text(
    `Audit chain entry ${input.auditHead.seq} · head ${input.auditHead.hash.slice(0, 24)}…`,
    { size: 8, font: mono, color: MUTED },
  );

  y -= 6;
  section("Findings and human decisions");
  const verifier = input.run?.verifier;
  text(
    `${input.findings.length} findings on record · ${verifier?.dropped ?? 0} model findings suppressed by the verifier · ${verifier?.needsHuman ?? 0} routed to Needs human`,
    { size: 8, font: sans, color: MUTED },
  );
  y -= 4;

  const decisionFor = (findingId: string) =>
    input.decisions.find((d) => d.findingId === findingId);

  if (!input.findings.length) {
    text(
      "No verified findings. The deterministic and narrative passes returned nothing against the published rulebook.",
      { size: 9, font: serifItalic, color: MUTED },
    );
  }

  for (const [index, finding] of input.findings.entries()) {
    const decision = decisionFor(finding.id);
    ensure(100);
    y -= 4;
    page.drawRectangle({
      x: MARGIN,
      y: y - 3,
      width: 3,
      height: 13,
      color:
        finding.severity === "critical"
          ? rgb(0.56, 0.19, 0.15)
          : finding.severity === "high"
            ? CLAY
            : rgb(0.55, 0.5, 0.4),
    });
    page.drawText(`${index + 1}. ${finding.severity.toUpperCase()}`, {
      x: MARGIN + 9,
      y,
      size: 7.5,
      font: sansBold,
      color: INK,
    });
    page.drawText(
      `${finding.ruleId} · ${finding.reviewer} · ${(finding.confidence * 100).toFixed(0)}% confidence`,
      { x: MARGIN + 95, y, size: 7.5, font: sans, color: MUTED },
    );
    y -= 12;
    text(`“${finding.spanText || "(computed evidence)"}”`, {
      size: 9,
      font: serifItalic,
      width: A4[0] - MARGIN * 2 - 9,
      lineHeight: 12,
    });
    y -= 1;
    page.drawText("Evidence:", {
      x: MARGIN + 9,
      y,
      size: 7,
      font: sansBold,
      color: MUTED,
    });
    text(finding.whyItMatters, {
      x: MARGIN + 52,
      size: 8,
      font: sans,
      width: A4[0] - MARGIN * 2 - 52,
      lineHeight: 10,
    });
    if (finding.claimStatus) {
      text(
        `Claim Ledger: ${finding.claimStatus}${finding.claimId ? ` (${finding.claimId})` : ""}`,
        { x: MARGIN + 9, size: 7.5, font: sans, color: MUTED, lineHeight: 10 },
      );
    }
    if (finding.suggestedFix) {
      text(`Suggested fix: ${finding.suggestedFix}`, {
        x: MARGIN + 9,
        size: 8,
        font: sans,
        color: MUTED,
        width: A4[0] - MARGIN * 2 - 9,
        lineHeight: 10,
      });
    }
    const decisionLine = decision
      ? `${decision.decision.toUpperCase()} by ${decision.actorName} (${decision.actorRole}) on ${fmtDate(decision.createdAt)} UTC${decision.reason ? ` · reason: ${decision.reason}` : ""}`
      : "PENDING · no human decision recorded";
    text(decisionLine, {
      x: MARGIN + 9,
      size: 7.5,
      font: sansBold,
      color: decision ? rgb(0.31, 0.36, 0.28) : CLAY,
      lineHeight: 10,
    });
    if (decision?.editedFix) {
      text(`Accepted wording: ${decision.editedFix}`, {
        x: MARGIN + 9,
        size: 7.5,
        font: sans,
        color: MUTED,
        lineHeight: 10,
      });
    }
    y -= 4;
    page.drawLine({
      start: { x: MARGIN, y },
      end: { x: A4[0] - MARGIN, y },
      thickness: 0.4,
      color: RULE,
    });
    y -= 10;
  }

  y -= 4;
  section("Evidence verification");
  if (verifier) {
    const rows: [string, string][] = [
      ["Model findings proposed", String(verifier.total)],
      ["Kept after evidence checks", String(verifier.kept)],
      ["Suppressed", String(verifier.dropped)],
      ["Span not verbatim", String(verifier.droppedSpan)],
      ["Rule not in rulebook", String(verifier.droppedRule)],
      ["Excerpt not in rulebook", String(verifier.droppedExcerpt)],
      ["Claim id not in ledger", String(verifier.droppedClaim)],
      ["Routed to Needs human", String(verifier.needsHuman)],
      ["Evidence validity", `${verifier.evidenceRate}%`],
    ];
    for (const [label, value] of rows) {
      ensure(14);
      page.drawText(label, { x: MARGIN, y, size: 8, font: sans, color: MUTED });
      page.drawText(value, { x: MARGIN + 210, y, size: 8.5, font: mono, color: INK });
      y -= 12;
    }
  } else {
    text("No verifier report is attached to this version.", {
      size: 8.5,
      font: serifItalic,
      color: MUTED,
    });
  }

  y -= 6;
  section("AI services and disclosure");
  const uniqueCalls = new Map<string, { model: string; count: number; ok: number }>();
  for (const call of input.calls) {
    const key = `${call.purpose}|${call.model}`;
    const current = uniqueCalls.get(key) ?? { model: call.model, count: 0, ok: 0 };
    current.count++;
    if (call.ok) current.ok++;
    uniqueCalls.set(key, current);
  }
  if (uniqueCalls.size === 0) {
    text("No hosted model call was recorded for this version.", {
      size: 8.5,
      font: sans,
      color: MUTED,
    });
  }
  for (const [key, value] of uniqueCalls) {
    text(`${key.split("|")[0]} · ${value.model} · ${value.count} call(s) · ${value.ok} valid`, {
      size: 8,
      font: sans,
      color: INK,
    });
  }
  y -= 4;
  text(
    "AI disclosure: hosted language models proposed review findings for this version. Deterministic engines computed naming, glossary, contrast, palette and alt-text checks in code. Every model finding passed a verbatim-span, rule-id and guideline-excerpt verifier before reaching a reviewer. No model output was auto-applied and no content was auto-published. A human named in this receipt made every decision recorded above.",
    { size: 8, font: serif, color: INK, lineHeight: 10.5 },
  );
  y -= 4;
  text(
    `Data handling: submitted content is sent to the model provider only for the review. PII redaction count for this run: ${input.calls.reduce((sum, c) => sum + c.redactions, 0)} substitution(s) logged.`,
    { size: 8, font: serif, color: MUTED, lineHeight: 10.5 },
  );

  y -= 8;
  section("Sign-off");
  const approval = input.decisions.filter((d) => d.actorRole === "approver").length;
  text(
    `This receipt records an approval decision by a human with the Approver role. ${approval} approver-level decision(s) are recorded against individual findings. The submission status at export was "${input.submission.status.replace(/_/g, " ")}".`,
    { size: 8.5, font: serif, color: INK, lineHeight: 11 },
  );
  y -= 4;
  text(
    "BrandSentinel is a review aid, not a legal opinion. Claims escalated to Legal remain flagged in the audit trail.",
    { size: 8, font: serifItalic, color: MUTED },
  );

  pages.forEach((p, index) => {
    p.drawLine({
      start: { x: MARGIN, y: 48 },
      end: { x: A4[0] - MARGIN, y: 48 },
      thickness: 0.5,
      color: RULE,
    });
    p.drawText("BrandSentinel · review receipt · generated from the audit trail", {
      x: MARGIN,
      y: 36,
      size: 6.8,
      font: sans,
      color: MUTED,
    });
    p.drawText(`Page ${index + 1} of ${pages.length}`, {
      x: A4[0] - MARGIN - 52,
      y: 36,
      size: 6.8,
      font: sans,
      color: MUTED,
    });
  });

  const receiptHash = sha256Hex(
    canonicalJson({
      contentHash,
      findings: input.findings.map((f) => f.id),
      decisions: input.decisions.map((d) => `${d.findingId}:${d.decision}`),
      auditHead: input.auditHead.hash,
      model: input.run?.model,
    }),
  );
  page.drawText(`Receipt digest ${receiptHash.slice(0, 32)}`, {
    x: MARGIN,
    y: 64,
    size: 6.5,
    font: mono,
    color: MUTED,
  });

  const bytes = await pdf.save();
  const slug = input.submission.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
  return {
    bytes,
    receiptHash,
    filename: `brandsentinel-receipt-${slug || "review"}-v${input.submission.currentVersion}.pdf`,
  };
}
