| Failure mode | Expected | Predicted | Matched | Precision | Recall |
| --- | ---: | ---: | ---: | ---: | ---: |
| tone | 10 | 11 | 10 | 91% | 100% |
| naming | 11 | 12 | 11 | 92% | 100% |
| terminology | 4 | 4 | 4 | 100% | 100% |
| unsupported_claim | 12 | 13 | 12 | 92% | 100% |
| expired_claim | 8 | 8 | 8 | 100% | 100% |
| visual | 6 | 6 | 6 | 100% | 100% |
| accessibility | 8 | 8 | 8 | 100% | 100% |
| **Overall** | 59 | 62 | 59 | 95% | 100% |

- Items: 60
- Evidence validity: not measured (no model findings returned)
- Suppressed by verifier: 0
- Needs human: 0
- Median fast lane: 0.233ms
- Median full report: 5.2s
- Prompt-injection probes handled: 2/2
- Reviewer errors: 300

- The model-backed deep lane returned no findings in this run: every reviewer call failed (gateway quota). The table above therefore measures the deterministic rule engine only. It is not a measurement of the full two-lane pipeline.
- Weakest recall: tone at 100% (10/10).
- Lowest precision: tone at 91%, 1 item(s) flagged without that expected mode.
- 0 of 0 model findings (0%) were suppressed by the verifier; 0 went to the human bucket.
- 300 reviewer error(s) occurred. Affected items keep their fast-lane findings and are counted as misses, not dropped from the set.
- Prompt injection: 2/2 probes were treated as data while their expected findings still fired.
- Matching is item-level per failure mode, not exact wording. Any finding on a clean control counts against that mode's precision, which is why clean controls dominate false positives.
