import { readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { config } from '../server/env.ts';
import { agentConfiguration } from '../server/agent.ts';

// Provision one dedicated agent. Configuration never goes through stdout or the browser.
if (!config.apiKey || !config.baseUrl.startsWith('https://')) {
  console.error('Configure a private Bolna API key and public HTTPS APP_BASE_URL first.');
  process.exit(1);
}
if (config.agentId) {
  console.error(
    'A dedicated agent is already configured. Use agent:export -- --private to review configuration before updating it.',
  );
  process.exit(1);
}
try {
  const response = await fetch('https://api.bolna.ai/v2/agent', {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(agentConfiguration(config.baseUrl, config.toolSecret)),
    signal: AbortSignal.timeout(30000),
  });
  const result = (await response.json()) as { agent_id?: string; id?: string; detail?: unknown };
  if (!response.ok) {
    console.error(`Agent creation returned HTTP ${response.status}.`);
    if (Array.isArray(result.detail))
      for (const e of result.detail)
        console.error(JSON.stringify({ field: e.loc, reason: e.type }));
    process.exit(1);
  }
  const id = result.agent_id || result.id;
  if (!id || !/^[a-f0-9-]{36}$/i.test(id)) throw new Error('Missing identifier');
  const file = '.env.local',
    text = readFileSync(file, 'utf8');
  writeFileSync(
    file,
    /^BOLNA_AGENT_ID=.*$/m.test(text)
      ? text.replace(/^BOLNA_AGENT_ID=.*$/m, `BOLNA_AGENT_ID=${id}`)
      : `${text}\nBOLNA_AGENT_ID=${id}\n`,
    { mode: 0o600 },
  );
  chmodSync(file, 0o600);
  console.log(
    `Dedicated recovery agent created: ${id}. Private environment updated; restart the app.`,
  );
} catch {
  console.error(
    'Agent creation could not be confirmed. Check Bolna agent history before retrying; do not create duplicates blindly.',
  );
  process.exit(1);
}
