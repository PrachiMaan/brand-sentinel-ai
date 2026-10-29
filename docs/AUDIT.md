# Audit: what is built, what is proven, what is not

This audit covers the Round 2 core loop, the three Round 3 improvements, and the
polish and verification work requested in the Round 3 prompts. It was written
after re-running every check below, on 29 October 2026, against workspace HEAD
`2dc752b` plus the uncommitted edits described at the end of this file.

Status vocabulary:

- **Tested** — a command in this table was run in this pass and produced the
  stated result.
- **Built, not browser-verified** — the code exists and typechecks/lints, but the
  UI path was not clicked in a real browser in this environment.
- **Partial** — a stated part of the requirement is missing or weaker.
- **Missing** — not implemented, and not presented as working in the UI.

Environment limits that shape this table: this build sandbox has no browser
binary, so no page was driven end to end here. The live Convex deployment was
reachable, so backend behaviour, saved runs and the API surface were exercised
directly.

## Round 2 core loop

| Requirement | Status | Evidence | Files |
| --- | --- | --- | --- |
| Auth plus four roles, one workspace, one brand pack | Tested (backend) | `session:me`, `session:enterDemo` and role switching exercised through the live deployment with `convex run`; memberships table holds the demo personas | `src/convex/session.ts`, `src/convex/auth.ts` |
| One-click demo seats, always-visible role switcher | Built, not browser-verified | Routes and personas defined; every switch writes `demo.role_switched` to the audit log (chain verified live, 7 entries) | `src/pages/Demo.tsx`, `src/components/AppShell.tsx` |
| Seeded Lumora pack: 14 typed rules, glossary, 6-claim ledger, palette, voice | Tested (data) | Published pack read from the live deployment: version `Edition 4 · March 2026`, 5 palette colours, 6 claims including one expiring (C-002) and two expired (C-003, C-006) | `src/convex/lib/lumora.ts`, `src/convex/helpers.ts` |
| Sample content buttons and demo assets | Built, not browser-verified | Assets exist under `public/demo-assets` and `demo-assets`; sample loader wired in the submit page | `src/pages/Submit.tsx`, `scripts/make-demo-assets.mjs` |
| Submit text, channel, audience, image, alt text | Built, not browser-verified | Server mutation enforces channel, team, character limit and a double-click guard (identical hash within 60 s returns the existing row) | `src/convex/submissions.ts` |
| Fast lane under one second | Tested | `eval` over 60 items: median 0.153 ms; 10 fast-lane unit tests pass | `src/convex/lib/fastlane.ts`, `tests/fastlane.test.ts` |
| Five reviewers in parallel, one Finding schema | Tested (live) | Four live sample runs on 29 Oct 2026: 5/5 reviewer calls succeeded each, no errors, 3.6–6.3 s per run; shared schema enforced by zod | `src/convex/ai/pipeline.ts`, `src/convex/lib/types.ts` |
| Claims reviewer labels against the ledger | Tested (live + unit) | Live launch-caption run reported Expired (C-003) and Unsuitable wording against C-002; verifier rejects unknown claim ids | `src/convex/lib/prompts.ts`, `tests/verifier.test.ts` |
| Evidence-or-silence verifier | Tested | 10 verifier tests pass (span, rule, excerpt, claim, approved copy, saved-run recheck); live runs: 30 model findings requested, 16 kept, 14 suppressed | `src/convex/lib/verifier.ts`, `tests/verifier.test.ts` |
| Synthesizer: dedupe, rank, brand fit, fix diff, intent score | Built, unit-untested | Code path runs in every live sample run and produced counts/summary/brand fit; no dedicated unit test | `src/convex/lib/synth.ts` |
| Review workspace: highlights, accept/edit/reject, comments | Built, not browser-verified | Mutations exist and are workspace- and role-scoped; not clicked in a browser here | `src/pages/Review.tsx`, `src/convex/submissions.ts` |
| Status state machine, Legal escalation, revision versions | Partial | Server transitions implemented; no automated transition test, and illegal-transition coverage through the UI is unverified | `src/convex/submissions.ts`, `src/convex/lib/types.ts` |
| Hash-chained audit log and Verify chain | Tested | 5 chain tests pass; live `audit:verifyChain` returned `ok: true`, 7 entries recomputed | `src/convex/audit.ts`, `tests/audit-chain.test.ts` |
| Review Receipt PDF | Partial | Generator exists with version hash, decisions, model list and disclosure; not opened in a browser or checked page by page in this pass | `src/lib/receipt.ts` |
| Brand Pack Compiler (PDF/DOCX/CSV → typed rules → publish) | Built, not browser-verified | Compile job and review UI exist; the sample PDF was not compiled in this pass | `src/convex/compile.ts`, `src/pages/Rulebook.tsx` |
| Override logging and rule-health table | Tested (engine) | 10 analytics tests pass; aggregates recomputed from raw rows with 0 mismatches | `src/convex/analytics.ts`, `tests/analytics.test.ts` |
| Prompt injection treated as data | Tested | 6 injection tests pass across text, document and API paths; eval handled 2/2 probes | `tests/injection.test.ts`, `eval/run.ts` |
| Multi-page PDF submission with per-page review | Built, not browser-verified | Client renders PDF pages with pdf.js, uploads page images, server analyses each page; not exercised with a real export here | `src/lib/pdf.ts`, `src/convex/visual.ts` |
| PII redaction before model calls | Tested | Redaction and restore covered in injection tests; count written to `llmCalls` | `src/convex/lib/text.ts` |

