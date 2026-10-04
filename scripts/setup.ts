import { existsSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
const file = '.env.local';
let text = readFileSync(existsSync(file) ? file : '.env.example', 'utf8');
for (const key of ['OPERATOR_TOKEN', 'PROVIDER_TOOL_SECRET'])
  if (new RegExp(`^${key}=\\s*$`, 'm').test(text))
    text = text.replace(
      new RegExp(`^${key}=\\s*$`, 'm'),
      `${key}=${randomBytes(24).toString('hex')}`,
    );
writeFileSync(file, text, { mode: 0o600 });
chmodSync(file, 0o600);
console.log(
  'Private environment prepared. Rehearsals need no API credentials. Edit .env.local to enable live voice; never commit it.',
);
