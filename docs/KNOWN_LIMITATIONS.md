# Known limitations

Current as of 29 October 2026. If something is here, it is not presented as
working in the UI.

## Verification gaps

- **No browser was available in the build sandbox.** The UI was typechecked and
  linted, and backend behaviour was exercised on the live deployment, but no page
  was clicked end to end in this pass. Empty input, huge input, emoji, RTL text,
  double-click, two-tab races, offline mode and back/forward navigation are not
  browser-verified. `docs/TEST_RESULTS.md` lists each with how to run it.
- **No screenshots.** No browser binary could be installed. Intended routes: `/`,
  `/demo`, `/app/submit`, `/app/review/:id` (findings and Needs human),
  `/app/audit` (before and after Verify chain), `/app/rules`,
  `/app/reliability`, `/app/api`.
- **The Google Docs sidebar has never been installed.** The Apps Script code and
  install guide exist; nothing was run in Google Workspace, so OAuth consent, the
  menu, sidebar rendering, live highlighting and quota behaviour are unverified.
  The script *logic* is covered by `tests/google-docs.test.ts` (23 tests running
  `Code.gs` against mocked `DocumentApp`, `PropertiesService`, `UrlFetchApp` and
  `Utilities`): empty and oversize documents, idempotency-key stability and
  per-field changes, every byte-array shape from `Utilities.computeDigest`,
  status and findings parsing, 401/403/409/429 messages, highlighting,
  span-not-found and clearing highlights. Four bugs those tests found are fixed
  in `Code.gs` (garbage digest from typed arrays, an idempotency key that ignored
  title/channel/team, redirects followed with the bearer key, no `retry-after` on
  429). Everything outside that logic — Google's runtime, permissions screen and
  document rendering — is still untested.

## Review API and webhooks

- **The external receiver did not verify signatures.** Delivery to
  `httpbin.org/post` returned 200 and the failure endpoint returned 500, proving
  the deployed path. Signature verification is proven against a local receiver
  using the same production handler, not by the remote service.
- **Live dead-lettering was not observed.** It needs roughly 9.5 hours of backoff.
  The transition is tested through the real `recordAttempt` mutation with an
  in-memory database, including both the retry schedule and the final `dead`
  state.
- **No receipt endpoint.** The API confirms the receipt manifest (approved status,
  version, all decisions, counts, source). The PDF is generated in the browser.
- **API keys created for the proof remain in the demo workspace** as hashed rows
  named “R3 proof …”. Their plaintext was never written to disk and is not
  recoverable. An admin can revoke them in **API & Webhooks**.

## Model-dependent behaviour

- **The evaluation does not measure the deep lane.** The committed red-team run
  had no model credential locally, so the reported precision/recall covers the
  deterministic rule engine only. No deep-lane precision or recall is claimed.
- **Deep-lane evidence comes from four saved samples plus one live API run.** The
  live API run returned 10 findings, source `live`, not degraded. Four samples and
  one submission are not an accuracy measurement.
- **Saved results exist only for the four seeded samples.** User-entered content
  always tries the live model and falls back to the fast lane with a cause and a
  retry button.
- **The "Needs human" bucket is empty on the current samples.** All saved model
  findings scored 0.9 confidence. The bucket and threshold exist; no seeded sample
  demonstrates it.
- **Model output quality varies.** One API run degraded with `invalid_output` and
  completed on deterministic findings; a later run was clean. Expect the verifier
  to suppress a meaningful share of model findings.
- **Model cost is not budgeted per workspace.** The gateway has a deployment-level
  budget; the per-run cap is 6 calls and 1,100 tokens per call.
- **Legal escalation is a flag**, not a separate legal workspace.

## Visual engine

- **Only generated fixture decks were measured.** No Keynote, PowerPoint or
  Google Slides export was available. Whether a real export crashes the pipeline
  is unverified.
- **Density is a page-level measure.** Its box is the merged dense region (IoU
  0.862), which points at the area to open up rather than a discrete object.
- **The serif check boxes the affected text band**, not exact glyphs (IoU 0.709).
- **Logos are matched with a generated template mask**, not a trained detector. A
  distorted or locked-up logo may be reported missing.
- **No OCR.** Text baked into an image is invisible to the text checks.
- **DOCX is text only.** No visual claim is made for Word documents.

## Analytics

- **The daily cron has not been observed firing** in production.
- **Charts were not visually inspected** at tablet width or with a screen reader.
  Each chart has a text table alternative.
- **The synthetic history repeats its three 30-day shapes across batches in the
  same order**, by design and with distinct seeds. It is labelled synthetic at
  page, row and suggestion level, and removable.

## Product scope

- **Single demo workspace, shared by all visitors.** Anonymous sign-in; anyone
  with the link sees the same Lumora workspace. Do not paste confidential copy.
- **One brand pack at a time.** The compiler can publish a new pack, but there is
  no multi-brand switcher.
- **Text limit is 20,000 characters** per submission, and 1,200 words for
  single-piece review. Longer documents should be split.
- **The receipt is a client-generated PDF** with hashes recorded in the audit
  chain; it is not cryptographically signed by a third party.
- **State-machine transitions are not fuzzed.** The approval gate and API paths
  were exercised; illegal transitions through every possible call were not.

## Platform

- **Hosting is the Freebuff workspace**, not Vercel. There is no Vercel project or
  `maxDuration` setting.
- **Database, auth and storage are Convex**, not Supabase. There is no SQL RLS;
  isolation is enforced in every function.
- **Version control is platform-managed.** Direct git commands are blocked in the
  build sandbox. The changes in this pass are in the working tree and may not yet
  be committed or mirrored to GitHub. `docs/HANDOFF.md` says what to do.
- **Lint has 24 warnings** (fast-refresh warnings in UI library files and unused
  refs). Zero errors.
