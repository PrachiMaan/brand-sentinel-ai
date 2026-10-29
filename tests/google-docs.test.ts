/**
 * Tests for integrations/google-docs/Code.gs.
 *
 * The Apps Script file only runs inside Google's runtime, so these tests load
 * its source into a Function with the Apps Script services mocked
 * (DocumentApp, PropertiesService, UrlFetchApp, Utilities, HtmlService) and
 * drive the same entry points the sidebar calls: submitDocument, fetchStatus,
 * fetchFindings, decideFinding, decideSubmission, highlightSpan, clearHighlights.
 *
 * The HTTP mock returns the error shape the real /api/v1 uses:
 *   { "error": { "code", "message", "requestId" } }
 */
import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const CODE_PATH = join(import.meta.dir, "..", "integrations", "google-docs", "Code.gs");
const source = readFileSync(CODE_PATH, "utf8");

const API_KEY = "bss_live_0123456789abcdef0123456789abcdef";
const API_BASE = "https://example.test";
const PALETTE = ["#F3C9C4", "#F6DCC0", "#FBEFC2", "#DDE7D2"];

type FetchCall = {
  url: string;
  options: {
    method?: string;
    headers?: Record<string, string>;
    payload?: string;
    muteHttpExceptions?: boolean;
    followRedirects?: boolean;
  };
};

type Responder = (
  url: string,
  options: FetchCall["options"],
) => { code: number; body?: unknown; headers?: Record<string, string> };

type DigestStyle = "plain" | "signed" | "uint8" | "no-map";

type HarnessOptions = {
  props?: Record<string, string>;
  text?: string;
  docId?: string;
  title?: string;
  digestStyle?: DigestStyle;
  respond?: Responder;
  /** Pre-coloured ranges in the mock document, for clearHighlights. */
  paint?: Array<{ start: number; end: number; color: string }>;
};

type CodeApi = {
  getSettings: () => { apiBase: string; apiKey: string; configured: boolean };
  saveSettings: (base: string, key: string) => { ok: boolean; error?: string };
  clearSettings: () => { ok: boolean };
  readDocument: () => { docId: string; title: string; text: string };
  submitDocument: (channel?: string, team?: string) => {
    ok: boolean;
    error?: string;
    submissionId?: string;
    status?: string;
    idempotencyKey?: string;
    chars?: number;
  };
  fetchStatus: (id: string) => { ok: boolean; error?: string; run?: Record<string, unknown> };
  fetchFindings: (id: string) => { ok: boolean; error?: string; findings?: Array<Record<string, unknown>> };
  decideFinding: (
    id: string,
    findingId: string,
    decision: string,
    reason?: string,
  ) => { ok: boolean; error?: string; result?: unknown };
  decideSubmission: (
    id: string,
    decision: string,
    reason?: string,
  ) => { ok: boolean; error?: string; result?: unknown };
  highlightSpan: (span: string, severity: string) => { ok: boolean; error?: string };
  clearHighlights: () => { ok: boolean; cleared?: number };
  digest_: (text: string) => string;
  escapeForFind_: (text: string) => string;
};

/** Byte array shapes Apps Script has been observed handing back. */
function digestBytes(style: DigestStyle, text: string): unknown {
  const bytes = Array.from(createHash("sha256").update(text, "utf8").digest());
  switch (style) {
    case "uint8":
      return Uint8Array.from(bytes);
    case "signed":
      // Java byte[] semantics: values above 127 come back negative.
      return bytes.map((b) => (b > 127 ? b - 256 : b));
    case "no-map": {
      // Array-like without array methods (length + index access only).
      const bare: Record<number, number> & { length: number } = { length: bytes.length };
      bytes.forEach((b, i) => {
        bare[i] = b > 127 ? b - 256 : b;
      });
      return bare;
    }
    default:
      return bytes;
  }
}