## Round 3 improvement 1: Visual Consistency Engine v2

| Requirement | Status | Evidence | Files |
| --- | --- | --- | --- |
| Logo presence, margin and clear-space measurement | Tested | Every injected logo violation found; IoU 0.91 and 0.95 | `src/convex/lib/visual.ts` |
| Palette distance on page colours | Tested | Injected off-palette block found, IoU 1.00, ΔE 65.6 reported | same |
| Typography and density checks | Tested | Serif-family and body-size violations detected; density page found | same |
| Box accuracy, IoU ≥ 0.7 for logo/clear-space/palette | Tested | All four box-based violations pass; mean IoU 0.795 | `eval/visual-eval.ts` |
| Zero findings on the clean deck | Tested | Clean deck: 10 pages, 0 findings | `eval/visual-results.json` |
| Runtime per page | Tested | 54.4 ms/page (violations deck), 73.2 ms/page (clean deck) | same |
| Overlays, two-way selection, responsive | Built, not browser-verified | Page viewer, box overlay and finding links implemented; not driven in a browser | `src/pages/Review.tsx`, `src/components/brand/PageViewer` |
| Real Keynote/PowerPoint/Google Slides export | Missing | Not tested: no such file was available and no canvas backend exists here. Only generated fixture decks were measured | — |

The density check reports a whole-page measurement, so its box IoU is 0.00 by
nature. It is reported but not a pass condition. This is stated in the eval
output and in `docs/EVALUATION.md`.

## Round 3 improvement 2: Brand Drift and Rule Health

| Requirement | Status | Evidence | Files |
| --- | --- | --- | --- |
| Seeded 90-day history, labelled synthetic | Tested (engine) | 271 submissions, 543 findings, 479 decisions, 21 rules in the analytics eval; the UI carries the synthetic label | `src/convex/lib/history.ts`, `src/pages/RuleHealth.tsx` |
| Override rate per rule with confidence interval | Tested | Wilson interval tests, sample gate at 20 decisions; 17 of 21 rules judgeable | `tests/analytics.test.ts` |
| Top drifting channel with numbers | Tested | `landing`, +0.40 findings/day between the first and last 30-day window | `eval/analytics-results.json` |
| Three suggested rewordings, each citing decisions | Partial | Two suggestions were produced (R-TERM-03, R-VIS-02), both with evidence; the third rule did not meet the evidence threshold | `src/convex/lib/history.ts` |
| Recompute twice gives identical results | Tested | `idempotent: true`; recomputation from raw rows matched all 21 × 8 fields | `eval/analytics-check.ts` |
| Removing synthetic data leaves a valid chain | Partial | Removal path exists and deletes only synthetic rows; the chain was not re-verified after a removal in this pass | `src/convex/analytics.ts` |
| Daily scheduled recompute | Built, not observed | Cron registered for 02:30 UTC; no production run observed | `src/convex/crons.ts` |

## Round 3 improvement 3: Review API, webhooks, Google Docs

| Requirement | Status | Evidence | Files |
| --- | --- | --- | --- |
| OpenAPI document served and current | Tested | `GET /api/v1/openapi.json` returned 200 with 5 documented paths | `src/convex/httpApi.ts` |
| Key auth, scopes, hashed storage, shown once | Built, not exercised with a key | Key creation stores a SHA-256 hash, plaintext returned once; no key was created in this pass | `src/convex/api.ts`, `src/pages/ApiAccess.tsx` |
| Submit, status, findings, decision via HTTP | Built, untested end to end | Routes and contracts implemented; a live call without a key returned the documented 401 shape | `src/convex/httpApi.ts` |
| Idempotent replay, 409 conflict, 403 scope, 429 limit | Built, untested | Logic present in `createSubmission`/`decide` and the key gate; no live key to prove the status codes | `src/convex/api.ts` |
| Signed webhooks with retries and dead letter | Partial | 9 webhook tests pass (HMAC, header format, constant-time compare, backoff schedule, SSRF guard); no delivery made to a real receiver | `src/convex/lib/webhooks.ts`, `src/convex/webhookDeliver.ts` |
| API-only demo script (`scripts/api-demo.ts`) | Missing | No script exists; would need a live API key to run | — |
| Google Docs sidebar | Built, untested | Apps Script files and install guide exist; never opened in Google Workspace | `integrations/google-docs/` |

