import type { Finding, Severity } from "./types";
import { contrastRatio, hexToRgb, nearestPalette } from "./color";
import { firstVerbatimIndex } from "./text";
import type { SeedClaim, SeedRule } from "./lumora";

export type FastLaneInput = {
  text: string;
  channel: string;
  altText: string;
  hasImage: boolean;
  design?: { textHex?: string; bgHex?: string };
  rules: SeedRule[];
  claims: SeedClaim[];
  glossary: {
    term: string;
    status: string;
    replacement?: string;
    note?: string;
  }[];
  /** ISO date used for claim expiry checks; injectable for the eval. */
  today?: string;
};

export type FastLaneResult = {
  findings: Finding[];
  elapsedMs: number;
  checks: { id: string; label: string; ran: boolean }[];
};

function rule(input: FastLaneInput, ruleId: string): SeedRule | undefined {
  return input.rules.find((r) => r.ruleId === ruleId);
}

function makeFinding(args: {
  input: FastLaneInput;
  ruleId: string;
  severity: Severity;
  span: string;
  text: string;
  why: string;
  fix: string;
  measured?: string;
  computed?: boolean;
  confidence?: number;
  index?: number;
}): Finding | null {
  const r = rule(args.input, args.ruleId);
  if (!r) return null;
  const at =
    args.index !== undefined
      ? args.index
      : args.span
        ? firstVerbatimIndex(args.text, args.span)
        : -1;
  if (args.span && at < 0) return null;
  return {
    id: `det-${args.ruleId}-${Math.max(0, at)}-${args.span.slice(0, 12)}`,
    reviewer:
      r.category === "accessibility"
        ? "accessibility"
        : r.category === "visual"
          ? "visual"
          : r.category === "tone"
            ? "tone"
            : r.category === "claims"
              ? "claims"
              : "terminology",
    severity: args.severity,
    confidence: args.confidence ?? 0.99,
    spanText: args.span,
    spanStart: Math.max(0, at),
    spanEnd: Math.max(0, at) + args.span.length,
    ruleId: args.ruleId,
    guidelineExcerpt: r.sourceExcerpt,
    whyItMatters: args.why,
    suggestedFix: args.fix,
    status: "pending",
    source: "deterministic",
    bucket: "verified",
    evidenceType: args.computed ? "computed" : "verbatim_span",
    measuredValue: args.measured,
  };
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function countWords(s: string) {
  return s.trim() ? s.trim().split(/\s+/).length : 0;
}

export function runFastLane(input: FastLaneInput): FastLaneResult {
  const started =
    typeof performance !== "undefined" ? performance.now() : Date.now();
  const findings: Finding[] = [];
  const text = input.text ?? "";
  const seen = new Set<string>();
  const add = (f: Finding | null) => {
    if (!f) return;
    const key = `${f.ruleId}:${f.spanStart}:${f.spanText.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    findings.push(f);
  };

  // 1. Banned and deprecated glossary terms.
  for (const entry of input.glossary) {
    if (entry.status === "banned") {
      const re = new RegExp(`\\b${escapeRegExp(entry.term)}\\b`, "gi");
      let match: RegExpExecArray | null;
      let guard = 0;
      while ((match = re.exec(text)) && guard < 3) {
        guard++;
        add(
          makeFinding({
            input,
            ruleId: "R-TERM-02",
            severity: "critical",
            span: match[0],
            text,
            index: match.index,
            why: `"${entry.term}" is on the prohibited-word list. It is the kind of absolute promise that turns a cosmetic into a claim we cannot defend.`,
            fix:
              entry.replacement && entry.replacement !== entry.term
                ? `Replace with "${entry.replacement}".`
                : "Remove the word and state the benefit plainly.",
          }),
        );
      }
    }
  }

  // 2. Product naming: bare "Glow Serum" and lowercase "lumora".
  {
    const shortName = /\bGlow Serum\b/g;
    let match: RegExpExecArray | null;
    let guard = 0;
    while ((match = shortName.exec(text)) && guard < 5) {
      guard++;
      const before = text.slice(Math.max(0, match.index - 7), match.index);
      if (/Lumora\s$/i.test(before)) continue;
      add(
        makeFinding({
          input,
          ruleId: "R-TERM-01",
          severity: "critical",
          span: match[0],
          text,
          index: match.index,
          why:
            'The product is "Lumora Glow Serum". Dropping the brand name weakens search visibility and breaks the naming rule on first mention.',
          fix: "Lumora Glow Serum",
        }),
      );
    }

    const lowerBrand = /\blumora\b/g;
    guard = 0;
    while ((match = lowerBrand.exec(text)) && guard < 3) {
      guard++;
      add(
        makeFinding({
          input,
          ruleId: "R-TERM-01",
          severity: "critical",
          span: match[0],
          text,
          index: match.index,
          why: "The brand name is always capitalised as Lumora.",
          fix: "Lumora",
        }),
      );
    }
  }

  // 3. Casing: all-caps words longer than three letters.
  {
    const allCaps = /\b[A-Z]{4,}\b/g;
    let match: RegExpExecArray | null;
    let guard = 0;
    while ((match = allCaps.exec(text)) && guard < 3) {
      guard++;
      if (/^HTTPS?$/.test(match[0])) continue;
      add(
        makeFinding({
          input,
          ruleId: "R-TERM-03",
          severity: "medium",
          span: match[0],
          text,
          index: match.index,
          why: "All-caps words read as shouting and break the sentence-case rule.",
          fix: match[0][0] + match[0].slice(1).toLowerCase(),
        }),
      );
    }
  }

  // 4. Expired claim wording.
  {
    const today = input.today ? new Date(input.today) : new Date();
    for (const claim of input.claims) {
      if (claim.status !== "expired") continue;
      const expiredOn = claim.expiresAt
        ? new Date(claim.expiresAt) < today
        : false;
      if (!expiredOn) continue;
      const distinctive = claim.text
        .replace(/^(Clinically|Visibly|Reduces)\s+/i, "")
        .replace(/\.$/, "");
      const probe = distinctive.split(/\s+/).slice(0, 5).join(" ");
      const at = probe ? firstVerbatimIndex(text, probe) : -1;
      if (at < 0) continue;
      const span =
        claim.text.length <= 160 ? claim.text : text.slice(at, at + 120);
      add(
        makeFinding({
          input,
          ruleId: "R-CLAIM-03",
          severity: "high",
          span,
          text,
          index: at,
          why: `This matches ledger claim ${claim.claimId}, which expired on ${claim.expiresAt}. Expired evidence cannot support new copy, and rewording does not renew it.`,
          fix: claim.approvedWording
            ? claim.approvedWording
            : "Remove the timeframe and use an approved claim from the ledger.",
        }),
      );
    }
  }

  // 5. Contrast, for explicit hex pairs in the copy or a design swatch.
  {
    const hexes = text.match(/#[0-9a-fA-F]{6}\b/g) ?? [];
    const pairs: { fg: string; bg: string; span: string }[] = [];
    const [firstHex, secondHex] = hexes;
    if (firstHex && secondHex) {
      const spanStart = text.indexOf(firstHex);
      const spanEnd = text.indexOf(secondHex) + secondHex.length;
      pairs.push({
        fg: firstHex,
        bg: secondHex,
        span: text.slice(spanStart, spanEnd),
      });
    }
    if (input.design?.textHex && input.design?.bgHex) {
      const already = pairs.some(
        (p) =>
          p.fg.toLowerCase() === input.design!.textHex!.toLowerCase() &&
          p.bg.toLowerCase() === input.design!.bgHex!.toLowerCase(),
      );
      if (!already) {
        pairs.push({
          fg: input.design.textHex,
          bg: input.design.bgHex,
          span: "",
        });
      }
    }
    for (const pair of pairs.slice(0, 2)) {
      const fg = hexToRgb(pair.fg);
      const bg = hexToRgb(pair.bg);
      if (!fg || !bg) continue;
      const ratio = contrastRatio(fg, bg);
      if (ratio >= 4.5) continue;
      add(
        makeFinding({
          input,
          ruleId: "R-A11Y-01",
          severity: "high",
          span: pair.span,
          text,
          why: `Measured contrast is ${ratio.toFixed(2)}:1. WCAG 2.1 AA needs 4.5:1 for this size of text, so low-vision readers will lose parts of the caption.`,
          fix: `Use Ink #1F1D1A on Bone #F4EFE6 (15.1:1), or darken ${pair.fg} until it reaches 4.5:1.`,
          measured: `${ratio.toFixed(2)}:1`,
          computed: !pair.span,
        }),
      );
    }
  }

  // 6. Missing alt text.
  if (input.hasImage && !input.altText.trim()) {
    add(
      makeFinding({
        input,
        ruleId: "R-A11Y-02",
        severity: "high",
        span: "",
        text,
        computed: true,
        why: "The image has no alt text. Screen-reader users get nothing, and the post fails the accessibility rule before it is published.",
        fix:
          "Describe the product, setting and light: a bone-coloured Lumora Glow Serum bottle on a sand plinth, lit from the left.",
        measured: "alt attribute empty",
      }),
    );
  }

  const elapsed =
    (typeof performance !== "undefined" ? performance.now() : Date.now()) -
    started;

  return {
    findings,
    elapsedMs: elapsed,
    checks: [
      { id: "banned", label: "Banned terms", ran: true },
      { id: "naming", label: "Naming & casing", ran: true },
      {
        id: "contrast",
        label: "Contrast ratio",
        ran: true,
      },
      { id: "alt", label: "Alt text", ran: input.hasImage },
    ],
  };
}

