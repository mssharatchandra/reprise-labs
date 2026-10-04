import { mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { Store } from '../server/store.ts';
import { config } from '../server/env.ts';
const store = new Store(config.database);
try {
  const live = store
    .allSessions()
    .filter((s) => s.mode === 'live')
    .reverse();
  if (!live.length || live.some((s) => store.meta(`execution_terminal:${s.id}`) !== 'true'))
    throw Error('Finalize provider executions before capturing evidence.');
  const report = {
    product: 'Reprise Labs',
    capturedAt: new Date().toISOString(),
    source:
      'Authenticated Bolna execution reads plus the local tool and simulated checkout ledger.',
    destination: 'One privately configured number controlled by the test participant; omitted.',
    financialMode: 'simulated',
    transcriptTiming:
      'Utterance order comes from provider transcript. Original per-utterance timestamps are unavailable; timestamps in the app reflect ingestion, not speech timing.',
    attempts: live.map((s, i) => {
      const events = store.events(s.customerId).filter((e) => e.sessionId === s.id);
      const final = events.find((e) => e.type === 'live_call_ended');
      return {
        attempt: i + 1,
        fictionalCustomerId: s.customerId,
        executionFingerprint: createHash('sha256')
          .update(s.executionId || s.id)
          .digest('hex'),
        startedAt: s.createdAt,
        finalizedAt: s.endedAt,
        providerStatus: final?.data.providerStatus,
        conversationDurationSeconds: final?.data.durationSeconds,
        providerCostNative: final?.data.providerCostNative,
        costCurrency: 'Not inferred from the provider response.',
        reservedUsd: s.reservedUsd,
        consentRecorded: s.consent,
        transcript: s.transcript.map(({ role, text }) => ({ role, text })),
        acceptedActions: events
          .filter((e) =>
            [
              'consent_recorded',
              'payment_link_created',
              'callback_requested',
              'review_requested',
              'opt_out_recorded',
            ].includes(e.type),
          )
          .reverse()
          .map((e) => ({ type: e.type, at: e.at, detail: e.detail })),
      };
    }),
    checkoutResults: [...new Set(live.map((s) => s.customerId))].map((id) => ({
      fictionalCustomerId: id,
      paymentStatus: store.customer(id).paymentStatus,
      recoveryStatus: store.customer(id).recoveryStatus,
      checkoutConfirmation: store
        .events(id)
        .filter((e) => e.type === 'payment_confirmed')
        .map((e) => ({ at: e.at, amountPaise: e.data.amount, financialMode: 'simulated' })),
    })),
    limitations: [
      'One answered happy-path call is not a voice-quality benchmark.',
      'Checkout, message delivery and merchant actions are simulated or requests only.',
      'No provider dollar cost inferred; conservative attempt reservations remain in the ledger.',
    ],
  };
  const serialized = JSON.stringify(report, null, 2) + '\n';
  for (const secret of [
    config.apiKey,
    config.toolSecret,
    config.operatorToken,
    config.destination,
    config.destination.replace(/^\+91/, ''),
  ])
    if (secret && serialized.includes(secret)) throw Error('Private data detected in evidence.');
  // Public export is opt-in: read the private copy and remove personal speech before sharing.
  const path = process.argv.includes('--share')
    ? 'artifacts/live-evidence.json'
    : '.local/live-evidence.private.json';
  mkdirSync(path.split('/')[0], { recursive: true });
  writeFileSync(path, serialized, { mode: 0o600 });
  console.log(
    `Finalized call evidence written to ${path}. Review all speech for personal details before publishing.`,
  );
} catch (e) {
  console.error((e as Error).message);
  process.exitCode = 1;
} finally {
  store.close();
}
