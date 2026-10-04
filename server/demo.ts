import express, { type Request } from 'express';
import { randomBytes } from 'node:crypto';
import { Store, AppError } from './store.ts';
import { startRehearsal, rehearse, endSession } from './rehearsal.ts';
import { completePayment } from './policy.ts';

// Separate in-memory ledger for each reviewer. This router has no provider dependency or live route.
export function demoRouter() {
  const router = express.Router();
  const ledgers = new Map<string, { store: Store; expires: number }>();
  const ledger = (req: Request, res: express.Response) => {
    for (const [id, l] of ledgers)
      if (l.expires < Date.now()) {
        l.store.close();
        ledgers.delete(id);
      }
    let id = (req.headers.cookie || '').match(/(?:^|;\s*)reprise_demo=([a-f0-9]{48})(?:;|$)/)?.[1];
    if (!id || !ledgers.has(id)) {
      if (ledgers.size >= 100)
        throw new AppError(
          429,
          'DEMO_CAPACITY',
          'The demo desk is busy. Please try again shortly.',
        );
      id = randomBytes(24).toString('hex');
      ledgers.set(id, { store: new Store(':memory:'), expires: Date.now() + 2 * 3600000 });
      res.setHeader(
        'Set-Cookie',
        `reprise_demo=${id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=7200`,
      );
    }
    return ledgers.get(id)!.store;
  };
  router.use((req, res, next) => {
    try {
      res.locals.store = ledger(req, res);
      next();
    } catch (e) {
      next(e);
    }
  });
  const store = (res: express.Response) => res.locals.store as Store;
  router.get('/dashboard', (_req, res) => {
    const s = store(res),
      customers = s.allCustomers(),
      sessions = s.allSessions();
    res.json({
      customers,
      events: s.events(),
      settings: {
        checks: [],
        liveReady: false,
        budgetUsd: 0,
        reservedUsd: 0,
        remainingUsd: 0,
        maxCallSeconds: 90,
        agentConfigured: false,
        destinationConfigured: false,
        providerVerified: false,
        lastVerification: null,
        operatorRequired: false,
        permittedDestination: 'Live calling is disabled in the public demo.',
        agentId: null,
      },
      metrics: {
        outstanding: customers
          .filter((c) => c.paymentStatus === 'outstanding')
          .reduce((n, c) => n + c.amount, 0),
        recovered: customers
          .filter((c) => c.paymentStatus === 'paid')
          .reduce((n, c) => n + c.amount, 0),
        followUps: customers.filter((c) => c.callbackAt || c.reviewReason).length,
        excluded: customers.filter((c) => c.optedOut).length,
        links: customers.filter((c) => !!s.link(c.id)).length,
        liveCalls: 0,
        rehearsals: sessions.length,
      },
    });
  });
  router.get('/customers/:id', (req, res, next) => {
    try {
      res.json(store(res).detail(String(req.params.id)));
    } catch (e) {
      next(e);
    }
  });
  router.post('/customers/:id/rehearse', (req, res, next) => {
    try {
      res.status(201).json(startRehearsal(store(res), String(req.params.id)));
    } catch (e) {
      next(e);
    }
  });
  router.post('/sessions/:id/respond', (req, res, next) => {
    try {
      res.json(rehearse(store(res), String(req.params.id), req.body?.choice));
    } catch (e) {
      next(e);
    }
  });
  router.post('/sessions/:id/end', (req, res, next) => {
    try {
      res.json(endSession(store(res), String(req.params.id)));
    } catch (e) {
      next(e);
    }
  });
  router.get('/checkout/:token', (req, res, next) => {
    try {
      const s = store(res),
        link = s.linkForToken(String(req.params.token)),
        c = s.customer(link.customerId);
      res.json({ link, customerName: c.name, plan: c.plan, blocked: !!c.reviewReason });
    } catch (e) {
      next(e);
    }
  });
  router.post('/checkout/:token/confirm', (req, res, next) => {
    try {
      if (req.body?.simulated !== true)
        throw new AppError(400, 'SIMULATION_REQUIRED', 'Only simulated payments are supported.');
      const r = completePayment(store(res), String(req.params.token));
      res.json({
        link: r.link,
        receiptId: `SIM-${r.link.token.slice(0, 8).toUpperCase()}`,
        replayed: r.replayed,
      });
    } catch (e) {
      next(e);
    }
  });
  router.get('/export', (_req, res) => {
    const s = store(res);
    res.json({
      product: 'Reprise',
      financialMode: 'simulated',
      source: 'Isolated reviewer rehearsal',
      customers: s.allCustomers(),
      sessions: s.allSessions(),
      events: s.events(),
    });
  });
  router.use((_req, res) =>
    res.status(404).json({
      error: {
        code: 'DEMO_ROUTE_UNAVAILABLE',
        message:
          'This public desk supports fictional rehearsals only. Live calls and provider controls are unavailable.',
      },
    }),
  );
  return router;
}
