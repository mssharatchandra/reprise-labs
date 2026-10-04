# Recovery tool contract

All live tools use `POST /api/provider/tools/<name>` with `Authorization: Bearer <private tool secret>` and a `session_token` from machine context. This capability resolves the customer on the server. No caller-supplied customer ID, phone number, amount or payment status is accepted. Definitions and provider parameter mappings are generated in `server/agent.ts`; the credential-free provider specification is in `artifacts/bolna-agent.template.json`.

| Tool                 | Arguments beyond session_token        | Result / restriction                                                                  |
| -------------------- | ------------------------------------- | ------------------------------------------------------------------------------------- |
| get_recovery_context | none                                  | Fictional invoice and supported actions; no access to other customers                 |
| record_consent       | permission boolean; quoted evidence   | Records explicit yes/no; a refusal ends the conversation                              |
| create_payment_link  | none                                  | Consent required; creates/reuses an expiring simulated checkout; no SMS or settlement |
| schedule_callback    | callbackAt, ISO timestamp with offset | Consent required; 1 minute–7 days ahead; records a request only                       |
| record_opt_out       | quoted evidence                       | Works before consent; durable exclusion; clears callbacks and ends open sessions      |
| escalate_to_human    | reason enum                           | Consent required; pauses automation and creates review; no actual transfer            |

Review reasons: `already_paid`, `billing_dispute`, `cancellation`, `mandate_revoked`, `customer_request`, `uncertain`. A revoked mandate cannot produce a payment link. Supported live language is English; other language requests should become merchant review.

Success responses include `ok`, `action`, `receiptId` and an accurate message. Link responses contain a checkout URL, `payment_state: outstanding` and `delivery: simulated` with `proposed_channels: ["whatsapp", "sms", "email"]`. Failures are HTTP status + `{ error: { code, message } }`: consent missing (403), invalid capability (403), invalid arguments (400), opt-out/review/ended/state conflicts (409), expired link (410), rate limit (429). The agent must not claim a failed action succeeded.

The internal policy supports explicit idempotency keys for callers of `performAction`; provider calls use semantic, per-session deduplication. Generated provider definitions expose only the minimum arguments. Callback writes do not trigger another outbound call. Replay cannot reinstate eligibility after opt-out/review/settlement.

Local operator endpoints: `GET /api/dashboard`, `GET /api/customers/:id`, `POST /api/customers/:id/rehearse`, `POST /api/sessions/:id/respond`, `POST /api/sessions/:id/end`, `POST /api/customers/:id/call` with `confirmed: true`, `POST /api/sessions/:id/sync`, `POST /api/provider/verify`, and `GET /api/export`. Public hosts need the private operator token. Rehearsal choice controls reject live sessions.

`POST /api/provider/webhook` accepts only a known execution hint and triggers an authenticated provider read. It never trusts supplied transcript, status, payment result or cost. `GET /api/checkout/:token` and `POST /api/checkout/:token/confirm` serve fictional invoices; confirmation explicitly requires `simulated: true`.

The isolated reviewer endpoints use `/api/demo` and an anonymous HttpOnly cookie. They expose only fictional list/get/rehearsal/respond/end/export/checkout operations. They have no live-call, provider-verification or provider-tool routes, and no access to the private operator ledger.
