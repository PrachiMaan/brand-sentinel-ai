import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { sha256Hex } from "./lib/sha256";

/**
 * /api/v1. Bearer key auth, workspace scoping, idempotent creation and the same
 * state machine as the web app. Errors always use one shape:
 *   { "error": { "code", "message", "requestId" } }
 */

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,OPTIONS",
  "access-control-allow-headers": "authorization,content-type,idempotency-key",
  "access-control-expose-headers": "x-request-id,retry-after",
};

let counter = 0;
function requestId() {
  counter += 1;
  return `req_${Date.now().toString(36)}_${counter}`;
}

function json(body: unknown, status = 200, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...CORS, ...extra },
  });
}

function fail(code: string, message: string, status: number, id: string, extra = {}) {
  return json({ error: { code, message, requestId: id } }, status, extra);
}

const STATUS_FOR_CODE: Record<string, number> = {
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  payload_too_large: 413,
  unprocessable: 422,
  rate_limited: 429,
  bad_request: 400,
};

export const openapi = {
  openapi: "3.1.0",
  info: {
    title: "BrandSentinel Review API",
    version: "1.0.0",
    description:
      "Submit content, read evidence-backed findings and record human decisions. Keys are scoped creator, reviewer or approver and work only inside their workspace.",
  },
  servers: [{ url: "/api/v1" }],
  components: {
    securitySchemes: {
      bearer: { type: "http", scheme: "bearer", bearerFormat: "bss_live_…" },
    },
    schemas: {
      Error: {
        type: "object",
        required: ["error"],
        properties: {
          error: {
            type: "object",
            required: ["code", "message", "requestId"],
            properties: {
              code: { type: "string" },
              message: { type: "string" },
              requestId: { type: "string" },
            },
          },
        },
      },
      Submission: {
        type: "object",
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          status: {
            type: "string",
            enum: [
              "draft",
              "ai_review",
              "findings_ready",
              "human_review",
              "needs_revision",
              "approved",
              "rejected",
              "receipt_exported",
            ],
          },
          degraded: { type: "boolean" },
          degradedCause: { type: ["string", "null"] },
          counts: { type: "object", additionalProperties: { type: "number" } },
        },
      },
      Finding: {
        type: "object",
        properties: {
          id: { type: "string" },
          reviewer: { type: "string" },
          severity: { type: "string", enum: ["critical", "high", "medium", "low"] },
          confidence: { type: "number" },
          spanText: { type: "string" },
          spanStart: { type: "number" },
          spanEnd: { type: "number" },
          ruleId: { type: "string" },
          guidelineExcerpt: { type: "string" },
          whyItMatters: { type: "string" },
          suggestedFix: { type: "string" },
          status: { type: "string" },
          measured: { type: ["string", "null"] },
          page: { type: ["number", "null"] },
        },
      },
    },
  },
  security: [{ bearer: [] }],
  paths: {
    "/submissions": {
      post: {
        summary: "Create a submission and start the review",
        parameters: [
          {
            name: "Idempotency-Key",
            in: "header",
            required: true,
            schema: { type: "string" },
          },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["text", "channel"],
                properties: {
                  title: { type: "string" },
                  text: { type: "string", maxLength: 20000 },
                  channel: {
                    type: "string",
                    enum: ["instagram", "email", "linkedin", "landing", "print"],
                  },
                  audience: { type: "string" },
                  team: { type: "string", enum: ["Social", "Email", "Web", "Paid"] },
                  externalRef: { type: "string" },
                },
              },
            },
          },
        },
        responses: {
          "202": { description: "Accepted" },
          "400": { description: "Missing idempotency key or invalid JSON" },
          "401": { description: "Missing or revoked key" },
          "409": { description: "Idempotency key reused with a different body" },
          "413": { description: "Content too large" },
          "429": { description: "Rate limited" },
        },
      },
    },
    "/submissions/{id}": {
      get: {
        summary: "Submission status",
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
        ],
        responses: { "200": { description: "Status" }, "404": { description: "Not found" } },
      },
    },
    "/submissions/{id}/findings": {
      get: {
        summary: "Verified findings for the current version",
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
        ],
        responses: { "200": { description: "Findings" }, "404": { description: "Not found" } },
      },
    },
    "/submissions/{id}/decision": {
      post: {
        summary: "Record a finding or submission decision",
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["decision"],
                properties: {
                  findingId: { type: "string" },
                  decision: {
                    type: "string",
                    enum: [
                      "accept",
                      "edit",
                      "reject",
                      "approve",
                      "reject_submission",
                      "needs_revision",
                    ],
                  },
                  reason: { type: "string" },
                  editedFix: { type: "string" },
                },
              },
            },
          },
        },
        responses: {
          "200": { description: "Recorded" },
          "403": { description: "Key scope does not allow this decision" },
          "409": { description: "State conflict, e.g. pending blocking findings" },
        },
      },
    },
    "/openapi.json": { get: { summary: "This document", responses: { "200": { description: "OK" } } } },
  },
};