function harness(options: HarnessOptions = {}) {
  const text = options.text ?? "Lumora Glow Serum makes your skin miracle-bright overnight.";
  const docId = options.docId ?? "doc_abc123";
  const title = options.title ?? "Q4 caption";
  const digestStyle = options.digestStyle ?? "plain";
  const respond: Responder =
    options.respond ??
    (() => ({ code: 200, body: { ok: true } }));

  const props = new Map<string, string>(Object.entries(options.props ?? {}));
  const calls: FetchCall[] = [];

  // --- document mock -------------------------------------------------------
  const bg: Array<string | null> = text.split("").map(() => null);
  for (const range of options.paint ?? []) {
    for (let i = range.start; i <= range.end; i++) bg[i] = range.color;
  }
  const applied: Array<{ start: number; end: number; color: string | null }> = [];

  const textApi = {
    getText: () => text,
    getBackgroundColor: (i: number) => bg[i],
    setBackgroundColor: (start: number, end: number, color: string | null) => {
      for (let i = start; i <= end; i++) bg[i] = color;
      applied.push({ start, end, color });
    },
  };

  const body = {
    getText: () => text,
    /** DocumentApp.findText takes a regex pattern string. */
    findText: (pattern: string) => {
      const re = new RegExp(pattern, "g");
      const match = re.exec(text);
      if (!match) return null;
      const start = match.index;
      const end = start + match[0].length - 1;
      return {
        getElement: () => ({
          asText: () => ({
            setBackgroundColor: (s: number, e: number, color: string | null) => {
              for (let i = s; i <= e; i++) bg[i] = color;
              applied.push({ start: s, end: e, color });
            },
          }),
        }),
        getStartOffset: () => start,
        getEndOffsetInclusive: () => end,
      };
    },
    editAsText: () => textApi,
  };

  const menuItems: string[] = [];
  const DocumentApp = {
    getActiveDocument: () => ({
      getId: () => docId,
      getName: () => title,
      getBody: () => body,
    }),
    getUi: () => ({
      createMenu: (label: string) => {
        menuItems.push(`menu:${label}`);
        const chain = {
          addItem: (item: string) => {
            menuItems.push(`item:${item}`);
            return chain;
          },
          addToUi: () => undefined,
        };
        return chain;
      },
      showSidebar: () => undefined,
    }),
  };

  // --- services ------------------------------------------------------------
  const PropertiesService = {
    getUserProperties: () => ({
      getProperty: (k: string) => (props.has(k) ? (props.get(k) as string) : null),
      setProperty: (k: string, v: string) => void props.set(k, String(v)),
      deleteProperty: (k: string) => void props.delete(k),
    }),
  };

  const UrlFetchApp = {
    fetch: (url: string, opts: FetchCall["options"]) => {
      calls.push({ url, options: opts });
      const res = respond(url, opts);
      const bodyText =
        typeof res.body === "string" ? res.body : JSON.stringify(res.body ?? null);
      return {
        getResponseCode: () => res.code,
        getContentText: () => bodyText,
        getHeader: (name: string) =>
          res.headers?.[name.toLowerCase()] ?? res.headers?.[name] ?? null,
      };
    },
  };

  const Utilities = {
    DigestAlgorithm: { SHA_256: "SHA_256" },
    Charset: { UTF_8: "UTF_8" },
    computeDigest: (_alg: string, value: string) => digestBytes(digestStyle, value),
  };

  const HtmlService = {
    createHtmlOutputFromFile: () => ({ setTitle: () => undefined }),
  };

  const names = [
    "PropertiesService",
    "DocumentApp",
    "UrlFetchApp",
    "Utilities",
    "HtmlService",
  ];
  const factory = new Function(
    ...names,
    `${source}
     return {
       onOpen, showSidebar, getSettings, saveSettings, clearSettings, readDocument,
       submitDocument, fetchStatus, fetchFindings, decideFinding, decideSubmission,
       highlightSpan, clearHighlights, digest_, escapeForFind_
     };`,
  ) as (...args: unknown[]) => CodeApi;

  const code = factory(
    PropertiesService,
    DocumentApp,
    UrlFetchApp,
    Utilities,
    HtmlService,
  );

  return { code, calls, props, bg, applied, menuItems };
}

const CONFIGURED = { apiBase: API_BASE, apiKey: API_KEY };

function apiError(code: string, message: string) {
  return { error: { code, message, requestId: "req_test" } };
}

