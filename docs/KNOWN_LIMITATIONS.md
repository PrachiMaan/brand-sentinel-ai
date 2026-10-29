# Known limitations

Honest list, current as of 29 October 2026. If something is here, it is not
presented as working in the UI.

## Verification gaps

- **No browser was available in the build sandbox.** The UI was typechecked and
  linted, and backend behaviour was exercised on the live deployment, but no page
  was clicked end to end in this pass. Empty input, huge input, emoji, RTL text,
  double-click, two-tab races, offline mode and back/forward navigation are not
  browser-verified. `docs/TEST_RESULTS.md` lists each one with how to run it.
- **No screenshots.** The submission package asked for Playwright captures. No
  browser binary could be installed here, so none were produced. The intended
  routes are: `/`, `/demo`, `/app/submit`, `/app/review/:id` (findings and Needs
  human), `/app/audit` (before and after Verify chain), `/app/rules`,
  `/app/reliability`, `/app/api`.
- **No live API key was issued.** The OpenAPI document (200) and the 401 shape
  were verified by curl. Submit, status, findings, decision, idempotent replay,
  409, 403, 429 and the webhook delivery path were **not** run end to end.
- **No webhook was delivered to a real receiver.** Signing, header format,
  constant-time comparison, backoff schedule and SSRF refusals are unit tested.
  Delivery, retries against a live endpoint and dead-lettering are not observed.
- **The Google Docs sidebar has never been installed.** The Apps Script code and
  install guide exist; nothing was run in Google Workspace. Apps Script quotas,
  highlight behaviour and OAuth consent are unverified.
- **`scripts/api-demo.ts` does not exist.** The Round 3 plan asked for it. Writing
  it without a key would have produced an unrunnable script presented as working,
  so it was left out.

## Model-dependent behaviour

- **The evaluation does not measure the deep lane.** The committed red-team run
  had no model credential, so all 300 reviewer calls failed with `unconfigured`
  and the reported precision/recall covers the deterministic rule engine only.
  No deep-lane precision or recall is claimed anywhere.
- **Deep-lane evidence comes from four samples.** Four live runs on 29 October
  2026 (30 model findings, 16 kept, 14 suppressed) show the verifier working on
  real output, but four items are not an accuracy measurement.
- **Saved results exist only for the four seeded samples.** User-entered content
  always tries the live model and falls back to the fast lane with a cause and a
  retry button. It is never served from the cache.
- **The "Needs human" bucket is empty on the current samples.** All saved model
  findings scored 0.9 confidence. The bucket and its threshold exist; no seeded
  sample demonstrates it.
- **Model output quality varies.** On the email sample the verifier suppressed 6
  of 10 model findings; on the clean control it suppressed 5 of 5 before the
  approved-copy rule was added. Expect the verifier to do real work on every run.
- **Model cost is not budgeted per workspace.** The gateway has a deployment-level
  budget; the per-run cap is 6 calls and 1,100 tokens per call.
- **Legal escalation is a flag**, not a separate legal workspace or a different
  queue.

## Visual engine

- **Only generated fixture decks were measured.** No Keynote, PowerPoint or
  Google Slides export was available. Whether a real export crashes the pipeline
  is unverified (it is plain PDF parsing plus page rasterisation, but unproven).
- **Density findings have no meaningful box** — they are whole-page measurements,
  so their IoU is 0.00 by construction. IoU is asserted only for logo, margin,
  clear-space and palette findings.
- **The serif check locates affected text but not exact glyph boxes** (IoU 0.71).
- **Logos are matched with a generated template mask**, not a trained detector. A
  distorted or locked-up logo may be reported missing.
- **No OCR.** Text baked into an image is invisible to the text checks.
- **DOCX is text only.** No visual claim is made for Word documents.

## Analytics

- **Two suggested rewordings, not three.** Two rules cleared the evidence and
  sample thresholds in the synthetic dataset. Lowering the threshold to produce a
  third was rejected as manufacturing a recommendation.
- **Synthetic data removal was not followed by a chain re-verification.** The
  removal deletes only rows marked synthetic, but the end-to-end sequence was not
  observed.
- **The daily cron has not been observed firing** in production.
- **Charts were not visually inspected.** Each chart has a text table alternative,
  but layout at different widths is unverified.

## Product scope

- **Single demo workspace, shared by all visitors.** Anonymous sign-in; anyone
  with the link sees the same Lumora workspace. Do not paste confidential copy.
- **One brand pack at a time.** The compiler can publish a new pack, but there is
  no multi-brand switcher.
- **Text limit is 20,000 characters** per submission, and 1,200 words for
  single-piece review. Longer documents should be split.
- **No OCR, video, auto-publish or webhooks-to-Google-Docs.** Out of scope.
- **The receipt is a client-generated PDF** with hashes recorded in the audit
  chain; it is not cryptographically signed by a third party.
- **State-machine transitions have no automated test.** Approval blocks on
  pending critical/high findings in code, but illegal transitions were not fuzzed.

## Platform

- **Hosting is the Freebuff workspace**, not Vercel. There is no Vercel project or
  `maxDuration` setting.
- **Database, auth and storage are Convex**, not Supabase. There is no SQL RLS;
  isolation is enforced in every function.
- **Version control is platform-managed.** Direct git commands are blocked in the
  build sandbox. The fixes in this pass are present in the working tree and may
  not yet be committed or mirrored to GitHub. `docs/HANDOFF.md` says what to do.
- **Lint has 24 warnings** (mostly `react-refresh/only-export-components` in
  shadcn UI files and unused refs). Zero errors.
