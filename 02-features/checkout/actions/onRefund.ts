// onRefund.ts — Stripe webhook handler for `charge.refunded`. Revokes
// the library_grants and writes the corresponding refund_debit entries
// in the payout_ledger.
//
// Idempotent: refund_id is unique on refunds, and we check before
// inserting a ledger entry.
//
// Royalty math (ADR-0009):
//   The refund ledger row's `amount_cents` is computed via
//   `calculateRefundRoyalty(item.royalty_cents, order.total_cents, refundAmount)` —
//   proportional, floored, clamped at the full sale royalty. For a
//   FULL refund, that collapses to `-item.royalty_cents` (the full
//   royalty). For a PARTIAL refund, it's proportionally less — we never
//   claw back more royalty than was earned.
//
// Currency: the refund row's `currency` matches the order's `currency`.
// (Bug fix in P6.9: the prior code hardcoded `'USD'`, which broke
// EUR/GBP orders.)
//
// royalty_pct_bps on the refund row: copied from the snapshot on
// `order_items.royalty_pct_bps` — keeps the audit trail of "this
// refund was computed at X%". Same shape as the original sale row's
// `royalty_pct_bps`.

import { getServiceSupabase } from '@foundations/data/supabase'
import { loggerFor } from '@foundations/log/pino'
import { calculateRefundRoyalty } from '@foundations/money/cents'

const log = loggerFor({ component: 'checkout.onRefund' })

export type StripeRefundLike = {
  id: string
  payment_intent?: string | null
  amount?: number | null
  metadata?: Record<string, string> | null
}

export async function onRefund(charge: StripeRefundLike): Promise<{ ok: true } | { ok: false; error: string }> {
  const service = getServiceSupabase()
  const paymentIntentId =
    typeof charge.payment_intent === 'string' ? charge.payment_intent : null
  if (!paymentIntentId) {
    log.warn({ code: 'refund_no_pi', stripe_refund_id: charge.id }, 'refund missing payment_intent')
    return { ok: false, error: 'missing payment_intent' }
  }

  // Find the order via payment intent.
  const { data: order } = await service
    .from('orders')
    .select('id, user_id, status, total_cents, refunded_cents, currency')
    .eq('stripe_payment_intent_id', paymentIntentId)
    .maybeSingle()
  if (!order) {
    log.warn({ code: 'refund_order_not_found', stripe_refund_id: charge.id }, 'refund: order not found')
    return { ok: false, error: 'order not found' }
  }

  // Idempotency: refunds row.
  const { data: existing } = await service
    .from('refunds')
    .select('id')
    .eq('stripe_refund_id', charge.id)
    .maybeSingle()
  if (existing) return { ok: true }

  const refundAmount = charge.amount ?? 0
  const { error: refundErr } = await service.from('refunds').insert({
    order_id: order.id,
    amount_cents: refundAmount,
    reason: 'requested_by_customer',
    status: 'succeeded',
    stripe_refund_id: charge.id,
    processed_at: new Date().toISOString(),
  })
  if (refundErr) {
    log.error({ code: 'refund_insert_failed', msg: refundErr.message }, 'refund insert failed')
    return { ok: false, error: 'refund insert failed' }
  }

  // Update order status + refunded_cents.
  const newRefunded = (order.refunded_cents ?? 0) + refundAmount
  const fullyRefunded = newRefunded >= (order.total_cents ?? 0)
  await service
    .from('orders')
    .update({
      status: fullyRefunded ? 'refunded' : 'partially_refunded',
      refunded_cents: newRefunded,
    })
    .eq('id', order.id)

  // Revoke library_grants for this order. One UPDATE (not per-item):
  // the predicate is `order_id = $1` so the cardinality equals the
  // grant count for the order (not N for N items). The `revoked_at`
  // is computed once outside the loop so all rows get the same
  // timestamp (M3 fix: previously it was re-stamped per item).
  const revokedAt = new Date().toISOString()
  await service
    .from('library_grants')
    .update({ revoked_at: revokedAt, revoked_reason: 'refund' })
    .eq('order_id', order.id)
    .is('revoked_at', null)

  // Append one ledger row per order_item. Single batched INSERT.
  // The `royalty_pct_bps` column is the snapshot from order_items —
  // same shape as the original sale row. The `amount_cents` is the
  // PROPORTIONAL refund royalty (ADR-0009), not the full royalty —
  // this fixes the pre-P6.9 bug where partial refunds over-clawed-
  // back the partner.
  const { data: items } = await service
    .from('order_items')
    .select('id, partner_id, royalty_cents, royalty_pct_bps')
    .eq('order_id', order.id)
  // Resolve the refund id once.
  const { data: refundRow } = await service
    .from('refunds')
    .select('id')
    .eq('stripe_refund_id', charge.id)
    .maybeSingle()
  const refundId = refundRow?.id ?? null

  if (items && items.length > 0) {
    // orderTotal is the order-level denominator for the proportional
    // formula. Fall back to 0 (which causes calculateRefundRoyalty to
    // return 0) if the order row is missing total_cents — defensive
    // only; a paid order always has total_cents.
    const orderTotal = order.total_cents ?? 0
    const orderCurrency = order.currency ?? 'USD'
    const rows = items.map((it) => {
      const refundRoyalty = calculateRefundRoyalty(
        it.royalty_cents,
        orderTotal,
        refundAmount,
      )
      return {
        partner_id: it.partner_id,
        order_id: order.id,
        order_item_id: it.id,
        refund_id: refundId,
        kind: 'refund' as const,
        status: 'accruing' as const,
        // Negative of the proportional refund royalty (signed amount —
        // a debit on the partner's balance).
        amount_cents: -Number(refundRoyalty),
        currency: orderCurrency,
        // Preserve the snapshot royalty rate for audit trail.
        royalty_pct_bps: it.royalty_pct_bps,
        description: `Refund for order #${order.id}`,
      }
    })
    const { error: ledgerErr } = await service.from('payout_ledger').insert(rows)
    if (ledgerErr) {
      log.warn(
        { code: 'refund_ledger_insert_failed', msg: ledgerErr.message, order_id: order.id },
        'refund ledger insert failed',
      )
    }
  }

  log.info(
    {
      order_id: order.id,
      refund_amount_cents: refundAmount,
      order_total_cents: order.total_cents,
      currency: order.currency,
    },
    'refund processed',
  )
  return { ok: true }
}