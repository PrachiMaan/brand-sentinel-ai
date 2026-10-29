# Test results

Run on 29 October 2026 against workspace HEAD `2dc752b` plus the fixes in
`docs/AUDIT.md`. Live checks used the Convex deployment
`https://tremendous-rabbit-679.convex.site`.

## Automated checks

| Check | Command | Result |
| --- | --- | --- |
| Convex codegen and typecheck | `bunx convex dev --once` | functions ready, exit 0 |
| TypeScript | `bunx tsc -b --noEmit` | exit 0 |
| Lint | `bun run lint` | 0 errors, 24 warnings |
| Unit tests | `bun test` | **80 pass, 0 fail**, 314 assertions, 10 files |
| Red-team eval | `bun run eval` | 60 items, precision 95.2%, recall 100% (deterministic lane) |
| Visual eval | `bun run eval:visual` | 5/5 checks, mean IoU 0.918 |
| Analytics eval | `bun run eval:analytics` | PASS, 0 mismatches, 3 evidenced suggestions |
| API demo | `bun run scripts/api-demo.ts` | **12/12 checks passed** |

Test files:

| File | Tests | Covers |
| --- | ---: | --- |
| `tests/fastlane.test.ts` | 10 | banned terms, naming, casing, claims, contrast, alt text |
| `tests/verifier.test.ts` | 10 | spans, rules, excerpts, claims, approved copy, recheck |
| `tests/analytics.test.ts` | 10 | aggregation, Wilson interval, sample gate, idempotence |
| `tests/color.test.ts` | 10 | WCAG contrast and CIELAB distance |
| `tests/webhooks.test.ts` | 9 | HMAC, header format, constant-time compare, backoff, SSRF |
| `tests/visual.test.ts` | 8 | palette, density, type statistics, logo mask, thresholds |
| `tests/injection.test.ts` | 6 | injection on text, document and API paths; redaction |
| `tests/webhook-delivery.test.ts` | 6 | local receiver delivery, signature, failure, retry, dead letter |
| `tests/audit-chain.test.ts` | 5 | intact, edited, removed, reordered, deterministic |
| `tests/sha256.test.ts` | 4 | hashing and canonical JSON |

## Review API, live

Keys were created through the app’s `apiAdminActions.createKey` action with an
admin session. Output of the final run:

```
Base: https://tremendous-rabbit-679.convex.site/api/v1
Run:  mvty9d74-dyr87

PASS  OpenAPI served — HTTP 200, 5 paths
PASS  Submit — HTTP 202, id mn7e51mfap5exs9kfk6m1vs77d8h63fw
PASS  Same-key replay returns the same submission — HTTP 202, id mn7e51mfap5exs9kfk6m1vs77d8h63fw
PASS  Conflicting body gives 409 — HTTP 409, code conflict
PASS  Creator-scope key cannot approve — HTTP 403, code forbidden
PASS  Review completes — status findings_ready
PASS  Findings returned — 10 findings, 10 pending
      first: critical R-TERM-02 "MIRACLE"
PASS  Pending findings decided — 10 decisions recorded
PASS  Approver key approves — HTTP 200, status approved
PASS  Status endpoint confirms approval — status approved, version 1
PASS  Receipt manifest complete — 10/10 decisions, version 1, source live
PASS  Rate limit returns 429 — HTTP 429 after 59 requests, retry-after 40s

Receipt manifest
{
  "submissionId": "mn7e51mfap5exs9kfk6m1vs77d8h63fw",
  "version": 1,
  "status": "approved",
  "findings": 10,
  "decisions": 10,
  "pending": 0,
  "counts": { "critical": 7, "high": 2, "medium": 1 },
  "source": "live",
  "degraded": false
}

12/12 checks passed
```

An earlier run of the same script degraded with `invalid_output` from the model
and completed on deterministic findings (`source: deterministic`). The script
reported that state rather than hiding it, which is the intended degraded path.