/** Palette distance from an uploaded image's dominant colours (CIELAB). */
export function paletteFindings(args: {
  dominant: { hex: string; share: number }[];
  palette: { name: string; hex: string }[];
  rules: SeedRule[];
  text: string;
}): Finding[] {
  const r = args.rules.find((x) => x.ruleId === "R-VIS-01");
  if (!r) return [];
  const out: Finding[] = [];
  for (const colour of args.dominant) {
    if (colour.share < 0.1) continue;
    const nearest = nearestPalette(
      colour.hex,
      args.palette.map((p) => p.hex),
    );
    if (!nearest) continue;
    if (nearest.deltaE <= 22) continue;
    const name =
      args.palette.find((p) => p.hex === nearest.hex)?.name ?? nearest.hex;
    out.push({
      id: `det-R-VIS-01-${colour.hex}`,
      reviewer: "visual",
      severity: "medium",
      confidence: 0.95,
      spanText: "",
      spanStart: 0,
      spanEnd: 0,
      ruleId: "R-VIS-01",
      guidelineExcerpt: r.sourceExcerpt,
      whyItMatters: `${colour.hex} covers ${Math.round(colour.share * 100)}% of the image and sits ΔE ${Math.round(nearest.deltaE)} from the nearest brand colour (${name} ${nearest.hex}). At that distance the creative reads as a different brand.`,
      suggestedFix: `Recolour the dominant surface toward ${name} ${nearest.hex}.`,
      status: "pending",
      source: "deterministic",
      bucket: "verified",
      evidenceType: "computed",
      measuredValue: `ΔE ${Math.round(nearest.deltaE)}`,
    });
    if (out.length >= 2) break;
  }
  return out;
}

export function submissionLengthWarning(text: string, channel: string) {
  if (!text.trim()) return "Write or load some content before submitting.";
  const words = countWords(text);
  if (channel === "instagram" && text.length > 2200) {
    return "Instagram captions are capped at 2,200 characters.";
  }
  if (words > 1200) {
    return "This is longer than a single-piece review. Split it into pages or a document submission.";
  }
  return null;
}
