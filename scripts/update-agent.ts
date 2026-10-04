import { config } from '../server/env.ts';
import { agentConfiguration } from '../server/agent.ts';
if (!config.apiKey || !config.agentId || !config.baseUrl.startsWith('https://')) {
  console.error('Configure the dedicated agent and public HTTPS endpoint first.');
  process.exit(1);
}
try {
  const response = await fetch(`https://api.bolna.ai/v2/agent/${config.agentId}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(agentConfiguration(config.baseUrl, config.toolSecret)),
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw Error(`Provider returned HTTP ${response.status}.`);
  console.log(
    'Dedicated recovery agent updated. No call was placed. Run provider:check before live testing.',
  );
} catch (e) {
  console.error((e as Error).message);
  process.exitCode = 1;
}
