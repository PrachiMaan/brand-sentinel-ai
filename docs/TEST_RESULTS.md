# Test results

Run on 29 October 2026 against workspace HEAD `2dc752b` plus the fixes described
in `docs/AUDIT.md`. The Convex deployment used was
`https://tremendous-rabbit-679.convex.cloud` (dev).

## Automated checks

| Check | Command | Result |
| --- | --- | --- |
| Convex codegen and typecheck | `bunx convex dev --once` | functions ready, exit 0 |
| TypeScript | `bunx tsc -b --noEmit` | exit 0, no errors |
| Lint | `bun run lint` | 0 errors, 24 warnings (UI library fast-refresh warnings, unused refs) |
| Unit tests | `bun test` | **74 pass, 0 fail**, 272 assertions, 9 files, 311 ms |
| Red-team eval | `bun run eval` | 60 items, precision 95.2%, recall 100%, 300 reviewer errors (no local credential) |
| Visual eval | `bun run eval:visual` | 4/4 acceptance checks pass |
| Analytics eval | `bun run eval:analytics` | PASS, 0 mismatches, idempotent |

Test files and counts:

| File | Tests | Covers |
| --- | ---: | --- |
| `tests/fastlane.test.ts` | 10 | banned terms, naming, casing, claims, contrast, alt text |
| `tests/verifier.test.ts` | 10 | spans, rules, excerpts, claims, approved copy, saved-run recheck |
| `tests/analytics.test.ts` | 10 | aggregation, Wilson interval, sample gate, idempotence |
| `tests/color.test.ts` | 10 | WCAG contrast and CIELAB distance |
| `tests/webhooks.test.ts` | 9 | HMAC, header format, constant-time compare, backoff, SSRF |
| `tests/visual.test.ts` | 8 | palette, density, type statistics, logo mask, thresholds |
| `tests/injection.test.ts` | 6 | injection on text, document and API paths; PII redaction |
| `tests/audit-chain.test.ts` | 5 | intact chain, edited row, removed row, reordered row, determinism |
| `tests/sha256.test.ts` | 4 | hashing and canonical JSON |

## Live deployment checks

| Check | How | Result |
| --- | --- | --- |
| Gateway reachable | `convex run review:probeModel --identity …` | reachable, `gpt-4o-mini`, 2,883 ms |
| Deep lane end to end on sample content | one-off internal seeding action using the production pipeline | 4/4 samples completed, 0 reviewer errors, 3.6–6.3 s per run |
| Saved runs written | `convex data cachedRuns` | 4 rows, 29 Oct 2026, with model, tokens and rulebook version |
| Saved-run lookup | `convex run reviewInternal:findCache` | each hash + version returns its row; wrong version returns null |
| Replay re-verification | stored findings through `verifyCachedFindings` | 37/37 kept at the time of the check, 0 dropped |
| Audit chain | `convex run audit:verifyChain` | `ok: true`, 7 entries recomputed |
| OpenAPI document | `curl /api/v1/openapi.json` | 200, 5 paths |
| Unauthenticated API call | `curl -X POST /api/v1/submissions` | 401 with the documented error body and CORS headers |

Saved-run detail:

| Sample | Findings | Model findings kept | Suppressed | Tokens in / out |
| --- | ---: | ---: | ---: | ---: |
| Launch caption | 14 | 9 of 10 | 1 | 4,588 / 1,123 |
| Launch email | 7 | 4 of 10 | 6 | 4,614 / 1,109 |
| Clean control | 0 | 0 of 5 | 5 | 4,554 / 630 |
| Injection probe | 6 | 3 of 5 | 2 | 4,508 / 577 |

## Bugs found and fixed in this pass

1. **Saved runs could never replay for sample captions.** The submit form did
   not set `sampleId`, which the cache path requires. Fixed in
   `src/pages/Submit.tsx`; the tag clears on any edit that changes the hash.
2. **All model findings had confidence 0**, so every one landed in "Needs human".
   The prompt's JSON example was literally `0.0`. Fixed in
   `src/convex/lib/prompts.ts`.
3. **Approved claim copy was reported as a violation.** The verifier now treats a
   non-expired approved ledger entry as authoritative and suppresses findings
   quoting it. Clean control: 9 findings → 0. Two tests added.
4. **Reviewer remits overlapped**, producing duplicate and out-of-scope findings
   (a visual reviewer flagging sentences). Prompts now state each boundary.
5. **Seven lint errors**: unused imports in `Reliability.tsx` and `Rulebook.tsx`,
   `Date.now()` during render, two setState-in-effect cascades, and a memo the
   React compiler could not preserve in `Submit.tsx`.

## Not run, and why

The sandbox has no browser binary, and no API key was issued in this pass. These
checks are listed so the gap is visible, not implied to have passed:

| Check | Reason | How to run it |
| --- | --- | --- |
| Full demo journey in a fresh session (Creator → Reviewer → Approver → receipt → verify chain) | No browser here | Open the live URL in a private window, use the demo seats |
| Empty input, whitespace only, 100k characters | No browser | Paste into the submit page; empty and over-limit are also rejected server-side |
| Emoji, RTL text, pasted HTML and script tags | No browser | Paste into the submit page |
| Invalid file type, corrupt PDF, zero-byte file, password-protected PDF, 31-page PDF | No browser | Use the PDF/DOCX control |
| Double-click submit, same action in two tabs, refresh during loading | No browser | Server has a duplicate-hash guard; tab races unverified |
| Offline mode, browser back/forward through the workflow | No browser | Toggle network in devtools |
| Wrong-role actions through direct function calls | No browser identity | Call the mutation with a non-matching session; server checks role |
| Another workspace's ids in URLs | No second workspace | Server scopes by membership; unit-level only |
| API submit → findings → decision with a live key | No key | Follow `docs/API.md` quick start |
| 409 / 403 / 429 and idempotent replay | No key | Same |
| Webhook delivery to a local receiver, retries, dead letter | No key and no reachable receiver | Create an endpoint, use the verification snippet in `docs/API.md` |
| Google Docs sidebar install | No Google Workspace access | Follow `integrations/google-docs/INSTALL.md` |
| Real PowerPoint/Keynote/Google Slides PDF | No sample file | Drop one into the submit page and compare the visual findings |
| Screenshots of the deployed app | No browser | Capture the routes listed in `docs/KNOWN_LIMITATIONS.md` |

Everything in the "not run" table is unverified. Nothing in the UI claims those
paths have been exercised.
