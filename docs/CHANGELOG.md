# Changelog

Newest first. Dates are the day the work landed in the workspace.

## 29 October 2026 — audit and polish pass

No new features. Correctness, verification and documentation.

**Fixed**

- Sample content submitted from the form now carries its `sampleId`, so a saved
  deep-lane result can replay. The tag clears when any field that feeds the
  content hash is edited.
- Model findings no longer arrive with `confidence: 0`. The prompt example was
  `0.0`; it is now `0.85` with an explicit instruction, so findings are no longer
  all routed to "Needs human".
- Approved Claim Ledger copy is now authoritative in the verifier. A finding that
  quotes a non-expired approved claim is suppressed, which took the clean-control
  sample from 9 findings to 0. Two tests added.
- Reviewer prompts state their boundaries: claims owns numbers and evidence,
  visual owns imagery and colour, tone owns voice. This removed duplicate and
  out-of-scope findings.
- Seven lint errors: unused imports, `Date.now()` during render in the
  reliability panel (the breaker state is now computed server-side), two
  setState-in-effect cascades, and a memo in the submit page the compiler could
  not preserve.

**Added**

- Four saved live runs for the seeded samples, with model, date and token counts.
- Per-page runtime in the visual eval.
- This documentation set: audit, architecture, features, improvements, API,
  evaluation, test results, limitations, roadmap, handoff.
- README rewritten to match the Round 3 code and the no-key behaviour.

**Changed**

- `eval/visual-eval.ts` reports analysis time per deck and per page.
- `api/modelStatus` returns `breakerOpen` so the UI does not read the clock during
  render.

## October 2026 — Round 3 build

- Visual Consistency Engine v2: logo template, margin and clear space, palette
  distance in CIELAB, type family and size, ink density; page viewer with boxes.
- Brand Drift and Rule Health: synthetic 90-day history, Wilson intervals,
  per-channel drift, suggestions citing decisions, daily recompute, independent
  consistency check.
- Review API: scoped hashed keys, idempotency, conflict detection, rate limits,
  OpenAPI in the same file as the handler; signed webhooks with backoff, SSRF
  guard and delivery log; Google Docs sidebar and install guide.
- Saved runs for seeded samples, re-verified on replay, with a degraded banner
  and a circuit breaker for the model gateway.
- Deterministic test suite: verifier, colour, webhook signing and SSRF, analytics,
  visual, fast lane, redaction, injection, audit chain.

## October 2026 — Round 2 core loop

- Submit, fast lane and deep lane, evidence-or-silence verifier, synthesizer,
  review workspace, status state machine, approval, Legal escalation, Review
  Receipt, hash-chained audit trail, Brand Pack Compiler, override logging,
  red-team eval.
