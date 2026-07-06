// onSubscriptionEvent.ts — business logic for Stripe subscription
// lifecycle events. Idempotent (keyed on stripe_subscription_id, which
// has a unique index).
//
// Events handled:
//   - customer.subscription.created  → upsert the row
//   - customer.subscription.updated  → upsert the row (status flips)
//   - customer.subscription.deleted  → mark status='canceled' + revoke
//                                     any active library_grants
//                                     (source='subscription') for the user
//   - invoice.paid                   → ensure status='active' (recovery
//                                     from past_due, and confirms the
//                                     first paid invoice) + insert
//                                     library_grants (one per line on the
//                                     invoice) + append payout_ledger
//                                     'subscription' row
//   - invoice.payment_failed         → set status='past_due'
//
// Called by the platform webhook handler at
// 04-platform/webhooks/stripe/handleStripeWebhook.ts.

import { getServiceSupabase } from '@foundations/data/supabase'
import { loggerFor } from '@foundations/log/pino'

const log = loggerFor({ component: 'subscriptions.onSubscriptionEvent' })

type SubShape = {
  id: string
  customer: string | string | null
  status: string
  current_period_start?: number | null
  current_period_end?: number | null
  cancel_at_period_end?: boolean | null
  canceled_at?: number | null
  items?: { data: Array<{ price: { id: string } }> }
  metadata?: Record<string, string> | null
  trial_start?: number | null
  trial_end?: number | null
}

function periodIso(n: number | null | undefined): string | null {
  if (typeof n !== 'number') return null
  return new Date(n * 1000).toISOString()
}

function priceId(sub: SubShape): string {
  const first = sub.items?.data?.[0]?.price?.id
  return first ?? ''
}

function userIdFrom(sub: SubShape): string | null {
  return sub.metadata?.user_id ?? null
}

function customerIdFrom(sub: SubShape): string | null {
  if (typeof sub.customer === 'string') return sub.customer
  return null
}

/** Upsert the local row to mirror the Stripe subscription state. */
async function upsertFromSub(sub: SubShape): Promise<{ ok: true; row_id: number } | { ok: false; error: string }> {
  const service = getServiceSupabase()
  const userId = userIdFrom(sub)
  if (!userId) {
    log.warn({ code: 'sub_no_user_id', sub_id: sub.id }, 'subscription event missing user_id metadata')
    return { ok: false, error: 'missing user_id metadata' }
  }
  const customerId = customerIdFrom(sub)
  const row = {
    user_id: userId,
    stripe_customer_id: customerId,
    stripe_subscription_id: sub.id,
    stripe_price_id: priceId(sub),
    status: sub.status as
      | 'incomplete'
      | 'incomplete_expired'
      | 'trialing'
      | 'active'
      | 'past_due'
      | 'canceled'
      | 'unpaid'
      | 'paused',
    current_period_start: periodIso(sub.current_period_start),
    current_period_end: periodIso(sub.current_period_end),
    cancel_at_period_end: sub.cancel_at_period_end ?? false,
    canceled_at: periodIso(sub.canceled_at),
    trial_start: periodIso(sub.trial_start),
    trial_end: periodIso(sub.trial_end),
    metadata: (sub.metadata as Record<string, unknown>) ?? {},
    updated_at: new Date().toISOString(),
  }
  // The unique index on stripe_subscription_id lets us use upsert.
  // We do an explicit "if exists update else insert" path because
  // service_role bypasses RLS but we still want the user_id to be
  // stable on first insert.
  const { data, error } = await service
    .from('subscriptions')
    .upsert(row, { onConflict: 'stripe_subscription_id' })
    .select('id')
    .single()
  if (error || !data) {
    log.error({ code: 'sub_upsert_failed', msg: error?.message, sub_id: sub.id }, 'subscription upsert failed')
    return { ok: false, error: 'upsert failed' }
  }
  return { ok: true, row_id: data.id }
}

export async function onSubscriptionCreated(sub: SubShape) {
  return upsertFromSub(sub)
}

export async function onSubscriptionUpdated(sub: SubShape) {
  return upsertFromSub(sub)
}

export async function onSubscriptionDeleted(sub: SubShape) {
  const upsert = await upsertFromSub({ ...sub, status: 'canceled' })
  // PH08: no grant cleanup is needed. Subscription access is computed
  // at query time via has_active_subscription(user_id) — we never wrote
  // library_grants rows for the subscription (the catalog will be 500+
  // products, so a per-product insert loop is the wrong shape). The
  // subscription status flip from active→canceled is enough; the next
  // /library page render will exclude this user.
  return upsert
}