describe("Google Docs sidebar: settings", () => {
  it("rejects a base URL without a scheme and a missing key", () => {
    const { code } = harness();
    expect(code.saveSettings("example.test", API_KEY).ok).toBe(false);
    expect(code.saveSettings(API_BASE, "  ").ok).toBe(false);
    const saved = code.saveSettings(`${API_BASE}/`, API_KEY);
    expect(saved.ok).toBe(true);
    expect(code.getSettings().configured).toBe(true);
    // Trailing slash is stripped so paths concatenate cleanly.
    expect(code.getSettings().apiBase).toBe(API_BASE);
  });

  it("refuses to call the API before settings exist", () => {
    const { code, calls } = harness({ props: {} });
    const res = code.submitDocument("instagram", "Social");
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/API base URL and key/);
    expect(calls.length).toBe(0);
  });
});

describe("Google Docs sidebar: submitDocument", () => {
  it("reports an empty or whitespace-only document without calling the API", () => {
    for (const text of ["", "   \n\t  \n"]) {
      const { code, calls } = harness({ props: CONFIGURED, text });
      const res = code.submitDocument("instagram", "Social");
      expect(res.ok).toBe(false);
      expect(res.error).toBe("This document is empty.");
      expect(calls.length).toBe(0);
    }
  });

  it("refuses an oversize document before the request is made", () => {
    const { code, calls } = harness({
      props: CONFIGURED,
      text: "a".repeat(20_001),
    });
    const res = code.submitDocument("instagram", "Social");
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/20,000/);
    expect(calls.length).toBe(0);
  });

  it("sends the documented body, bearer key and idempotency key, and never follows redirects", () => {
    const { code, calls } = harness({
      props: CONFIGURED,
      respond: () => ({ code: 202, body: { id: "sub_1", status: "draft" } }),
    });
    const res = code.submitDocument("email", "Email");
    expect(res.ok).toBe(true);
    expect(res.submissionId).toBe("sub_1");
    expect(calls.length).toBe(1);

    const call = calls[0];
    expect(call.url).toBe(`${API_BASE}/api/v1/submissions`);
    expect(call.options.method).toBe("post");
    // The bearer key must not be replayed to a redirect target.
    expect(call.options.followRedirects).toBe(false);
    expect(call.options.headers?.Authorization).toBe(`Bearer ${API_KEY}`);
    expect(call.options.headers?.["Idempotency-Key"]).toMatch(/^gdoc-[0-9a-f]{40}$/);

    const body = JSON.parse(call.options.payload ?? "{}") as Record<string, unknown>;
    expect(body.channel).toBe("email");
    expect(body.team).toBe("Email");
    expect(body.text).toContain("Lumora Glow Serum");
    expect(body.externalRef).toBe("doc_abc123");
    expect(res.chars).toBe((body.text as string).length);
  });

  it("derives a stable idempotency key for identical content", () => {
    const respond = () => ({ code: 202, body: { id: "sub_1", status: "draft" } });
    const first = harness({ props: CONFIGURED, respond });
    const second = harness({ props: CONFIGURED, respond });
    const a = first.code.submitDocument("instagram", "Social");
    const b = second.code.submitDocument("instagram", "Social");
    expect(a.ok && b.ok).toBe(true);
    expect(a.idempotencyKey).toBe(b.idempotencyKey);
    expect(a.idempotencyKey).toMatch(/^gdoc-[0-9a-f]{40}$/);
  });

  it("changes the key whenever any field of the request body changes", () => {
    // The API rejects a reused key with a different body (409), so the key has
    // to move with text, channel, team and title alike.
    const respond = () => ({ code: 202, body: { id: "sub_1", status: "draft" } });
    const base = harness({ props: CONFIGURED, respond });
    const key = (h: ReturnType<typeof harness>, channel = "instagram", team = "Social") =>
      h.code.submitDocument(channel, team).idempotencyKey;

    const baseline = key(base);
    expect(baseline).toBeDefined();

    const textChanged = harness({
      props: CONFIGURED,
      respond,
      text: "Different copy entirely.",
    });
    expect(key(textChanged)).not.toBe(baseline);

    const titleChanged = harness({ props: CONFIGURED, respond, title: "Renamed doc" });
    expect(key(titleChanged)).not.toBe(baseline);

    // Same document, same text, different channel: a second review, not a replay.
    expect(key(base, "email", "Social")).not.toBe(baseline);
    expect(key(base, "instagram", "Email")).not.toBe(baseline);

    // Re-submitting the same combination still replays.
    const repeat = harness({ props: CONFIGURED, respond });
    expect(key(repeat)).toBe(baseline);
  });

  it("builds the same digest from every byte-array shape", () => {
    const expected = createHash("sha256").update("payload", "utf8").digest("hex");
    for (const style of ["plain", "signed", "uint8", "no-map"] as DigestStyle[]) {
      const { code } = harness({ props: CONFIGURED, digestStyle: style });
      expect(code.digest_("payload")).toBe(expected);
    }
  });

  it("derives the same key whatever byte-array shape the runtime returns", () => {
    const keys = (["plain", "signed", "uint8", "no-map"] as DigestStyle[]).map((style) => {
      const h = harness({
        props: CONFIGURED,
        digestStyle: style,
        respond: () => ({ code: 202, body: { id: "sub_9", status: "draft" } }),
      });
      const res = h.code.submitDocument("instagram", "Social");
      expect(res.ok).toBe(true);
      expect(res.idempotencyKey).toMatch(/^gdoc-[0-9a-f]{40}$/);
      return res.idempotencyKey;
    });
    expect(new Set(keys).size).toBe(1);
  });
});

