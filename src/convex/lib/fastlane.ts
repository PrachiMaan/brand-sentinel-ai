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
      // Allow simple inflections so "cures" is still caught by the entry "cure".
      const re = new RegExp(
        `\\b${escapeRegExp(entry.term)}(?:s|d|ed|ing)?\\b`,
        "gi",
      );
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

  // 4. Claim Ledger matching: expired wording, unsupported performance claims
  // and medical language. This is a deterministic ledger match, not a model.
  {
    const today = input.today ? new Date(input.today) : new Date();
    const sentences: { text: string; index: number }[] = [];
    const sentenceRe = /[^.!?\n]+[.!?]?/g;
    let sentenceMatch: RegExpExecArray | null;
    while ((sentenceMatch = sentenceRe.exec(text))) {
      const value = sentenceMatch[0].trim();
      if (value.length < 8) continue;
      const offset = sentenceMatch.index + sentenceMatch[0].indexOf(value);
      sentences.push({ text: value, index: offset });
    }

    const stop = new Set([
      "the", "and", "for", "with", "that", "this", "from", "your", "our",
      "are", "was", "were", "has", "have", "into", "over", "after",
      "study", "shown", "reported", "participants", "users", "people",
    ]);
    const stem = (word: string) =>
      word.replace(/(ing|ed|es|s)$/, "").replace(/e$/, "");
    const tokens = (value: string) =>
      value
        .toLowerCase()
        .replace(/[^a-z0-9%]+/g, " ")
        .split(/\s+/)
        .filter((word) => word.length > 2 && !stop.has(word))
        .map(stem);

    const claimWords = input.claims.map((claim) => ({
      claim,
      words: tokens(claim.text),
    }));
    const ledgerScore = (sentenceTokens: string[], claimTokens: string[]) => {
      const set = new Set(claimTokens);
      const hits = new Set(sentenceTokens.filter((word) => set.has(word)));
      return {
        hits: hits.size,
        score: hits.size / Math.max(1, claimTokens.length),
      };
    };

    for (const sentence of sentences) {
      const words = tokens(sentence.text);
      if (!words.length) continue;
      let expiredMatch = false;

      // 4a. Expired or expiring ledger entries used again.
      for (const { claim, words: cWords } of claimWords) {
        if (claim.status !== "expired" && claim.status !== "expiring") continue;
        const { hits, score } = ledgerScore(words, cWords);
        if (hits < 2 || score < 0.45) continue;
        const expiredOn = claim.expiresAt
          ? new Date(claim.expiresAt) < today
          : claim.status === "expired";
        // An expiring claim is still valid until its date. Only an actually
        // expired entry is a violation.
        if (!expiredOn) continue;
        // If both the claim and the sentence carry numbers, they must agree.
        const claimNumbers: string[] = claim.text.match(/\d+/g) ?? [];
        const sentenceNumbers: string[] = sentence.text.match(/\d+/g) ?? [];
        if (
          claimNumbers.length &&
          sentenceNumbers.length &&
          !claimNumbers.some((n) => sentenceNumbers.includes(n))
        ) {
          continue;
        }
        add(
          makeFinding({
            input,
            ruleId: "R-CLAIM-03",
            severity: "high",
            span: sentence.text,
            text,
            index: sentence.index,
            why: `This sentence matches ledger claim ${claim.claimId}${
              expiredOn
                ? `, which expired on ${claim.expiresAt}`
                : `, which expires on ${claim.expiresAt}`
            }. Expired evidence cannot support new copy, and rewording does not renew it.`,
            fix: claim.approvedWording
              ? claim.approvedWording
              : "Remove the timeframe and use an approved claim from the ledger.",
          }),
        );
        expiredMatch = true;
        break;
      }
      if (expiredMatch) continue;

      // 4b. Medical language. Cosmetics may not promise treatment.
      const medical = sentence.text.match(
        /\b(heals?|healing|cures?|treats?|treatment|repairs?|eczema|acne|rosacea|psoriasis|medical|therapeutic)\b/i,
      );
      if (medical) {
        add(
          makeFinding({
            input,
            ruleId: "R-CLAIM-02",
            severity: "critical",
            span: medical[0],
            text,
            index: sentence.index + (medical.index ?? 0),
            why: "Lumora sells cosmetics. Treatment, healing and medical language turns a cosmetic benefit into a regulated medical claim.",
            fix: "Describe the cosmetic appearance instead, for example 'visibly calmer-looking skin'.",
          }),
        );
      }

      // 4c. Performance numbers and absolutes must match an approved entry.
      const assertion =
        /(\d+(\.\d+)?\s?%|\b\d+\s*(out of|\/)\s*\d+|\b(in|within|after|just)\s+\d+\s+(day|week|hour)s?\b|\b(twice|three times|\d+x)\s+(as\s+)?(fast|effective|strong|powerful)\b|clinically proven|instant results?|works instantly|overnight results?|guaranteed|leading serums?|transform your skin|the only .{0,30} you will ever need)/i.test(
          sentence.text,
        );
      if (!assertion) continue;
      const supported = claimWords.some(({ claim, words: cWords }) => {
        if (claim.status === "expired") return false;
        const { hits, score } = ledgerScore(words, cWords);
        return hits >= 2 && score >= 0.4;
      });
      if (supported) continue;
      add(
        makeFinding({
          input,
          ruleId: "R-CLAIM-01",
          severity: "critical",
          span: sentence.text,
          text,
          index: sentence.index,
          why: "This is a performance assertion with a number or absolute wording, but it does not match any approved entry in the Claim Ledger. There is no evidence on file for it.",
          fix: "Replace it with the nearest approved wording from the Claim Ledger, or remove the number and timeframe.",
        }),
      );
    }
  }

  // 5. Tone: urgency, hype and clinical jargon.
  {
    const tonePatterns: { ruleId: string; re: RegExp; why: string; fix: string }[] = [
      {
        ruleId: "R-TONE-01",
        re: /\b(hurry|last chance|don'?t miss|before it'?s gone|before it is gone|only [a-z0-9]+ left|buy now|act now|limited time)\b/i,
        why: "This is pressure selling. Lumora never manufactures urgency, and the voice rule asks for a quieter register.",
        fix: "State the availability or benefit plainly, without a countdown or a command to buy.",
      },
      {
        ruleId: "R-TONE-01",
        re: /\b(game-?changer|you need this|must-have|unbelievable|life-changing|obsessed|revolutionary|unprecedented|scientifically engineered|the only [a-z ]{0,40} you will ever need)\b/i,
        why: "Hype language breaks the quiet-confidence voice and reads like every other skincare ad.",
        fix: "Name the actual benefit in plain words.",
      },
      {
        ruleId: "R-TONE-01",
        re: /\b(limited stock|order in the next [a-z0-9]+|secure yours|while stocks last|last step you need)\b/i,
        why: "This creates artificial scarcity. The voice rule asks Lumora to inform rather than pressure.",
        fix: "Say when the product is available and let the reader decide.",
      },
      {
        ruleId: "R-TONE-01",
        re: /!{2,}/g,
        why: "Stacked exclamation marks are explicitly excluded by the voice rule.",
        fix: "Use a full stop.",
      },
      {
        ruleId: "R-TONE-02",
        re: /\b(cutaneous|dermal|bio-?active|matrix|optimises|optimizes|modulates|proprietary|synergy|paradigm|pathways|scientifically engineered)\b/i,
        why: "Clinical and marketing jargon asks the reader to decode the sentence. The rule asks for the everyday word.",
        fix: "Rewrite in plain language: say what the serum does for skin, not how the formula is described internally.",
      },
    ];
    for (const tonePattern of tonePatterns) {
      const match = text.match(tonePattern.re);
      if (!match) continue;
      add(
        makeFinding({
          input,
          ruleId: tonePattern.ruleId,
          severity: tonePattern.ruleId === "R-TONE-02" ? "medium" : "high",
          span: match[0],
          text,
          why: tonePattern.why,
          fix: tonePattern.fix,
        }),
      );
    }
  }

  // 6. Deprecated glossary terms (for example "anti-aging").
  for (const entry of input.glossary) {
    if (entry.status !== "deprecated") continue;
    const re = new RegExp(`\\b${escapeRegExp(entry.term)}\\b`, "gi");
    const match = re.exec(text);
    if (!match) continue;
    // "Lumora Glow Serum" is the approved full name, not a deprecated use.
    if (
      entry.term.toLowerCase() === "glow serum" &&
      /lumora\s+$/i.test(text.slice(Math.max(0, match.index - 8), match.index))
    ) {
      continue;
    }
    add(
      makeFinding({
        input,
        ruleId:
          entry.term.toLowerCase() === "anti-aging"
            ? "R-TERM-04"
            : entry.term.toLowerCase() === "glow serum"
              ? "R-TERM-01"
              : "R-TERM-02",
        severity: "medium",
        span: match[0],
        text,
        index: match.index,
        why: `"${entry.term}" is deprecated in the glossary. ${entry.note ?? ""}`.trim(),
        fix: entry.replacement
          ? `Replace with "${entry.replacement}".`
          : "Remove the term.",
      }),
    );
  }

  // 7. Email subject discipline.
  if (input.channel === "email") {
    const subject = text.match(/^Subject:\s*(.+)$/im)?.[1] ?? text.split("\n")[0];
    if (subject && subject.length > 60) {
      add(
        makeFinding({
          input,
          ruleId: "R-CHAN-01",
          severity: "low",
          span: subject.trim(),
          text,
          why: `The subject line is ${subject.trim().length} characters. The channel rule keeps email subjects under 60 so they are not truncated in the inbox.`,
          fix: subject.trim().slice(0, 57).trimEnd() + "...",
          measured: `${subject.trim().length} characters`,
          computed: false,
        }),
      );
    }
  }

  // 8. Contrast, for explicit hex pairs in the copy or a design swatch.
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

  // 9. Missing alt text.
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
      { id: "claims", label: "Claim Ledger match", ran: true },
      { id: "tone", label: "Tone & jargon", ran: true },
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
