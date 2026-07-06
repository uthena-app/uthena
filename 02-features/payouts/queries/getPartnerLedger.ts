// getPartnerLedger.ts — partner's own ledger + balance summary.
//
// RLS is the primary gate (`payout_ledger_partner_read_own` filters
// by current_partner_id() which is SECURITY DEFINER). The partner's
// own RLS-aware client is correct — no service-role needed.
//
// P6.3 — adds:
//   - `status` filter (entries only; summary stays global by design)
//   - `kind`   filter (entries only)
//   - `sort`   param: 'date' (default) | 'amount' | 'kind'
//   - `beforeId` keyset pagination (date desc, id desc) — already
//     supported, kept as-is for Slice 2 (pagination UI)
//   - `timezone` read from profiles.timezone (defaults to 'UTC' if
//     the profile row is missing or the column is null). Surfaced
//     on the result so the page renders all dates in the partner's
//     local timezone — spec acceptance criterion #18.
//
// Summary aggregates intentionally do NOT honor the filters — they
// reflect the partner's full financial state. If a partner filters
// to "Paid", they still see "Available: $X" at the top so they can
// act on it. The ledger below is what's currently in scope.

import 'server-only'
import { z } from 'zod'
import { getServerSupabase } from '@foundations/data/supabase'
import { getSessionUser } from '@foundations/auth/guards'
import { loggerFor } from '@foundations/log/pino'
import {
  LEDGER_STATUS_VALUES,
  LEDGER_KIND_VALUES,
  LEDGER_SORT_VALUES,
  type LedgerSort,
  type LedgerStatus,
  type LedgerKind,
} from '../filter-options'

const log = loggerFor({ component: 'payouts.getPartnerLedger' })

export type LedgerEntry = {
  id: number
  created_at: string
  kind: LedgerKind
  status: 'accruing' | 'pending_payout' | 'locked' | 'available' | 'paid' | 'void'
  amount_cents: number
  currency: string
  description: string | null
  order_id: number | null
  order_item_id: number | null
  /** P6.4 — refund link for `kind='refund'` rows. Most rows have
   *  this null; refund rows always have it (the `onRefund` trigger
   *  sets it). Useful for the ledger row's affordance + the
   *  detail page's refund-card join. */
  refund_id: number | null
  royalty_pct_bps: number | null
  locked_until: string | null
  available_at: string | null
  paid_at: string | null
  paypal_payout_batch_id: string | null
  stripe_transfer_id: string | null
}

export type LedgerSummary = {
  available_cents: number
  locked_cents: number
  paid_cents: number
  lifetime_earned_cents: number
  next_release_at: string | null
  pending_payout_cents: number
}

// Re-export the filter constants/types so the existing public
// surface (`@features/payouts`) keeps working unchanged.
export { LEDGER_STATUS_VALUES, LEDGER_KIND_VALUES, LEDGER_SORT_VALUES, type LedgerSort, type LedgerStatus, type LedgerKind }

const LedgerFilterSchema = z.object({
  limit: z.number().int().min(1).max(200).default(50),
  beforeId: z.number().int().positive().nullable().optional(),
  status: z.enum(LEDGER_STATUS_VALUES).optional(),
  kind: z.enum(LEDGER_KIND_VALUES).optional(),
  sort: z.enum(LEDGER_SORT_VALUES).default('date'),
})

export type LedgerFilterOptions = z.input<typeof LedgerFilterSchema>

export type PartnerLedgerResult = {
  entries: LedgerEntry[]
  summary: LedgerSummary
  /** Partner's IANA timezone (e.g. 'America/Los_Angeles'). All
   *  date display in the page routes through this so the partner
   *  sees dates in their local time, not the server's. */
  timezone: string
  /** Echoed filters — useful for the page header to render an
   *  "X filter applied" affordance + tests to assert the filter
   *  was honored. */
  filters: {
    status?: LedgerFilterOptions['status']
    kind?: LedgerFilterOptions['kind']
    sort: LedgerSort
  }
}

/** Fetch the partner's ledger. Returns null if the user is not a
 *  partner (RLS returns 0 rows; we detect this and return null so
 *  the page can show "you're not a partner" instead of an empty list).
 *
 *  P6.3 — accepts URL-driven filter + sort options; the entries
 *  query honors them. The summary aggregates do NOT (see file
 *  header). */
