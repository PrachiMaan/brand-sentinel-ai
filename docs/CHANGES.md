# What changed from the Round 1 plan, and why

This file covers the **Round 2** build. Round 3 additions and the later audit
pass are recorded in `docs/CHANGELOG.md`.

Every item below is a real difference between the Round 1 deck and the Round 2
build.

## Stack substitutions (forced by the build environment, not preference)

**Next.js App Router + Vercel -> Vite + React Router + Freebuff workspace.**
The Round 2 build ran in an environment where Vercel, GitHub and Supabase were not
reachable; the available stack was Vite + React + Convex, with a managed preview.
The App Router was not available, so routes are React Router routes. The product
behaviour is the same, but server-side rendering, route handlers and Vercel
`maxDuration` do not exist here.

**Supabase (Postgres, Auth, Storage, RLS) -> Convex.**
Convex provides the database, file storage, auth and functions in one deployment.
Workspace isolation is enforced in every query and mutation by resolving the
caller's membership and filtering on `workspaceId`. This is the RLS equivalent;
there is no direct client database access.

**Inngest -> a Convex action started by a mutation.**
The review run is a `runs` row with a progress array. The client subscribes to the
row, so the UI updates without polling or SSE. The action calls the five reviewers
with `Promise.all`. Retries are per reviewer (one schema repair attempt) rather
than a durable workflow engine. The Trade-off: no cross-run retry queue and no
dead-letter store.

**pgvector hybrid retrieval -> ledger and rules in the prompt, with ID checks.**
The Claim Ledger is six entries; the published rulebook is fourteen rules. Both
are small enough to pass in full. Reviewers must return a `rule_id`; the claims
reviewer must return a `claim_id`. The verifier checks that the ids exist and that
the span and guideline excerpt are real. This removes an embedding service and a
whole class of silent retrieval misses, at the cost of not scaling to a large
guideline library. That scaling is a Round 3 problem.

## Scope changes

**Page rasterisation and visual overlays: not built.** The image path analyses
dominant colours and alt text only. There is no logo clear-space measurement or
layout geometry. This was listed as "only if time allows" in Round 1 and it did
not.

**Multi-page PDF/DOCX submission: not built (Tier 3).** The compiler extracts text
from PDF, DOCX and CSV, but the review intake accepts text and one image only. Do
not expect page-by-page review in the app.

**Screenshots: not captured.** The submission asks for Playwright screenshots of
the deployed app. The sandbox had no browser system libraries and no disk space to
install them. Rather than stage screenshots, the package lists the intended shots
and their routes. This is a real gap in the submission, not a design choice.

**Deployment: not on Vercel.** The live app is served by the Freebuff workspace at
**https://brandsentinel.freebuff.app/**. There is no Vercel project and no Vercel
`maxDuration` control; the app is a static Vite build against a Convex deployment.
The README gives the link plainly so nobody looks for a Vercel URL.

**Commit history: platform-managed.** The repository is initialised and contains
the work. Version control and committing are handled by the Freebuff workspace,
which also blocks direct `git push` from the sandbox, so the remote
(`github.com/PrachiMaan/brand-sentinel-ai`) is synced by the platform rather than
by hand. Publishing it publicly is a repository setting, not a code change.

## Things that were added beyond the plan

**Deterministic claim and tone checks in the fast lane.** Round 1 put claims and
tone in the deep lane only. During the model outage the product needed a working
path, so the rule engine now also does: ledger matching for expired and expiring
entries (with number agreement), unsupported percentages/timeframes and absolute
claims, medical language, urgency/hype/jargon lexicons, deprecated glossary terms,
and email subject length. These are labelled as deterministic findings and use the
same evidence rules. They are not presented as model judgement.

**Degraded-mode honesty.** A failed reviewer no longer blank-screens the review.
The run is marked `degraded`, the banner names the failure, fast-lane findings are
kept, and the audit row records it. This was implicit in Round 1 ("degrade
gracefully") and is now explicit in the UI and data model.

**Local eval runner instead of an HTTP eval endpoint.** The first implementation
posted batches to a Convex HTTP action. Convex codegen would not publish a function
that the route referenced while the typecheck depended on that function, so the
runner now imports `runPipeline` directly in Bun. It runs the exact production
module, needs no server, and is easier to reproduce. The Convex HTTP route was
removed.

## Deliberate non-goals at Round 2

No Brand Drift dashboard, no Visual Consistency Engine v2, no Review API/webhooks,
no Google Docs sidebar, no video, no auto-publish, no fine-tuning. The Round 2 UI
did not show these as working. The Brand Drift dashboard, Visual Consistency
Engine, Review API/webhooks and Google Docs sidebar were subsequently built in
Round 3; see `docs/CHANGELOG.md` and `docs/IMPROVEMENTS_R3.md`.

## What this means for judging

The core loop (submit -> findings -> human decision -> approval -> receipt ->
audit verification) is built and typechecked. The model-backed part of the loop
could not be exercised at the end because the shared model budget was exhausted;
the run data and the UI handle that state without pretending otherwise. The
Round 3 plan is written against the modules that actually exist, not the Round 1
diagram.
