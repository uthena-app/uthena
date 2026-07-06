// getRecentInvoices.ts — invoice history for the current user.
//
// P5.7: surface the **last 12 months** of subscription invoices (with
// each invoice linking out to its Stripe-hosted PDF). Calls Stripe's
// `invoices.list` via the service-role stripe client (we need the
// secret key, not the user's) and filters server-side by a
// `created[gte]` window. The count limit is a safety cap (default 24
// ≈ 2× a 12-month monthly cadence) so the response stays bounded even
// in pathological cases (multiple invoices per month, mid-cycle
// adjustments, refunds, credit memos). Returns a normalized shape;
// an empty array when the user has no `stripe_customer_id` yet, when
// Stripe is unconfigured, or when the API call fails — every "no
// data" branch falls through to the UI's designed empty state.

import 'server-only'
import { getServerSupabase } from '@foundations/data/supabase'
import { getSessionUser } from '@foundations/auth/guards'
import {
  isStripeConfigured,
  getStripe,
  withStripeErrorHandling,
} from '@foundations/money/stripe'
import { loggerFor } from '@foundations/log/pino'

const log = loggerFor({ component: 'subscriptions.getRecentInvoices' })

/** Milliseconds in one (30.4375-day average) month — stable across the calendar. */
const MS_PER_MONTH = (365.25 / 12) * 24 * 60 * 60 * 1000

export type RecentInvoice = {
  id: string
  number: string | null
  created_at: string
  amount_due_cents: number
  amount_paid_cents: number
  currency: string
  status: 'draft' | 'open' | 'paid' | 'uncollectible' | 'void'
  hosted_invoice_url: string | null
  invoice_pdf: string | null
}

/**
 * Default cap that matches the "last 12 months" window for a typical
 * monthly subscriber. Two cycles of headroom for refunds / credits /
 * mid-cycle adjustments without ever spilling past 12 months (the
 * Stripe-side `created[gte]` filter is the authoritative time gate).
 */
export const DEFAULT_INVOICE_LIMIT = 24

/**
 * Window size (months) for the P5.7 spec — "Invoice list + download —
 * last 12 months, PDF per invoice".
 */
export const DEFAULT_INVOICE_WINDOW_MONTHS = 12

/**
 * Return up to `limit` invoices for the current user that were created
 * within the last `olderThanMonths` months. When `olderThanMonths` is
 * null, no time filter is applied (escape hatch for a future "all time"
 * admin surface).
 */
export async function getRecentInvoices(
  limit: number = DEFAULT_INVOICE_LIMIT,
  olderThanMonths: number | null = DEFAULT_INVOICE_WINDOW_MONTHS,
  now: number = Date.now(),
): Promise<RecentInvoice[]> {
  const user = await getSessionUser()
  if (!user) return []
  if (!isStripeConfigured()) return []
  const supabase = await getServerSupabase()
  const { data: sub } = await supabase
    .from('subscriptions')
    .select('stripe_customer_id')
    .eq('user_id', user.id)
    .maybeSingle()
  const customerId = sub?.stripe_customer_id
  if (!customerId) return []

  // Build the Stripe query params. The `created[gte]` filter is the
  // primary time gate; the count `limit` is a safety cap.
  const listParams: { customer: string; limit: number; created?: { gte: number } } = {
    customer: customerId,
    limit,
  }
  if (olderThanMonths !== null) {
    const sinceMs = now - olderThanMonths * MS_PER_MONTH
    listParams.created = { gte: Math.floor(sinceMs / 1000) }
  }

  try {
    const stripe = getStripe()
    const result = await withStripeErrorHandling(
      () => stripe.invoices.list(listParams),
      { surface: 'subscriptions.getRecentInvoices' },
    )
    if (!result.ok) {
      // Read failure — return empty so the UI degrades to a designed
      // empty state rather than a flash of error. The error is already
      // logged by the wrapper.
      return []
    }
    const res = result.data
    return (res.data ?? []).map((inv): RecentInvoice => ({
      id: inv.id ?? '',
      number: inv.number ?? null,
      created_at: inv.created ? new Date(inv.created * 1000).toISOString() : new Date().toISOString(),
      amount_due_cents: inv.amount_due ?? 0,
      amount_paid_cents: inv.amount_paid ?? 0,
      currency: inv.currency ?? 'usd',
      status: (inv.status ?? 'open') as RecentInvoice['status'],
      hosted_invoice_url: inv.hosted_invoice_url ?? null,
      invoice_pdf: inv.invoice_pdf ?? null,
    }))
  } catch (err) {
    const e = err as Error
    log.warn({ code: 'invoices_list_failed', msg: e.message }, 'invoices.list failed')
    return []
  }
}