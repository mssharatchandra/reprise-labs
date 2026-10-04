import { randomUUID, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { Store, AppError, now, safeText } from './store.ts';
import type { ActionReceipt, PaymentLink } from '../src/types.ts';

const common = { idempotencyKey: z.string().min(8).max(100).optional() };
export const actionSchema = z.discriminatedUnion('name', [
  z.object({ name: z.literal('get_recovery_context'), ...common }).strict(),
  z
    .object({
      name: z.literal('record_consent'),
      permission: z.boolean(),
      evidence: z.string().min(2).max(500),
      ...common,
    })
    .strict(),
  z.object({ name: z.literal('create_payment_link'), ...common }).strict(),
  z
    .object({
      name: z.literal('schedule_callback'),
      callbackAt: z.string().datetime({ offset: true }),
      ...common,
    })
    .strict(),
  z
    .object({ name: z.literal('record_opt_out'), evidence: z.string().min(2).max(500), ...common })
    .strict(),
  z
    .object({
      name: z.literal('escalate_to_human'),
      reason: z.enum([
        'already_paid',
        'billing_dispute',
        'cancellation',
        'mandate_revoked',
        'customer_request',
        'uncertain',
      ]),
      ...common,
    })
    .strict(),
]);
export function performAction(store: Store, sessionId: string, raw: unknown): ActionReceipt {
  const parsed = actionSchema.safeParse(raw);
  if (!parsed.success)
    throw new AppError(
      400,
      'INVALID_ACTION',
      'The action arguments are invalid or contain unsupported fields.',
    );
  const input = parsed.data;
  return store.transaction(() => {
    const session = store.session(sessionId),
      customer = store.customer(session.customerId);
    // Exclusion state wins over cached or stale requests. Opt-out remains available without consent.
    if (customer.optedOut && input.name !== 'record_opt_out')
      throw new AppError(
        409,
        'OPTED_OUT',
        'Recovery actions are blocked by the customer’s opt-out.',
      );
    if (
      customer.reviewReason &&
      !['get_recovery_context', 'record_opt_out'].includes(input.name) &&
      !(input.name === 'escalate_to_human' && input.reason === customer.reviewReason)
    )
      throw new AppError(
        409,
        'REVIEW_REQUIRED',
        'Automated recovery is paused for merchant review.',
      );
    if (
      customer.paymentStatus === 'paid' &&
      ['create_payment_link', 'schedule_callback'].includes(input.name)
    )
      throw new AppError(409, 'ALREADY_PAID', 'Payment is already confirmed.');
    const { idempotencyKey, ...arguments_ } = input;
    const key = idempotencyKey ?? `${sessionId}:${JSON.stringify(arguments_)}`;
    const signature = JSON.stringify(arguments_);
    const cached = store.receipt(key, sessionId, signature);
    if (cached) return cached;
    if (input.name === 'record_opt_out' && customer.optedOut)
      return {
        ok: true,
        action: input.name,
        receiptId: `optout:${customer.id}`,
        message: 'Contact is already disabled.',
      };
    if (session.endedAt && input.name !== 'get_recovery_context')
      throw new AppError(
        409,
        'CONVERSATION_ENDED',
        'This conversation has ended. No further actions are accepted.',
      );
    if (customer.reviewReason && !['get_recovery_context', 'record_opt_out'].includes(input.name))
      throw new AppError(
        409,
        'REVIEW_REQUIRED',
        'Automated recovery is paused for merchant review.',
      );
    if (
      !session.consent &&
      !['get_recovery_context', 'record_consent', 'record_opt_out'].includes(input.name)
    )
      throw new AppError(
        403,
        'CONSENT_REQUIRED',
        'Explicit permission is required before a recovery action.',
      );
    const receipt: ActionReceipt = {
      ok: true,
      action: input.name,
      receiptId: randomUUID(),
      message: '',
    };
    if (input.name === 'get_recovery_context') {
      receipt.customer = customer;
      receipt.allowedActions =
        customer.paymentStatus === 'paid'
          ? ['record_opt_out']
          : customer.failureCode === 'MANDATE_REVOKED'
            ? ['record_consent', 'escalate_to_human', 'record_opt_out']
            : [
                'record_consent',
                'create_payment_link',
                'schedule_callback',
                'record_opt_out',
                'escalate_to_human',
              ];
      receipt.message = 'Fictional gateway context. No debit or mandate-change capability.';
    } else if (input.name === 'record_consent') {
      session.consent = input.permission;
      receipt.message = input.permission
        ? 'Permission to discuss the fictional payment recorded.'
        : 'Permission declined. End the conversation politely.';
      if (!input.permission) {
        session.status = 'declined';
        session.endedAt = now();
        session.outcome = 'Permission declined';
      }
      store.event(
        customer.id,
        session.id,
        'consent_recorded',
        input.permission ? 'Permission granted' : 'Permission declined',
        safeText(input.evidence),
        session.mode,
        { granted: input.permission },
      );
    } else if (input.name === 'record_opt_out') {
      customer.optedOut = true;
      customer.recoveryStatus = 'opted_out';
      customer.callbackAt = null;
      // Atomically terminate every open session for this customer, so parallel/stale calls cannot act.
      for (const s of store
        .allSessions()
        .filter((s) => s.customerId === customer.id && !s.endedAt)) {
        s.status = 'completed';
        s.endedAt = now();
        s.outcome = 'Opted out';
        store.saveSession(s);
      }
      session.status = 'completed';
      session.endedAt = now();
      session.outcome = 'Opted out';
      receipt.message =
        'Opt-out persisted. No further contact or recovery actions are allowed. Say goodbye and end the call.';
      store.event(
        customer.id,
        session.id,
        'opt_out_recorded',
        'Contact disabled',
        input.evidence,
        session.mode,
      );
    } else if (input.name === 'create_payment_link') {
      if (customer.paymentStatus === 'paid')
        throw new AppError(409, 'ALREADY_PAID', 'Payment is already confirmed.');
      if (customer.failureCode === 'MANDATE_REVOKED')
        throw new AppError(409, 'MANDATE_REVIEW', 'A revoked mandate requires merchant review.');
      let link = store.link(customer.id);
      if (!link) {
        link = {
          token: randomBytes(20).toString('hex'),
          customerId: customer.id,
          amount: customer.amount,
          status: 'pending',
          createdAt: now(),
          expiresAt: new Date(Date.now() + 86400000).toISOString(),
        } satisfies PaymentLink;
        store.saveLink(link);
        store.event(
          customer.id,
          session.id,
          'payment_link_created',
          'Payment link created',
          'Simulated one-off checkout. Payment remains outstanding; no message was sent.',
          session.mode,
        );
      }
      if (new Date(link.expiresAt).getTime() <= Date.now())
        throw new AppError(
          410,
          'LINK_EXPIRED',
          'The checkout link has expired. Request merchant review.',
        );
      customer.recoveryStatus = 'link_sent';
      receipt.link = link;
      receipt.message =
        'Simulated link is available in the merchant workspace. No SMS was sent. Invoice is still outstanding; autopay is unchanged.';
    } else if (input.name === 'schedule_callback') {
      const at = Date.parse(input.callbackAt),
        delay = at - Date.now();
      if (delay < 60000 || delay > 7 * 86400000)
        throw new AppError(
          400,
          'INVALID_CALLBACK_TIME',
          'Choose a callback at least one minute and at most seven days from now.',
        );
      customer.callbackAt = new Date(at).toISOString();
      customer.recoveryStatus = 'callback';
      receipt.message =
        'Callback request recorded for merchant follow-up. No automatic call is scheduled.';
      store.event(
        customer.id,
        session.id,
        'callback_requested',
        'Callback requested',
        `Requested for ${new Date(at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST.`,
        session.mode,
        { callbackAt: customer.callbackAt },
      );
    } else if (input.name === 'escalate_to_human') {
      customer.reviewReason = input.reason;
      customer.recoveryStatus = 'review';
      customer.callbackAt = null;
      receipt.message =
        'Merchant review task created. Automated recovery is paused. No live transfer or cancellation has occurred.';
      store.event(
        customer.id,
        session.id,
        'review_requested',
        'Merchant review requested',
        input.reason.replaceAll('_', ' '),
        session.mode,
        { reason: input.reason },
      );
    }
    store.saveCustomer(customer);
    store.saveSession(session);
    store.saveReceipt(key, sessionId, signature, receipt);
    return receipt;
  });
}

export function completePayment(store: Store, token: string) {
  return store.transaction(() => {
    const link = store.linkForToken(token),
      customer = store.customer(link.customerId);
    if (link.status === 'paid') return { link, customer, replayed: true };
    if (Date.parse(link.expiresAt) <= Date.now())
      throw new AppError(410, 'LINK_EXPIRED', 'This payment link has expired.');
    if (customer.reviewReason)
      throw new AppError(
        409,
        'REVIEW_REQUIRED',
        'This invoice is under review. Checkout is paused.',
      );
    link.status = 'paid';
    customer.paymentStatus = 'paid';
    customer.recoveryStatus = customer.optedOut ? 'opted_out' : 'recovered';
    customer.callbackAt = null;
    store.saveLink(link);
    store.saveCustomer(customer);
    store.event(
      customer.id,
      null,
      'payment_confirmed',
      'Simulated payment confirmed',
      'Checkout confirmation settled this fictional invoice. The recurring mandate was not changed.',
      'checkout',
      { amount: link.amount, receiptId: `SIM-${token.slice(0, 8).toUpperCase()}` },
    );
    return { link, customer, replayed: false };
  });
}
