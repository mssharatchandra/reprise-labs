import { Store } from '../server/store.ts';
import { config } from '../server/env.ts';
import { verifyProvider } from '../server/bolna.ts';
const store = new Store(config.database);
try {
  console.log(JSON.stringify(await verifyProvider(store), null, 2));
} catch (e) {
  console.error(e instanceof Error ? e.message : 'Provider verification failed.');
  process.exitCode = 1;
} finally {
  store.close();
}
