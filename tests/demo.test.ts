import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../server/store.ts';
import { createApp } from '../server/index.ts';
test('public demo isolates ledgers, denies live routes and does not expose operator settings', async (t) => {
  const privateStore = new Store(':memory:'),
    server = createApp(privateStore).listen(0, '127.0.0.1');
  await new Promise<void>((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  t.after(async () => {
    await new Promise<void>((r) => server.close(() => r()));
    privateStore.close();
  });
  const one = await fetch(base + '/api/demo/dashboard', {
    headers: { Origin: 'https://reviewer.example' },
  });
  assert.equal(one.status, 200);
  const cookie = one.headers.get('set-cookie')!.split(';')[0],
    data = await one.json();
  assert.equal(data.settings.liveReady, false);
  assert.equal(data.settings.agentId, null);
  assert.equal(data.settings.operatorRequired, false);
  const post = (path: string, body: unknown) =>
    fetch(base + '/api/demo' + path, {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  const s = await (await post('/customers/C001/rehearse', {})).json();
  await post(`/sessions/${s.id}/respond`, { choice: 'optout' });
  const mine = await (
    await fetch(base + '/api/demo/customers/C001', { headers: { Cookie: cookie } })
  ).json();
  assert.equal(mine.customer.optedOut, true);
  const theirs = await (await fetch(base + '/api/demo/customers/C001')).json();
  assert.equal(theirs.customer.optedOut, false);
  assert.equal(privateStore.customer('C001').optedOut, false);
  for (const path of ['/customers/C002/call', '/provider/verify', '/provider/tools/record_consent'])
    assert.equal((await post(path, { confirmed: true })).status, 404);
  assert.equal(privateStore.allSessions().length, 0);
});
