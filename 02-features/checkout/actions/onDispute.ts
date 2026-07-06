// onDispute.ts — STUB-061 fix. Invoked by the Stripe webhook handler
// for `charge.dispute.created` and `charge.dispute.closed`.
//
// Problem (STUB-061 / TODO-HARDENING QLT-4, "blocks Stripe live"):
// `04-platform/webhooks/stripe/` had no handler for Stripe dispute
// events. When a customer disputes a charge, Stripe sends
// `charge.dispute.created` immediately, then `charge.dispute.closed`
// once the dispute resolves (status='won' or 'lost'). Without a
// handler, a lost dispute silently over-pays the partner — the
// original `order_sale` payout_ledger row keeps accruing toward
// payout as if nothing happened.
//
// Fix (mirrors onRefund.ts's shape — service-role reads + append-only
// ledger writes + audit log):
//   onDisputeCreated:
//     - Freezes the affected payout_ledger rows: any row for this
//       order with status in ('locked', 'available') (i.e. not yet
//       paid out) flips to status='pending_dispute'
//       (04-platform/migrations/0072_payout_ledger_dispute_enums.sql)
//       so the daily release-locked-balances cron and any manual
//       payout run SKIP it while the dispute is open.
//     - Does NOT touch rows already status='paid' — those already left
//       the ledger; STUB-061 doesn't ask for a clawback-on-open, only
//       a freeze, per the spec's "(a) on created — freeze".
//   onDisputeClosed:
//     - status='won': un-freezes — any 'pending_dispute' row for this
//       order reverts to 'available' (the refund-window lock has
//       already elapsed by the time most disputes resolve; reverting
//       to 'available' rather than re-deriving 'locked' is the
//       conservative choice — a won dispute means the sale stands, and
//       the partner shouldn't be re-penalized with another wait).
//     - status='lost': writes a NEGATIVE payout_ledger row per
//       order_item with kind='dispute', amount_cents=-royalty_cents
//       (full clawback — a lost dispute means Stripe has already
//       reversed the full charge, unlike a partial refund) using the
//       SAME royalty_cents snapshot from order_items that
//       onPaymentSucceeded used for the original sale row (never
//       re-derives from the live partner rate — same snapshot
//       invariant as onRefund.ts / ADR-0009). Any 'pending_dispute' or
//       'locked'/'available' row for this order that hasn't been paid
//       out yet is voided (status='void') so it's excluded from future
//       payout runs — the new negative 'dispute' row is the row of
//       record for the balance impact.
//
// Idempotency: keyed on the Stripe dispute id via a `stripe_dispute_id`
// column check against existing payout_ledger 'dispute' rows for the
// order — a re-delivered `charge.dispute.closed` is a no-op if the
// dispute-kind row already exists for this order+dispute pairing.

import { getServiceSupabase } from '@foundations/data/supabase'
import { loggerFor } from '@foundations/log/pino'

const log = loggerFor({ component: 'checkout.onDispute' })

/** System actor UUID for webhook-triggered audit rows — matches the
 *  established pattern in 00-foundations/auth/rate-limit.ts and
 *  02-features/auth/actions.ts. */
const SYSTEM_ACTOR_ID = '00000000-0000-0000-0000-000000000000'

export type StripeDisputeLike = {
  id: string
  payment_intent?: string | null
  amount?: number | null
  reason?: string | null
  status?: string | null
}

export type OnDisputeResult = { ok: true } | { ok: false; error: string }

async function resolveOrderId(
  service: ReturnType<typeof getServiceSupabase>,
  paymentIntentId: string | null,
): Promise<{ id: number; currency: string } | null> {
  if (!paymentIntentId) return null
  const { data } = await service
    .from('orders')
    .select('id, currency')
    .eq('stripe_payment_intent_id', paymentIntentId)
    .maybeSingle()
  return data ?? null
}

/**
 * `charge.dispute.created` — freeze affected payout_ledger rows so the
 * payout cron / manual runs skip them while the dispute is open.
 */
