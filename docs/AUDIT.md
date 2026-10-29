# Audit: what is built, what is proven, what is not

Covers the Round 2 core loop, the three Round 3 improvements, and the closing
verification pass. Written on 29 October 2026 against workspace HEAD `2dc752b`
plus the uncommitted edits listed at the end.

Status vocabulary:

- **Tested** — a command below was run in this pass and produced the stated result.
- **Built, not browser-verified** — code exists and typechecks/lints, but the UI
  path was not clicked in a real browser here.
- **Partial** — a named part is missing or weaker.
- **Missing** — not implemented.

The build sandbox has no browser binary, so no page was driven end to end. The
live Convex deployment was reachable, so backend behaviour, the HTTP API, webhook
delivery, saved runs and the analytics history were exercised directly.

## Round 2 core loop

| Requirement | Status | Evidence | Files |
| --- | --- | --- | --- |
| Auth plus four roles, one workspace, one brand pack | Tested (backend) | `session:switchRole` exercised through the live deployment; memberships hold the four personas | `src/convex/session.ts`, `src/convex/auth.ts` |
| One-click demo seats, always-visible role switcher | Built, not browser-verified | Personas and routes defined; switches write audit rows (chain verified live, 69 entries) | `src/pages/Demo.tsx`, `src/components/AppShell.tsx` |
| Seeded Lumora pack: 21 typed rules (14 copy + 7 visual), glossary, 6-claim ledger, palette, voice | Tested (data) | Published pack read from the live deployment; C-002 expiring, C-003 and C-006 expired | `src/convex/lib/lumora.ts`, `src/convex/helpers.ts` |
| Sample content and demo assets | Built, not browser-verified | Assets under `public/demo-assets`; loader wired in the submit page | `src/pages/Submit.tsx` |
| Submit text, channel, audience, image, alt text | Tested (API + code) | API submission created, reviewed and approved; server enforces channel, team, length and duplicate guard | `src/convex/submissions.ts` |
| Fast lane under one second | Tested | Eval over 60 items: median 0.153 ms; 10 fast-lane tests pass | `src/convex/lib/fastlane.ts` |
| Five reviewers in parallel, one Finding schema | Tested (live) | Live API run on 29 Oct: 10 findings, source `live`, not degraded; four saved sample runs also completed | `src/convex/ai/pipeline.ts` |
| Claims reviewer labels against the ledger | Tested (live + unit) | Live findings include Expired C-003 and unsupported claims; verifier rejects unknown ids | `src/convex/lib/prompts.ts`, `tests/verifier.test.ts` |
| Evidence-or-silence verifier | Tested | 10 verifier tests; live sample runs: 30 model findings requested, 16 kept, 14 suppressed | `src/convex/lib/verifier.ts` |
| Synthesizer: dedupe, rank, brand fit, fix diff | Built, unit-untested | Runs on every review and produced counts/summary/brand fit; no dedicated unit test | `src/convex/lib/synth.ts` |
| Review workspace: highlights, accept/edit/reject, comments | Built, not browser-verified | Mutations exist and are workspace- and role-scoped; not clicked here | `src/pages/Review.tsx` |
| Status state machine, Legal escalation, revision versions | Tested (API paths) | Approve gate blocks pending critical/high; API exercised draft → findings_ready → human_review → approved; illegal transitions not fuzzed | `src/convex/submissions.ts`, `src/convex/api.ts` |
| Hash-chained audit log and Verify chain | Tested | 5 chain tests; live `audit:verifyChain` returned `ok: true`, 69 entries after seeding, removals and the API run | `src/convex/audit.ts` |
| Review Receipt PDF | Partial | Generator exists; API has no receipt endpoint, so the script confirms the receipt data, not the PDF; PDF not opened in a browser here | `src/lib/receipt.ts` |
| Brand Pack Compiler | Built, not browser-verified | Compile job and editor exist; not run on the sample PDF in this pass | `src/convex/compile.ts`, `src/pages/Rulebook.tsx` |
| Override logging and rule health | Tested | 10 analytics tests; eval and live recompute agree | `src/convex/analytics.ts` |
| Prompt injection treated as data | Tested | 6 injection tests across text, document and API paths; eval 2/2 | `tests/injection.test.ts` |
| Multi-page PDF submission with per-page review | Built, not browser-verified | Client renders pages with pdf.js; server analyses each page; not exercised on a real export | `src/lib/pdf.ts`, `src/convex/visual.ts` |
| PII redaction before model calls | Tested | Redaction and restore covered in injection tests; count logged | `src/convex/lib/text.ts` |

