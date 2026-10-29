import { afterAll, describe, expect, it } from "bun:test";
import { deliver } from "../src/convex/webhookDeliver";
import { recordAttempt } from "../src/convex/webhookInternal";
import {
  headerValue,
  MAX_ATTEMPTS,
  RETRY_SCHEDULE_MS,
  safeEqual,
  signatureHex,
} from "../src/convex/lib/webhooks";

/**
 * Delivery is exercised against a real local HTTP receiver through the real
 * action handler, and retry/dead-letter through the real recordAttempt
 * mutation with an in-memory database. A Convex deployment cannot reach this
 * sandbox, so a live cloud delivery is not possible; this covers the code path.
 */

const SECRET = "whsec_local_receiver_test";
const PAYLOAD = JSON.stringify({
  id: "evt_local_1",
  type: "approved",
  submissionId: "sub_1",
  status: "approved",
  summary: { total: 2 },
});

type Received = {
  body: string;
  signature: string | null;
  event: string | null;
  delivery: string | null;
  valid: boolean;
  timestamp: number;
};

let received: Received[] = [];
let respondWith = 200;

const server = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  async fetch(request) {
    const body = await request.text();
    const header = request.headers.get("x-brandsentinel-signature");
    const parts = Object.fromEntries(
      (header ?? "").split(",").map((part) => part.split("=", 2)),
    );
    const timestamp = Number(parts.t ?? 0);
    const expected = signatureHex(SECRET, timestamp, body);
    received.push({
      body,
      signature: header,
      event: request.headers.get("x-brandsentinel-event"),
      delivery: request.headers.get("x-brandsentinel-delivery"),
      valid: safeEqual(expected, parts.v1 ?? ""),
      timestamp,
    });
    return new Response(JSON.stringify({ ok: respondWith === 200 }), {
      status: respondWith,
      headers: { "content-type": "application/json" },
    });
  },
});

afterAll(() => {
  server.stop(true);
});

type Attempt = { ok?: boolean; responseCode?: number; error?: string };

type DeliveryDoc = {
  _id: string;
  workspaceId: string;
  eventId: string;
  eventType: string;
  payload: string;
  idempotencyKey: string;
  endpointId: string;
  attempt: number;
  status: string;
  createdAt: number;
  nextAttemptAt?: number;
  responseCode?: number;
  error?: string;
  deliveredAt?: number;
};

function deliveryCtx(url: string) {
  const attempts: Attempt[] = [];
  const ctx = {
    runQuery: async () => ({
      url,
      secret: SECRET,
      payload: PAYLOAD,
      eventType: "approved",
      idempotencyKey: "evt_local_1:endpoint_1",
    }),
    runMutation: async (_fn: unknown, args: Attempt) => {
      attempts.push(args);
      return null;
    },
  };
  return { ctx, attempts };
}

function mutationCtx(row: DeliveryDoc) {
  const rows: Record<string, DeliveryDoc> = { delivery_1: row };
  const audit: { action?: string }[] = [];
  const scheduled: { ms: number; args: unknown }[] = [];
  const ctx = {
    db: {
      get: async (id: string) => rows[id] ?? null,
      patch: async (id: string, patch: Partial<DeliveryDoc>) => {
        rows[id] = { ...rows[id], ...patch } as DeliveryDoc;
        return null;
      },
      insert: async (table: string, doc: { action?: string }) => {
        if (table === "auditEvents") audit.push(doc);
        return "audit_1";
      },
      query: () => ({
        withIndex: () => ({
          order: () => ({
            first: async () => null,
            take: async () => [],
          }),
          first: async () => null,
          collect: async () => [],
        }),
      }),
    },
    scheduler: {
      runAfter: async (ms: number, _fn: unknown, args: unknown) => {
        scheduled.push({ ms, args });
        return null;
      },
    },
  };
  return { ctx, rows, audit, scheduled };
}

type DeliveryResult = { status: string; responseCode?: number; error?: string };
const handler = (
  deliver as unknown as {
    _handler: (ctx: unknown, args: { deliveryId: string }) => Promise<DeliveryResult>;
  }
)._handler;
const record = (
  recordAttempt as unknown as {
    _handler: (ctx: unknown, args: Record<string, unknown>) => Promise<void>;
  }
)._handler;
const localUrl = `http://127.0.0.1:${server.port}/hook`;