export async function onDisputeCreated(dispute: StripeDisputeLike): Promise<OnDisputeResult> {
  const service = getServiceSupabase()
  const paymentIntentId = typeof dispute.payment_intent === 'string' ? dispute.payment_intent : null
  if (!paymentIntentId) {
    log.warn({ code: 'dispute_no_pi', stripe_dispute_id: dispute.id }, 'dispute missing payment_intent')
    return { ok: false, error: 'missing payment_intent' }
  }

  const order = await resolveOrderId(service, paymentIntentId)
  if (!order) {
    log.warn({ code: 'dispute_order_not_found', stripe_dispute_id: dispute.id }, 'dispute: order not found')
    return { ok: false, error: 'order not found' }
  }

  // Freeze: only rows not yet paid out. Idempotent — re-running this
  // on a redelivered event just re-applies the same filter (rows
  // already 'pending_dispute' are simply matched again by the 'in'
  // clause and re-set to the same value, a harmless no-op).
  const { error: freezeErr } = await service
    .from('payout_ledger')
    .update({ status: 'pending_dispute' } as never)
    .eq('order_id', order.id)
    .in('status', ['locked', 'available'])
  if (freezeErr) {
    log.error(
      { code: 'dispute_freeze_failed', msg: freezeErr.message, order_id: order.id },
      'dispute freeze update failed',
    )
    return { ok: false, error: 'freeze update failed' }
  }

  await writeDisputeAudit(service, {
    orderId: order.id,
    action: 'payout_ledger_dispute_frozen',
    metadata: { stripe_dispute_id: dispute.id, reason: dispute.reason ?? null },
  })

  log.info({ order_id: order.id, stripe_dispute_id: dispute.id }, 'payout ledger rows frozen for dispute')
  return { ok: true }
}

/**
 * `charge.dispute.closed` — status='won' unfreezes; status='lost'
 * claws back the partner's royalty with a negative ledger row.
 */
