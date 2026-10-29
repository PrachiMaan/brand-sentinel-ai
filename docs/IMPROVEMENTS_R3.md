# Round 3 improvements: promised, delivered, measured

Three improvements were committed to for Round 3. This file records what was
promised, what exists, what was measured, and where it falls short. No other new
headline features were added.

Measurements are from 29 October 2026, workspace HEAD `2dc752b` plus the
uncommitted fixes in `docs/AUDIT.md`.

---

## 1. Visual Consistency Engine v2

**Promised.** Logo clear-space and placement, palette distance, typography and
layout checks on deck and PDF pages, with visual overlays; every finding needs a
measured value, a page number and a box, or it is dropped.

**Delivered.** A deterministic page analyser in `src/convex/lib/visual.ts` that
runs on rasterised pages and extracted text items:

| Check | What it measures | Rule |
| --- | --- | --- |
| Logo present | normalised logo template correlation across the page | VIS-LOGO-PRESENT |
| Logo margin | distance from the page edge as a share of page width | VIS-LOGO-MARGIN |
| Logo clear space | nearest text/ink distance in multiples of logo height | VIS-LOGO-CLEARSPACE |
| Palette | share of page pixels far from every brand colour in CIELAB (ΔE) | VIS-PALETTE |
| Type family | share and count of text items set in a serif face | VIS-TYPE-FAMILY |
| Type size | median body size in points, lower quartile | VIS-TYPE-SIZE |
| Density | share of the page covered by ink | VIS-DENSITY |

Pages are rendered client-side with pdf.js (`src/lib/pdf.ts`), uploaded as page
images with their text items, and analysed server-side. Overlays use the same
normalised boxes the verifier checks. A finding without a page, an in-range box
and a measured value is dropped by `verifyVisualFields`.

**Measured.**

| Metric | Result |
| --- | --- |
| Injected violations detected | 7 / 7 |
| Box-based violations with IoU ≥ 0.70 | 4 / 4 (0.91, 0.95, 1.00, 1.00) |
| Mean IoU across all seven | 0.795 |
| Findings on the clean 10-page deck | 0 |
| Unexpected findings on the violations deck | 0 |
| Runtime | 54.4 ms/page (violations), 73.2 ms/page (clean) |
| Unit tests | 8 pass |

Acceptance criterion met for logo, clear-space and palette. Typography and
density are detected and boxed but are page-level checks, not box-accuracy
checks, and are reported as such.

**Not delivered / not proven.**

- No real Keynote, PowerPoint or Google Slides export was tested; only generated
  fixture decks. This is recorded in `docs/KNOWN_LIMITATIONS.md`.
- The page viewer and overlay interactions were not clicked in a browser here.
- Logos are matched with a generated template, not a learned detector. A logo
  with heavy distortion or a different lockup may be reported missing.

## 2. Brand Drift and Rule Health

**Promised.** A 90-day history, per-rule override rate with a confidence
interval, the top drifting channel with numbers, suggested rewordings that open
the decisions behind them, an idempotent recompute that an independent script can
reproduce, and removable synthetic data that leaves a valid audit chain.

**Delivered.**

- `src/convex/lib/history.ts` plans a deterministic 90-day synthetic history from
  a fixed seed and clock: 271 submissions, 543 findings, 479 decisions across 21
  rules and five channels. Every row is marked synthetic.
- `src/convex/analytics.ts` aggregates decisions and findings into `ruleHealth`
  and `ruleSuggestions`, with a Wilson score interval and a minimum sample of 20
  decisions before a rule is called judgeable.
- Drift compares findings per day in the first and last 30-day windows per
  channel, using actual counts.
- `src/pages/RuleHealth.tsx` shows override rate, interval, sample size, drift by
  channel, and suggestions that link to decision records. The synthetic label is
  visible, and the admin can remove synthetic rows.
- A daily cron recomputes recent aggregates at 02:30 UTC, and admins can
  recompute on demand.

**Measured.**