## Saved runs and no-key behaviour

| Requirement | Status | Evidence | Files |
| --- | --- | --- | --- |
| Saved results keyed by content hash + rulebook version | Tested (live) | Four rows written on 29 Oct 2026; lookup by hash and version returns each row; mismatched version returns null by design | `src/convex/reviewInternal.ts` |
| Model, date and token counts stored | Tested (live) | e.g. launch caption: `gpt-4o-mini · vly-gateway`, 4,588 in / 1,123 out | `cachedRuns` table |
| Replay passes the verifier again | Tested | Re-checking the stored findings kept all 37 that existed at that point (0 dropped) | `verifyCachedFindings`, `tests/verifier.test.ts` |
| Only sample content can be replayed | Tested (code path) | `sampleId` is required and now carried by the sample submit path; user copy has no sample id | `src/pages/Submit.tsx`, `src/convex/review.ts` |
| "Saved from a live run on …" label, `source: saved_run` in receipt and audit | Built, not browser-verified | String present in review and receipt code; not seen on screen | `src/pages/Review.tsx`, `src/lib/receipt.ts` |
| Degraded banner, retry, fast circuit breaker | Built, not browser-verified | Gateway classifies budget/rate/timeout/unconfigured, breaker at 3 failures; a live probe succeeded in 2.9 s | `src/convex/ai/gateway.ts`, `src/pages/Review.tsx` |
| No claim that the model always runs | Tested | Copy reviewed; degraded and deterministic states are named in the review banner and reliability page | `src/pages/Reliability.tsx` |

Live saved-run measurements (29 Oct 2026, `gpt-4o-mini`, rulebook
`Edition 4 · March 2026`):

| Sample | Model findings requested | Kept after verifier | Suppressed | Final findings |
| --- | ---: | ---: | ---: | ---: |
| Launch caption | 10 | 9 | 1 | 14 (incl. 5 deterministic) |
| Launch email | 10 | 4 | 6 | 7 |
| Clean control | 5 | 0 | 5 | 0 |
| Injection probe | 5 | 3 | 2 | 6 |

## Verification, polish and repository

| Requirement | Status | Evidence |
| --- | --- | --- |
| Typecheck clean | Tested | `bunx tsc -b --noEmit` exit 0 |
| Lint clean of errors | Tested | `bun run lint`: 0 errors, 24 warnings (UI library fast-refresh warnings and unused-ref warnings) |
| Unit tests | Tested | `bun test`: 74 pass, 0 fail, 272 assertions, 9 files |
| Red-team eval | Tested | 60 items, precision 95.2%, recall 100%, evidence validity not measurable (see Evaluation) |
| Visual eval | Tested | 4/4 acceptance checks pass |
| Analytics eval | Tested | `PASS`, 0 mismatches, idempotent |
| Adversarial UI pass (empty input, 100k chars, double-click, two tabs, offline, back/forward) | Not run | No browser in this sandbox. The server guards that could be checked by reading and unit tests are listed in `docs/TEST_RESULTS.md` |
| API contract tests against a live key | Not run | No key created; exact commands are in `docs/API.md` |
| Docs set and README | Tested | Files written in this pass; README commands checked against `package.json` |
| Repository free of secrets | Tested | `.env.example` has placeholders only; no key material in tracked files or the client bundle |

## Fixes made in this pass

1. **Sample content never reached the saved-run cache.** The submit form created
   sample submissions without a `sampleId`, so a saved result could never replay.
   The form now tags seeded samples and clears the tag on any edit that changes
   the content hash.
2. **Every model finding had `confidence: 0`.** The prompt's JSON example showed
   `0.0`, which the model copied, sending every finding to "Needs human". The
   example is now 0.85 with an explicit instruction.
3. **Approved claims were reported as violations.** The ledger is now
   authoritative in the verifier: a quote that matches a non-expired approved
   claim is suppressed as approved copy. This took the clean control from 9
   findings to 0. Covered by two new tests.
4. **Claims, tone and visual prompts overlapped**, which produced duplicate and
   out-of-scope findings. Each prompt now states its boundary.
5. **Seven lint errors** (unused imports, impure `Date.now()` in render, two
   setState-in-effect cascades, an un-preservable memo) are fixed.

The changes are uncommitted in this workspace: version control is managed by the
platform and direct git commands are blocked here. See `docs/HANDOFF.md`.