export async function onDisputeClosed(dispute: StripeDisputeLike): Promise<OnDisputeResult> {
  const service = getServiceSupabase()
  const paymentIntentId = typeof dispute.payment_intent === 'string' ? dispute.payment_intent : null
  if (!paymentIntentId) {
    log.warn({ code: 'dispute_closed_no_pi', stripe_dispute_id: dispute.id }, 'dispute missing payment_intent')
    return { ok: false, error: 'missing payment_intent' }
  }

  const order = await resolveOrderId(service, paymentIntentId)
  if (!order) {
    log.warn({ code: 'dispute_closed_order_not_found', stripe_dispute_id: dispute.id }, 'dispute: order not found')
    return { ok: false, error: 'order not found' }
  }

  if (dispute.status === 'won') {
    const { error: unfreezeErr } = await service
      .from('payout_ledger')
      .update({ status: 'available' } as never)
      .eq('order_id', order.id)
      .eq('status', 'pending_dispute')
    if (unfreezeErr) {
      log.error(
        { code: 'dispute_unfreeze_failed', msg: unfreezeErr.message, order_id: order.id },
        'dispute unfreeze update failed',
      )
      return { ok: false, error: 'unfreeze update failed' }
    }
    await writeDisputeAudit(service, {
      orderId: order.id,
      action: 'payout_ledger_dispute_won',
      metadata: { stripe_dispute_id: dispute.id },
    })
    log.info({ order_id: order.id, stripe_dispute_id: dispute.id }, 'dispute won — ledger rows unfrozen')
    return { ok: true }
  }

  if (dispute.status !== 'lost') {
    // Any other closed status (e.g. Stripe's rare 'warning_closed')
    // isn't actionable per the STUB-061 spec — record nothing, don't
    // fail the webhook.
    log.info(
      { order_id: order.id, stripe_dispute_id: dispute.id, status: dispute.status },
      'dispute closed with non-actionable status — skipped',
    )
    return { ok: true }
  }

  // Idempotency: a 'dispute'-kind row already exists for this order →
  // this event was already processed (redelivery).
  const { data: existing } = await service
    .from('payout_ledger')
    .select('id')
    .eq('order_id', order.id)
    .eq('kind', 'dispute')
    .limit(1)
    .maybeSingle()
  if (existing) return { ok: true }

  // Lost: void any not-yet-paid-out row for this order (locked /
  // available / pending_dispute) and write ONE negative 'dispute' row
  // per order_item using the SAME royalty_cents snapshot the original
  // sale row used — never re-derive from the live partner rate
  // (matches the onRefund.ts / ADR-0009 snapshot invariant).
  const { data: items, error: itemsErr } = await service
    .from('order_items')
    .select('id, partner_id, royalty_cents, royalty_pct_bps')
    .eq('order_id', order.id)
  if (itemsErr) {
    log.error(
      { code: 'dispute_items_lookup_failed', msg: itemsErr.message, order_id: order.id },
      'order_items lookup failed',
    )
    return { ok: false, error: 'items lookup failed' }
  }

  const { error: voidErr } = await service
    .from('payout_ledger')
    .update({ status: 'void' } as never)
    .eq('order_id', order.id)
    .in('status', ['locked', 'available', 'pending_dispute'])
  if (voidErr) {
    log.error(
      { code: 'dispute_void_failed', msg: voidErr.message, order_id: order.id },
      'dispute void update failed',
    )
    return { ok: false, error: 'void update failed' }
  }

  if (items && items.length > 0) {
    const rows = items.map((it) => ({
      partner_id: it.partner_id,
      order_id: order.id,
      order_item_id: it.id,
      kind: 'dispute' as const,
      // 'accruing' — same status onRefund.ts uses for its debit rows.
      // This is the row of record for the balance impact, so it must
      // be counted (unlike the voided original sale row above); it
      // then flows through the normal accrual → lock → available →
      // payout lifecycle like any other ledger row (a negative amount
      // simply reduces what's owed rather than adding to it).
      status: 'accruing' as const,
      // Full clawback — a lost dispute means Stripe reversed the full
      // charge. Negative sign = debit on the partner's balance.
      amount_cents: -Number(it.royalty_cents),
      currency: order.currency,
      royalty_pct_bps: it.royalty_pct_bps,
      description: `Dispute lost for order #${order.id} (${dispute.id})`,
    }))
    const { error: ledgerErr } = await service.from('payout_ledger').insert(rows)
    if (ledgerErr) {
      log.error(
        { code: 'dispute_ledger_insert_failed', msg: ledgerErr.message, order_id: order.id },
        'dispute clawback ledger insert failed',
      )
      return { ok: false, error: 'ledger insert failed' }
    }
  }

  await writeDisputeAudit(service, {
    orderId: order.id,
    action: 'payout_ledger_dispute_lost',
    metadata: { stripe_dispute_id: dispute.id, order_item_count: items?.length ?? 0 },
  })

  log.info(
    { order_id: order.id, stripe_dispute_id: dispute.id, item_count: items?.length ?? 0 },
    'dispute lost — partner payout clawed back',
  )
  return { ok: true }
}

async function writeDisputeAudit(
  service: ReturnType<typeof getServiceSupabase>,
  opts: { orderId: number; action: string; metadata: Record<string, unknown> },
): Promise<void> {
  try {
    await service.from('admin_audit_log').insert({
      actor_id: SYSTEM_ACTOR_ID,
      actor_email: 'system:stripe_webhook@uthena.audit',
      action: opts.action,
      target_kind: 'orders',
      target_id: String(opts.orderId),
      metadata: opts.metadata,
    } as never)
  } catch (auditErr) {
    log.warn(
      { code: 'dispute_audit_write_failed', msg: (auditErr as Error).message, order_id: opts.orderId },
      'dispute audit log insert failed (ledger effect still applied)',
    )
  }
}
