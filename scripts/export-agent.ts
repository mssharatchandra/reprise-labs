import { writeFileSync, mkdirSync } from 'node:fs';
import { agentConfiguration } from '../server/agent.ts';
import { config } from '../server/env.ts';
const privateExport = process.argv.includes('--private');
const dest = privateExport
  ? '.local/bolna-agent.private.json'
  : 'artifacts/bolna-agent.template.json';
mkdirSync(privateExport ? '.local' : 'artifacts', { recursive: true });
writeFileSync(
  dest,
  JSON.stringify(
    agentConfiguration(
      privateExport ? config.baseUrl : 'https://YOUR-HTTPS-ENDPOINT',
      privateExport ? config.toolSecret : 'YOUR_PRIVATE_TOOL_SECRET',
    ),
    null,
    2,
  ) + '\n',
  { mode: 0o600 },
);
console.log(`${privateExport ? 'Private' : 'Shareable'} agent configuration written to ${dest}.`);
