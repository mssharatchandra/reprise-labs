import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store, AppError } from '../server/store.ts';
import { config } from '../server/env.ts';
import {
  applyExecution,
  settings,
  startLiveCall,
  verifyProvider,
  verificationFingerprint,
} from '../server/bolna.ts';
import { agentConfiguration } from '../server/agent.ts';
import { performAction } from '../server/policy.ts';

function fixture(t: { after: (fn: () => void) => void }) {
  const s = new Store(':memory:');
  t.after(() => s.close());
  return s;
}
function ready(store: Store) {
  config.apiKey = 'test-only-key';
  config.agentId = '00000000-0000-0000-0000-000000000001';
  config.destination = '+15555550123';
  config.baseUrl = 'https://test.example';
  config.budgetUsd = 2;
  config.reserveUsd = 0.5;
  store.setMeta('provider_verified_agent', config.agentId);
  store.setMeta('provider_verified_url', config.baseUrl);
  store.setMeta('provider_verified_fingerprint', verificationFingerprint());
}
const is = (code: string) => (e: unknown) => e instanceof AppError && e.code === code;
test('provider config verification rejects model or unauthenticated tool drift', async (t) => {
  const store = fixture(t);
  ready(store);
  const original = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = original;
  });
  const agent = agentConfiguration(config.baseUrl, config.toolSecret).agent_config;
  globalThis.fetch = async () => new Response(JSON.stringify(agent));
  assert.equal((await verifyProvider(store)).verified, true);
  agent.tasks[0].tools_config.llm_agent.llm_config.model = 'expensive-model';
  await assert.rejects(() => verifyProvider(store), is('AGENT_CONFIG_MISMATCH'));
});
test('execution must match its session and configured agent', (t) => {
  const store = fixture(t);
  ready(store);
  const s = store.createSession('C001', 'live', 0.5);
  s.executionId = 'execution-1';
  store.saveSession(s);
  assert.throws(
    () =>
      applyExecution(store, s.id, {
        id: 'execution-2',
        agent_id: config.agentId,
        status: 'completed',
      }),
    is('EXECUTION_MISMATCH'),
  );
  assert.throws(
    () =>
      applyExecution(store, s.id, {
        id: 'execution-1',
        agent_id: 'other-agent',
        status: 'completed',
      }),
    is('EXECUTION_MISMATCH'),
  );
  assert.equal(store.session(s.id).status, 'queued');
});
test('terminal callback replay cannot regress status or settle payment', (t) => {
  const store = fixture(t);
  ready(store);
  const s = store.createSession('C001', 'live', 0.5);
  s.executionId = 'execution-1';
  store.saveSession(s);
  const base = { id: s.executionId, agent_id: config.agentId };
  applyExecution(store, s.id, {
    ...base,
    status: 'completed',
    transcript: 'assistant: Your invoice is paid.\nuser: thanks',
    total_cost: 17.25,
    conversation_duration: 20,
  });
  applyExecution(store, s.id, { ...base, status: 'ringing' });
  applyExecution(store, s.id, { ...base, status: 'completed' });
  assert.equal(store.session(s.id).status, 'completed');
  assert.equal(store.customer('C001').paymentStatus, 'outstanding');
  assert.equal(store.session(s.id).costUsd, null);
  assert.equal(store.events().filter((e) => e.type === 'live_call_ended').length, 1);
  assert.equal(settings(store).reservedUsd, 0.5);
});
test('private capability cannot leak in provider transcript', (t) => {
  const store = fixture(t);
  ready(store);
  const s = store.createSession('C001', 'live', 0.5);
  s.executionId = 'execution-1';
  store.saveSession(s);
  const token = store.sessionToken(s.id);
  applyExecution(store, s.id, {
    id: s.executionId,
    agent_id: config.agentId,
    status: 'completed',
    transcript: `assistant: ${token}\nuser: +15555550123`,
  });
  const text = JSON.stringify(store.session(s.id));
  assert(!text.includes(token));
  assert(!text.includes('+15555550123'));
});
test('opt-out remains terminal when the provider later reports a call in progress', (t) => {
  const store = fixture(t);
  ready(store);
  const s = store.createSession('C001', 'live', 0.5);
  s.executionId = 'execution-1';
  s.endedAt = new Date().toISOString();
  s.status = 'completed';
  s.outcome = 'Opted out';
  store.saveSession(s);
  const c = store.customer('C001');
  c.optedOut = true;
  c.recoveryStatus = 'opted_out';
  store.saveCustomer(c);
  applyExecution(store, s.id, {
    id: s.executionId,
    agent_id: config.agentId,
    status: 'in-progress',
  });
  assert.equal(store.session(s.id).status, 'completed');
  assert.equal(store.customer(c.id).optedOut, true);
});
test('unknown acceptance retains reservation and prevents automatic redial', async (t) => {
  const store = fixture(t);
  ready(store);
  const original = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = original;
  });
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    throw Error('network unavailable');
  };
  await assert.rejects(() => startLiveCall(store, 'C001', true));
  assert.equal(store.allSessions()[0].status, 'reconciling');
  assert.equal(settings(store).reservedUsd, 0.5);
  await assert.rejects(() => startLiveCall(store, 'C002', true), is('CALL_IN_PROGRESS'));
  assert.equal(calls, 1);
});
test('live budget prevents a fifth attempt and forbids unconfirmed calls', async (t) => {
  const store = fixture(t);
  ready(store);
  const original = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = original;
  });
  globalThis.fetch = async () => new Response(JSON.stringify({ execution_id: 'test-execution' }));
  await assert.rejects(() => startLiveCall(store, 'C001', false), is('PERMISSION_REQUIRED'));
  for (const customerId of ['C001', 'C002', 'C003', 'C005']) {
    const s = await startLiveCall(store, customerId, true);
    applyExecution(store, s.id, {
      id: s.executionId,
      agent_id: config.agentId,
      status: 'completed',
    });
  }
  assert.equal(settings(store).remainingUsd, 0);
  await assert.rejects(() => startLiveCall(store, 'C006', true), is('LIVE_NOT_READY'));
  assert.equal(store.allSessions().length, 4);
});
test('secret rotation invalidates cached verification before another call', (t) => {
  const store = fixture(t);
  ready(store);
  assert.equal(settings(store).providerVerified, true);
  const original = config.toolSecret;
  t.after(() => {
    config.toolSecret = original;
  });
  config.toolSecret = 'rotated-test-only-secret';
  assert.equal(settings(store).providerVerified, false);
  assert.equal(settings(store).liveReady, false);
});
test('ending recovery permission does not free an ongoing provider call slot', (t) => {
  const store = fixture(t);
  ready(store);
  const s = store.createSession('C001', 'live', 0.5);
  s.executionId = 'test-execution';
  store.saveSession(s);
  performAction(store, s.id, { name: 'record_opt_out', evidence: 'Please stop contacting me.' });
  assert(store.session(s.id).endedAt);
  assert.throws(() => store.createSession('C002', 'live', 0.5), is('CALL_IN_PROGRESS'));
  applyExecution(store, s.id, { id: s.executionId, agent_id: config.agentId, status: 'completed' });
  assert.equal(store.createSession('C002', 'live', 0.5).customerId, 'C002');
});
