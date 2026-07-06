// onPaymentSucceeded.ts — invoked by the Stripe webhook handler when a
// `checkout.session.completed` event arrives. This is the source of
// truth for "this order is paid" — the success page is optimistic but
// the webhook is the authority.
//
// Idempotent: the function is safe to call multiple times for the same
// session_id. The processed_webhooks table is the dedup layer at the
// HTTP boundary; the order's status check is the safety net here.
//
// Steps:
//   1. Look up the order by stripe_checkout_session_id (or order_id
//      from session.metadata if Stripe's session_id hasn't been written
//      back yet — race window between create and webhook).
//   2. If status is already 'paid' or beyond, return early.
//   3. Call the `mark_order_paid_and_grant` RPC (STUB-062 fix,
//      04-platform/migrations/0070_atomic_order_paid_rpc.sql) — this
//      flips the order to 'paid', inserts every library_grant, and
//      inserts every payout_ledger row INSIDE ONE POSTGRES
//      TRANSACTION. If any write fails (e.g. a single payout_ledger
//      insert hits a transient error), the ENTIRE transaction rolls
//      back, including the orders.status='paid' flip. That's the
//      atomicity fix: there is no longer a window where the order is
//      paid but a partner's ledger row silently failed to write.
//   4. On RPC failure, this function returns `{ ok: false }`. The
//      webhook dispatcher (handleStripeWebhook.ts) releases the
//      processed_webhooks claim and returns 500 on a soft-fail, so
//      Stripe retries — and because the RPC rolled back, the order is
//      still 'awaiting_payment', so the retry re-attempts the FULL
//      fulfillment (not a partial patch-up).
//
// Previously (pre-STUB-062-fix): this file looped order_items in Node,
// doing per-item library_grants + payout_ledger INSERTs with the order
// already marked paid. A failed ledger insert was caught, logged at
// warn, and the loop continued — the partner never got paid and the
// only signal was a warn log, because the dedup+idempotency checks
// prevented any retry from reprocessing an already-'paid' order. The
// RPC above removes that failure window entirely instead of just
// widening the retry surface.

import { getServiceSupabase } from '@foundations/data/supabase'
import { loggerFor } from '@foundations/log/pino'

const log = loggerFor({ component: 'checkout.onPaymentSucceeded' })

export type StripeCheckoutSessionLike = {
  id: string
  payment_intent?: string | string | null
  customer?: string | null
  customer_email?: string | null
  amount_total?: number | null
  metadata?: Record<string, string> | null
  payment_status?: string
  /** STUB-006 — Stripe's authoritative tax breakdown, present when
   *  `automatic_tax.enabled` was set on session-create. `amount_tax`
   *  is persisted onto `orders.tax_cents` via the
   *  `mark_order_paid_and_grant` RPC. Absent/undefined on sessions
   *  created before automatic_tax was wired, or when Stripe Tax isn't
   *  configured in the Dashboard yet — both fall back to whatever
   *  tax_cents was written at session-create time (0 in v1). */
  total_details?: { amount_tax?: number | null } | null
}

export type OnPaymentSucceededResult =
  | { ok: true; order_id: number; already_paid: boolean }
  | { ok: false; error: string; order_id?: number }

export async function onPaymentSucceeded(
  session: StripeCheckoutSessionLike,
): Promise<OnPaymentSucceededResult> {
  const service = getServiceSupabase()

  // 1. Resolve the order id. Prefer session.metadata.order_id (set at
  //    create time); fall back to a lookup by stripe_checkout_session_id.
  let orderId: number | null = null
  const metaOrderId = session.metadata?.order_id
  if (metaOrderId) {
    const n = Number(metaOrderId)
    if (Number.isInteger(n) && n > 0) orderId = n
  }
  if (!orderId) {
    const { data } = await service
      .from('orders')
      .select('id')
      .eq('stripe_checkout_session_id', session.id)
      .maybeSingle()
    orderId = data?.id ?? null
  }
  if (!orderId) {
    log.warn(
      { code: 'order_not_found', session_id: session.id },
      'checkout.session.completed for unknown order',
    )
    return { ok: false, error: 'order not found', order_id: 0 }
  }

  // 2. Idempotency: if the order is already past 'awaiting_payment',
  //    return early. (processed_webhooks is the outer dedup; this is the
  //    second line of defense.)
  const { data: order, error: orderErr } = await service
    .from('orders')
    .select('id, status, user_id, email, total_cents, currency')
    .eq('id', orderId)
    .maybeSingle()
  if (orderErr || !order) {
    log.error({ code: 'order_lookup_failed', msg: orderErr?.message, order_id: orderId }, 'order lookup failed')
    return { ok: false, error: 'order lookup failed', order_id: orderId }
  }
  if (order.status === 'paid' || order.status === 'fulfilled') {
    return { ok: true, order_id: orderId, already_paid: true }
  }

  // 3. Atomic fulfillment via RPC (STUB-062 fix). One Postgres
  //    transaction: orders.status='paid' + every library_grant +
  //    every payout_ledger row. If any write inside the function body
  //    fails, Postgres rolls back the WHOLE transaction — including
  //    the paid flip — so this call either fully succeeds or leaves
  //    the order exactly as it was (still 'awaiting_payment').
  const paymentIntentId =
    typeof session.payment_intent === 'string' ? session.payment_intent : null

  // STUB-006 — pass through Stripe's authoritative tax amount when
  // present. `amount_tax` is only meaningful once Stripe has actually
  // calculated tax (automatic_tax enabled + a billing address
  // collected); when absent, both p_tax_cents and p_total_cents stay
  // NULL and the RPC's `coalesce` leaves the existing order columns
  // untouched.
  const taxCents =
    typeof session.total_details?.amount_tax === 'number' ? session.total_details.amount_tax : null
  const totalCents = typeof session.amount_total === 'number' ? session.amount_total : null

  const { data: rpcData, error: rpcErr } = await service.rpc(
    'mark_order_paid_and_grant' as never,
    {
      p_order_id: orderId,
      p_payment_intent_id: paymentIntentId,
      p_customer_id: session.customer ?? null,
      p_tax_cents: taxCents,
      p_total_cents: totalCents,
    } as never,
  )
  if (rpcErr) {
    log.error(
      { code: 'mark_order_paid_failed', msg: rpcErr.message, order_id: orderId },
      'mark_order_paid_and_grant RPC failed — order left unpaid so the webhook retries',
    )
    return { ok: false, error: 'order fulfillment failed', order_id: orderId }
  }
  const result = Array.isArray(rpcData) ? rpcData[0] : rpcData
  const alreadyPaid = Boolean((result as { already_paid?: boolean } | null)?.already_paid)
  const itemsGranted = Number((result as { items_granted?: number } | null)?.items_granted ?? 0)
  const ledgerRowsWritten = Number(
    (result as { ledger_rows_written?: number } | null)?.ledger_rows_written ?? 0,
  )

  log.info(
    {
      order_id: orderId,
      already_paid: alreadyPaid,
      items_granted: itemsGranted,
      ledger_rows_written: ledgerRowsWritten,
    },
    'order marked paid',
  )
  return { ok: true, order_id: orderId, already_paid: alreadyPaid }
}