## Improvement 1: Visual Consistency Engine v2

| Requirement | Status | Evidence |
| --- | --- | --- |
| Logo presence, margin, clear space | Tested | IoU 1.00, 0.91, 0.95 |
| Palette distance per page | Tested | IoU 0.998, ΔE 65.6 reported |
| Typography and layout checks | Tested | Serif IoU 0.709; body size IoU 1.00 |
| Density finding carries a box | Tested | Dense region (union of near-max cells), IoU **0.862** |
| Box accuracy, IoU ≥ 0.70 | Tested | **7/7** violations, mean IoU **0.918** |
| Zero findings on the clean deck | Tested | 10 pages, 0 findings |
| Runtime per page | Tested | 54.5 ms/page (violations), 72.5 ms/page (clean) |
| Acceptance checks | Tested | **5/5** pass, including density as the fifth check |
| Overlays, two-way selection, responsive | Built, not browser-verified | Page viewer and box links implemented; not driven here |
| Real Keynote/PowerPoint/Slides export | Missing | Not available; only generated fixtures were measured |

## Improvement 2: Brand Drift and Rule Health

| Requirement | Status | Evidence |
| --- | --- | --- |
| Seeded 90-day history, labelled synthetic | Tested | 283 submissions, 565 findings, 506 decisions; 3 batches load; “Synthetic Lumora data” label and per-row markers |
| Override rate with confidence interval | Tested | Wilson 95%, 20-decision gate; 18 of 21 rules judgeable |
| Top drifting channel with numbers | Tested | `email`, 1.04 → 1.64 findings/day, +0.60 |
| Three suggestions citing real decision IDs | Tested | R-TONE-02, R-TERM-03, R-VIS-02; each cites 8 decisions, all real, all edit/reject |
| Recompute twice gives identical results | Tested | `idempotent: true`; 21 × 8 fields, 0 mismatches |
| Removal leaves a valid chain | Tested | Removed 3 batches, reseeded, chain verified (69 entries) |
| Daily scheduled recompute | Built, not observed | Cron registered at 02:30 UTC |

## Improvement 3: Review API, webhooks, Google Docs

Live proof on 29 October 2026 against `https://tremendous-rabbit-679.convex.site/api/v1`,
using keys created through the app’s own `apiAdminActions.createKey` action:

| Check | Result |
| --- | --- |
| OpenAPI | 200, 5 paths |
| Submit with Idempotency-Key | 202, submission id returned |
| Same-key replay, same body | 202, same submission id |
| Same key, different body | 409 `conflict` |
| Creator key approving | 403 `forbidden` |
| Review to findings | `findings_ready`, 10 findings, source `live`, not degraded |
| Decide every pending finding | 10/10 recorded |
| Approve | 200, status `approved` |
| Status after approval | `approved`, version 1 |
| Receipt manifest | 10/10 decisions, 0 pending, counts recorded |
| Rate limit | 429 `rate_limited` after 59 requests, `retry-after` set |
| Contract script | `bun run scripts/api-demo.ts`: **12/12 checks passed** |

Webhooks:

| Check | Result |
| --- | --- |
| Live delivery to external echo (`httpbin.org/post`) | delivered, HTTP 200, attempt 1 |
| Live failure to external 500 endpoint | failed, HTTP 500, retry scheduled; endpoint then deactivated |
| Local receiver, real `deliver` action | signature verified against the documented scheme, body and headers match |
| Retry and dead-letter, real `recordAttempt` | attempt 1 schedules ~60 s; attempt 6 becomes `dead` with no retry; success on retry marks `delivered` |
| Local receiver tests | **6 pass** |

Still open:

