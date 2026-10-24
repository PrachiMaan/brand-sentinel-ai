# Submission form answers

Copy-paste ready. Values in `[square brackets]` must be filled from the workspace
before submitting; everything else is final.

## Project link

[Paste the Freebuff preview URL for this workspace]

The app opens on the landing page. Judges should choose **Try the demo**, pick a
seat, and use the role switcher in the header. No signup, no email.

## Repository link

[Paste the repository URL if the workspace exposes one; this build has no public
GitHub remote. The code and history are in the workspace.]

## One-paragraph summary

BrandSentinel is an AI-assisted brand gate that reviews content before publication
against a company's brand guidelines. A deterministic fast lane checks banned
terms, naming, claims, tone, contrast and alt text immediately. Five specialist
reviewers then return findings in one schema, and an evidence-or-silence verifier
drops anything whose span, rule, guideline excerpt or claim id cannot be checked.
A human accepts, edits or rejects each finding; an approver signs off, rejects or
escalates claims to Legal; every action lands in a hash-chained audit trail and an
approval produces a downloadable Review Receipt. The demo uses a seeded synthetic
brand, Lumora, so judges can go from submission to approval in two minutes.

## Completed features

- **Roles and demo access** — Done. One-click entry as Creator, Reviewer, Approver
  or Admin; always-visible role switcher; every switch audited.
- **Seeded Lumora brand pack** — Done. 14 typed rules, glossary with banned and
  deprecated terms, 6-claim ledger (one expiring, two expired), palette, voice,
  guideline PDF, sample captions and an off-palette sample image.
- **Submission** — Done for text and one image, with channel, audience, alt text,
  optional design hex pair. Multi-page documents are not built.
- **Fast lane** — Done. Banned terms, naming/casing, claim-ledger matching,
  tone/jargon, WCAG contrast, palette distance, missing alt text; median 0.23 ms
  on the seeded set.
- **Deep lane** — Built. Five reviewers in parallel, shared Finding schema, zod
  validation with one repair attempt. The final verification run could not use it:
  the model gateway's daily budget was exhausted and every reviewer call failed.
  The UI degrades to fast-lane findings and states the failure.
- **Verifier** — Done. Verbatim span, rule id, guideline excerpt and claim id
  checks; confidence floor to Needs human; dropped counts and reasons stored.
- **Synthesizer** — Done. De-duplication, severity ranking, brand-fit score,
  intent-preservation score, tracked diff, nothing auto-applied.
- **Review workspace** — Done. Side-by-side highlighted content, findings list,
  accept/edit/reject with reasons, comments, version history.
- **Status machine** — Done. Draft, AI review, Findings ready, Human review,
  Needs revision, Approved, Rejected, Receipt exported; Legal escalation.
- **Audit chain** — Done. Append-only, prev_hash + hash per row, Verify chain
  recomputes and reports pass/fail or the first broken row.
- **Review Receipt** — Done. Client-side PDF with version hash, findings, human
  decisions, models used and the AI disclosure statement.
- **Brand Pack Compiler** — Built. PDF/DOCX/CSV text extraction, LLM proposes
  typed rules with source excerpts, admin edits and publishes. Not exercised
  end-to-end while the model quota was exhausted.
- **Override logging and Rule Health** — Done. Every decision writes a
  ruleOverrides row; the Rule Health page shows counts and override rates.
- **PII redaction** — Done. Email and phone regex before model calls; count logged.
- **Prompt injection** — Done. Content is delimited and treated as data; two probes
  in the eval still produce their expected findings.

## Technology and implementation details

| Layer | What is actually used |
| --- | --- |
| Frontend | Vite, React 19, React Router, TypeScript, Tailwind CSS, shadcn/ui, Framer Motion |
| Backend | Convex: queries, mutations, node actions, file storage, auth |
| Database | Convex (Postgres-backed), workspace-scoped access in every function |
| Model gateway | One provider-agnostic file (`src/convex/ai/gateway.ts`), OpenAI-compatible, zod-validated JSON, two attempts, every call logged |
| Deterministic engines | `fastlane.ts`: regex/glossary/naming, Claim Ledger match, WCAG contrast, CIELAB palette distance, alt text |
| Verification | `verifier.ts`: verbatim span, rule id, guideline excerpt, claim id, confidence floor |
| Audit | `audit.ts` + `lib/sha256.ts`: SHA-256 hash chain with prev_hash |
| Documents | `pdf-lib` for the receipt; `mammoth` and `pdfjs-dist` for compiler extraction |
| Eval | `eval/run.ts` imports the production pipeline; 60 seeded items; metrics to `eval/results.json` |

