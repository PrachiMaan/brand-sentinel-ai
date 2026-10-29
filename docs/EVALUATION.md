# Evaluation

All numbers below were produced on 29 October 2026 by the commands shown, on
workspace HEAD `2dc752b` plus the uncommitted fixes listed in `docs/AUDIT.md`.
Nothing here is tuned: the result files are written by the runners.

The fixtures and the red-team set are synthetic and authored by the same team
that wrote the engine. Treat every number as a regression result and an upper
bound, not a held-out benchmark.

## 1. Deterministic lane (red-team set)

Command: `bun run eval` → `eval/results.json`, `eval/results.md`,
`public/eval/results.json`.

60 items across six failure modes plus clean controls and two prompt-injection
probes. Matching is item-level per failure mode: a finding on an item counts for
the mode it belongs to, so a false positive on a clean control counts against a
mode's precision.

| Failure mode | Expected | Predicted | Matched | Precision | Recall |
| --- | ---: | ---: | ---: | ---: | ---: |
| tone | 10 | 11 | 10 | 91% | 100% |
| naming | 11 | 12 | 11 | 92% | 100% |
| terminology | 4 | 4 | 4 | 100% | 100% |
| unsupported claim | 12 | 13 | 12 | 92% | 100% |
| expired claim | 8 | 8 | 8 | 100% | 100% |
| visual | 6 | 6 | 6 | 100% | 100% |
| accessibility | 8 | 8 | 8 | 100% | 100% |
| **Overall** | **59** | **62** | **59** | **95.2%** | **100%** |

Other measurements from the same run:

- Median fast lane: **0.153 ms**; median full report: **< 1 ms**, because the
  deep lane returned nothing in this run.
- Prompt-injection probes handled as data with expected findings still firing:
  **2/2**.
- Reviewer errors: **300** (5 reviewers × 60 items). The local shell has no model
  credential, so every deep-lane call failed immediately with `unconfigured`.
- Evidence validity, verifier suppression and "Needs human": **not measurable in
  this run** (0 model findings). `eval/results.json` reports null/zero rather than
  a denominator of zero.
- False positives: one each in tone and naming, none in the other modes.

Reading: the deterministic engine catches every seeded violation and is slightly
over-eager on naming and tone. This is a regression result for the rule engine
only. It is **not** a measurement of the full two-lane pipeline, and no precision
or recall figure is claimed for the deep lane.

The notes in `eval/results.json` say this in the file itself.

## 2. Visual engine

Command: `bun run eval:visual` → `eval/visual-results.json`,
`eval/visual-results.md`.

Two generated decks of 10 pages each: one clean, one with seven injected
violations. Pages are decoded from PNG fixtures rendered from the same geometry
as the PDFs, because this environment has no canvas backend for pdf.js.

| Deck | Pages | Findings | Expected | Detected | IoU ≥ 0.70 | Mean IoU | Runtime |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Clean | 10 | 0 | 0 | 0 | 0 | — | 72.5 ms/page |
| Violations | 10 | 7 | 7 | 7 | **7** | **0.918** | 54.5 ms/page |

Per violation:

| Page | Rule | Result | IoU | Measurement |
| ---: | --- | --- | ---: | --- |
| 2 | VIS-LOGO-MARGIN | found | 0.91 | 0.3% of page width from the left edge |
| 3 | VIS-LOGO-CLEARSPACE | found | 0.95 | 0.16× logo height |
| 4 | VIS-PALETTE | found | 0.998 | #FF2E93, ΔE 65.6 from nearest palette colour |
| 5 | VIS-TYPE-FAMILY | found | 0.709 | 3 text items set in serif |
| 6 | VIS-DENSITY | found | 0.862 | 64.7% of the page covered |
| 7 | VIS-TYPE-SIZE | found | 1.00 | median body size 24.0 pt |
| 10 | VIS-LOGO-PRESENT | found | 1.00 | logo not detected |

Acceptance checks: **5/5 pass**, including density pointing at the dense region.

1. Every injected logo, margin, clear-space and palette violation found.
2. Those violations have IoU ≥ 0.70.
3. The clean deck produces zero findings.
4. No unexpected findings on the violations deck.

Weak spots, stated plainly:

- The density box is the merged dense region rather than a single grid cell.
  Its IoU is 0.862 against the fixture's declared block geometry. It is a
  page-level measure, so it points at the area to open up, not at an object.
- The serif check detects that something is off-family and boxes the affected
  text, not a pixel-perfect glyph region (IoU 0.709).
- Only generated fixtures were measured. A real Keynote/PowerPoint/Google Slides
  export was **not** available in this environment, so "does not crash on a real
  export" is unverified.

## 3. Analytics consistency

Command: `bun run eval:analytics` → `eval/analytics-results.json`.

| Check | Result |
| --- | --- |
| Synthetic history | 283 submissions, 565 findings, 506 decisions, 21 rules, 90 days |
| Stored aggregates vs independent recomputation | 21 rules × 8 fields, **0 mismatches** |
| Recompute twice | **idempotent: true** |
| Rules with decisions / enough data | 21 / 18 (minimum 20 decisions) |
| Top drifting channel | `email`, +0.60 findings per day (1.04 → 1.64), 121 findings |
| Suggested rewordings | **3** (R-TONE-02, R-TERM-03, R-VIS-02), each citing 8 real decisions |
| Method | deterministic template path |
| Overall | **PASS** |

Reading: the aggregate table is derived from raw rows and can be recomputed
exactly. The three seeded contested rules each clear both the disagreement count
and the override-rate threshold without changing either threshold. The check
fails if any evidence id is not a real decision, or if fewer than three
suggestions are produced.

## 4. Deep lane from saved live runs

No API key is provided for this pass, so the deep lane is measured only from
**four saved live runs** made on 29 October 2026 with `gpt-4o-mini` through the
built-in gateway and rulebook `Edition 4 · March 2026`. This is a very small
sample; it is not a precision or recall measurement and none is claimed.

| Sample | Model findings | Kept by verifier | Suppressed | Final findings | Input / output tokens |
| --- | ---: | ---: | ---: | ---: | ---: |
| Launch caption | 10 | 9 | 1 | 14 | 4,588 / 1,123 |
| Launch email | 10 | 4 | 6 | 7 | 4,614 / 1,109 |
| Clean control | 5 | 0 | 5 | 0 | 4,554 / 630 |
| Injection probe | 5 | 3 | 2 | 6 | 4,508 / 577 |
| **Total** | **30** | **16** | **14** | **27** | **18,264 / 3,439** |

What this shows:

- The evidence-or-silence verifier suppressed **14 of 30** model findings (47%)
  on real model output, mostly invented or out-of-scope claims on the clean
  control and the email.
- The injection probe's payload did not become an approval: the run produced
  findings about the content, not an empty list.
- Latency per sample run was 3.6–6.3 s wall clock with all five reviewers
  succeeding.

What it does not show: accuracy at scale, behaviour on long documents, or
stability across model versions. The set is four items.

## 5. Reproducing

```bash
bun install
bunx convex dev --once          # codegen and schema push; needs Convex login
bun run typecheck
bun test
bun run eval                    # deterministic lane; needs no credential
bun run eval:visual
bun run eval:analytics
```

`bun run eval` without a model credential records 300 reviewer errors and
measures the deterministic lane only, exactly as reported above. With a
credential in the Convex deployment, the same command measures the full pipeline;
the runner reports whatever comes back and writes it to the same files.
