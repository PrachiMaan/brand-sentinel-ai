# Features

Status labels used here: **Tested** means an automated check or a live backend
call was run and passed; **Built** means the code exists and typechecks but was
not exercised in a browser in this environment; **Partial** means a named part is
missing.

## Review workflow

| Feature | Status | Notes |
| --- | --- | --- |
| Demo seats for Creator, Reviewer, Approver, Admin | Built | One-click anonymous sign-in; role switcher in the header; every switch audited |
| Submit text with channel, audience and team | Tested | Server validates channel, team, 20k character limit and duplicate submissions within 60 s |
| Image upload with alt text | Built | Dominant colours computed in the browser, stored with the submission |
| PDF and DOCX intake | Built | PDF pages rendered and analysed; DOCX is text only and the UI says so |
| Fast lane while typing | Tested | 0.153 ms median over 60 items |
| Deep lane with five reviewers | Tested (live) | Four live sample runs, all five reviewers succeeded |
| Evidence-or-silence verifier | Tested | 10 unit tests; 14 of 30 model findings suppressed on live sample runs |
| Needs-human bucket | Built | Confidence below 0.6; empty on the current samples because their findings scored 0.9 |
| Synthesizer with brand-fit score and fix diffs | Built | Runs on every review; no dedicated unit test |
| Accept / edit / reject per finding with reason | Built | Recorded in `decisions` and the audit chain |
| Comments | Built | Per submission, optional finding link |
| Status state machine and revision versions | Partial | Draft → review → findings → human review → approved / rejected / needs revision; no automated transition test |
| Legal escalation of a claims finding | Built | Sets submission legal flag and a `legalCases` row |
| Review Receipt PDF | Built | Version hash, findings, decisions, models, disclosure statement |
| Hash-chained audit log with Verify chain | Tested | 5 unit tests; live chain verified (7 entries) |

## Round 3: visual

| Feature | Status | Notes |
| --- | --- | --- |
| Logo presence, margin, clear space | Tested | Eval: IoU 0.91 / 0.95 / 1.00 |
| Palette distance per page | Tested | CIELAB ΔE, eval IoU 1.00 |
| Typography family and body size | Tested | Page-level measures; serif share and median point size |
| Ink density | Tested | Whole-page measurement, no box |
| Page viewer with box overlays | Built | Two-way selection between boxes and findings |
| Real slide-export support | Not proven | Only generated fixture decks were tested |

## Round 3: analytics

| Feature | Status | Notes |
| --- | --- | --- |
| 90-day synthetic history | Tested | 271 submissions, 543 findings, 479 decisions |
| Override rate with confidence interval | Tested | Wilson interval, 20-decision sample gate |
| Drift by channel | Tested | Top channel `landing`, +0.40 findings/day |
| Suggested rewordings citing decisions | Partial | 2 suggestions, not the 3 planned |
| Idempotent recompute | Tested | 0 mismatches against an independent recomputation |
| Remove synthetic data | Partial | Path exists; chain not re-verified afterwards |
| Scheduled daily recompute | Built | Cron registered; not observed in production |

## Round 3: integration

| Feature | Status | Notes |
| --- | --- | --- |
| Versioned HTTP API | Tested (surface) | OpenAPI served with 5 paths; unauthenticated 401 verified |
| Scoped API keys, shown once, hashed | Built | No key created in this pass |
| Idempotency and 409 on body conflict | Built | Not exercised live |
| Rate limiting with 429 | Built | Not exercised live |
| Signed webhooks and retry schedule | Partial | 9 unit tests; no live delivery |
| Dead-letter view | Built | `webhookDeliveries` records every attempt |
| SSRF guard | Tested | Private, loopback, link-local and bad schemes rejected |
| Google Docs sidebar | Built | Never installed in Google Workspace |
| API demo script | Missing | Not written; no key to run it |

## Reliability and transparency

| Feature | Status | Notes |
| --- | --- | --- |
| Saved runs for seeded samples | Tested (live) | Four samples saved 29 Oct 2026 with model, date and token counts |
| Replay re-verified against the current rulebook | Tested | Stored findings re-checked; 0 dropped |
| Degraded banner with cause and retry | Built | Six classified causes |
| Circuit breaker | Built | Opens after 3 consecutive failures for 90 s |
| Model call log | Tested (data) | Prompt hash, provider, model, latency, tokens, error, redactions |
| Reliability page reading real result files and saved runs | Built | Reads `public/eval/results.json` and the `cachedRuns` query |
| PII redaction before model calls | Tested | Email and phone patterns; count logged |
| Prompt-injection isolation | Tested | 6 tests across text, document and API paths; 2/2 eval probes |

## Brand pack

| Feature | Status | Notes |
| --- | --- | --- |
| Seeded Lumora pack | Tested (data) | 14 rules, 6 claims, glossary, palette, voice |
| Rulebook viewer | Built | Rules grouped by category with source excerpts |
| Brand Pack Compiler (PDF/DOCX/CSV → typed rules) | Built | Admin review and publish flow; not run in this pass |
| Rule health page | Tested (engine) | Numbers computed, not hard-coded |
