/**
 * Webhook signing and endpoint vetting.
 *
 * The signature is HMAC-SHA256 over `${timestamp}.${body}` with the endpoint
 * secret, sent as:
 *   X-BrandSentinel-Signature: t=<unix seconds>,v1=<hex>
 * Receivers should reject anything older than five minutes and compare with a
 * constant-time check.
 */

import { sha256Bytes } from "./sha256";

export const RETRY_SCHEDULE_MS = [60_000, 300_000, 1_800_000, 7_200_000, 21_600_000];
export const MAX_ATTEMPTS = RETRY_SCHEDULE_MS.length + 1;

const PRIVATE_HOST =
  /^(localhost|127\.|0\.0\.0\.0|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?$)/i;

export type EndpointCheck = { ok: true; url: string } | { ok: false; reason: string };

/**
 * Only https endpoints are accepted outside development. Private, loopback and
 * link-local addresses are refused so a key holder cannot use the webhook
 * delivery service as an internal network probe.
 */
export function checkEndpointUrl(raw: string, allowHttpLocalhost = true): EndpointCheck {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: "That is not a valid URL." };
  }
  if (url.protocol === "http:") {
    const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    if (!(allowHttpLocalhost && local)) {
      return { ok: false, reason: "Webhook endpoints must use https." };
    }
  } else if (url.protocol !== "https:") {
    return { ok: false, reason: "Webhook endpoints must use https." };
  }
  if (PRIVATE_HOST.test(url.hostname)) {
    const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    if (!(allowHttpLocalhost && local && url.protocol === "http:")) {
      return { ok: false, reason: "Private and loopback addresses are not allowed." };
    }
  }
  if (url.username || url.password) {
    return { ok: false, reason: "Credentials in the URL are not allowed." };
  }
  return { ok: true, url: url.toString() };
}

export type WebhookPayload = {
  id: string;
  type: "findings_ready" | "approved" | "test";
  workspace: string;
  submissionId: string;
  status: string;
  summary: Record<string, number>;
  findingsUrl: string;
  createdAt: string;
};

export function buildPayload(args: {
  eventId: string;
  type: WebhookPayload["type"];
  workspace: string;
  submissionId: string;
  status: string;
  counts: Record<string, number>;
  baseUrl: string;
  createdAt?: number;
}): WebhookPayload {
  return {
    id: args.eventId,
    type: args.type,
    workspace: args.workspace,
    submissionId: args.submissionId,
    status: args.status,
    summary: args.counts,
    findingsUrl: `${args.baseUrl}/api/v1/submissions/${args.submissionId}/findings`,
    createdAt: new Date(args.createdAt ?? Date.now()).toISOString(),
  };
}

/** Hex HMAC-SHA256 over `timestamp.body`. */
export function signatureHex(secret: string, timestamp: number, body: string): string {
  return hmacHex(secret, `${timestamp}.${body}`);
}

/**
 * HMAC implementation that works in both the V8 runtime and Node, so signing
 * and verifying use one implementation everywhere.
 */
export function hmacHex(secret: string, message: string, keyEncoding: "utf8" | "hex" = "utf8") {
  const key = keyEncoding === "hex" ? hexToBytes(secret) : new TextEncoder().encode(secret);
  const msg = new TextEncoder().encode(message);
  const blockSize = 64;
  let padded: Uint8Array<ArrayBufferLike> = key;
  if (key.length > blockSize)    padded = sha256Bytes(key);
  if (padded.length < blockSize) {
    const grown = new Uint8Array(blockSize);
    grown.set(padded);
    padded = grown;
  }
  const inner = new Uint8Array(blockSize + msg.length);
  const outer = new Uint8Array(blockSize + 32);
  for (let i = 0; i < blockSize; i++) {
    inner[i] = padded[i] ^ 0x36;
    outer[i] = padded[i] ^ 0x5c;
  }
  inner.set(msg, blockSize);
  outer.set(sha256Bytes(inner), blockSize);
  return toHex(sha256Bytes(outer));
}

export function headerValue(secret: string, timestamp: number, body: string) {
  return `t=${timestamp},v1=${signatureHex(secret, timestamp, body)}`;
}

/** Constant-time comparison, used by the documented verification snippet. */
export function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function nextAttemptAt(attempt: number, now = Date.now()): number | null {
  const delay = RETRY_SCHEDULE_MS[attempt - 1];
  return delay === undefined ? null : now + delay;
}

function hexToBytes(hex: string) {
  const clean = hex.trim();
  const out = new Uint8Array(Math.floor(clean.length / 2));
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function toHex(bytes: Uint8Array) {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