| Metric | Result |
| --- | --- |
| Stored vs recomputed fields | 21 rules × 8 fields, 0 mismatches |
| Second recompute | identical (`idempotent: true`) |
| Rules judgeable (≥ 20 decisions) | 17 / 21 |
| Top drifting channel | `landing`, +0.40 findings/day (0.82 → 1.22), 92 findings |
| Suggestions produced | 2 (R-TERM-03, R-VIS-02), all citing decision records |
| Suggestion method | deterministic template |
| Unit tests | 10 pass |

**Shortfall.** The plan said three suggested rewordings. Two rules cleared the
evidence threshold in this dataset. A third was not manufactured by loosening the
threshold; the page shows what exists.

**Not proven.** The synthetic-data removal path was not followed by a chain
re-verification in this pass. The cron has not been observed firing in
production. Charts were not visually checked.

## 3. Integration path: Review API, signed webhooks, Google Docs sidebar

**Promised.** Versioned HTTP API with scoped keys, idempotent submission,
conflict detection, rate limits, an OpenAPI contract that matches behaviour,
signed webhook delivery with retries and a dead-letter view, an SSRF guard, an API
demo script, and a Google Docs sidebar that uses the same endpoints.

**Delivered.**

| Piece | Where | Notes |
| --- | --- | --- |
| Versioned API | `src/convex/httpApi.ts` | `POST /api/v1/submissions`, `GET /api/v1/submissions/{id}`, `GET …/findings`, `POST …/decision`, `GET /api/v1/openapi.json` |
| Scoped keys | `src/convex/api.ts`, `src/pages/ApiAccess.tsx` | key shown once, stored as SHA-256, scopes creator / reviewer / approver, revocable |
| Idempotency | `idempotencyKeys` table | required `Idempotency-Key`; same key + same body returns the first response; same key + different body returns 409 |
| Rate limits | `apiKeys` counters | per-key window, 429 with `retry-after` |
| Error shape | one helper | `{ error: { code, message }, requestId }`, stable status mapping |
| Webhooks | `src/convex/webhookDeliver.ts`, `lib/webhooks.ts` | HMAC-SHA256 over `timestamp.body`, `X-BrandSentinel-Signature: t=…,v1=…`, retries at 1 m, 5 m, 30 m, 2 h, 6 h, then dead letter |
| SSRF guard | `lib/webhooks.ts` | rejects private, loopback and link-local hosts, credentials in URL, non-https outside localhost |
| Delivery log | `webhookDeliveries` | every attempt recorded with status, response code and error |
| Google Docs | `integrations/google-docs/` | Apps Script sidebar with settings, review, highlight, decisions and approval; install guide included |

**Measured.**

| Check | Result |
| --- | --- |
| OpenAPI served | `GET /api/v1/openapi.json` → 200, 5 paths |
| Unauthenticated call | 401 with the documented error shape |
| HMAC and header format | unit test matches Node's HMAC-SHA256 byte for byte |
| Constant-time compare | unit test |
| Backoff schedule | unit test: 1 m, 5 m, 30 m, 2 h, 6 h, stop |
| SSRF refusals | unit tests for private, loopback, link-local, bad scheme |
| Webhook unit tests | 9 pass |

**Not proven — this is the weakest area of the three.**

- No live API key was created in this pass, so submit → findings → decision via
  curl, idempotent replay, 409, 403, 429 and contract tests against real responses
  were **not run**. The endpoints and the OpenAPI document were written together
  in one file to keep them aligned, but alignment is asserted by construction,
  not by a contract test.
- No webhook was delivered to a real receiver. Signing and scheduling are unit
  tested; delivery, retry against a live endpoint and dead-lettering were not
  observed.
- The Google Docs sidebar has never been installed in Google Workspace. Its
  Apps Script code was reviewed, not executed. Apps Script quotas and the
  highlight behaviour are unverified.
- `scripts/api-demo.ts`, which the plan asked for, does not exist. Creating it
  without a key would produce an unrunnable script presented as working, so it was
  left out and recorded here.

**What a reviewer can see without a key.** The API reference page, the key
management UI, the OpenAPI document and the documented signing algorithm. Nothing
in the UI claims a delivery or a call that did not happen.