describe("Google Docs sidebar: status and findings", () => {
  it("reads the status payload the API returns", () => {
    const { code } = harness({
      props: CONFIGURED,
      respond: () => ({
        code: 200,
        body: {
          id: "sub_1",
          status: "human_review",
          degraded: true,
          degradedCause: "model quota",
        },
      }),
    });
    const res = code.fetchStatus("sub_1");
    expect(res.ok).toBe(true);
    expect((res.run as { status: string }).status).toBe("human_review");
    expect((res.run as { degraded: boolean }).degraded).toBe(true);
  });

  it("returns an empty list when the run has no findings", () => {
    const { code } = harness({
      props: CONFIGURED,
      respond: () => ({ code: 200, body: { submissionId: "sub_1", status: "approved" } }),
    });
    const res = code.fetchFindings("sub_1");
    expect(res.ok).toBe(true);
    expect(res.findings).toEqual([]);
  });

  it("encodes the submission id in the path", () => {
    const { code, calls } = harness({
      props: CONFIGURED,
      respond: () => ({ code: 200, body: { submissionId: "sub 1/x", status: "draft" } }),
    });
    code.fetchStatus("sub 1/x");
    code.fetchFindings("sub 1/x");
    expect(calls[0].url).toBe(`${API_BASE}/api/v1/submissions/sub%201%2Fx`);
    expect(calls[1].url).toBe(`${API_BASE}/api/v1/submissions/sub%201%2Fx/findings`);
  });
});

