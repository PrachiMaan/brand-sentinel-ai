import { createHmac, timingSafeEqual } from "node:crypto";
import { describe, expect, it } from "bun:test";
import {
  buildPayload,
  checkEndpointUrl,
  headerValue,
  hmacHex,
  MAX_ATTEMPTS,
  nextAttemptAt,
  RETRY_SCHEDULE_MS,
  safeEqual,
  signatureHex,
} from "../src/convex/lib/webhooks";

describe("webhook signing", () => {
  it("matches node's HMAC-SHA256 over `timestamp.body`", () => {
    const secret = "whsec_test_secret_value";
    const ts = 1_760_000_000;
    const body = JSON.stringify({ type: "approved", submissionId: "abc" });
    const expected = createHmac("sha256", secret).update(`${ts}.${body}`).digest("hex");
    expect(signatureHex(secret, ts, body)).toBe(expected);
  });

  it("renders the documented header format", () => {
    const header = headerValue("s", 1760000000, "{}");
    expect(header).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/);
  });

  it("safeEqual behaves like a constant-time compare", () => {
    const a = signatureHex("s", 1, "{}");
    expect(safeEqual(a, a)).toBe(true);
    const nodeCompare = timingSafeEqual(Buffer.from(a), Buffer.from(a));
    expect(nodeCompare).toBe(true);
    expect(safeEqual(a, a.slice(0, -1) + "0")).toBe(false);
    expect(safeEqual(a, "")).toBe(false);
  });

  it("hmacHex agrees with node for hex-encoded keys too", () => {
    const key = "deadbeef";
    const expected = createHmac("sha256", Buffer.from(key, "hex")).update("msg").digest("hex");
    expect(hmacHex(key, "msg", "hex")).toBe(expected);
  });
});

describe("webhook retry schedule", () => {
  it("backs off 1m, 5m, 30m, 2h, 6h then stops", () => {
    expect(RETRY_SCHEDULE_MS).toEqual([60_000, 300_000, 1_800_000, 7_200_000, 21_600_000]);
    expect(MAX_ATTEMPTS).toBe(RETRY_SCHEDULE_MS.length + 1);
    const now = 1_000;
    expect(nextAttemptAt(1, now)).toBe(now + 60_000);
    expect(nextAttemptAt(5, now)).toBe(now + 21_600_000);
    expect(nextAttemptAt(6, now)).toBeNull();
  });
});

describe("SSRF guard", () => {
  it("rejects private, loopback and link-local targets", () => {
    expect(checkEndpointUrl("https://10.0.0.5/hook").ok).toBe(false);
    expect(checkEndpointUrl("https://192.168.1.9/hook").ok).toBe(false);
    expect(checkEndpointUrl("https://172.16.0.1/hook").ok).toBe(false);
    expect(checkEndpointUrl("https://127.0.0.1/hook").ok).toBe(false);
    expect(checkEndpointUrl("https://169.254.169.254/latest/meta-data").ok).toBe(false);
    expect(checkEndpointUrl("https://0.0.0.0/hook").ok).toBe(false);
  });

  it("rejects non-http schemes and missing hosts", () => {
    expect(checkEndpointUrl("javascript:alert(1)").ok).toBe(false);
    expect(checkEndpointUrl("ftp://example.com/x").ok).toBe(false);
    expect(checkEndpointUrl("not a url").ok).toBe(false);
  });

  it("allows a public https endpoint and localhost for development", () => {
    expect(checkEndpointUrl("https://hooks.example.com/brand").ok).toBe(true);
    expect(checkEndpointUrl("http://localhost:8787/hook").ok).toBe(true);
    expect(checkEndpointUrl("http://127.0.0.1:8787/hook").ok).toBe(true);
  });
});

describe("payload", () => {
  it("builds a deterministic event id and a findings URL", () => {
    const payload = buildPayload({
      eventId: "evt_1",
      type: "findings_ready",
      workspace: "Lumora Studio",
      submissionId: "sub_1",
      status: "findings_ready",
      counts: { critical: 1, high: 2 },
      baseUrl: "https://example.com",
      createdAt: 1_760_000_000_000,
    });
    expect(payload.id).toBe("evt_1");
    expect(payload.findingsUrl).toBe("https://example.com/api/v1/submissions/sub_1/findings");
    expect(payload.createdAt).toBe(new Date(1_760_000_000_000).toISOString());
    expect(JSON.parse(JSON.stringify(payload))).toEqual(payload);
  });
});
