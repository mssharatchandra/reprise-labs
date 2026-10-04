import express, { type Request, type Response, type NextFunction } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Store, AppError } from './store.ts';
import { config } from './env.ts';
import { settings, verifyProvider, startLiveCall, syncExecution } from './bolna.ts';
import { performAction, completePayment } from './policy.ts';
import { startRehearsal, rehearse, endSession } from './rehearsal.ts';
import { demoRouter } from './demo.ts';
import { existsSync, readFileSync } from 'node:fs';

function secretMatches(value: string, expected: string) {
  const a = Buffer.from(value),
    b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
function localOperator(req: Request) {
  const host = req.headers.host || '';
  const socket = req.socket.remoteAddress || '';
  return (
    ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(socket) &&
    /^(localhost|127\.0\.0\.1|\[::1\]):\d+$/.test(host) &&
    (!req.headers.origin || req.headers.origin === `http://${host}`)
  );
}
const wrap =
  (fn: (req: Request, res: Response) => unknown) =>
  (req: Request, res: Response, next: NextFunction) =>
    Promise.resolve()
      .then(() => fn(req, res))
      .catch(next);
export function createApp(store: Store) {
  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Frame-Options', 'DENY');
    next();
  });
  app.use(express.json({ limit: '32kb' }));
  const rate = new Map<string, { at: number; n: number }>();
  app.use('/api', (req, res, next) => {
    const key =
      (req.socket.remoteAddress || 'local') +
      ':' +
      (req.path.startsWith('/provider') ? 'provider' : 'operator');
    let bucket = rate.get(key);
    if (!bucket || Date.now() - bucket.at > 60000) {
      bucket = { at: Date.now(), n: 0 };
      rate.set(key, bucket);
    }
    bucket.n++;
    if (rate.size > 1000) for (const [k, b] of rate) if (Date.now() - b.at > 60000) rate.delete(k);
    if (bucket.n > 180) {
      res.setHeader('Retry-After', '60');
      return res.status(429).json({
        error: { code: 'RATE_LIMITED', message: 'Too many requests. Try again in a minute.' },
      });
    }
    next();
  });
  const operator = (req: Request, res: Response, next: NextFunction) => {
    const bearer = (req.headers.authorization || '').replace(/^Bearer /, '');
    if (localOperator(req) || secretMatches(bearer, config.operatorToken)) return next();
    res.status(401).json({
      error: {
        code: 'OPERATOR_AUTH_REQUIRED',
        message: 'Open the local workspace, or enter your private operator token.',
      },
    });
  };
  app.get('/healthz', (_req, res) => res.json({ ok: true, service: 'reprise-labs' }));
  app.use('/api/demo', demoRouter());
  app.get('/api/proof', (_req, res) =>
    res.json({
      recordingAvailable: existsSync(resolve('artifacts/live-call.mp3')),
      voice: JSON.parse(readFileSync(resolve('artifacts/live-evidence.json'), 'utf8')),
    }),
  );
  app.get('/proof/call-audio', (_req, res) => {
    const file = resolve('artifacts/live-call.mp3');
    if (!existsSync(file)) return res.status(404).send('Recording unavailable.');
    res.type('audio/mpeg').sendFile(file);
  });
  app.get('/proof/walkthrough', (_req, res) => {
    const file = resolve('artifacts/product-walkthrough.webm');
    if (!existsSync(file)) return res.status(404).send('Walkthrough unavailable.');
    res.type('video/webm').sendFile(file);
  });
  app.get('/proof/dashboard', (_req, res) => {
    const file = resolve('artifacts/live-dashboard.webm');
    if (!existsSync(file)) return res.status(404).send('Dashboard recording unavailable.');
    res.type('video/webm').sendFile(file);
  });
  app.get('/api/dashboard', operator, (_req, res) => {
    const customers = store.allCustomers(),
      sessions = store.allSessions();
    res.json({
      customers,
      events: store.events(),
      settings: settings(store),
      metrics: {
        outstanding: customers
          .filter((c) => c.paymentStatus === 'outstanding')
          .reduce((n, c) => n + c.amount, 0),
        recovered: customers
          .filter((c) => c.paymentStatus === 'paid')
          .reduce((n, c) => n + c.amount, 0),
        followUps: customers.filter((c) => c.callbackAt || c.reviewReason).length,
        excluded: customers.filter((c) => c.optedOut).length,
        links: customers.filter((c) => !!store.link(c.id)).length,
        liveCalls: sessions.filter((s) => s.mode === 'live').length,
        rehearsals: sessions.filter((s) => s.mode === 'rehearsal').length,
      },
    });
  });
  app.get(
    '/api/customers/:id',
    operator,
    wrap((req, res) => res.json(store.detail(String(req.params.id)))),
  );
  app.post(
    '/api/customers/:id/rehearse',
    operator,
    wrap((req, res) => res.status(201).json(startRehearsal(store, String(req.params.id)))),
  );
  app.post(
    '/api/sessions/:id/respond',
    operator,
    wrap((req, res) => res.json(rehearse(store, String(req.params.id), req.body?.choice))),
  );
  app.post(
    '/api/sessions/:id/end',
    operator,
    wrap((req, res) => res.json(endSession(store, String(req.params.id)))),
  );
  app.post(
    '/api/customers/:id/call',
    operator,
    wrap(async (req, res) =>
      res
        .status(201)
        .json(await startLiveCall(store, String(req.params.id), req.body?.confirmed === true)),
    ),
  );
  app.post(
    '/api/sessions/:id/sync',
    operator,
    wrap(async (req, res) => res.json(await syncExecution(store, String(req.params.id)))),
  );
  app.post(
    '/api/provider/verify',
    operator,
    wrap(async (_req, res) => res.json(await verifyProvider(store))),
  );
  app.post(
    '/api/provider/tools/:name',
    wrap((req, res) => {
      if (
        !secretMatches((req.headers.authorization || '').replace(/^Bearer /, ''), config.toolSecret)
      )
        throw new AppError(401, 'TOOL_AUTH_REQUIRED', 'Provider authentication failed.');
      const { session_token, ...args } = req.body || {};
      if (typeof session_token !== 'string' || !/^[a-f0-9]{48}$/.test(session_token))
        throw new AppError(403, 'INVALID_SESSION', 'Valid conversation capability required.');
      const session = store.sessionForToken(session_token);
      if (session.mode !== 'live')
        throw new AppError(403, 'WRONG_MODE', 'Provider tools cannot act on a rehearsal.');
      if (String(req.params.name) === 'record_consent' && typeof args.permission === 'string') {
        if (!['true', 'false', 'True', 'False'].includes(args.permission))
          throw new AppError(400, 'INVALID_PERMISSION', 'Permission must be true or false.');
        args.permission = args.permission.toLowerCase() === 'true';
      }
      const receipt = performAction(store, session.id, { ...args, name: String(req.params.name) });
      const { link, ...safe } = receipt;
      res.json({
        ...safe,
        ...(link
          ? {
              checkout_url: `${config.baseUrl}/checkout/${link.token}`,
              payment_state: 'outstanding',
              delivery: 'simulated',
              proposed_channels: ['whatsapp', 'sms', 'email'],
            }
          : {}),
      });
    }),
  );
  app.post(
    '/api/provider/webhook',
    wrap(async (req, res) => {
      const id = req.body?.id || req.body?.execution_id;
      if (typeof id !== 'string' || !/^[a-f0-9-]{36}$/i.test(id))
        throw new AppError(400, 'INVALID_EXECUTION', 'An execution ID is required.');
      const session = store.allSessions().find((s) => s.mode === 'live' && s.executionId === id);
      if (!session) return res.status(202).json({ accepted: true });
      // Never trust the callback payload as truth. Refetch through the authenticated provider API.
      await syncExecution(store, session.id);
      res.json({ accepted: true });
    }),
  );
  app.get(
    '/api/checkout/:token',
    wrap((req, res) => {
      const link = store.linkForToken(String(req.params.token)),
        c = store.customer(link.customerId);
      res.json({ link, customerName: c.name, plan: c.plan, blocked: !!c.reviewReason });
    }),
  );
  app.post(
    '/api/checkout/:token/confirm',
    wrap((req, res) => {
      if (req.body?.simulated !== true)
        throw new AppError(
          400,
          'SIMULATION_REQUIRED',
          'This checkout only supports simulated confirmation.',
        );
      const result = completePayment(store, String(req.params.token));
      res.json({
        link: result.link,
        receiptId: `SIM-${result.link.token.slice(0, 8).toUpperCase()}`,
        replayed: result.replayed,
      });
    }),
  );
  app.get('/api/export', operator, (_req, res) => {
    res.setHeader('Content-Disposition', 'attachment; filename="reprise-evidence.json"');
    res.json({
      product: 'Reprise Labs',
      exportedAt: new Date().toISOString(),
      financialMode: 'simulated',
      customers: store.allCustomers(),
      sessions: store.allSessions(),
      events: store.events(),
      limitations: [
        'Rehearsals are scripted, not LLM evaluations.',
        'Only live provider events are evidence of phone transport.',
        'Payments and message delivery are simulated.',
        'No autonomous mandate changes, debits, transfers, or cancellations.',
      ],
    });
  });
  app.use('/api', (_req, res) =>
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'API route not found.' } }),
  );
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const e = error instanceof AppError ? error : null;
    res.status(e?.status || 400).json({
      error: {
        code: e?.code || 'REQUEST_FAILED',
        message: e?.message || 'The request could not be completed. Check the input or try again.',
      },
    });
  });
  return app;
}