export async function getPartnerLedger(
  opts: LedgerFilterOptions = {},
): Promise<PartnerLedgerResult | null> {
  const parsed = LedgerFilterSchema.parse(opts)

  const user = await getSessionUser()
  if (!user) return null
  const supabase = await getServerSupabase()

  // Read the partner row + the partner's profile (timezone) in
  // parallel. Both are single-row lookups on a unique index; the
  // profile query keys off `user_id` which we just got from
  // getSessionUser(). Cheap — adds < 5ms to the page render.
  const [partnerRes, profileRes] = await Promise.all([
    supabase
      .from('partners')
      .select('id, user_id, status')
      .eq('user_id', user.id)
      .maybeSingle(),
    supabase
      .from('profiles')
      .select('timezone')
      .eq('user_id', user.id)
      .maybeSingle(),
  ])
  const partner = partnerRes.data
  if (!partner) return null
  const timezone =
    typeof profileRes.data?.timezone === 'string' && profileRes.data.timezone.length > 0
      ? profileRes.data.timezone
      : 'UTC'

  // Build the entries query. P6.3 — apply the URL-driven filters
  // + sort. Sort orderings:
  //   - 'date'   → created_at desc, id desc (newest first; keyset
  //                pagination via beforeId)
  //   - 'amount' → amount_cents desc, id desc (biggest first; tie-
  //                break on id so the page is deterministic)
  //   - 'kind'   → kind asc, created_at desc, id desc (grouped by
  //                kind, newest within group)
  let q = supabase
    .from('payout_ledger')
    .select('id, created_at, kind, status, amount_cents, currency, description, order_id, order_item_id, refund_id, royalty_pct_bps, locked_until, available_at, paid_at, paypal_payout_batch_id, stripe_transfer_id')
    .eq('partner_id', partner.id)
  if (parsed.status) {
    q = q.eq('status', parsed.status)
  }
  if (parsed.kind) {
    q = q.eq('kind', parsed.kind)
  }
  if (parsed.sort === 'amount') {
    q = q.order('amount_cents', { ascending: false }).order('id', { ascending: false })
  } else if (parsed.sort === 'kind') {
    q = q.order('kind', { ascending: true }).order('created_at', { ascending: false }).order('id', { ascending: false })
  } else {
    q = q.order('created_at', { ascending: false }).order('id', { ascending: false })
  }
  if (parsed.beforeId) {
    // Keyset on (created_at desc, id desc): a smaller id is later
    // in the same descending sort. The beforeId filter is only
    // meaningful for the 'date' sort — for 'amount'/'kind' sorts
    // it may return surprising results. We still apply it because
    // a "load more" click should consistently advance the cursor;
    // the next-tick pagination UI can detect sort changes and
    // reset to page 1.
    q = q.lt('id', parsed.beforeId)
  }
  q = q.limit(parsed.limit)

  const { data: entries, error } = await q
  if (error) {
    log.warn({ code: 'partner_ledger_failed', msg: error.message }, 'partner ledger read failed')
    return {
      entries: [],
      summary: emptySummary(),
      timezone,
      filters: { status: parsed.status, kind: parsed.kind, sort: parsed.sort },
    }
  }

  // Summary aggregates. Intentionally NO filter — the partner's
  // "Available / Locked / Paid" headline numbers reflect their full
  // financial state regardless of what they're currently viewing
  // in the ledger. One read each, hitting the (partner_id, status)
  // index. Five round-trips total — cheap (every query touches the
  // partner's own rows via RLS, so they're small).
  const [availableRes, lockedRes, paidRes, nextReleaseRes, pendingRes] = await Promise.all([
    supabase.from('payout_ledger').select('amount_cents').eq('partner_id', partner.id).eq('status', 'available'),
    supabase.from('payout_ledger').select('amount_cents').eq('partner_id', partner.id).eq('status', 'locked'),
    supabase.from('payout_ledger').select('amount_cents').eq('partner_id', partner.id).eq('status', 'paid'),
    supabase.from('payout_ledger').select('available_at').eq('partner_id', partner.id).eq('status', 'locked').gt('available_at', new Date().toISOString()).order('available_at', { ascending: true }).limit(1).maybeSingle(),
    supabase.from('payout_ledger').select('amount_cents').eq('partner_id', partner.id).eq('status', 'pending_payout'),
  ])
  const sum = (rows: { amount_cents: number | null }[] | null) =>
    (rows ?? []).reduce((s, r) => s + (r.amount_cents ?? 0), 0)
  const summary: LedgerSummary = {
    available_cents: sum(availableRes.data),
    locked_cents: sum(lockedRes.data),
    paid_cents: sum(paidRes.data),
    lifetime_earned_cents: sum(availableRes.data) + sum(lockedRes.data) + sum(paidRes.data),
    next_release_at: nextReleaseRes.data?.available_at ?? null,
    pending_payout_cents: sum(pendingRes.data),
  }
  return {
    entries: entries ?? [],
    summary,
    timezone,
    filters: { status: parsed.status, kind: parsed.kind, sort: parsed.sort },
  }
}

function emptySummary(): LedgerSummary {
  return {
    available_cents: 0,
    locked_cents: 0,
    paid_cents: 0,
    lifetime_earned_cents: 0,
    next_release_at: null,
    pending_payout_cents: 0,
  }
}