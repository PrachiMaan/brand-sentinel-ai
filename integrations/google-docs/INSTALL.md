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

The script logic itself is covered by `tests/google-docs.test.ts`, which runs
`Code.gs` against mocked Apps Script services (see *What was verified*).

## Install (5 minutes, one Google account)

1. Open the Google Doc you want to review (or a blank one).
2. **Extensions → Apps Script**.
3. In the editor, open **Project Settings** and tick *Show `appsscript.json`
   manifest file in editor*.
4. Replace the contents of `Code.gs` with this folder's `Code.gs`.
5. Create an HTML file named `Sidebar` (File → New → HTML) and paste
   `Sidebar.html` into it.
6. Replace `appsscript.json` with this folder's version.
7. Save.

### First run: permissions

The **BrandSentinel** menu only appears after `onOpen` has run once in your
account.

1. In the Apps Script editor, select the function `onOpen` in the function
   dropdown and press **Run**. (Reloading the Google Doc does the same thing.)
2. Google asks for authorization: **Authorization required** →
   **Review permissions** → pick your Google account.
3. You land on a screen that says **"Google hasn't verified this app."** This
   is expected: it is a private script in your own account, so nothing has been
   submitted for Google's review. To continue:
   - click **Advanced** (bottom left of that screen),
   - then **Go to &lt;project name&gt; (unsafe)**,
   - then **Allow** on the consent screen.
   The word "unsafe" refers to the missing third-party review, not to what the
   script does. The three requested scopes are listed in `appsscript.json`:
   edit the current document, show UI in the document, and make external
   requests to your BrandSentinel deployment.
4. Reload the Google Doc — the **BrandSentinel** menu appears in the toolbar.
5. **BrandSentinel → Open review panel**. Paste your API base URL
   (`https://your-deployment`) and an API key, then Save.

The key is stored in your own user properties. It is never written into the
document or shared with other editors.

If step 1 fails with *"You do not have permission to execute that script"* or
the consent screen never appears, your Google Workspace administrator blocks
unverified apps. Run the install from a personal Google account, or ask the
admin to allow the project.

## Creating the API key

In the web app, sign in as an admin (demo seat *Ravi Shah*), open **API &
Webhooks**, create a key with the scope you need, and copy it once.

- `creator` key: submit only.
- `reviewer` key: submit, accept/edit/reject findings.
- `approver` key: everything above plus approve / reject / needs-revision.

## Making a copy for another document

The script is bound to one document, so reviewing a second document needs its
own copy:

1. In the source document: **File → Make a copy**, name it, and open the copy.
   The bound script travels with the document, so steps 2–6 of the install are
   not repeated.
2. **Extensions → Apps Script** in the copy and confirm `Code.gs`, `Sidebar`
   and `appsscript.json` are present.
3. Open the review panel and enter the API base URL and key once. Settings are
   stored per script project, so a copied document starts unconfigured.

To copy the script project itself instead of the document, open the project in
the Apps Script editor, use the project menu (three dots next to the project
name) → **Make a copy**.

## Using it

1. Choose a channel and team.
2. **Review this document** sends the body text (capped at 20,000 characters)
   with an `Idempotency-Key` derived from the document id and a hash of the
   whole request body. Re-running on unchanged text returns the same submission
   instead of creating a duplicate; changing the text, channel, team or title
   starts a new submission rather than a 409 conflict.
3. The panel polls the status endpoint every 2.5 seconds. If the deep lane is
   degraded the status line says so.
4. Findings list severity, rule, the quoted span and the suggested fix.
5. **Show** highlights the quoted span in the document. If the sentence was
   edited since the review, the panel says *text changed, re-run the review*
   instead of colouring the wrong words. **BrandSentinel → Clear highlights**
   removes all colours it added and leaves other highlighting alone.
6. **Accept** / **Reject** record the decision. A rejection needs a reason
   (the reason box at the top of the results panel).
7. With an approver key, **Approve submission** approves when no pending
   critical or high findings remain. Otherwise the API returns 409 and the
   panel shows the message.

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| **401 `unauthorized`** — "Unknown API key" or "That API key is revoked" | The key is wrong, was never copied in full, or has been revoked | Create a new key in **API & Webhooks** (admin seat *Ravi Shah*), copy it once, and paste it under **API settings**. |
| **"This document is empty."** | The body has no text (whitespace only, or content that is only images) | Type or paste the copy first; the sidebar sends plain text only. |
| **Nothing happens when I click the menu item or a button** | `onOpen` has not run yet, or the panel is not configured | Select `onOpen` in the Apps Script editor and press **Run**, then reload the document. If the sidebar is blank, check that `Sidebar.html` was saved with the exact name `Sidebar`. |
| **"Google hasn't verified this app" blocks the run, or a permissions error** | The script is private, so Google shows this screen; a Workspace policy may also block it | Follow *First run: permissions* above (Advanced → Go to project → Allow). If the button is missing or greyed out, the admin blocks unverified apps: use a personal account or ask the admin. |
| **409 `conflict` on submit** | The same idempotency key arrived with a different body | Re-run **Review this document**; the current code derives the key from the whole body, so this should not occur from the sidebar. |
| **429 `rate_limited`** | 60 requests per minute on this key | Wait the number of seconds shown in the message, then poll or re-run. |

## What was verified

- The API endpoints used here (`/api/v1/submissions`, status, findings,
  decision) are covered by the contract and idempotency tests in
  `scripts/api-contract-test.ts` and exercised end to end by
  `scripts/api-demo.ts`, which submits, waits for findings, decides and
  approves without opening the web app.
- `tests/google-docs.test.ts` (23 tests) loads `Code.gs` with `DocumentApp`,
  `PropertiesService`, `UrlFetchApp` and `HtmlService` mocked and drives the
  sidebar entry points: empty and whitespace-only documents, the 20,000
  character cap, idempotency-key stability and how it changes with each body
  field, every byte-array shape `Utilities.computeDigest` returns, status and
  findings parsing, 401 / 403 / 409 / 429 error messages, span highlighting,
  span-not-found, and clearing highlights.
- Those tests found and fixed four defects: the digest produced garbage when
  the runtime returned a typed array; the idempotency key ignored the title,
  channel and team so a re-review of unchanged text could return 409;
  `UrlFetchApp` followed redirects with the bearer key attached; and a 429 did
  not surface the `retry-after` the API sends.
- The Apps Script files were **not executed inside Google's runtime** while
  building this, because that requires an interactive Google account. The code
  uses only documented `DocumentApp`, `UrlFetchApp`, `PropertiesService` and
  `Utilities` APIs, and the payloads match the tested API contract. Treat the
  first run as an install check: if a call fails, the panel shows the API error
  message and code instead of failing silently.

## Limits

- Plain text only. Images and tables in the Doc are not sent, so visual rules
  do not apply to a Docs review.
- The document body is sent to the review pipeline as content. The pipeline
  treats it as data, never as instructions (see the prompt-injection guard in
  `docs/ARCHITECTURE.md`).
- No automatic review on edit. A review is started by the user.
