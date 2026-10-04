import { Store, AppError, now, safeText } from './store.ts';
import { config } from './env.ts';
import { agentConfiguration } from './agent.ts';
import { createHash } from 'node:crypto';
import type { Settings, Session } from '../src/types.ts';

export async function providerRequest(path: string, body?: unknown) {
  if (!config.apiKey)
    throw new AppError(503, 'PROVIDER_NOT_CONFIGURED', 'Configure a Bolna API key privately.');
  const response = await fetch(`https://api.bolna.ai${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok)
    throw new AppError(
      response.status === 429 ? 429 : 502,
      'PROVIDER_ERROR',
      `Bolna returned HTTP ${response.status}. Check provider access and configuration; no automatic retry was attempted.`,
    );
  return response.json() as Promise<Record<string, unknown>>;
}
export function verificationFingerprint() {
  return createHash('sha256')
    .update(
      JSON.stringify({
        agentId: config.agentId,
        apiKey: config.apiKey,
        configuration: agentConfiguration(config.baseUrl, config.toolSecret),
      }),
    )
    .digest('hex');
}
export function settings(store: Store): Settings {
  const reservedUsd = store
    .allSessions()
    .filter((s) => s.mode === 'live')
    .reduce((n, s) => n + s.reservedUsd, 0);
  const checks = [
    {
      key: 'key',
      label: 'Bolna API key',
      ready: !!config.apiKey,
      detail: 'Server-side only. Never sent to the browser.',
    },
    {
      key: 'agent',
      label: 'Recovery agent',
      ready: !!config.agentId,
      detail: 'A dedicated Reprise agent with authenticated tools.',
    },
    {
      key: 'number',
      label: 'Permitted test destination',
      ready: /^\+[1-9]\d{7,14}$/.test(config.destination),
      detail: 'One privately configured number; arbitrary destinations are blocked.',
    },
    {
      key: 'https',
      label: 'Public HTTPS endpoint',
      ready: config.baseUrl.startsWith('https://'),
      detail: 'Needed for Bolna to reach recovery tools. Use a temporary tunnel.',
    },
    {
      key: 'verified',
      label: 'Provider configuration verified',
      ready:
        store.meta('provider_verified_agent') === config.agentId &&
        store.meta('provider_verified_url') === config.baseUrl &&
        store.meta('provider_verified_fingerprint') === verificationFingerprint(),
      detail: 'Verifies the connected agent tool URLs, auth, model and duration cap.',
    },
    {
      key: 'budget',
      label: 'Voice budget available',
      ready: config.budgetUsd - reservedUsd >= config.reserveUsd,
      detail: `$${config.reserveUsd.toFixed(2)} reserved per attempt, including unknown outcomes. Actual provider billing may differ.`,
    },
  ];
  return {
    checks,
    liveReady: checks.every((c) => c.ready),
    budgetUsd: config.budgetUsd,
    reservedUsd,
    remainingUsd: Math.max(0, config.budgetUsd - reservedUsd),
    maxCallSeconds: config.maxCallSeconds,
    agentConfigured: !!config.agentId,
    destinationConfigured: checks[2].ready,
    providerVerified: checks[4].ready,
    lastVerification: store.meta('provider_verified_at'),
    operatorRequired: true,
    permittedDestination: config.destination
      ? 'Private test number configured'
      : 'No test number configured',
    agentId: config.agentId || null,
  };
}
export async function verifyProvider(store: Store) {
  store.setMeta('provider_verified_fingerprint', '');
  if (!config.agentId)
    throw new AppError(503, 'AGENT_REQUIRED', 'Configure the Reprise agent ID first.');
  const agent = await providerRequest(`/v2/agent/${encodeURIComponent(config.agentId)}`);
  const candidate = (agent.agent_config || agent) as Record<string, unknown>;
  const tasks = candidate.tasks as Record<string, unknown>[] | undefined;
  const task = tasks?.[0];
  const toolConfig = task?.tools_config as Record<string, unknown> | undefined;
  const apiTools = toolConfig?.api_tools as
    | {
        tools?: unknown[];
        tools_params?: Record<
          string,
          { url?: string; api_token?: string; method?: string; param?: string }
        >;
      }
    | undefined;
  const cap = (task?.task_config as Record<string, unknown> | undefined)?.call_terminate;
  const llm = (toolConfig?.llm_agent as { llm_config?: { model?: string } } | undefined)
    ?.llm_config;
  const params = apiTools?.tools_params;
  const expected = agentConfiguration(config.baseUrl, config.toolSecret).agent_config.tasks[0]
    .tools_config.api_tools.tools_params;
  if (
    !params ||
    Number(cap) > 90 ||
    !Number(cap) ||
    llm?.model !== 'gpt-4.1-mini' ||
    !Object.entries(expected).every(
      ([name, p]) =>
        params[name]?.url === p.url &&
        params[name]?.api_token === p.api_token &&
        params[name]?.method === p.method &&
        params[name]?.param === p.param,
    )
  )
    throw new AppError(
      409,
      'AGENT_CONFIG_MISMATCH',
      'The agent tools, model or duration cap do not match this app. Export and apply the current agent configuration.',
    );
  store.setMeta('provider_verified_agent', config.agentId);
  store.setMeta('provider_verified_url', config.baseUrl);
  store.setMeta('provider_verified_at', now());
  store.setMeta('provider_verified_fingerprint', verificationFingerprint());
  return {
    verified: true,
    agentId: config.agentId,
    toolCount: Object.keys(expected).length,
    maxCallSeconds: 90,
  };
}
export async function startLiveCall(store: Store, customerId: string, confirmed: boolean) {
  if (!confirmed)
    throw new AppError(
      400,
      'PERMISSION_REQUIRED',
      'Confirm that the configured destination is yours or explicitly permitted.',
    );
  const session = store.transaction(() => {
    const readiness = settings(store);
    if (!readiness.liveReady)
      throw new AppError(
        503,
        'LIVE_NOT_READY',
        'Complete every live setup check before placing a call.',
      );
    return store.createSession(customerId, 'live', config.reserveUsd);
  });
  const customer = store.customer(customerId);
  try {
    const response = await providerRequest('/call', {
      agent_id: config.agentId,
      recipient_phone_number: config.destination,
      user_data: {
        customer_name: customer.name,
        amount_rupees: customer.amount / 100,
        failure_reason: customer.failure,
        recovery_context: customer.description,
        session_token: store.sessionToken(session.id),
      },
    });
    if (typeof response.execution_id !== 'string')
      throw new AppError(
        502,
        'MISSING_EXECUTION',
        'The provider did not return an execution identifier. The attempt requires reconciliation.',
      );
    const current = store.session(session.id);
    current.executionId = response.execution_id;
    store.saveSession(current);
    return current;
  } catch (e) {
    const current = store.session(session.id);
    current.status = 'reconciling';
    current.outcome = 'Provider acceptance unknown; reservation retained';
    store.saveSession(current);
    store.event(
      customerId,
      current.id,
      'provider_unknown',
      'Call needs reconciliation',
      'The request failed or timed out. Do not redial until acceptance is established. Its budget reservation is retained.',
      'live',
    );
    throw e;
  }
}
const terminal = new Set([
  'completed',
  'no-answer',
  'busy',
  'failed',
  'canceled',
  'stopped',
  'error',
  'balance-low',
]);
export function applyExecution(
  store: Store,
  sessionId: string,
  execution: Record<string, unknown>,
) {
  return store.transaction(() => {
    const s = store.session(sessionId);
    if (
      s.mode !== 'live' ||
      !s.executionId ||
      execution.id !== s.executionId ||
      execution.agent_id !== config.agentId
    )
      throw new AppError(403, 'EXECUTION_MISMATCH', 'Execution is not bound to this live session.');
    const status = String(execution.status);
    const alreadyTerminal = store.meta(`execution_terminal:${s.id}`) === 'true';
    if (alreadyTerminal && !terminal.has(status)) return s;
    if (!s.endedAt)
      s.status =
        status === 'in-progress'
          ? 'in-progress'
          : status === 'ringing'
            ? 'ringing'
            : status === 'queued' || status === 'initiated'
              ? 'queued'
              : terminal.has(status)
                ? status === 'completed'
                  ? 'completed'
                  : 'failed'
                : 'reconciling';
    if (terminal.has(status) && !alreadyTerminal) {
      s.endedAt = s.endedAt || now();
      s.outcome = s.outcome || `Provider ${status}`;
      // total_cost is retained only as native provider units in a safe event, never presumed to be USD.
      const transcript = typeof execution.transcript === 'string' ? execution.transcript : '';
      s.transcript = transcript
        .split('\n')
        .filter(Boolean)
        .slice(0, 100)
        .map((line) => ({
          role: /^(user|human|customer):/i.test(line) ? 'customer' : 'agent',
          text: safeText(
            line
              .replace(/^[^:]+:\s*/, '')
              .replaceAll(store.sessionToken(s.id), '[private context removed]'),
          ),
          at: now(),
        }));
      store.setMeta(`execution_terminal:${s.id}`, 'true');
      store.event(
        s.customerId,
        s.id,
        'live_call_ended',
        'Live call finished',
        `Provider status: ${status}. Payment truth remains in the checkout ledger.`,
        'live',
        {
          providerStatus: status,
          durationSeconds:
            typeof execution.conversation_duration === 'number'
              ? execution.conversation_duration
              : null,
          providerCostNative:
            typeof execution.total_cost === 'number' ? execution.total_cost : null,
        },
      );
      if (['no-answer', 'busy'].includes(status)) {
        const c = store.customer(s.customerId);
        if (!c.optedOut && !c.reviewReason && c.paymentStatus !== 'paid') {
          c.recoveryStatus = 'unreachable';
          store.saveCustomer(c);
        }
      }
    }
    store.saveSession(s);
    return s;
  });
}
const polling = new Map<string, number>();
export async function syncExecution(store: Store, id: string) {
  const s = store.session(id);
  if (!s.executionId)
    throw new AppError(
      409,
      'EXECUTION_UNKNOWN',
      'The provider execution ID is unknown. Inspect call history before retrying.',
    );
  if (store.meta(`execution_terminal:${id}`) === 'true') return s;
  if (Date.now() - (polling.get(id) || 0) < 3000) return s;
  polling.set(id, Date.now());
  const execution = await providerRequest(`/executions/${encodeURIComponent(s.executionId)}`);
  return applyExecution(store, id, execution);
}
