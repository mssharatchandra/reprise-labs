import { mkdirSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { Store } from '../server/store.ts';
import { startRehearsal, rehearse } from '../server/rehearsal.ts';
import { completePayment } from '../server/policy.ts';
const store = new Store(':memory:');
const cases = [
  { id: 'C001', choices: ['consent', 'pay', 'finish'], expected: 'recovered', checkout: true },
  { id: 'C002', choices: ['consent', 'pay', 'finish'], expected: 'link_sent' },
  { id: 'C003', choices: ['consent', 'callback', 'finish'], expected: 'callback' },
  { id: 'C004', choices: ['consent', 'mandate', 'finish'], expected: 'review' },
  { id: 'C005', choices: ['consent', 'callback', 'finish'], expected: 'callback' },
  { id: 'C006', choices: ['consent', 'already_paid', 'finish'], expected: 'review' },
  { id: 'C007', choices: ['optout'], expected: 'opted_out' },
  { id: 'C008', choices: ['consent', 'dispute', 'finish'], expected: 'review' },
  { id: 'C009', choices: ['consent', 'cancel', 'finish'], expected: 'review' },
  { id: 'C010', choices: ['no_answer'], expected: 'unreachable' },
];
const results = cases.map((c) => {
  const s = startRehearsal(store, c.id);
  for (const choice of c.choices) rehearse(store, s.id, choice);
  if (c.checkout) completePayment(store, store.link(c.id)!.token);
  const customer = store.customer(c.id);
  assert.equal(customer.recoveryStatus, c.expected);
  assert.equal(customer.paymentStatus, c.checkout ? 'paid' : 'outstanding');
  return {
    customerId: c.id,
    scenario: customer.scenario,
    expected: c.expected,
    actual: customer.recoveryStatus,
    passed: true,
    transcript: store.session(s.id).transcript,
    events: store.events(c.id),
  };
});
mkdirSync('artifacts', { recursive: true });
writeFileSync(
  'artifacts/evaluation.json',
  JSON.stringify(
    {
      product: 'Reprise Labs',
      evaluatedAt: new Date().toISOString(),
      method: 'Deterministic policy rehearsal. Not an LLM quality or live telephony evaluation.',
      passed: results.length,
      total: cases.length,
      providerSpendUsd: 0,
      results,
    },
    null,
    2,
  ) + '\n',
);
store.close();
console.log(
  `${results.length}/${cases.length} policy scenarios passed; synthetic evidence written to artifacts/evaluation.json. No provider calls made.`,
);