## Webhooks, live and local

| Check | Result |
| --- | --- |
| `https://httpbin.org/post` | delivered, HTTP 200, attempt 1, 315 ms |
| `https://httpbin.org/status/500` | failed, HTTP 500, retry scheduled; endpoint then deactivated |
| Local receiver via real `deliver` | signature, body, event and delivery headers matched |
| Receiver returns 500 | attempt recorded as failed |
| Receiver unreachable | transport error recorded |
| Attempt 1 failure | retry scheduled in ~60 s |
| Attempt 6 failure | status `dead`, no retry scheduled |
| Retry succeeds | status `delivered`, no further scheduling |

A Convex deployment cannot reach this sandbox, so a live delivery to a receiver
under our control is impossible. The external echo proves the deployed delivery
path returns 200/500; signature verification is proven against the local receiver
using the same production handler.

## Analytics, live and eval

| Check | Result |
| --- | --- |
| Eval history | 283 submissions, 565 findings, 506 decisions |
| Stored vs recomputed | 21 rules × 8 fields, 0 mismatches |
| Idempotent recompute | true |
| Judgeable rules | 18 / 21 |
| Top drift channel | `email`, +0.60 findings/day |
| Suggestions | 3: R-TONE-02, R-TERM-03, R-VIS-02 |
| Evidence | 8 real decisions each, all edit/reject with reasons |
| Live history | 283 synthetic submissions, 3 batches |
| Live suggestions | 3, same rule ids |
| Remove 3 batches → reseed → API run → verify chain | `ok: true`, 69 entries |

## Visual

| Deck | Findings | Detected | Mean IoU | Runtime |
| --- | ---: | ---: | ---: | ---: |
| Clean (10 pages) | 0 | 0 | — | 72.5 ms/page |
| Violations (10 pages) | 7 | 7 | 0.918 | 54.5 ms/page |

Density IoU 0.862 after the engine began reporting the merged dense region and
the fixture ground truth came from declared block geometry instead of a
hard-coded corner.

## Bugs found and fixed in this pass

1. **Saved runs could never replay for sample captions** (`sampleId` missing).
2. **All model findings had confidence 0**, so all landed in "Needs human".
3. **Approved ledger copy was reported as a violation**; the ledger is now
   authoritative. Clean control 9 → 0.
4. **Reviewer remits overlapped**, producing duplicate and out-of-scope findings.
5. **Seven lint errors** (unused imports, clock in render, setState cascades, memo).
6. **`seedHistory` blocked batches 1 and 2**, so only 30 days loaded.
7. **`removeSynthetic` exceeded the per-call read limit** on a full history.
8. **All three batches used the same random stream**, tripling one month and
   producing 5 suggestions instead of 3.
9. **Density ground truth was a hard-coded corner**; engine and fixture now use
   real geometry, IoU 0.862.
10. **`scripts/api-demo.ts` did not exist**; added and run live.

## Not run, and why

No browser binary exists in this sandbox.

| Check | How to run it |
| --- | --- |
| Full demo journey in a fresh session | Open the live URL in a private window, use the demo seats |
| Empty input, whitespace only, 100k characters | Paste into the submit page; empty and over-limit are also rejected server-side |
| Emoji, RTL, pasted HTML and script tags | Paste into the submit page |
| Corrupt, zero-byte, password-protected, 31-page PDF | Use the PDF/DOCX control |
| Double-click, two tabs, refresh during loading | Server has a duplicate-hash guard; tab races unverified |
| Offline mode, back/forward | Toggle network in devtools |
| Wrong-role direct function calls | Server checks role; not exercised from a browser |
| Cross-workspace ids | No second workspace; scoping is server-side |
| Google Docs sidebar install | Follow `integrations/google-docs/INSTALL.md` |
| Real PowerPoint/Keynote/Slides PDF | Drop one into the submit page |
| Screenshots | Capture the routes listed in `docs/KNOWN_LIMITATIONS.md` |