export const api = httpAction(async (ctx, request) => {
  const id = requestId();
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "");

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }
  if (path === "/api/v1/openapi.json" || path === "/api/v1") {
    return json(openapi);
  }

  const header = request.headers.get("authorization") ?? "";
  const token = header.replace(/^Bearer\s+/i, "").trim();
  if (!token) {
    return fail("unauthorized", "Send Authorization: Bearer <key>.", 401, id);
  }
  const auth = await ctx.runMutation(internal.api.authenticate, {
    keyHash: sha256Hex(token),
  });
  if (!auth.ok) {
    const status = STATUS_FOR_CODE[auth.code] ?? 401;
    return fail(auth.code, auth.message, status, id, {
      ...(auth.code === "rate_limited" ? { "retry-after": String((auth as { retryAfter?: number }).retryAfter ?? 60) } : {}),
    });
  }

  const submissionsMatch = path.match(/^\/api\/v1\/submissions$/);
  if (submissionsMatch && request.method === "POST") {
    const idempotencyKey = request.headers.get("idempotency-key") ?? "";
    if (!idempotencyKey || idempotencyKey.length > 200) {
      return fail("bad_request", "Idempotency-Key is required.", 400, id);
    }
    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return fail("bad_request", "Body must be JSON.", 400, id);
    }
    const text = typeof body.text === "string" ? body.text : "";
    const channel = typeof body.channel === "string" ? body.channel : "";
    const channels = ["instagram", "email", "linkedin", "landing", "print"];
    if (!channels.includes(channel)) {
      return fail("unprocessable", "channel must be one of " + channels.join(", ") + ".", 422, id);
    }
    if (text.length > 20_000) {
      return fail("payload_too_large", "text is over 20,000 characters.", 413, id);
    }
    const teams = ["Social", "Email", "Web", "Paid"];
    const team = typeof body.team === "string" && teams.includes(body.team) ? body.team : "Social";
    const result = await ctx.runMutation(internal.api.createSubmission, {
      keyId: auth.keyId as Id<"apiKeys">,
      title: typeof body.title === "string" ? body.title : "",
      text,
      channel,
      audience: typeof body.audience === "string" ? body.audience : "",
      team,
      externalRef: typeof body.externalRef === "string" ? body.externalRef : undefined,
      idempotencyKey,
      requestHash: sha256Hex(JSON.stringify(body)),
    });
    if ("error" in result && result.error) {
      return fail(
        result.error.code,
        result.error.message,
        STATUS_FOR_CODE[result.error.code] ?? 400,
        id,
      );
    }
    return json(result.response ?? result, 202);
  }

  const idMatch = path.match(/^\/api\/v1\/submissions\/([^/]+)$/);
  if (idMatch && request.method === "GET") {
    const submission = await ctx.runQuery(internal.api.getSubmission, {
      workspaceId: auth.workspaceId as Id<"workspaces">,
      submissionId: idMatch[1] as Id<"submissions">,
    });
    if (!submission) return fail("not_found", "Submission not found.", 404, id);
    return json(submission);
  }

  const findingsMatch = path.match(/^\/api\/v1\/submissions\/([^/]+)\/findings$/);
  if (findingsMatch && request.method === "GET") {
    const findings = await ctx.runQuery(internal.api.getFindings, {
      workspaceId: auth.workspaceId as Id<"workspaces">,
      submissionId: findingsMatch[1] as Id<"submissions">,
    });
    if (!findings) return fail("not_found", "Submission not found.", 404, id);
    return json(findings);
  }

  const decisionMatch = path.match(/^\/api\/v1\/submissions\/([^/]+)\/decision$/);
  if (decisionMatch && request.method === "POST") {
    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return fail("bad_request", "Body must be JSON.", 400, id);
    }
    const allowed = [
      "accept",
      "edit",
      "reject",
      "approve",
      "reject_submission",
      "needs_revision",
    ];
    const decision = typeof body.decision === "string" ? body.decision : "";
    if (!allowed.includes(decision)) {
      return fail("unprocessable", "decision must be one of " + allowed.join(", ") + ".", 422, id);
    }
    const result = await ctx.runMutation(internal.api.decide, {
      keyId: auth.keyId as Id<"apiKeys">,
      submissionId: decisionMatch[1] as Id<"submissions">,
      findingId: typeof body.findingId === "string" ? body.findingId : undefined,
      decision: decision as
        | "accept"
        | "edit"
        | "reject"
        | "approve"
        | "reject_submission"
        | "needs_revision",
      reason: typeof body.reason === "string" ? body.reason : undefined,
      editedFix: typeof body.editedFix === "string" ? body.editedFix : undefined,
    });
    if ("error" in result && result.error) {
      return fail(
        result.error.code,
        result.error.message,
        STATUS_FOR_CODE[result.error.code] ?? 400,
        id,
      );
    }
    return json(result);
  }

  return fail("not_found", "No route matches that path.", 404, id);
});