| Requirement | Status | Reason |
| --- | --- | --- |
| Signature verified by the external receiver | Partial | The echo endpoint returns 200 but does not inspect headers; signature verification was proven locally |
| Dead-letter observed live | Partial | Would take ~9.5 h of backoff; proven through the real mutation with a fake database |
| Google Docs sidebar, script logic | Works, unit-tested with mocks | `tests/google-docs.test.ts`: 23 pass over `Code.gs` with `DocumentApp`, `PropertiesService`, `UrlFetchApp`, `Utilities` mocked — empty doc, 20,000-char cap, idempotency-key stability and per-field changes, all `computeDigest` byte-array shapes, status/findings parsing, 401/403/409/429 messages, highlight, span-not-found, clear highlights |
| Google Docs sidebar, install in a real account | Not run | No Google Workspace access here: OAuth consent, menu, sidebar rendering and highlight colouring in a live Doc are unverified |

## Saved runs and no-key behaviour

| Requirement | Status | Evidence |
| --- | --- | --- |
| Saved results keyed by content hash + rulebook version | Tested (live) | 4 rows written 29 Oct; lookup by hash and version returns the row |
| Model, date and token counts stored | Tested (live) | e.g. launch caption 4,588 in / 1,123 out |
| Replay passes the verifier again | Tested | Stored findings re-checked; 37/37 kept at the time of the check |
| Only sample content can be replayed | Tested | `sampleId` required and carried by the sample submit path |
| “Saved from a live run on …” label | Built, not browser-verified | Present in review and receipt code |
| Degraded banner, retry, circuit breaker | Built, not browser-verified | Classification and breaker unit-level; live API run was clean |

## Verification and repository

| Check | Result |
| --- | --- |
| Typecheck | `bunx tsc -b --noEmit` exit 0 |
| Lint | 0 errors, 24 warnings |
| Unit tests | **103 pass, 0 fail**, 430 assertions, 11 files (incl. 23 for the Google Docs script) |
| Red-team eval | 60 items, precision 95.2%, recall 100% (deterministic lane only) |
| Visual eval | 5/5 checks, mean IoU 0.918 |
| Analytics eval | PASS, 0 mismatches, idempotent, 3 evidenced suggestions |
| Adversarial UI pass | Not run: no browser in the sandbox |
| Google Docs script logic | `bun test tests/google-docs.test.ts`: 23 pass (mocked Apps Script services) |
| Google Docs install in Workspace | Not run: no Workspace access |
| Secrets | `.env.example` placeholders only; keys stored hashed; secrets created in this pass were not written to disk |

## Fixes made in this pass

1. **Sample content never reached the saved-run cache.** The form did not set
   `sampleId`. Fixed in `src/pages/Submit.tsx`; the tag clears on edits.
2. **Every model finding had `confidence: 0`**, sending all of them to "Needs
   human". The prompt example was `0.0`; it is now 0.85 with an instruction.
3. **Approved claims were reported as violations.** The verifier now treats a
   non-expired approved ledger entry as authoritative. Clean control: 9 → 0.
4. **Reviewer remits overlapped** (visual flagging sentences). Prompts now state
   boundaries.
5. **Seven lint errors** (unused imports, clock during render, two setState
   cascades, an un-preservable memo) fixed.
6. **`seedHistory` refused every batch after the first**, so only 30 of the 90
   days loaded. The guard now scopes to the batch window.
7. **`removeSynthetic` exceeded Convex’s per-call read limit** on a full history.
   Removal is now per 30-day batch and the UI loops all three.
8. **Each synthetic batch reused the same random stream**, tripling one month’s
   shape and producing five suggestions. Each batch now has its own seed and the
   eval composes the same three batches.
9. **Density findings pointed at an arbitrary corner in the fixture ground truth.**
   The engine now reports the merged dense region and the fixture states its
   ground truth from declared block geometry. IoU 0.862, not the previous 0.
10. **The API demo script did not exist.** `scripts/api-demo.ts` now runs the full
    path and asserts replay, 409, 403 and 429; it passed 12/12 live.

The changes are uncommitted in this workspace; version control is managed by the
platform. See `docs/HANDOFF.md`.
