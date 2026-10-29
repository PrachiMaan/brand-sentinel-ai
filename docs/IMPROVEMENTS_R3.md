# Round 3 improvements: promised, delivered, measured

Three improvements were committed to for Round 3. This file records what was
promised, what exists, what was measured, and where it falls short. No other new
headline features were added.

Measurements from 29 October 2026, workspace HEAD `2dc752b` plus the uncommitted
fixes in `docs/AUDIT.md`.

---

## 1. Visual Consistency Engine v2

**Promised.** Logo clear-space and placement, palette distance, typography and
layout checks on deck and PDF pages, with overlays; every finding needs a measured
value, a page number and a box, or it is dropped.

**Delivered.** A deterministic page analyser (`src/convex/lib/visual.ts`) over
rasterised pages and extracted text:

| Check | What it measures | Rule | Box |
| --- | --- | --- | --- |
| Logo present | normalised template correlation | VIS-LOGO-PRESENT | whole mark |
| Logo margin | distance to page edge as a share of width | VIS-LOGO-MARGIN | logo |
| Logo clear space | nearest intrusion in multiples of logo height | VIS-LOGO-CLEARSPACE | logo + intruding block |
| Palette | page pixels far from brand colours in CIELAB | VIS-PALETTE | offending region |
| Type family | serif share of text items | VIS-TYPE-FAMILY | affected text band |
| Type size | median and lower-quartile body size | VIS-TYPE-SIZE | text band |
| Density | share of page covered by ink | VIS-DENSITY | dense region |

The density box is the union of every grid cell within five points of the densest
cell, not an arbitrary single cell. On a page whose content fills two bands, that
is the region a designer has to open up.

**Measured** (`bun run eval:visual`):

| Metric | Result |
| --- | --- |
| Injected violations detected | 7 / 7 |
| Violations with IoU ≥ 0.70 | 7 / 7 |
| Mean IoU | 0.918 |
| Density IoU | 0.862 |
| Logo margin / clear space / palette | 0.91 / 0.946 / 0.998 |
| Type family / type size | 0.709 / 1.000 |
| Findings on the clean 10-page deck | 0 |
| Unexpected findings on the violations deck | 0 |
| Runtime | 54.5 ms/page (violations), 72.5 ms/page (clean) |
| Acceptance checks | 5 / 5 |
| Unit tests | 8 pass |

**Not delivered / not proven.**

- No real Keynote, PowerPoint or Google Slides export was tested; only generated
  fixture decks. Recorded in `docs/KNOWN_LIMITATIONS.md`.
- The page viewer and overlay interactions were not clicked in a browser here.
- Logos are matched with a generated template, not a learned detector.
- Density is a page-level measurement; its box points at the area to fix, not at
  a discrete object.

## 2. Brand Drift and Rule Health

**Promised.** A 90-day history, per-rule override rate with a confidence
interval, the top drifting channel with numbers, three suggested rewordings that
open the decisions behind them, an idempotent recompute that an independent script
can reproduce, and removable synthetic data that leaves a valid audit chain.

**Delivered.**

- `src/convex/lib/history.ts` plans three deterministic 30-day batches, each from
  its own seed, for 283 submissions, 565 findings and 506 decisions across 21
  rules and five channels. Every row is marked synthetic.
- Three rules are seeded as genuinely contested (`R-TONE-02`, `R-TERM-03`,
  `R-VIS-02`) with enough decided findings and enough edit/reject disagreement to
  clear the evidence threshold. `R-CHAN-01` is deliberately left below it.
- `src/convex/analytics.ts` aggregates with a Wilson interval and a 20-decision
  sample gate; suggestions require 12 disagreements and a 25% override rate, and
  cite the real decision ids.
- `src/pages/RuleHealth.tsx` shows override rate, interval, sample size, drift by
  channel, and suggestions that trace to decision records. It labels the data
  synthetic at page level, per rule row, and on each suggestion.
- Removal is batched per 30 days so a full history stays inside Convex’s read
  limit; the UI removes all three batches.

**Measured** (`bun run eval:analytics`):

| Metric | Result |
| --- | --- |
| Submissions / findings / decisions | 283 / 565 / 506 |
| Stored vs recomputed | 21 rules × 8 fields, 0 mismatches |
| Second recompute | identical (`idempotent: true`) |
| Rules judgeable (≥ 20 decisions) | 18 / 21 |
| Top drifting channel | `email`, 1.04 → 1.64 findings/day, +0.60 |
| Suggestions produced | **3**: R-TONE-02, R-TERM-03, R-VIS-02 |
| Evidence per suggestion | 8 decisions, all real, all edit/reject, all with reasons |
| Suggestion method | deterministic template |
| Live removal → reseed → chain verify | `ok: true`, 69 entries |

**Not proven.** The daily cron has not been observed firing in production, and
the charts were not visually inspected at different widths.

## 3. Integration path: Review API, signed webhooks, Google Docs sidebar

**Promised.** Versioned HTTP API with scoped keys, idempotent submission, conflict
detection, rate limits, an OpenAPI contract that matches behaviour, signed webhook
delivery with retries and a dead-letter view, an SSRF guard, an API demo script,
and a Google Docs sidebar that uses the same endpoints.

**Delivered and verified live.** Keys were created through the app’s own
`apiAdminActions.createKey` action (admin session), not inserted by hand.

`bun run scripts/api-demo.ts` against the deployed API:

```
PASS  OpenAPI served — HTTP 200, 5 paths
PASS  Submit — HTTP 202, id mn7e51mfap5exs9kfk6m1vs77d8h63fw
PASS  Same-key replay returns the same submission — HTTP 202, same id
PASS  Conflicting body gives 409 — HTTP 409, code conflict
PASS  Creator-scope key cannot approve — HTTP 403, code forbidden
PASS  Review completes — status findings_ready
PASS  Findings returned — 10 findings, 10 pending
PASS  Pending findings decided — 10 decisions recorded
PASS  Approver key approves — HTTP 200, status approved
PASS  Status endpoint confirms approval — status approved, version 1
PASS  Receipt manifest complete — 10/10 decisions, version 1, source live
PASS  Rate limit returns 429 — HTTP 429 after 59 requests, retry-after 40s

12/12 checks passed
```

Webhooks, live and local:

| Check | Result |
| --- | --- |
| Live POST to `https://httpbin.org/post` | delivered, HTTP 200 |
| Live POST to `https://httpbin.org/status/500` | failed, HTTP 500, retry scheduled |
| Local receiver through the real `deliver` handler | signature matched the documented `t=…,v1=…` scheme, body and headers correct |
| Retry scheduling through the real `recordAttempt` | attempt 1 retries in ~60 s; attempt 6 dead-letters with no retry |
| Success on a retry | marked delivered, no further scheduling |
| Webhook delivery tests | **6 pass** |

**Not delivered / not proven.**

- The external echo service returned 200 but does not inspect signatures, so
  signature validation is proven locally, not by the remote receiver.
- Live dead-lettering would take about 9.5 hours of backoff. The transition is
  proven through the real mutation with an in-memory database.
- **The Google Docs sidebar has never been installed** in Google Workspace. Its
  Apps Script code was reviewed, not executed. Quotas and highlight behaviour are
  unverified.
- The Review Receipt PDF has no API endpoint; the script confirms the receipt
  manifest (status, version, decisions, counts, source). The PDF itself is a
  browser-side document.
