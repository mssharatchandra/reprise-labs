# dlogs experiment

dlogs was used as development decision provenance. It is not connected to the runtime recovery policy and receives no phone numbers, credentials or real customer data from this project.

Before implementation, a task-context query for `mssharatchandra/reprise-labs` returned no relevant active decisions. A later file-context query for `server/bolna.ts` returned exactly:

```json
{ "decisions": [], "total": 0, "page": 1, "page_size": 10 }
```

Consequential choices were emitted using `emit_decision_signal`:

1. One TypeScript service, local SQLite, authoritative typed tools and conservative live-call reservations — proposal **#171**.
2. Authenticated provider reconciliation and terminal-state protection — proposal **#172**.
3. Durable customer exclusions before replaying recovery receipts — proposal **#173**.
4. Public demos use the production bundle; development file/HMR middleware remains local — proposal **#174**.
5. A live transport slot is released only after provider terminal confirmation — a final proposal emitted with the call-slot regression test.

All five returned **“Sent for human review”**, explicitly stating they become decisions only after approval. A queued proposal is not an active decision ID and was not treated as recalled guidance. An initial third signal with an unsupported decision category was rejected; it was corrected to `architecture`.

Later in this build, the first two proposals appeared as approved, active decisions. `get_context_for_file` on `server/policy.ts` returned [DEC-2026-0002](https://record.dlogs.app/decisions/DEC-2026-0002), “Keep recovery truth in durable tools and reserve paid voice for explicit tests.” A task-context query for final settlement verification and provider configuration hardening returned both that decision and [DEC-2026-0001](https://record.dlogs.app/decisions/DEC-2026-0001), “Reconcile voice callbacks through authenticated reads; preserve attempt reservations,” with file-scope and semantic matches.

**Observed usefulness:** authentication, proposal review, file retrieval and semantic task recall all worked. The empty initial query was neutral. Later recall reinforced keeping attempt reservations and using checkout ledger evidence for settlement; it informed the final review and documentation. Configuration hardening additionally invalidates cached provider verification after secret/configuration changes. This is an emission → approval → recall round trip, not proof that dlogs independently discovered a bug or improved recovery rates. Proposals #173 and #174 had not appeared as active decisions in the latest observed retrieval. Influence feedback recorded the later retrieval as used/useful for final verification, with no newly prevented mistake claimed.

Nothing in this prototype depends on dlogs availability. Its review queue is human engineering review, not a permission gate for individual customer recovery actions.
