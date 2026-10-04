import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store, AppError, safeText } from '../server/store.ts';
import { performAction, completePayment } from '../server/policy.ts';
import { startRehearsal, rehearse } from '../server/rehearsal.ts';

function fixture(t: { after: (fn: () => void) => void }, id = 'C001') {
  const store = new Store(':memory:');
  t.after(() => store.close());
  return { store, session: startRehearsal(store, id) };
}
const error = (code: string) => (e: unknown) => e instanceof AppError && e.code === code;
function consent(store: Store, id: string) {
  return performAction(store, id, {
    name: 'record_consent',
    permission: true,
    evidence: 'Yes, I agree to discuss the demo.',
  });
}
test('ten fictional records start without invented recovery results', (t) => {
  const { store } = fixture(t);
  assert.equal(store.allCustomers().length, 10);
  assert.equal(store.allCustomers().filter((c) => c.paymentStatus === 'paid').length, 0);
  assert(store.allCustomers().every((c) => c.email.endsWith('.test')));
});
test('no payment link, callback or review before consent', (t) => {
  const { store, session } = fixture(t);
  for (const action of [
    { name: 'create_payment_link' },
    { name: 'schedule_callback', callbackAt: new Date(Date.now() + 3600000).toISOString() },
    { name: 'escalate_to_human', reason: 'already_paid' },
  ])
    assert.throws(() => performAction(store, session.id, action), error('CONSENT_REQUIRED'));
  assert.equal(store.link('C001'), null);
});
test('strict schemas reject invented amount and chosen customer IDs', (t) => {
  const { store, session } = fixture(t);
  consent(store, session.id);
  assert.throws(
    () =>
      performAction(store, session.id, {
        name: 'create_payment_link',
        amount: 1,
        customerId: 'C002',
      }),
    error('INVALID_ACTION'),
  );
  assert.equal(store.link('C002'), null);
});
test('link creation is idempotent and leaves payment outstanding', (t) => {
  const { store, session } = fixture(t);
  consent(store, session.id);
  const a = performAction(store, session.id, { name: 'create_payment_link' }),
    b = performAction(store, session.id, { name: 'create_payment_link' });
  assert.equal(a.receiptId, b.receiptId);
  assert.equal(a.link?.token, b.link?.token);
  assert.equal(store.events().filter((e) => e.type === 'payment_link_created').length, 1);
  assert.equal(store.customer('C001').paymentStatus, 'outstanding');
});
test('checkout alone confirms payment once and blocks stale recovery receipts', (t) => {
  const { store, session } = fixture(t);
  consent(store, session.id);
  const link = performAction(store, session.id, { name: 'create_payment_link' }).link!;
  assert.equal(completePayment(store, link.token).replayed, false);
  assert.equal(completePayment(store, link.token).replayed, true);
  assert.equal(store.customer('C001').recoveryStatus, 'recovered');
  assert.equal(store.events().filter((e) => e.type === 'payment_confirmed').length, 1);
  assert.throws(
    () => performAction(store, session.id, { name: 'create_payment_link' }),
    error('ALREADY_PAID'),
  );
});
test('explicit idempotency keys cannot be reused for another action or session', (t) => {
  const { store, session } = fixture(t);
  const key = 'shared-request-key';
  performAction(store, session.id, {
    name: 'record_consent',
    permission: true,
    evidence: 'Yes please',
    idempotencyKey: key,
  });
  assert.throws(
    () => performAction(store, session.id, { name: 'create_payment_link', idempotencyKey: key }),
    error('IDEMPOTENCY_CONFLICT'),
  );
  const other = startRehearsal(store, 'C002');
  assert.throws(
    () =>
      performAction(store, other.id, {
        name: 'record_consent',
        permission: true,
        evidence: 'Yes please',
        idempotencyKey: key,
      }),
    error('IDEMPOTENCY_CONFLICT'),
  );
});
test('opt-out works before permission and prevents any future contact', (t) => {
  const { store, session } = fixture(t);
  performAction(store, session.id, { name: 'record_opt_out', evidence: 'Do not call me again.' });
  assert.equal(store.customer('C001').optedOut, true);
  assert(store.session(session.id).endedAt);
  assert.throws(() => startRehearsal(store, 'C001'), error('OPTED_OUT'));
  assert.throws(
    () =>
      performAction(store, session.id, {
        name: 'record_consent',
        permission: true,
        evidence: 'Yes',
      }),
    error('OPTED_OUT'),
  );
});
test('opt-out supersedes cached link and consent requests', (t) => {
  const { store, session } = fixture(t);
  consent(store, session.id);
  performAction(store, session.id, { name: 'create_payment_link' });
  performAction(store, session.id, { name: 'record_opt_out', evidence: 'Remove me.' });
  assert.throws(
    () => performAction(store, session.id, { name: 'create_payment_link' }),
    error('OPTED_OUT'),
  );
  assert.equal(store.customer('C001').callbackAt, null);
});
test('a voluntary checkout after opt-out does not restore permission', (t) => {
  const { store, session } = fixture(t);
  consent(store, session.id);
  const link = performAction(store, session.id, { name: 'create_payment_link' }).link!;
  performAction(store, session.id, { name: 'record_opt_out', evidence: 'Stop contacting me.' });
  completePayment(store, link.token);
  assert.equal(store.customer('C001').paymentStatus, 'paid');
  assert.equal(store.customer('C001').recoveryStatus, 'opted_out');
  assert.equal(store.customer('C001').optedOut, true);
});
test('claimed prior payment creates review without settling the invoice', (t) => {
  const { store, session } = fixture(t, 'C006');
  consent(store, session.id);
  performAction(store, session.id, { name: 'escalate_to_human', reason: 'already_paid' });
  assert.equal(store.customer('C006').paymentStatus, 'outstanding');
  assert.equal(store.customer('C006').reviewReason, 'already_paid');
  assert.throws(() => startRehearsal(store, 'C006'), error('REVIEW_REQUIRED'));
});
test('review supersedes cached payment link and blocks pending checkout', (t) => {
  const { store, session } = fixture(t);
  consent(store, session.id);
  const link = performAction(store, session.id, { name: 'create_payment_link' }).link!;
  performAction(store, session.id, { name: 'escalate_to_human', reason: 'billing_dispute' });
  assert.throws(
    () => performAction(store, session.id, { name: 'create_payment_link' }),
    error('REVIEW_REQUIRED'),
  );
  assert.throws(() => completePayment(store, link.token), error('REVIEW_REQUIRED'));
});
test('revoked mandates cannot produce a link or be recreated', (t) => {
  const { store, session } = fixture(t, 'C004');
  consent(store, session.id);
  assert.throws(
    () => performAction(store, session.id, { name: 'create_payment_link' }),
    error('MANDATE_REVIEW'),
  );
  performAction(store, session.id, { name: 'escalate_to_human', reason: 'mandate_revoked' });
  assert.equal(store.customer('C004').failureCode, 'MANDATE_REVOKED');
});
test('callback validates time horizon and records a request without a new call', (t) => {
  const { store, session } = fixture(t);
  consent(store, session.id);
  for (const delay of [-1000, 30000, 8 * 86400000])
    assert.throws(
      () =>
        performAction(store, session.id, {
          name: 'schedule_callback',
          callbackAt: new Date(Date.now() + delay).toISOString(),
        }),
      error('INVALID_CALLBACK_TIME'),
    );
  performAction(store, session.id, {
    name: 'schedule_callback',
    callbackAt: new Date(Date.now() + 3600000).toISOString(),
  });
  assert(store.customer('C001').callbackAt);
  assert.equal(store.allSessions().length, 1);
});
test('declining permission terminates the session without mutation', (t) => {
  const { store, session } = fixture(t);
  rehearse(store, session.id, 'decline');
  assert.equal(store.session(session.id).status, 'declined');
  assert.equal(store.customer('C001').paymentStatus, 'outstanding');
  assert.throws(
    () => performAction(store, session.id, { name: 'create_payment_link' }),
    error('CONVERSATION_ENDED'),
  );
});
test('expired checkout cannot settle an invoice', (t) => {
  const { store, session } = fixture(t);
  consent(store, session.id);
  const link = performAction(store, session.id, { name: 'create_payment_link' }).link!;
  link.expiresAt = new Date(Date.now() - 1000).toISOString();
  store.saveLink(link);
  assert.throws(() => completePayment(store, link.token), error('LINK_EXPIRED'));
  assert.equal(store.customer('C001').paymentStatus, 'outstanding');
});
test('transactions roll back partial customer mutations and events', (t) => {
  const { store } = fixture(t);
  const events = store.events().length;
  assert.throws(() =>
    store.transaction(() => {
      const c = store.customer('C001');
      c.paymentStatus = 'paid';
      store.saveCustomer(c);
      store.event(c.id, null, 'invalid', 'Invalid', 'rollback', 'checkout');
      throw Error('rollback');
    }),
  );
  assert.equal(store.customer('C001').paymentStatus, 'outstanding');
  assert.equal(store.events().length, events);
});
test('scripted injection and secret prompts cannot mutate payment truth', (t) => {
  const { store, session } = fixture(t);
  rehearse(store, session.id, 'inject');
  const response = rehearse(store, session.id, 'secret');
  assert(response.session.transcript.at(-1)?.text.includes('don’t share'));
  assert(store.allCustomers().every((c) => c.paymentStatus === 'outstanding'));
  assert.equal(store.link('C001'), null);
});
test('sensitive free text is redacted before evidence export', () => {
  assert.equal(
    safeText('phone +919876543210; OTP 123456; key bn-exampleSecret'),
    'phone [phone removed]; OTP [sensitive digits removed]; key [credential removed]',
  );
  assert(!safeText('9876543210').includes('9876543210'));
});