type InvoiceShape = {
  id: string
  customer?: string | null
  subscription?: string | null
  status?: string | null
  amount_due?: number | null
  amount_paid?: number | null
  lines?: { data: Array<{ price: { id: string }; amount: number; description?: string | null }> }
}

/** For `invoice.paid` and `invoice.payment_failed`. If the invoice
 *  has a subscription attached, mirror its state in our row, and
 *  on `paid` issue library access + append the subscription ledger
 *  row. We do not write the invoice to a local table in v1 — Stripe's
 *  hosted invoice page is the source of truth.
 */
export async function onInvoiceEvent(inv: InvoiceShape) {
  const subId = inv.subscription
  if (!subId) return { ok: true as const, ignored: true }
  const service = getServiceSupabase()
  // Map the invoice status to a subscription status. Stripe sends
  // `paid` for `invoice.paid` and `open` for `invoice.payment_failed`
  // (the failure itself shows in invoice.payment_intent.payment_failed
  // with last_payment_error populated, but the invoice stays 'open'
  // until retries are exhausted).
  if (inv.status === 'paid') {
    const { error } = await service
      .from('subscriptions')
      .update({ status: 'active', updated_at: new Date().toISOString() })
      .eq('stripe_subscription_id', subId)
    if (error) {
      log.warn({ code: 'invoice_paid_update_failed', msg: error.message }, 'invoice paid update failed')
      return { ok: false, error: 'update failed' }
    }
    // PH08: grant library access to every published PLR product for the
    // subscriber, and append the subscription ledger row.
    const sub = await service
      .from('subscriptions')
      .select('id, user_id, amount_due')
      .eq('stripe_subscription_id', subId)
      .maybeSingle()
    if (sub.data) {
      // No grant writes — see comment on onSubscriptionDeleted. The
      // active subscription is the source of truth; the /library page
      // joins has_active_subscription(user_id) into the grant read.
      // The ledger row is idempotent on `stripe_invoice_id` (unique
      // partial index from migration 0007) — Stripe retries land
      // here again, and the upsert no-ops.
      await appendSubscriptionLedgerEntry(sub.data.id, sub.data.user_id, inv.amount_due ?? 0, inv.id)
    }
  } else if (inv.status === 'open' || inv.status === 'uncollectible') {
    const { error } = await service
      .from('subscriptions')
      .update({ status: 'past_due', updated_at: new Date().toISOString() })
      .eq('stripe_subscription_id', subId)
    if (error) {
      log.warn({ code: 'invoice_failed_update_failed', msg: error.message }, 'invoice failed update failed')
      return { ok: false, error: 'update failed' }
    }
  }
  return { ok: true as const }
}

// ---------------------------------------------------------------------------
// PH08: subscription library access — see comment on onSubscriptionDeleted.
// Access is computed at query time via has_active_subscription(user_id);
// no library_grants rows are written for the subscription. This keeps
// the write path O(1) regardless of catalog size (the catalog will be
// 500+ products).
// ---------------------------------------------------------------------------

/** Append a payout_ledger 'subscription' row for the invoice amount.
 *  partner_id is NULL (the column is nullable for subscription /
 *  adjustment rows per migration 0004). The full invoice amount goes
 *  into amount_cents — this is platform revenue, not partner-attributed.
 *  The row is idempotent on `stripe_invoice_id` (the unique partial
 *  index from migration 0007 covers kind='subscription' rows).
 *  Stripe retries land here again with the same invoice id; the
 *  upsert is a no-op.
 */
async function appendSubscriptionLedgerEntry(
  subscriptionId: number,
  userId: string,
  amountDueCents: number,
  stripeInvoiceId: string | null,
): Promise<void> {
  if (amountDueCents <= 0) return
  const service = getServiceSupabase()
  const row = {
    partner_id: null,
    kind: 'subscription' as const,
    status: 'accruing' as const,
    amount_cents: amountDueCents,
    currency: 'USD',
    description: `Subscription revenue (sub_id=${subscriptionId}, user_id=${userId})`,
    stripe_invoice_id: stripeInvoiceId,
  }
  // `ignoreDuplicates` is the cleanest shape: insert if new, no-op
  // if the unique partial index rejects us.
  const { error } = await service
    .from('payout_ledger')
    .upsert(row, { onConflict: 'stripe_invoice_id', ignoreDuplicates: true })
  if (error) {
    log.warn(
      { code: 'sub_ledger_insert_failed', msg: error.message, subscription_id: subscriptionId },
      'subscription ledger insert failed',
    )
  }
}
