# Reviewer access and proof files

The public repository is **https://github.com/mssharatchandra/reprise-labs**. No repository access grant is needed.

The app serves these routes when running:

| Route                | Access                                 | Purpose                                                           |
| -------------------- | -------------------------------------- | ----------------------------------------------------------------- |
| `/`                  | No credentials                         | Landing page and playable proof files                             |
| `/demo`              | No credentials                         | Isolated fictional recovery desk; each browser has its own ledger |
| `/workspace`         | Local access or private operator token | Operator ledger and permitted paid-call controls                  |
| `/proof/call-audio`  | No credentials                         | Original permitted phone recording                                |
| `/proof/dashboard`   | No credentials                         | Screen recording of the actual phone demo ledger                  |
| `/proof/walkthrough` | No credentials                         | Separate scripted product walkthrough                             |

Share the repository, the `/demo` URL, and the two original evidence files:

- [Original phone audio](../artifacts/live-call.mp3) — real permitted 77-second provider call. Financial data was fictional. The recording predates the updated WhatsApp/SMS/email wording.
- [Actual dashboard recording](../artifacts/live-dashboard.webm) — the finalized phone transcript, tool journal and checkout receipt in the real local operator ledger. No new call was made while recording it.

Also available: [scripted browser walkthrough](../artifacts/product-walkthrough.webm), [live execution evidence](../artifacts/live-evidence.json), [ten-scenario evaluation](../artifacts/evaluation.json), and setup instructions in the README.

**Reviewer credentials: none.** The demo has no paid-call capabilities. Keep `OPERATOR_TOKEN`, `BOLNA_API_KEY`, `PROVIDER_TOOL_SECRET`, the permitted destination and private exports out of shared materials. There is no public administrator password to include.

A quick-tunnel URL works only while the local server and tunnel remain running. The repository and attached recordings are durable evidence; a long-lived hosted deployment is not part of the current prototype.
