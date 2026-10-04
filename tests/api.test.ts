import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server/index.ts';
import { Store } from '../server/store.ts';
import { config } from '../server/env.ts';
import { request as httpRequest } from 'node:http';

test('HTTP boundary authenticates operators and scopes provider tools to live capabilities', async (t) => {
  // Explicit fictional credentials make this export check meaningful without a local environment.
  config.apiKey = 'test-only-export-credential';
  const store = new Store(':memory:'),
    server = createApp(store).listen(0, '127.0.0.1');
  await new Promise<void>((r) => server.once('listening', r));
  const address = server.address() as { port: number };
  const base = `http://127.0.0.1:${address.port}`;
  t.after(async () => {
    await new Promise<void>((r) => server.close(() => r()));
    store.close();
  });
  const request = (path: string, body?: unknown, headers: Record<string, string> = {}) =>
    fetch(base + path, {
      method: body ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json', ...headers },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  assert.equal((await request('/api/dashboard')).status, 200);
  assert.equal(
    (await request('/api/dashboard', undefined, { Origin: 'https://evil.example' })).status,
    401,
  );
  const publicRequest = (authorized = false) =>
    new Promise<number>((resolve) => {
      const req = httpRequest(
        base + '/api/dashboard',
        {
          headers: {
            Host: 'public.example',
            ...(authorized ? { Authorization: `Bearer ${config.operatorToken}` } : {}),
          },
        },
        (res) => {
          res.resume();
          res.on('end', () => resolve(res.statusCode!));
        },
      );
      req.end();
    });
  assert.equal(await publicRequest(), 401);
  assert.equal(await publicRequest(true), 200);
  const rehearsal = await (await request('/api/customers/C001/rehearse', {})).json();
  const path = '/api/provider/tools/record_consent',
    token = store.sessionToken(rehearsal.id);
  assert.equal(
    (await request(path, { session_token: token, permission: true, evidence: 'yes' })).status,
    401,
  );
  assert.equal(
    (
      await request(
        path,
        { session_token: token, permission: true, evidence: 'yes' },
        { Authorization: `Bearer ${config.toolSecret}` },
      )
    ).status,
    403,
  );
  const live = store.createSession('C002', 'live', 0.5),
    capability = store.sessionToken(live.id),
    auth = { Authorization: `Bearer ${config.toolSecret}` };
  assert.equal(
    (
      await request(
        path,
        { session_token: capability, permission: 'garbage', evidence: 'yes' },
        auth,
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await request(
        path,
        { session_token: capability, permission: 'True', evidence: 'Yes, I agree.' },
        auth,
      )
    ).status,
    200,
  );
  const response = await (
    await request('/api/provider/tools/create_payment_link', { session_token: capability }, auth)
  ).json();
  assert(response.checkout_url);
  assert.equal(store.customer('C002').paymentStatus, 'outstanding');
  assert.equal(
    (
      await request('/api/provider/webhook', {
        execution_id: '00000000-0000-0000-0000-000000000999',
        status: 'completed',
        payment_status: 'paid',
      })
    ).status,
    202,
  );
  assert.equal(store.customer('C002').paymentStatus, 'outstanding');
  const evidence = JSON.stringify(await (await request('/api/export')).json());
  assert(!evidence.includes(capability));
  assert(!evidence.includes(config.toolSecret));
  assert(!evidence.includes(config.apiKey));
  assert.equal(
    (await request('/api/checkout/' + store.link('C002')!.token + '/confirm', {})).status,
    400,
  );
  assert.equal(
    (await request('/api/checkout/' + store.link('C002')!.token + '/confirm', { simulated: true }))
      .status,
    200,
  );
  assert.equal(store.customer('C002').paymentStatus, 'paid');
});
