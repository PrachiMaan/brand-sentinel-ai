# Roadmap

What is planned next, in the order it should be done. Items here are not built
unless they also appear in `docs/FEATURES.md`.

## Close the verification gaps first

1. **Browser pass on the live app.** Walk Creator → Reviewer → Approver in a
   private window, then the break-it list in `docs/TEST_RESULTS.md`. Capture the
   screenshots listed in `docs/KNOWN_LIMITATIONS.md`.
2. **API contract tests with a live key.** Assert the OpenAPI document against
   real responses, idempotent replay, 409 on body conflict, 403 on wrong scope and
   429 with `retry-after`.
3. **Webhook receiver test.** A local receiver that verifies the HMAC, a forced
   failure to exercise the backoff, and a dead-letter assertion.
4. **Google Docs install.** Follow `integrations/google-docs/INSTALL.md` in a real
   Workspace account and record what breaks.

## Deep lane quality

5. **Measure the deep lane properly.** Re-run `bun run eval` with a credential and
   report precision, recall, verifier suppression and "Needs human" counts for the
   full pipeline, not only the rule engine.
6. **A seeded borderline case** so the Needs human bucket is visible in the demo.
7. **Prompt regression fixtures.** Store a handful of recorded model responses and
   test the verifier and synthesizer against them offline.

## Analytics

8. **A third suggested rewording.** Add a rule that clears the evidence threshold
   honestly, rather than lowering it. Or show why only two rules are actionable.
9. **Chain re-verification after synthetic removal**, as an automated check.
10. **Chart accessibility review** at tablet width and with a screen reader.

## Visual engine

11. **Real slide exports.** Test decks exported from Keynote, PowerPoint and
    Google Slides; record detection quality separately from the fixture results.
12. **Better logo handling.** Multiple lockups and a tolerance for distortion,
    instead of one generated template.
13. **Text-in-image checks** via OCR for headline casing and contrast.

## Integration

14. **`scripts/api-demo.ts`**: submit → findings → decision → approved → receipt
    with nothing but a key and Node.
15. **API reference page** generated from the OpenAPI document rather than
    maintained by hand.
16. **Webhook event coverage** for rejected and needs-revision, with a replay
    button in the admin UI.

## Later, explicitly not started

Brand Drift alerting (email/Slack digests), multi-brand workspaces, SSO,
fine-tuning, video review, auto-publish. None of these appear in the product.
