# Handoff

State of the workspace and the exact things a person must do that this
environment could not do.

## What is where

- Live app: **https://brandsentinel.freebuff.app/**
- Convex backend (site URL for the API): **https://tremendous-rabbit-679.convex.site**
- Repository: **https://github.com/PrachiMaan/brand-sentinel-ai**
- Workspace HEAD when this was written: `2dc752b`. The edits in this pass are in
  the working tree and may not be committed.
- Saved runs for the four Lumora samples were written to the live deployment on
  **29 October 2026** with `gpt-4o-mini`.

## 1. Commit and push

Direct git commands are blocked in this sandbox, so this is yours to run:

```bash
git status
git add -A
git commit -m "Closing pass: live API proof, webhook tests, seeded drift suggestions, density box"
git push origin main
```

Before pushing, check the repo is public and that
`git grep -nE "sk-|bss_live_|BEGIN (RSA|OPENSSH|EC) PRIVATE KEY"` returns
nothing. `.env.example` contains placeholders only.

## 2. Re-run the checks

```bash
bun install
bunx convex dev --once        # needs Convex login; the Freebuff workspace does this for you
bun run typecheck
bun run lint                  # 0 errors expected, warnings in UI library files
bun test                      # 80 pass
bun run eval                  # deterministic lane
bun run eval:visual           # 4/4 checks
bun run eval:analytics        # PASS
```

## 3. Saved runs and model budget

The four samples already have saved results, so a judge who opens the demo sees a
deep-lane report without spending model budget. A replay is labelled "Saved from
a live run on 29 October 2026 · gpt-4o-mini · vly-gateway".

To refresh them after a prompt or rulebook change:

1. Sign in as the admin or approver seat and open **Reliability**.
2. Press **Save model results for samples**. It runs each existing sample
   submission once through the gateway and stores the result.
3. If the budget is exhausted, the action returns the exact cause and stores
   nothing. It does not write a partial or hand-written result.

A saved result is only reused when both the content hash and the rulebook version
match, and it is re-verified against the current rulebook on every replay. Sample
content submitted from the form now carries its sample id; user copy never does.

To check the gateway without the UI:

```bash
bunx convex run review:probeModel --identity '{"subject":"<demo user id>"}'
```

## 4. Review API and webhooks

Done live on 29 October 2026: 12/12 checks, including replay, 409, 403 and 429,
plus an external webhook 200 and a 500 that scheduled a retry. To reproduce:

```bash
BASE_URL="https://tremendous-rabbit-679.convex.site/api/v1" \
BRANDSENTINEL_KEY="bss_live_…" \
BRANDSENTINEL_CREATOR_KEY="bss_live_…" \
  bun run scripts/api-demo.ts
```

Create the two keys in the app as admin under **API & Webhooks**. The proof keys
from this pass remain in the demo workspace as hashed rows named “R3 proof …”;
revoke them there if you want a clean key list. The external echo does not inspect
signatures, so verify a webhook with the snippet in `docs/API.md` against your own
receiver if that matters.

## 5. Google Docs

Follow `integrations/google-docs/INSTALL.md` in a real Google account. Nothing in
that folder has been executed. Record what worked in `docs/TEST_RESULTS.md` and
what did not in `docs/KNOWN_LIMITATIONS.md`.

## 6. Screenshots

No browser binary exists here. Capture, at 1440 px wide:

1. `/` landing
2. `/demo` with the four seats
3. `/app/submit` with the Lumora sample loaded and fast-lane highlights
4. `/app/review/:id` with findings and the saved-run label
5. the Needs human section (requires a finding below 0.6 confidence; the current
   samples have none, so this shot may be empty)
6. a finding accepted, one edited and one rejected with a reason
7. the approved state
8. `/app/audit` with Verify chain passing
9. the exported Review Receipt PDF
10. `/app/rules`, `/app/reliability`, `/app/api`

## 7. Things deliberately left undone

Listed with reasons in `docs/KNOWN_LIMITATIONS.md`. In short: no browser-driven UI
pass or screenshots, no Google Workspace run, no real slide export, no live
dead-letter observation (the transition is tested), external webhook signatures
not inspected by the remote service, and no API receipt endpoint.
