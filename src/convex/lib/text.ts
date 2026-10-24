/** Text helpers: tracked diffs, a fix-intent proxy and PII redaction. */

export type DiffPart = { type: "same" | "add" | "remove"; text: string };

const tokenize = (s: string) => s.match(/\s+|[^\s]+/g) ?? [];

/** Word-level LCS diff, good enough for short brand fixes. */
export function wordDiff(before: string, after: string): DiffPart[] {
  const a = tokenize(before);
  const b = tokenize(after);
  const n = a.length;
  const m = b.length;
  const table: number[][] = Array.from({ length: n + 1 }, () =>
    new Array<number>(m + 1).fill(0),
  );
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i][j] =
        a[i] === b[j]
          ? table[i + 1][j + 1] + 1
          : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  const out: DiffPart[] = [];
  let i = 0;
  let j = 0;
  const push = (type: DiffPart["type"], text: string) => {
    if (!text) return;
    const last = out[out.length - 1];
    if (last && last.type === type) last.text += text;
    else out.push({ type, text });
  };
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      push("same", a[i]);
      i++;
      j++;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      push("remove", a[i++]);
    } else {
      push("add", b[j++]);
    }
  }
  while (i < n) push("remove", a[i++]);
  while (j < m) push("add", b[j++]);
  return out;
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const curr = [i];
    for (let j = 1; j <= b.length; j++) {
      curr[j] = Math.min(
        prev[j] + 1,
        curr[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = curr;
  }
  return prev[b.length];
}

export function stringSimilarity(a: string, b: string): number {
  const longest = Math.max(a.length, b.length);
  if (!longest) return 1;
  return 1 - levenshtein(a.toLowerCase(), b.toLowerCase()) / longest;
}

/**
 * Intent-preservation proxy for a suggested fix. We measure how much of the
 * original wording survives, weighted by token overlap. It is deliberately
 * conservative: a wholesale rewrite scores low even if it reads nicely, which
 * is what a reviewer needs to see before accepting.
 */
export function intentScore(spanText: string, suggestedFix: string): number {
  if (!suggestedFix.trim()) return 0;
  const words = (s: string) =>
    new Set(
      s
        .toLowerCase()
        .replace(/[^a-z0-9\s%]/g, " ")
        .split(/\s+/)
        .filter((w) => w.length > 2),
    );
  const original = words(spanText);
  const fix = words(suggestedFix);
  if (!original.size || !fix.size) return 0;
  let overlap = 0;
  for (const w of original) if (fix.has(w)) overlap++;
  const containment = overlap / original.size;
  const lengthPenalty =
    fix.size > original.size * 2.2 ? 0.75 : fix.size === 0 ? 0 : 1;
  return Math.max(0, Math.min(1, containment * lengthPenalty));
}

export function fixRisk(score: number): "low" | "medium" | "high" {
  if (score >= 0.6) return "low";
  if (score >= 0.35) return "medium";
  return "high";
}

export type RedactionResult = {
  text: string;
  count: number;
  kinds: string[];
  restore: (value: string) => string;
};

/**
 * Basic PII redaction before any model call. The mapping stays in this process
 * so the model never holds an email or phone number; model-returned spans are
 * rehydrated before evidence checking so quoted evidence still matches the
 * original submission exactly.
 */
export function redactPII(input: string): RedactionResult {
  const replacements: { token: string; original: string }[] = [];
  const kinds = new Set<string>();
  let text = input;

  const swap = (regex: RegExp, kind: string, make: (m: string, i: number) => string) => {
    text = text.replace(regex, (match) => {
      const token = make(match, replacements.length);
      replacements.push({ token, original: match });
      kinds.add(kind);
      return token;
    });
  };

  swap(
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
    "email",
    (_m, i) => `⟦EMAIL_${i + 1}⟧`,
  );
  swap(
    /(?:\+\d{1,3}[\s-]?)?(?:\(?\d{2,4}\)?[\s-]?)\d{3,4}[\s-]?\d{3,4}\b/g,
    "phone",
    (_m, i) => `⟦PHONE_${i + 1}⟧`,
  );

  return {
    text,
    count: replacements.length,
    kinds: Array.from(kinds),
    restore: (value: string) => {
      let out = value;
      for (const r of replacements) out = out.split(r.token).join(r.original);
      return out;
    },
  };
}

export function normalizeWhitespace(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

export function firstVerbatimIndex(haystack: string, needle: string): number {
  if (!needle.trim()) return -1;
  const direct = haystack.indexOf(needle);
  if (direct >= 0) return direct;

  // Tolerate whitespace-only differences, but keep a map back to real offsets
  // so highlights still land on the original text.
  let normalized = "";
  const offsets: number[] = [];
  for (let i = 0; i < haystack.length; i++) {
    const ch = haystack[i];
    if (/\s/.test(ch)) {
      if (normalized.length && normalized[normalized.length - 1] !== " ") {
        normalized += " ";
        offsets.push(i);
      }
    } else {
      normalized += ch;
      offsets.push(i);
    }
  }
  const target = needle.replace(/\s+/g, " ").trim();
  const at = normalized.indexOf(target);
  return at < 0 ? -1 : offsets[at] ?? -1;
}
