// getPartnerLedgerEntry.ts — single ledger entry detail for /partner/payouts/[id].
//
// P6.4 — partner ledger detail. RLS is the primary gate
// (`payout_ledger_partner_read_own` filters by current_partner_id()
// which is SECURITY DEFINER). The partner's own RLS-aware client
// returns 0 rows for entries that aren't theirs, so we can't
// distinguish "doesn't exist" from "not yours" — we treat both as
// `null` so the page renders a 404. This avoids leaking the
// existence of other partners' entries via a 200/404 differential.
//
// Joins:
//   - Source order: if `entry.order_id` is set, fetch the order row
//     (NO email / NO ip / NO user_agent — the spec forbids PII).
//   - Refund: if `entry.refund_id` is set, fetch the refund row.
//     Also covers `kind='refund'` rows where refund_id is set
//     (current shape) — defensive guard handles either path.
//   - Partner's timezone: from `profiles.timezone`, defaults to
//     'UTC' if missing/null/empty. Used by the page to render all
//     dates in the partner's local time.
//
// No migration. No new RLS. No new dependencies.

import 'server-only'
import { z } from 'zod'
import { getServerSupabase } from '@foundations/data/supabase'
import { getSessionUser } from '@foundations/auth/guards'
import { loggerFor } from '@foundations/log/pino'
import type { LedgerEntry } from './getPartnerLedger'

const log = loggerFor({ component: 'payouts.getPartnerLedgerEntry' })

