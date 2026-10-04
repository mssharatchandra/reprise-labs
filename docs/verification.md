# Verification

Observed on 2026-10-04 with Node 26 on macOS:

| Check                            | Observation                                                                                                                                         |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Strict TypeScript and Vite build | Passed                                                                                                                                              |
| Backend tests                    | 29 passed: policies, API auth, provider binding, callback ordering, budget behavior, secret-rotation invalidation and provider call-slot protection |
| Scripted scenarios               | 10/10 passed; zero provider calls; artifact includes accepted events                                                                                |
| Browser flows                    | 5 passed: simulated checkout, durable opt-out, search/export/setup, landing/mobile layout and isolated reviewer browsers                            |
| Provider agent verification      | Six authenticated tool URLs, configured model and 90-second cap verified                                                                            |
| Public endpoint                  | Health reachable; unauthenticated operator API returns 401                                                                                          |
| First permitted live attempt     | Provider returned busy; no conversation, no tool actions, duration 0, provider-native cost 0                                                        |
| Second permitted live attempt    | Answered; completed, 77 seconds; explicit consent and simulated payment-link tool accepted; provider-native cost 9 (currency not inferred)          |
| Live-created checkout            | Confirmed through the browser after the call; only then did the fictional invoice become recovered                                                  |

The first attempt is transport evidence only. The second is an actual answered conversation, with server receipts for permission and link creation. The agent explicitly stated no SMS/email was sent and autopay was unchanged. The browser then confirmed the simulated checkout. [Live evidence](../artifacts/live-evidence.json) records these observations with the private destination, credentials and checkout capability omitted. Total retained attempt reservation: $1.00; this is not a claim of $1.00 actual provider billing.

Original utterance timestamps are unavailable in the provider’s flat transcript. The application preserves utterance order and timestamps ingestion; do not interpret those as speech timing. One answered happy-path call establishes integration, not voice quality across the ten scenarios. The separate [product walkthrough](../artifacts/product-walkthrough.webm) shows a scripted browser rehearsal, not a recorded phone call.

Tests mock the provider network boundary; they make no paid calls. Rehearsal/evaluation conversations are deterministic and intentionally labeled scripted. They demonstrate that the application enforces consent, scopes actions, respects exclusions and separates link creation from settlement; they do not evaluate ASR, interruption or LLM persuasion.

No commercial recovery rate, actual collection, SMS delivery, real gateway integration, production readiness or multilingual quality is claimed. The prototype creates merchant review tasks but has no human review-resolution workflow or real transfer.

## Design and reviewer refresh — 5 October 2026

The original permitted call audio was downloaded unchanged from Bolna. A separate screen recording shows the actual private operator ledger: finalized phone transcript, accepted tools, simulated checkout receipt and live journal. No operator credentials or destination appear on screen. The updated product walkthrough is a separate scripted public-desk rehearsal.

The current agent configuration was updated and verified with proposed WhatsApp/SMS/email delivery and explicit simulation disclosure. No new paid call was made for this wording change; the original recording reflects the previous wording. Both the landing page and proof downloads are public, while operator access remains authenticated.
