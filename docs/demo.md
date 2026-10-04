# Demo guide

## Three-minute product walkthrough

1. Open the recovery workspace. Show all ten fictional failed renewals and the initial outstanding balance. Select Aanya. Her failure category is a gateway fact, not an inferred bank diagnosis.
2. Start a free rehearsal. Before permission, there is no payment-link button. Grant permission; then create a link. The event says **no message was sent** and the invoice stays outstanding.
3. Open simulated checkout, confirm it, and return. Recovered value changes only after checkout confirmation. Finish the conversation. Open Activity journal to inspect the permission, link and checkout events.
4. Select Nisha and opt out before permission. New contact is disabled and survives refresh. Select Arjun, grant permission, and choose “already paid”: a merchant review task appears, but his invoice remains outstanding.
5. Open Trust & decisions and Live voice setup. Explain the recorded evidence, private destination, provider verification and attempt budget.

## Permitted real phone demonstration

Complete README live setup. Choose an eligible fictional customer and call the privately configured number you control or have explicit permission to use. Play the customer, not a real debtor:

> Yes, I’m happy to discuss this fictional payment. Please create a payment link.

Expect permission and link tool receipts in the merchant journal. The agent should explain that the checkout is simulated and available in the workspace. It should not say an SMS was sent or payment collected. End politely. Wait for the final provider execution before inspecting its redacted transcript, then complete the simulated checkout yourself.

An unanswered/busy call proves dialing, not an agent conversation. Do not count it as an end-to-end voice success. Unknown provider acceptance requires reconciliation before any new attempt. The app does not automatically retry.

## Fictional scenarios

| ID   | Fictional customer | Intended exercise                                 |
| ---- | ------------------ | ------------------------------------------------- |
| C001 | Aanya Rao          | Willing to pay; one-off simulated checkout        |
| C002 | Kabir Shah         | Expired card; link created, payment still pending |
| C003 | Meera Iyer         | Temporary bank failure; callback request          |
| C004 | Rohan Das          | Revoked mandate; merchant review                  |
| C005 | Sana Khan          | Busy; request callback                            |
| C006 | Arjun Menon        | Claims prior payment; reconciliation review       |
| C007 | Nisha Patel        | Stop contact before permission                    |
| C008 | Dev Kapoor         | Billing dispute; review lock                      |
| C009 | Tara Sen           | Cancellation request; no actual cancellation      |
| C010 | Vikram Joshi       | No answer; no assumed consent/redial              |

These are contexts for exploration, not forced live outcomes. The person answering the permitted test call can choose any supported path.
