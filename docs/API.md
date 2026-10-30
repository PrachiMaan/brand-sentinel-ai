# Review API

Base URL: `https://<your-convex-deployment>.convex.site/api/v1`

The deployed prototype uses
`https://joyous-herring-358.convex.site/api/v1`.

OpenAPI 3.1 document: `GET /api/v1/openapi.json` (also served at `/api/v1`).
The document and the handler live in the same file, `src/convex/httpApi.ts`, so a
route change is a document change in the same edit.

## Authentication

Every endpoint except the OpenAPI document needs a bearer key:

```
Authorization: Bearer bss_live_…
```

Create a key in the web app as an admin: **API & Webhooks → Create key**. The key
is shown once. Only its SHA-256 hash is stored. Scopes:

| Scope | Can do |
| --- | --- |
| `creator` | create submissions and read their status and findings |
| `reviewer` | the above, plus accept / edit / reject findings |
| `approver` | the above, plus approve, reject, needs-revision |

Keys are workspace-bound. A key cannot read another workspace's submission, even
with a valid id.

## Errors

All errors use one shape and a stable status mapping:

```json
{ "error": { "code": "conflict", "message": "…", "requestId": "…" } }
```

| Code | Status |
| --- | --- |
| `bad_request` | 400 |
| `unauthorized` | 401 |
| `forbidden` | 403 |
| `not_found` | 404 |
| `conflict` | 409 |
| `payload_too_large` | 413 |
| `unprocessable` | 422 |
| `rate_limited` | 429 (with `retry-after`) |

## Submit content

`POST /submissions`

Required header: `Idempotency-Key`. Reusing a key with the same body returns the
first response with `status: "replayed"`. Reusing it with a different body returns
409.

```bash
curl -sS -X POST "$BASE/submissions" \
  -H "Authorization: Bearer $BRANDSENTINEL_KEY" \
  -H "Idempotency-Key: launch-caption-001" \
  -H "content-type: application/json" \
  -d '{
    "title": "Launch caption",
    "text": "Lumora Glow Serum is a fragrance-free daily serum.",
    "channel": "instagram",
    "audience": "Skincare-curious adults, 25-44",
    "team": "Social",
    "externalRef": "cms-8841"
  }'
```

Body:

| Field | Required | Notes |
| --- | --- | --- |
| `text` | yes | up to 20,000 characters |
| `channel` | yes | `instagram`, `email`, `linkedin`, `landing`, `print` |
| `title` | no | trimmed to 120 characters |
| `audience` | no | defaults to "General audience" |
| `team` | no | `Social`, `Email`, `Web`, `Paid`; defaults to `Social` |
| `externalRef` | no | your own id, returned with the submission |

Response: `202` with the submission id and status.

## Status

`GET /submissions/{id}`

Returns the submission status (`draft`, `ai_review`, `findings_ready`,
`human_review`, `needs_revision`, `approved`, `rejected`, `receipt_exported`),
severity counts, and whether the run is degraded with a cause.

## Findings

`GET /submissions/{id}/findings`

Returns the verified findings for the current version. Each finding carries the
shared fields: reviewer, severity, confidence, quoted span with offsets, rule id,
guideline excerpt, why it matters, suggested fix, status, bucket, and, for visual
findings, page and box. Suppressed findings are not returned; the run records the
suppression counts.

## Decide

`POST /submissions/{id}/decision`

```bash
curl -sS -X POST "$BASE/submissions/$ID/decision" \
  -H "Authorization: Bearer $BRANDSENTINEL_KEY" \
  -H "content-type: application/json" \
  -d '{"findingId":"f-claims-56-R-CLAIM-01","decision":"reject","reason":"Claim needs legal review."}'
```

| Field | Required | Notes |
| --- | --- | --- |
| `decision` | yes | `accept`, `edit`, `reject`, `approve`, `reject_submission`, `needs_revision` |
| `findingId` | for finding decisions | must belong to this submission |
| `reason` | for reject | free text |
| `editedFix` | for edit | replacement wording |

Approve returns 409 when pending critical or high findings remain, or when the
caller's key scope is not `approver` (403).

## Rate limits

Per key, per window. When the limit is reached the response is 429 with a
`retry-after` header in seconds. Every rejected attempt is not billed against the
submission state; nothing is written.

## Webhooks

Create an endpoint in **API & Webhooks**, choosing the events it subscribes to
The signing secret is shown once.

Each delivery is a POST with:

```
x-brandsentinel-signature: t=<unix-seconds>,v1=<hex hmac-sha256>
x-brandsentinel-event: findings_ready | approved
x-brandsentinel-delivery: <event id>:<endpoint id>
```

The signed payload is the string `${t}.${rawBody}`. Verify it like this:

```js
import crypto from "node:crypto";

export function verify(secret, header, rawBody, toleranceSeconds = 300) {
  const parts = Object.fromEntries(
    header.split(",").map((part) => part.split("=", 2)),
  );
  const timestamp = Number(parts.t);
  if (!Number.isFinite(timestamp)) return false;
  if (Math.abs(Date.now() / 1000 - timestamp) > toleranceSeconds) return false;
  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${parts.t}.${rawBody}`)
    .digest("hex");
  return crypto.timingSafeEqual(
    Buffer.from(expected, "hex"),
    Buffer.from(parts.v1, "hex"),
  );
}
```

Delivery rules:

- HTTPS only. Private, loopback and link-local hosts are refused at creation.
- 10-second timeout, no redirects followed.
- Retries after 1 m, 5 m, 30 m, 2 h and 6 h, then the delivery is dead-lettered.
- Every attempt is recorded in `webhookDeliveries` and visible in the app.

## Google Docs

The sidebar in `integrations/google-docs/` uses these endpoints. Install steps
are in `integrations/google-docs/INSTALL.md`. It has not been installed in Google
Workspace in this environment; see `docs/KNOWN_LIMITATIONS.md`.

## Quick start without the web app

```bash
export BASE="https://joyous-herring-358.convex.site/api/v1"
export BRANDSENTINEL_KEY="bss_live_…"   # create in the app, shown once

ID=$(curl -sS -X POST "$BASE/submissions" \
  -H "Authorization: Bearer $BRANDSENTINEL_KEY" \
  -H "Idempotency-Key: $(uuidgen)" \
  -H "content-type: application/json" \
  -d '{"text":"Glow Serum is a MIRACLE.","channel":"instagram"}' \
  | jq -r '.submissionId')

curl -sS "$BASE/submissions/$ID/findings" \
  -H "Authorization: Bearer $BRANDSENTINEL_KEY" | jq
```

These commands were run live on 29 October 2026, including replay, 409, 403 and
429. See `docs/TEST_RESULTS.md` for the full output.

## Scripted proof

`scripts/api-demo.ts` runs the whole path and asserts each status:

```bash
BASE_URL="https://joyous-herring-358.convex.site/api/v1" \
BRANDSENTINEL_KEY="bss_live_…" \
BRANDSENTINEL_CREATOR_KEY="bss_live_…" \
  bun run scripts/api-demo.ts
```

It submits with an `Idempotency-Key`, replays the same request, sends a
conflicting body, attempts an approval with the creator key, polls until findings
arrive, decides every pending finding, approves, confirms the status and receipt
manifest, and finally drives the creator key to 429. It exits non-zero if any
check fails.

The Review Receipt PDF is generated in the web app; the API has no receipt
endpoint, so the script confirms the data the receipt is built from.
