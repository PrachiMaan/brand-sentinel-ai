# Two-minute judge walkthrough

Everything below uses seeded Lumora content. No signup. Keep this open on a
second screen.

## 0:00 — Open the app

Landing page. Read the one line at the top: **the brand gate you can audit.**
Click **Try the demo**.

## 0:10 — Choose the Creator seat

Four cards. Click **Maya Rao, Creator**. You land on the queue.

Say: *"The whole workspace is seeded with Lumora: a rulebook, a claim ledger with
an expiring claim, a palette and a guideline PDF. Nothing here is a mock response;
findings are stored."*

## 0:20 — Submit

Click **New submission**. Press **Load Lumora sample**. Point at three things:

- the caption loads with an off-palette launch image,
- the alt text is prefilled, and the channel is Instagram,
- the hex pair is a contrast risk.

Press **Submit for review**.

## 0:30 — The fast lane

The review page opens. Within a second, findings are already visible: the product
name shortened to "Glow Serum", the banned word "miracle", an expired 7-day claim,
and contrast below 4.5:1. Point at the highlighted span and the guideline excerpt.

Say: *"This is plain TypeScript, not a model. Median 0.23 milliseconds on 60 seeded
items. It also works if the model is unavailable."*

If the deep lane reports a gateway error, say so plainly: *"The model budget is
exhausted today, so the app is in degraded mode. The banner names the failure and
the deterministic findings are complete. I will not pretend otherwise."* Do not
skip this; judges check honesty.

## 0:50 — Human review

Switch the role in the header to **Reviewer** (Dev Kapoor). Open a finding:

- **Accept** the naming fix; the tracked diff appears.
- **Reject** one finding with a reason, for example *"Deliberate campaign
  shorthand, approved by brand lead."*
- Add a comment.

If the model returns findings, point at the suppression counter: *"The verifier
removed N model findings whose span or rule could not be checked. It never
silently drops; the count and reasons are here."* In degraded mode the counter is
zero and the banner explains why.

## 1:10 — Approver

Switch to **Ines Alvarez, Approver**. Point at the approval lock: it stays locked
until every verified critical and high finding has a decision.

Press **Approve version**. Then **Export review receipt**. The PDF downloads with
the version hash, findings, decisions, models used and the AI disclosure.

## 1:30 — Audit chain

Open **Audit trail** from the sidebar. Press **Verify chain**. It recomputes every
row's SHA-256 hash and the prev_hash link, and reports pass or the first broken
row.

Say: *"Append-only, hash-chained. The receipt hash is in here too."*

## 1:45 — Depth, if asked

- **Rule Health**: override rate per rule, from real decisions.
- **Rulebook**: 14 typed rules; the compiler path for PDF/DOCX/CSV is built but
  needs the model.
- **Reliability**: call log, verifier stats, last eval. Open `eval/results.json`
  in the repo for the per-failure-mode table.
- **Eval**: 60 items, 95% precision, 100% recall, deterministic-only run. Say the
  set is seeded from the same rulebook, so it is an upper bound.

## Close

*"One loop: submit, evidence-backed findings, human decision, approval, receipt,
audit. Round 3 adds page-level visual review, drift analytics and the Docs
integration. Everything shown here exists; the limitations are in the README."*
