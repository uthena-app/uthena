// onPaymentFailed.ts — STUB-063 fix. Invoked by the Stripe webhook
// handler for `payment_intent.payment_failed`, `checkout.session.expired`,
// and `checkout.session.async_payment_failed`.
//
// Problem (STUB-063 / TODO-HARDENING QLT-4): before this handler
// existed, `04-platform/webhooks/stripe/` had no case for these event
// types, so a failed/expired payment left the order in
// `status='awaiting_payment'` FOREVER. The user's cart lines were
// never released for retry, and support had no signal that the order
// would never complete.
//
// Fix: this handler
//   1. Looks up the order by `stripe_payment_intent_id` (payment_intent
//      events) or `stripe_checkout_session_id` (checkout.session
//      events) — whichever the inbound event carries.
//   2. Idempotent no-op if the order is already terminal (`paid`,
//      `fulfilled`, `refunded`, `partially_refunded`, `canceled`,
//      `failed`) — never overwrites a real outcome with "canceled".
//   3. Flips the order to `status='canceled'` + sets `canceled_at`
//      (04-platform/migrations/0071_orders_canceled_at.sql).
//   4. Reverts the user's cart_items rows for the order's products
//      back to `status='active'` so the buyer can retry checkout
//      without support intervention. (In v1 nothing else flips these
//      rows away from 'active' during checkout — the only current
//      status transition is 'active' → 'converted' on payment
//      success — but the revert is explicit and defensive so a future
//      "hold the cart line during checkout" feature doesn't silently
//      strand a customer's cart.)
//   5. Audit-logs the failure (best-effort; never blocks the webhook).
//
// Idempotent: safe to call multiple times for the same order — step 2
// short-circuits before any writes once the order is terminal.

import { getServiceSupabase } from '@foundations/data/supabase'
import { loggerFor } from '@foundations/log/pino'

const log = loggerFor({ component: 'checkout.onPaymentFailed' })

/** System actor UUID for webhook-triggered audit rows — matches the
 *  established pattern in 00-foundations/auth/rate-limit.ts and
 *  02-features/auth/actions.ts for pre-auth / non-human-actor writes
 *  to admin_audit_log (whose actor_id FK requires a value). */
const SYSTEM_ACTOR_ID = '00000000-0000-0000-0000-000000000000'

const TERMINAL_STATUSES = new Set([
  'paid',
  'fulfilled',
  'refunded',
  'partially_refunded',
  'canceled',
  'failed',
  'fraudulent',
])

export type StripePaymentFailedLike = {
  /** The Stripe event type that triggered this call — carried through
   *  purely for logging/audit context. */
  event_type: 'payment_intent.payment_failed' | 'checkout.session.expired' | 'checkout.session.async_payment_failed'
  /** payment_intent id — present on payment_intent.payment_failed. */
  payment_intent_id?: string | null
  /** checkout session id — present on checkout.session.* events. */
  checkout_session_id?: string | null
  /** Stripe's failure reason, if present (e.g. `last_payment_error.message`). */
  failure_message?: string | null
}

export type OnPaymentFailedResult =
  | { ok: true; order_id: number; already_terminal: boolean }
  | { ok: false; error: string; order_id?: number }

export async function onPaymentFailed(
  event: StripePaymentFailedLike,
): Promise<OnPaymentFailedResult> {
  const service = getServiceSupabase()

  if (!event.payment_intent_id && !event.checkout_session_id) {
    log.warn(
      { code: 'payment_failed_no_identifier', event_type: event.event_type },
      'payment failure event carries neither payment_intent nor checkout_session id',
    )
    return { ok: false, error: 'missing payment_intent or checkout_session id' }
  }

  // 1. Resolve the order.
  let query = service.from('orders').select('id, status, user_id')
  query = event.payment_intent_id
    ? query.eq('stripe_payment_intent_id', event.payment_intent_id)
    : query.eq('stripe_checkout_session_id', event.checkout_session_id as string)
  const { data: order, error: orderErr } = await query.maybeSingle()

  if (orderErr) {
    log.error(
      { code: 'payment_failed_lookup_failed', msg: orderErr.message, event_type: event.event_type },
      'order lookup failed',
    )
    return { ok: false, error: 'order lookup failed' }
  }
  if (!order) {
    // Stripe can send failure events for sessions we never persisted
    // an order for (e.g. abandoned before the order row was written).
    // Matches the existing onRefund.ts convention: a soft-fail here
    // causes the webhook dispatcher to release the claim and Stripe
    // retries (capped at Stripe's ~3-day retry window, then Stripe
    // gives up on its own) — consistent with how every other handler
    // in this dispatcher treats "referenced order not found".
    log.warn(
      { code: 'payment_failed_order_not_found', event_type: event.event_type },
      'payment failure event for unknown order',
    )
    return { ok: false, error: 'order not found' }
  }

  // 2. Idempotent no-op if already terminal — never clobber a real
  //    'paid'/'refunded'/etc. outcome with 'canceled'. Also guards
  //    against redundant delivery of the same failure event.
  if (TERMINAL_STATUSES.has(order.status)) {
    return { ok: true, order_id: order.id, already_terminal: true }
  }

  // 3. Flip the order to canceled.
  const { error: updateErr } = await service
    .from('orders')
    .update({ status: 'canceled', canceled_at: new Date().toISOString() })
    .eq('id', order.id)
  if (updateErr) {
    log.error(
      { code: 'payment_failed_update_failed', msg: updateErr.message, order_id: order.id },
      'order cancel update failed',
    )
    return { ok: false, error: 'order update failed', order_id: order.id }
  }

  // 4. Revert cart lines for this order's products back to 'active' so
  //    the buyer can retry checkout without support intervention.
  const { data: items } = await service
    .from('order_items')
    .select('product_id')
    .eq('order_id', order.id)
  const productIds = [...new Set((items ?? []).map((i) => i.product_id))]
  if (productIds.length > 0) {
    await service
      .from('cart_items')
      .update({ status: 'active' })
      .eq('user_id', order.user_id)
      .in('product_id', productIds)
      .neq('status', 'active')
  }

  // 5. Best-effort audit log. Never blocks the webhook outcome.
  try {
    await service.from('admin_audit_log').insert({
      actor_id: SYSTEM_ACTOR_ID,
      actor_email: 'system:stripe_webhook@uthena.audit',
      action: 'order_payment_failed',
      target_kind: 'orders',
      target_id: String(order.id),
      metadata: {
        event_type: event.event_type,
        failure_message: event.failure_message ?? null,
      },
    } as never)
  } catch (auditErr) {
    log.warn(
      { code: 'payment_failed_audit_write_failed', msg: (auditErr as Error).message, order_id: order.id },
      'audit log insert failed (order still canceled)',
    )
  }

  log.info(
    { order_id: order.id, event_type: event.event_type },
    'order canceled after payment failure',
  )
  return { ok: true, order_id: order.id, already_terminal: false }
}