// PII safety: a hashed partner_id for log lines. FNV-1a 32-bit, fast
// + deterministic + non-cryptographic. Same shape as
// getMyPartnerProfile.ts so the redaction rule is consistent.
function hashPartnerId(partnerId: number): string {
  let hash = 0x811c9dc5
  for (const ch of String(partnerId)) {
    hash ^= ch.charCodeAt(0)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

const IdSchema = z.object({
  id: z.coerce.number().int().positive(),
})

export type SourceOrder = {
  id: number
  status: string
  subtotal_cents: number
  discount_cents: number
  tax_cents: number
  total_cents: number
  currency: string
  paid_at: string | null
  fulfilled_at: string | null
  created_at: string
  refunded_cents: number
}

export type SourceRefund = {
  id: number
  order_id: number
  amount_cents: number
  reason: string
  notes: string | null
  status: string
  stripe_refund_id: string | null
  approved_at: string | null
  processed_at: string | null
  created_at: string
}

export type PartnerLedgerEntryDetail = {
  entry: LedgerEntry
  /** Source order — present iff `entry.order_id` is set AND the
   *  partner can see it (RLS-gated; not-found is treated as null
   *  rather than 404 to avoid leaking existence). */
  order: SourceOrder | null
  /** Refund — present iff `entry.refund_id` is set. For
   *  `kind='refund'` rows the refund_id is required by the
   *  `onRefund` trigger; we treat its absence as null. */
  refund: SourceRefund | null
  /** Partner's IANA timezone, e.g. 'America/Los_Angeles'. Page
   *  renders all dates via this so the partner sees dates in their
   *  local time, not the server's. */
  timezone: string
}

/** Fetch a single partner ledger entry by id, joined with its source
 *  order + refund. Returns null if the entry doesn't exist OR isn't
 *  the current partner's — the page renders a 404 in both cases. */
export async function getPartnerLedgerEntry(
  rawId: string | number,
): Promise<PartnerLedgerEntryDetail | null> {
  const parsed = IdSchema.safeParse({ id: rawId })
  if (!parsed.success) return null
  const id = parsed.data.id

  const user = await getSessionUser()
  if (!user) return null
  const supabase = await getServerSupabase()

  // Fetch the entry, the partner's profile (timezone), and (in
  // parallel after we know the entry) the order + refund. We do the
  // first round-trip in parallel — entry lookup + profile lookup
  // are independent.
  const [entryRes, profileRes] = await Promise.all([
    supabase
      .from('payout_ledger')
      .select(
        'id, created_at, kind, status, amount_cents, currency, description, order_id, order_item_id, refund_id, royalty_pct_bps, locked_until, available_at, paid_at, paypal_payout_batch_id, stripe_transfer_id',
      )
      .eq('id', id)
      .maybeSingle(),
    supabase
      .from('profiles')
      .select('timezone')
      .eq('user_id', user.id)
      .maybeSingle(),
  ])

  if (entryRes.error) {
    log.warn(
      { code: 'ledger_entry_read_failed', msg: entryRes.error.message },
      'ledger entry read failed',
    )
    return null
  }
  const row = entryRes.data
  if (!row) return null

  // RLS check: even if a row came back, `payout_ledger_partner_read_own`
  // filters by current_partner_id(). If the partner_id on the row is
  // NOT the current user's partner_id, RLS would have returned null
  // already (the row doesn't exist from the RLS perspective). So a
  // populated `row` is already proven to be owned by this partner.
  const entry: LedgerEntry = {
    id: row.id as number,
    created_at: row.created_at as string,
    kind: row.kind as LedgerEntry['kind'],
    status: row.status as LedgerEntry['status'],
    amount_cents: row.amount_cents as number,
    currency: (row.currency as string | null) ?? 'USD',
    description: (row.description as string | null) ?? null,
    order_id: (row.order_id as number | null) ?? null,
    order_item_id: (row.order_item_id as number | null) ?? null,
    refund_id: (row.refund_id as number | null) ?? null,
    royalty_pct_bps: (row.royalty_pct_bps as number | null) ?? null,
    locked_until: (row.locked_until as string | null) ?? null,
    available_at: (row.available_at as string | null) ?? null,
    paid_at: (row.paid_at as string | null) ?? null,
    paypal_payout_batch_id: (row.paypal_payout_batch_id as string | null) ?? null,
    stripe_transfer_id: (row.stripe_transfer_id as string | null) ?? null,
  }

  const timezone =
    typeof profileRes.data?.timezone === 'string' &&
    profileRes.data.timezone.length > 0
      ? profileRes.data.timezone
      : 'UTC'

  // Fetch the source order + refund in parallel. Both are optional
  // (entry.order_id and entry.refund_id may be null). Use
  // .maybeSingle() so a missing row returns null instead of error.
  //
  // PII safety: orders.email is INTENTIONALLY NOT selected. The
  // spec marks "PII displayed: no" for partner-facing surfaces —
  // the partner sees the order id + money + dates + status, NOT
  // the buyer's email. Same for orders.ip + orders.user_agent.
  const [orderRes, refundRes] = await Promise.all([
    entry.order_id
      ? supabase
          .from('orders')
          .select(
            'id, status, subtotal_cents, discount_cents, tax_cents, total_cents, currency, paid_at, fulfilled_at, created_at, refunded_cents',
          )
          .eq('id', entry.order_id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null } as const),
    entry.refund_id
      ? supabase
          .from('refunds')
          .select(
            'id, order_id, amount_cents, reason, notes, status, stripe_refund_id, approved_at, processed_at, created_at',
          )
          .eq('id', entry.refund_id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null } as const),
  ])

  // Fail-soft on the join reads: a missing or errored join returns
  // null rather than 404. The entry itself is the primary record;
  // the joins are supplemental context. This matches the spec's
  // "View order details" affordance — a missing order shouldn't
  // block the partner from seeing the ledger row.
  const order: SourceOrder | null = orderRes.error
    ? null
    : orderRes.data
    ? {
        id: orderRes.data.id as number,
        status: orderRes.data.status as string,
        subtotal_cents: (orderRes.data.subtotal_cents as number) ?? 0,
        discount_cents: (orderRes.data.discount_cents as number) ?? 0,
        tax_cents: (orderRes.data.tax_cents as number) ?? 0,
        total_cents: (orderRes.data.total_cents as number) ?? 0,
        currency: (orderRes.data.currency as string | null) ?? 'USD',
        paid_at: (orderRes.data.paid_at as string | null) ?? null,
        fulfilled_at: (orderRes.data.fulfilled_at as string | null) ?? null,
        created_at: orderRes.data.created_at as string,
        refunded_cents: (orderRes.data.refunded_cents as number) ?? 0,
      }
    : null

  const refund: SourceRefund | null = refundRes.error
    ? null
    : refundRes.data
    ? {
        id: refundRes.data.id as number,
        order_id: refundRes.data.order_id as number,
        amount_cents: (refundRes.data.amount_cents as number) ?? 0,
        reason: refundRes.data.reason as string,
        notes: (refundRes.data.notes as string | null) ?? null,
        status: refundRes.data.status as string,
        stripe_refund_id: (refundRes.data.stripe_refund_id as string | null) ?? null,
        approved_at: (refundRes.data.approved_at as string | null) ?? null,
        processed_at: (refundRes.data.processed_at as string | null) ?? null,
        created_at: refundRes.data.created_at as string,
      }
    : null

  // Sanity check: refund rows SHOULD have a refund_id. If `kind` is
  // `refund` but `refund_id` is null, log a warning — that would be
  // a data inconsistency (the `onRefund` trigger should always set
  // it). Doesn't change the response (we return what we have) but
  // gives ops a signal if the trigger regresses.
  if (entry.kind === 'refund' && entry.refund_id === null) {
    log.warn(
      {
        code: 'refund_row_missing_refund_id',
        entry_id_hash: hashPartnerId(entry.id),
      },
      'refund ledger row missing refund_id',
    )
  }

  return { entry, order, refund, timezone }
}