The two-lane pipeline: fast lane is synchronous plain TypeScript; the deep lane is
one Convex action that runs five reviewers with `Promise.all`. Findings are stored
in one table with a shared schema, including `source` (model or deterministic) and
`bucket` (verified or needs_human). The verifier drops a finding when its span is
not found verbatim, its rule id is unknown, its guideline excerpt is not in the
guideline document, or its claim id is not in the ledger; low-confidence findings
are kept but sent to Needs human. Dropped counts and reasons are stored and shown.

Security: the client never touches the database directly; every function resolves
the caller's workspace and role. Submitted content is delimited and passed as
data, never as instructions. Email and phone numbers are redacted before model
calls and the redaction count is logged with each call. No secrets are in the
client bundle.

## Changes to the original plan

- Next.js/Vercel became Vite/React Router in the Freebuff workspace; Vercel and
  GitHub were not reachable from the build environment.
- Supabase became Convex for database, auth and storage; workspace isolation is
  enforced in every Convex function instead of RLS policies.
- Inngest became a Convex action plus a `runs` progress row; no durable queue.
- pgvector hybrid retrieval became ledger-in-prompt with claim-id verification,
  which suits a six-entry ledger and removes an embedding dependency.
- Multi-page PDF/DOCX review and page rasterisation were not built.
- Deterministic claim and tone checks were added to the fast lane so the gate
  still works when the model is unavailable.
- The eval runner is a local Bun script, not an HTTP route, to avoid a codegen
  dependency cycle.

## Three major improvements for Round 3

**1. Visual Consistency Engine v2.** Extend the existing palette check in
`lib/color.ts` and the image path in `ai/pipeline.ts` into page-level visual
review: logo presence and clear space against the L-mark rule (R-VIS-02), logo
placement and margins, typography family/size consistency, and layout density on
PDF/deck pages, with bounding-box overlays on a rendered page. Reuse `runs`,
`findings` and the verifier; add a `visualAssets` table and a `pageRenders` blob
store. Acceptance: on a 10-page seeded deck, every injected logo/clear-space and
palette violation is detected with a box overlay, and a clean deck yields no
visual findings. Test: extend `eval/dataset.json` with rendered page fixtures and
compare boxes to expected coordinates with IoU >= 0.7.

**2. Brand Drift and Rule Health analytics.** Turn the existing `ruleOverrides`
and `llmCalls` tables into a trend view: recurring issues by team, channel and
rule; override rate per rule with a confidence interval; time-to-approval; and
suggested rewordings for rules whose override rate is high. Add `ruleHealth`
aggregates and a nightly Convex action. This extends the current Rule Health page
from raw counts to decisions over time. Acceptance: a seeded 90-day history shows
per-rule override rate, top drifting channel and three suggested rewordings, each
traceable to the decisions that produced it. Test: fixture history with known
drift; assert the top rule/channel and the suggested wording references.

**3. Integration path: Review API, webhooks and a Google Docs sidebar.** Expose the
existing review pipeline as a documented, workspace-scoped HTTP API (submit,
status, findings, decision) with signed webhooks on `findings_ready` and
`approved`, plus a Google Docs sidebar that submits the open document and shows
findings inline. Reuse `submissions`, `runs`, `findings`, `decisions` and the
audit chain; add `apiKeys`, `webhookEndpoints` and `webhookDeliveries` tables
with idempotency keys. Acceptance: a Docs document can be submitted, reviewed and
approved without opening the web app, and every webhook delivery is retried and
audited. Test: contract tests against the OpenAPI schema, a replay test for
idempotency, and a staging Docs add-on run.