async function main() {
  const store = new Store(config.database),
    app = createApp(store);
  if (process.env.NODE_ENV === 'production') {
    app.use(express.static(resolve('dist'), { index: false }));
    app.get('/{*path}', (_req, res) => res.sendFile(resolve('dist/index.html')));
  } else {
    // Development file/HMR middleware is local-only. Expose the production bundle for live demos.
    app.use((req, res, next) => {
      if (!/^(localhost|127\.0\.0\.1|\[::1\]):\d+$/.test(req.headers.host || ''))
        return res
          .status(503)
          .send(
            'Public UI requires npm run build and npm start. Provider API routes remain available.',
          );
      next();
    });
    const { createServer } = await import('vite');
    const vite = await createServer({
      server: { middlewareMode: true, ws: { host: '127.0.0.1', port: config.port + 20000 } },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }
  const server = app.listen(config.port, config.host, () =>
    console.log(
      `Reprise Labs is ready at http://localhost:${config.port} · payments are simulated`,
    ),
  );
  const interval = setInterval(() => {
    for (const s of store
      .allSessions()
      .filter(
        (s) =>
          s.mode === 'live' && s.executionId && store.meta(`execution_terminal:${s.id}`) !== 'true',
      ))
      void syncExecution(store, s.id).catch(() => {});
  }, 5000);
  interval.unref();
  const stop = () => {
    clearInterval(interval);
    server.close(() => {
      store.close();
      process.exit(0);
    });
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  void main().catch(() => {
    console.error('Reprise failed to start. Check the local environment, database path and port.');
    process.exit(1);
  });
