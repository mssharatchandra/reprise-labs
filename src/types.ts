export type RecoveryStatus =
  'ready' | 'link_sent' | 'callback' | 'review' | 'opted_out' | 'recovered' | 'unreachable';
export type ActionName =
  | 'get_recovery_context'
  | 'record_consent'
  | 'create_payment_link'
  | 'schedule_callback'
  | 'record_opt_out'
  | 'escalate_to_human';
export type SessionStatus =
  | 'active'
  | 'queued'
  | 'ringing'
  | 'in-progress'
  | 'reconciling'
  | 'completed'
  | 'failed'
  | 'declined';
export interface Customer {
  id: string;
  name: string;
  initials: string;
  email: string;
  plan: string;
  amount: number;
  failure: string;
  failureCode: string;
  description: string;
  recommendation: string;
  scenario: string;
  scenarioLabel: string;
  dueDate: string;
  attempts: number;
  paymentStatus: 'outstanding' | 'paid';
  recoveryStatus: RecoveryStatus;
  optedOut: boolean;
  reviewReason: string | null;
  callbackAt: string | null;
}
export interface TranscriptLine {
  role: 'agent' | 'customer';
  text: string;
  at: string;
}
export interface Session {
  id: string;
  customerId: string;
  mode: 'rehearsal' | 'live';
  status: SessionStatus;
  consent: boolean;
  createdAt: string;
  endedAt: string | null;
  executionId: string | null;
  transcript: TranscriptLine[];
  costUsd: number | null;
  reservedUsd: number;
  outcome: string | null;
}
export interface Event {
  id: string;
  customerId: string;
  sessionId: string | null;
  type: string;
  title: string;
  detail: string;
  at: string;
  mode: 'rehearsal' | 'live' | 'checkout';
  data: Record<string, unknown>;
}
export interface PaymentLink {
  token: string;
  customerId: string;
  amount: number;
  status: 'pending' | 'paid';
  createdAt: string;
  expiresAt: string;
}
export interface Detail {
  customer: Customer;
  sessions: Session[];
  events: Event[];
  link: PaymentLink | null;
}
export interface Readiness {
  key: string;
  label: string;
  ready: boolean;
  detail: string;
}
export interface Settings {
  checks: Readiness[];
  liveReady: boolean;
  budgetUsd: number;
  reservedUsd: number;
  remainingUsd: number;
  maxCallSeconds: number;
  agentConfigured: boolean;
  destinationConfigured: boolean;
  providerVerified: boolean;
  lastVerification: string | null;
  operatorRequired: boolean;
  permittedDestination: string;
  agentId: string | null;
}
export interface ActionInput {
  name: ActionName;
  permission?: boolean;
  evidence?: string;
  callbackAt?: string;
  reason?: string;
  idempotencyKey?: string;
}
export interface ActionReceipt {
  ok: true;
  action: ActionName;
  receiptId: string;
  message: string;
  link?: PaymentLink;
  customer?: Customer;
  allowedActions?: string[];
}
export interface Dashboard {
  customers: Customer[];
  events: Event[];
  metrics: {
    outstanding: number;
    recovered: number;
    followUps: number;
    excluded: number;
    links: number;
    liveCalls: number;
    rehearsals: number;
  };
  settings: Settings;
}
