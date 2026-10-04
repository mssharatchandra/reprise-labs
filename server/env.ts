import { existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
if (existsSync('.env.local')) process.loadEnvFile('.env.local');
function amount(value: string | undefined, fallback: number) {
  const n = Number(value ?? fallback);
  return Number.isFinite(n) ? n : fallback;
}
export const config = {
  port: Number(process.env.PORT || 4173),
  host: process.env.HOST || '127.0.0.1',
  database: process.env.DATABASE_PATH || '.local/reprise.db',
  apiKey: process.env.BOLNA_API_KEY || '',
  agentId: process.env.BOLNA_AGENT_ID || '',
  destination: process.env.DEMO_PHONE_NUMBER || '',
  baseUrl: (process.env.APP_BASE_URL || 'http://localhost:4173').replace(/\/$/, ''),
  operatorToken: process.env.OPERATOR_TOKEN || randomBytes(24).toString('hex'),
  toolSecret: process.env.PROVIDER_TOOL_SECRET || randomBytes(24).toString('hex'),
  budgetUsd: Math.min(2, Math.max(0, amount(process.env.LIVE_CALL_BUDGET_USD, 2))),
  reserveUsd: Math.max(0.5, amount(process.env.LIVE_CALL_RESERVE_USD, 0.5)),
  maxCallSeconds: 90,
};