describe("Google Docs sidebar: API errors", () => {
  const cases: Array<{ code: number; apiCode: string; message: string; via: string }> = [
    {
      code: 401,
      apiCode: "unauthorized",
      message: "That API key is revoked.",
      via: "status",
    },
    {
      code: 403,
      apiCode: "forbidden",
      message: "A creator key cannot make a submission-level decision.",
      via: "approve",
    },
    {
      code: 409,
      apiCode: "conflict",
      message: "This Idempotency-Key was used with a different request body.",
      via: "submit",
    },
    {
      code: 429,
      apiCode: "rate_limited",
      message: "Rate limit is 60 requests per minute for this key.",
      via: "findings",
    },
  ];

  for (const testCase of cases) {
    it(`surfaces ${testCase.code} ${testCase.apiCode} with the API message and never throws`, () => {
      const { code, calls } = harness({
        props: CONFIGURED,
        respond: () => ({
          code: testCase.code,
          body: apiError(testCase.apiCode, testCase.message),
          headers: testCase.code === 429 ? { "retry-after": "42" } : undefined,
        }),
      });

      let res: { ok: boolean; error?: string };
      if (testCase.via === "status") {
        res = code.fetchStatus("sub_1");
      } else if (testCase.via === "findings") {
        res = code.fetchFindings("sub_1");
      } else if (testCase.via === "submit") {
        res = code.submitDocument("instagram", "Social");
      } else {
        res = code.decideSubmission("sub_1", "approve", "");
      }

      expect(res.ok).toBe(false);
      expect(res.error).toContain(testCase.message);
      expect(res.error).toContain(testCase.apiCode);
      expect(calls.length).toBe(1);
      if (testCase.code === 429) {
        expect(res.error).toMatch(/retry/i);
        expect(res.error).toContain("42");
      }
    });
  }

  it("shows a readable message when the body is not JSON", () => {
    const { code } = harness({
      props: CONFIGURED,
      respond: () => ({ code: 502, body: "<html>bad gateway</html>" }),
    });
    const res = code.fetchStatus("sub_1");
    expect(res.ok).toBe(false);
    expect(res.error).toBe("Request failed (502)");
  });

  it("records a finding decision with the reason only when one is given", () => {
    const { code, calls } = harness({
      props: CONFIGURED,
      respond: () => ({ code: 200, body: { findingId: "f1", status: "accepted" } }),
    });
    const withReason = code.decideFinding("sub_1", "f1", "reject", "not in ledger");
    expect(withReason.ok).toBe(true);
    const withoutReason = code.decideFinding("sub_1", "f1", "accept");
    expect(withoutReason.ok).toBe(true);

    const first = JSON.parse(calls[0].options.payload ?? "{}") as Record<string, unknown>;
    expect(first).toEqual({
      findingId: "f1",
      decision: "reject",
      reason: "not in ledger",
    });
    const second = JSON.parse(calls[1].options.payload ?? "{}") as Record<string, unknown>;
    expect(second).toEqual({ findingId: "f1", decision: "accept" });
    expect(calls[1].url).toBe(`${API_BASE}/api/v1/submissions/sub_1/decision`);
  });
});

describe("Google Docs sidebar: highlighting", () => {
  it("colours the quoted span with the severity colour", () => {
    const text = "The Lumora Glow Serum erases wrinkles in one night.";
    const { code, applied, bg } = harness({ props: CONFIGURED, text });
    const res = code.highlightSpan("erases wrinkles", "critical");
    expect(res.ok).toBe(true);
    expect(applied.length).toBe(1);
    expect(applied[0].color).toBe("#F3C9C4");
    const start = text.indexOf("erases wrinkles");
    for (let i = start; i < start + "erases wrinkles".length; i++) {
      expect(bg[i]).toBe("#F3C9C4");
    }
  });

  it("matches a span containing regex metacharacters and newlines", () => {
    const text = "Clinically proven (in a 12-week study) to erase 100% of lines.";
    const { code, applied } = harness({ props: CONFIGURED, text });
    const res = code.highlightSpan("(in a 12-week study) to erase 100%", "high");
    expect(res.ok).toBe(true);
    expect(applied.length).toBe(1);
    expect(applied[0].color).toBe("#F6DCC0");
  });

  it("reports a missing span instead of colouring the wrong words", () => {
    const { code, applied } = harness({ props: CONFIGURED });
    const res = code.highlightSpan("a sentence that is no longer there", "high");
    expect(res.ok).toBe(false);
    expect(res.error).toBe("text changed, re-run the review");
    expect(applied.length).toBe(0);
  });

  it("rejects a finding with no quoted text", () => {
    const { code } = harness({ props: CONFIGURED });
    expect(code.highlightSpan("", "high").ok).toBe(false);
    expect(code.highlightSpan("   ", "high").ok).toBe(false);
  });

  it("clears only BrandSentinel colours and reports how many characters", () => {
    const text = "Lumora Glow Serum, morning routine.";
    const { code, bg } = harness({
      props: CONFIGURED,
      text,
      paint: [
        { start: 0, end: 5, color: "#F3C9C4" },
        { start: 7, end: 11, color: "#f6dcc0" },
        { start: 20, end: 22, color: "#123456" },
      ],
    });
    const res = code.clearHighlights();
    expect(res.ok).toBe(true);
    expect(res.cleared).toBe(11);
    expect(bg[0]).toBeNull();
    expect(bg[11]).toBeNull();
    // Somebody else's highlight stays put.
    expect(bg[20]).toBe("#123456");
    expect(PALETTE.length).toBe(4);
  });
});
