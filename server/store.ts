import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID, randomBytes } from 'node:crypto';
import { customers } from './seed.ts';
import type { Customer, Session, Event, PaymentLink, ActionReceipt } from '../src/types.ts';

export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export const now = () => new Date().toISOString();
export const safeText = (s: string) =>
  s
    .replace(/(?:bn-|dlogs_)[a-zA-Z0-9_-]+/g, '[credential removed]')
    .replace(/\+\d{8,15}\b/g, '[phone removed]')
    .replace(/\b(?:\d[ -]?){6,19}\b/g, '[sensitive digits removed]')
    .slice(0, 2000);
export class Store {
  db: DatabaseSync;
  constructor(path = '.local/reprise.db') {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS customers (id TEXT PRIMARY KEY, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, customer_id TEXT NOT NULL, token TEXT UNIQUE NOT NULL, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, customer_id TEXT NOT NULL, session_id TEXT, at TEXT NOT NULL, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS links (token TEXT PRIMARY KEY, customer_id TEXT UNIQUE NOT NULL, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS receipts (key TEXT PRIMARY KEY, session_id TEXT NOT NULL, signature TEXT NOT NULL, body TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS events_customer ON events(customer_id, at);
      CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);`);
    const insert = this.db.prepare('INSERT OR IGNORE INTO customers VALUES (?,?)');
    for (const c of customers) insert.run(c.id, JSON.stringify(c));
  }
  transaction<T>(work: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = work();
      this.db.exec('COMMIT');
      return result;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }
  customer(id: string): Customer {
    const row = this.db.prepare('SELECT body FROM customers WHERE id=?').get(id) as
      { body: string } | undefined;
    if (!row) throw new AppError(404, 'NOT_FOUND', 'Customer not found.');
    return JSON.parse(row.body);
  }
  allCustomers(): Customer[] {
    return (
      this.db.prepare('SELECT body FROM customers ORDER BY id').all() as { body: string }[]
    ).map((r) => JSON.parse(r.body));
  }
  saveCustomer(c: Customer) {
    this.db.prepare('UPDATE customers SET body=? WHERE id=?').run(JSON.stringify(c), c.id);
  }
  session(id: string): Session {
    const row = this.db.prepare('SELECT body FROM sessions WHERE id=?').get(id) as
      { body: string } | undefined;
    if (!row) throw new AppError(404, 'NOT_FOUND', 'Conversation not found.');
    return JSON.parse(row.body);
  }
  sessionForToken(token: string): Session {
    const row = this.db.prepare('SELECT body FROM sessions WHERE token=?').get(token) as
      { body: string } | undefined;
    if (!row)
      throw new AppError(403, 'INVALID_SESSION', 'This tool is not bound to a valid conversation.');
    return JSON.parse(row.body);
  }
  sessionToken(id: string): string {
    return (this.db.prepare('SELECT token FROM sessions WHERE id=?').get(id) as { token: string })
      .token;
  }
  allSessions(): Session[] {
    return (
      this.db.prepare('SELECT body FROM sessions ORDER BY rowid DESC').all() as { body: string }[]
    ).map((r) => JSON.parse(r.body));
  }
  saveSession(s: Session) {
    this.db.prepare('UPDATE sessions SET body=? WHERE id=?').run(JSON.stringify(s), s.id);
  }
  createSession(customerId: string, mode: Session['mode'], reservedUsd = 0): Session {
    const customer = this.customer(customerId);
    if (customer.optedOut)
      throw new AppError(409, 'OPTED_OUT', 'This customer has opted out of contact.');
    if (customer.reviewReason)
      throw new AppError(
        409,
        'REVIEW_REQUIRED',
        'Merchant review is required before further recovery.',
      );
    if (customer.paymentStatus === 'paid')
      throw new AppError(409, 'ALREADY_PAID', 'This payment is already confirmed.');
    const open = this.allSessions().find(
      (s) => !s.endedAt && (s.customerId === customerId || (mode === 'live' && s.mode === 'live')),
    );
    if (open)
      throw new AppError(
        409,
        'CALL_IN_PROGRESS',
        'A conversation is already in progress. Open it or finish it first.',
      );
    const s: Session = {
      id: randomUUID(),
      customerId,
      mode,
      status: mode === 'live' ? 'queued' : 'active',
      consent: false,
      createdAt: now(),
      endedAt: null,
      executionId: null,
      transcript: [],
      costUsd: null,
      reservedUsd,
      outcome: null,
    };
    this.db
      .prepare('INSERT INTO sessions VALUES (?,?,?,?)')
      .run(s.id, customerId, randomBytes(24).toString('hex'), JSON.stringify(s));
    customer.attempts += 1;
    this.saveCustomer(customer);
    this.event(
      customerId,
      s.id,
      'conversation_started',
      mode === 'live' ? 'Live call requested' : 'Rehearsal started',
      mode === 'live'
        ? 'One permitted test destination. No automatic redial.'
        : 'Scripted conversation · no provider spend.',
      mode,
    );
    return s;
  }
  event(
    customerId: string,
    sessionId: string | null,
    type: string,
    title: string,
    detail: string,
    mode: Event['mode'],
    data: Event['data'] = {},
  ): Event {
    const e: Event = {
      id: randomUUID(),
      customerId,
      sessionId,
      type,
      title,
      detail: safeText(detail),
      at: now(),
      mode,
      data,
    };
    this.db
      .prepare('INSERT INTO events VALUES (?,?,?,?,?)')
      .run(e.id, customerId, sessionId, e.at, JSON.stringify(e));
    return e;
  }
  events(customerId?: string): Event[] {
    const rows = customerId
      ? this.db
          .prepare('SELECT body FROM events WHERE customer_id=? ORDER BY rowid DESC LIMIT 100')
          .all(customerId)
      : this.db.prepare('SELECT body FROM events ORDER BY rowid DESC LIMIT 100').all();
    return (rows as { body: string }[]).map((r) => JSON.parse(r.body));
  }
  link(customerId: string): PaymentLink | null {
    const r = this.db.prepare('SELECT body FROM links WHERE customer_id=?').get(customerId) as
      { body: string } | undefined;
    return r ? JSON.parse(r.body) : null;
  }
  linkForToken(token: string): PaymentLink {
    const r = this.db.prepare('SELECT body FROM links WHERE token=?').get(token) as
      { body: string } | undefined;
    if (!r) throw new AppError(404, 'NOT_FOUND', 'Payment link not found.');
    return JSON.parse(r.body);
  }
  saveLink(l: PaymentLink) {
    this.db
      .prepare(
        'INSERT INTO links VALUES (?,?,?) ON CONFLICT(token) DO UPDATE SET body=excluded.body',
      )
      .run(l.token, l.customerId, JSON.stringify(l));
  }
  receipt(key: string, sessionId: string, signature: string): ActionReceipt | null {
    const r = this.db.prepare('SELECT * FROM receipts WHERE key=?').get(key) as
      { session_id: string; signature: string; body: string } | undefined;
    if (!r) return null;
    if (r.session_id !== sessionId || r.signature !== signature)
      throw new AppError(
        409,
        'IDEMPOTENCY_CONFLICT',
        'This request identifier was already used for another action.',
      );
    return JSON.parse(r.body);
  }
  saveReceipt(key: string, sessionId: string, signature: string, r: ActionReceipt) {
    this.db
      .prepare('INSERT INTO receipts VALUES (?,?,?,?)')
      .run(key, sessionId, signature, JSON.stringify(r));
  }
  meta(key: string): string | null {
    return (
      (
        this.db.prepare('SELECT value FROM metadata WHERE key=?').get(key) as
          { value: string } | undefined
      )?.value ?? null
    );
  }
  setMeta(key: string, value: string) {
    this.db
      .prepare(
        'INSERT INTO metadata VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
      )
      .run(key, value);
  }
  detail(id: string) {
    return {
      customer: this.customer(id),
      sessions: this.allSessions().filter((s) => s.customerId === id),
      events: this.events(id),
      link: this.link(id),
    };
  }
  close() {
    this.db.close();
  }
}