describe("webhook delivery against a local receiver", () => {
  it("signs the request with the documented scheme and delivers", async () => {
    received = [];
    respondWith = 200;
    const { ctx, attempts } = deliveryCtx(localUrl);
    const result = await handler(ctx, { deliveryId: "delivery_1" });
    expect(result.status).toBe("delivered");
    expect(result.responseCode).toBe(200);
    expect(received).toHaveLength(1);
    expect(received[0].valid).toBe(true);
    expect(received[0].body).toBe(PAYLOAD);
    expect(received[0].event).toBe("approved");
    expect(received[0].delivery).toBe("evt_local_1:endpoint_1");
    expect(received[0].signature).toBe(
      headerValue(SECRET, received[0].timestamp, PAYLOAD),
    );
    expect(attempts[0]).toMatchObject({ ok: true, responseCode: 200 });
  });

  it("records a failure when the receiver returns 500", async () => {
    received = [];
    respondWith = 500;
    const { ctx, attempts } = deliveryCtx(localUrl);
    const result = await handler(ctx, { deliveryId: "delivery_1" });
    expect(result.status).toBe("failed");
    expect(result.responseCode).toBe(500);
    expect(attempts[0]).toMatchObject({ ok: false, responseCode: 500 });
  });

  it("reports a transport error when the receiver is gone", async () => {
    respondWith = 200;
    const dead = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("") });
    const url = `http://127.0.0.1:${dead.port}/hook`;
    dead.stop(true);
    const { ctx, attempts } = deliveryCtx(url);
    const result = await handler(ctx, { deliveryId: "delivery_1" });
    expect(result.status).toBe("failed");
    expect(String(result.error ?? "")).not.toBe("");
    expect(attempts[0].ok).toBe(false);
  });
});

describe("retry and dead-letter through the real recordAttempt", () => {
  it("schedules the next backoff after the first failure", async () => {
    const { ctx, rows, scheduled, audit } = mutationCtx({
      _id: "delivery_1",
      workspaceId: "ws_1",
      eventId: "evt_local_1",
      eventType: "approved",
      payload: PAYLOAD,
      idempotencyKey: "evt_local_1:endpoint_1",
      endpointId: "endpoint_1",
      attempt: 1,
      status: "pending",
      createdAt: Date.now(),
    });
    const before = Date.now();
    await record(ctx, {
      deliveryId: "delivery_1",
      ok: false,
      responseCode: 500,
      error: "HTTP 500",
    });
    expect(rows.delivery_1.status).toBe("failed");
    expect(rows.delivery_1.nextAttemptAt).toBeGreaterThan(before + 55_000);
    expect(rows.delivery_1.nextAttemptAt).toBeLessThan(before + 65_000);
    expect(scheduled).toHaveLength(1);
    expect(scheduled[0].ms).toBeGreaterThan(30_000);
    expect(audit[0]?.action).toBe("webhook.retry_scheduled");
  });

  it("walks the full schedule and dead-letters the last attempt", async () => {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const { ctx, rows, scheduled } = mutationCtx({
        _id: "delivery_1",
        workspaceId: "ws_1",
        eventId: "evt_local_1",
        eventType: "approved",
        payload: PAYLOAD,
        idempotencyKey: "evt_local_1:endpoint_1",
        endpointId: "endpoint_1",
        attempt,
        status: "pending",
        createdAt: Date.now(),
      });
      await record(ctx, {
        deliveryId: "delivery_1",
        ok: false,
        responseCode: 503,
        error: "HTTP 503",
      });
      if (attempt < MAX_ATTEMPTS) {
        expect(rows.delivery_1.status).toBe("failed");
        expect(rows.delivery_1.nextAttemptAt).toBeDefined();
        expect(scheduled).toHaveLength(1);
      } else {
        expect(rows.delivery_1.status).toBe("dead");
        expect(rows.delivery_1.nextAttemptAt).toBeUndefined();
        expect(scheduled).toHaveLength(0);
      }
    }
    expect(RETRY_SCHEDULE_MS).toHaveLength(MAX_ATTEMPTS - 1);
  });

  it("marks a successful retry as delivered and stops scheduling", async () => {
    const { ctx, rows, scheduled } = mutationCtx({
      _id: "delivery_1",
      workspaceId: "ws_1",
      eventId: "evt_local_1",
      eventType: "approved",
      payload: PAYLOAD,
      idempotencyKey: "evt_local_1:endpoint_1",
      endpointId: "endpoint_1",
      attempt: 2,
      status: "failed",
      createdAt: Date.now(),
    });
    await record(ctx, { deliveryId: "delivery_1", ok: true, responseCode: 200 });
    expect(rows.delivery_1.status).toBe("delivered");
    expect(scheduled).toHaveLength(0);
  });
});
