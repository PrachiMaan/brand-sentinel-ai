# BrandSentinel for Google Docs

A sidebar that reviews the document you are writing against the Lumora brand
pack, shows the verified findings, and records accept / reject / approve
decisions through the same API the web app uses. Decisions land in the same
audit chain.

## What is in this folder

| File | Purpose |
| --- | --- |
| `appsscript.json` | Manifest. Scopes: current document, container UI, external requests. |
| `Code.gs` | Menu, settings, API calls, highlighting. |
| `Sidebar.html` | The panel UI. |

## Install (5 minutes, one Google account)

1. Open the Google Doc you want to review (or a blank one).
2. **Extensions → Apps Script**.
3. In the editor, open **Project Settings** and tick *Show `appsscript.json`
   manifest file in editor*.
4. Replace the contents of `Code.gs` with this folder's `Code.gs`.
5. Create an HTML file named `Sidebar` (File → New → HTML) and paste
   `Sidebar.html` into it.
6. Replace `appsscript.json` with this folder's version.
7. Save, then reload the Google Doc. A **BrandSentinel** menu appears.
8. **BrandSentinel → Open review panel**. Paste your API base URL
   (`https://your-deployment`) and an API key, then Save.

The key is stored in your own user properties. It is never written into the
document or shared with other editors.

## Creating the API key

In the web app, sign in as an admin (demo seat *Ada*), open **API & Webhooks**,
create a key with the scope you need, and copy it once.

- `creator` key: submit only.
- `reviewer` key: submit, accept/edit/reject findings.
- `approver` key: everything above plus approve / reject / needs-revision.

## Using it

1. Choose a channel and team.
2. **Review this document** sends the body text (capped at 20,000 characters)
   with an `Idempotency-Key` derived from the document id and a hash of the
   text. Re-running on unchanged text returns the same submission instead of
   creating a duplicate.
3. The panel polls the status endpoint every 2.5 seconds. If the deep lane is
   degraded the status line says so.
4. Findings list severity, rule, the quoted span and the suggested fix.
5. **Show** highlights the quoted span in the document. If the sentence was
   edited since the review, the panel says *text changed, re-run the review*
   instead of colouring the wrong words. **BrandSentinel → Clear highlights**
   removes all colours.
6. **Accept** / **Reject** record the decision. A rejection needs a reason
   (the reason box at the top of the results panel).
7. With an approver key, **Approve submission** approves when no pending
   critical or high findings remain. Otherwise the API returns 409 and the
   panel shows the message.

## What was verified

- The API endpoints used here (`/api/v1/submissions`, status, findings,
  decision) are covered by the contract and idempotency tests in
  `scripts/api-contract-test.ts` and exercised end to end by
  `scripts/api-demo.ts`, which submits, waits for findings, decides and
  approves without opening the web app.
- The Apps Script files themselves were **not executed inside Google's
  runtime** while building this, because that requires an interactive Google
  account. The code uses only documented `DocumentApp`, `UrlFetchApp`,
  `PropertiesService` and `Utilities` APIs, and the payloads match the
  tested API contract. Treat the first run as an install check: if a call
  fails, the panel shows the API error message and code instead of failing
  silently.

## Limits

- Plain text only. Images and tables in the Doc are not sent, so visual rules
  do not apply to a Docs review.
- The document body is sent to the review pipeline as content. The pipeline
  treats it as data, never as instructions (see the prompt-injection guard in
  `docs/ARCHITECTURE.md`).
- No automatic review on edit. A review is started by the user.
