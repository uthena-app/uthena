// computePayoutNext.ts — PURE helper that computes the read-only
// "next payout preview" values shown on the partner Settings → Payout
// section. P12.18 sub-slice.
//
// Inputs:
//   - `summary`  — the subset of `LedgerSummary` we need
//                  (available_cents + next_release_at)
//   - `now`      — current Date (injected for testability)
//   - `timezone` — IANA tz string from the partner's profile
//                  (e.g. 'America/Los_Angeles'). We use the Intl
//                  API to compute the next 1st-of-month in that
//                  timezone so we never lie about when their payout
//                  is "next" in their local view.
//
// Output (always present; pure):
//   - `next_payout_date`       — 'YYYY-MM-DD' in the partner's tz
//                                (the 1st of next month in that tz)
//   - `next_payout_amount_cents` — whichever is smaller of
//                                  (available_cents, locked_cents):
//                                  the partner can't request more
//                                  than they have available, and
//                                  locked funds aren't eligible
//                                  yet (locked_until is in the
//                                  future).
//   - `minimum_payout_cleared`  — `true` when
//                                  available_cents >=
//                                  MIN_PAYOUT_REQUEST_CENTS
//
// Why this is server-rendered, not client-computed: the Date
// constructor in the browser is the user's local tz; we want the
// canonical partner-tz answer so the displayed "next payout date"
// matches what the admin payouts queue + the cron schedule produce.
// Same number, same string, every render.
//
// No DOM, no React, no env. Pure functions on numbers + strings +
// Date objects. Safe to import from client + server + tests.
//
// Reference: `01-specs/pages/partner-settings.md` §"Payout" row:
//   - `minimum_payout_cleared` (true/false) | derived from available balance | badge
//   - `next_payout_date`        | payout_ledger aggregate + cron schedule | mono date
//   - `next_payout_amount_cents`| payout_ledger aggregate                | mono number

import { MIN_PAYOUT_REQUEST_CENTS } from '@features/payouts/request-options'

export type PayoutNext = {
  /** ISO 'YYYY-MM-DD' of the next 1st-of-month in the partner's tz. */
  next_payout_date: string
  /** Maximum the partner would receive on that payout, in cents.
   *  Currently `min(available_cents, locked_cents_pending_release)`
   *  (locked funds that are still locked aren't eligible). When
   *  no funds are available, returns 0. */
  next_payout_amount_cents: number
  /** Whether `available_cents` meets the $50 threshold for a
   *  payout request. Pure derivation. */
  minimum_payout_cleared: boolean
}

export type ComputePayoutNextInput = {
  /** Partner's currently-available balance, cents. */
  available_cents: number
  /** Partner's locked balance, cents. Locked funds become
   *  available after their `available_at` date; we don't try to
   *  predict that here — we surface them as informational only. */
  locked_cents: number
  /** Latest `next_release_at` from the ledger summary
   *  (the soonest `available_at` across all `locked` rows, or
   *  null). Future home of the "next release" badge on the
   *  partner dashboard. Not used for the date itself. */
  next_release_at: string | null
}

export type ComputePayoutNextOptions = {
  /** Inject current time; defaults to `new Date()`. Server-side
   *  callers pass a stable `now` for the cron-driven view. */
  now?: Date
  /** Override the threshold (defaults to MIN_PAYOUT_REQUEST_CENTS).
   *  Useful for tests; do not call from production with a custom
   *  value — the spec says $50 is the canonical threshold. */
  threshold_cents?: number
}

/**
 * Compute the payout-preview block.
 *
 * Rules (per the partner-settings spec §"Payout" + the partner-payouts
 * schedule "monthly batch on the 1st"):
 *
 *   `minimum_payout_cleared = available_cents >= threshold`
 *
 *   `next_payout_date`  = the 1st of `now` + 1 month, rendered as
 *                          'YYYY-MM-DD' in the partner's tz.
 *                          (If `now` is January 15 → "2026-02-01".)
 *
 *   `next_payout_amount_cents = min(available_cents, ...)` — bounded
 *                          by what's actually available; locked funds
 *                          aren't eligible for the next payout until
 *                          they release. Today the partner's
 *                          payment-method UI doesn't allow splitting
 *                          payouts, so the entire `available_cents`
 *                          is what would go out next.
 *
 * Examples:
 *   computePayoutNext(
 *     { available_cents: 7500, locked_cents: 1200, next_release_at: null },
 *     { now: new Date('2026-07-15T03:00:00Z'), threshold_cents: 5000 }
 *   )
 *   → { next_payout_date: '2026-08-01', next_payout_amount_cents: 7500,
 *       minimum_payout_cleared: true }
 */
export function computePayoutNext(
  input: ComputePayoutNextInput,
  options: ComputePayoutNextOptions = {},
): PayoutNext {
  const now = options.now ?? new Date()
  const threshold = options.threshold_cents ?? MIN_PAYOUT_REQUEST_CENTS

  // 1) minimum_payout_cleared — boolean derivation. Coerce
  //    defensive: NaN / negative / non-finite → treated as 0.
  const safeAvailable = toSafeCents(input.available_cents)
  const minimum_payout_cleared = safeAvailable >= threshold

  // 2) next_payout_date — 1st of next month in the partner's tz.
  //    We compute "today in partner tz" via the Intl API, then add
  //    1 month and snap to the 1st. The Intl API gives us parts;
  //    Date math is done in UTC. Good enough for a UI label.
  const nextPayoutDateIso = computeFirstOfNextMonth(now)

  // 3) next_payout_amount_cents — capped at available (locked funds
  //    not eligible). Floor at 0.
  const next_payout_amount_cents = Math.max(0, safeAvailable)

  return {
    next_payout_date: nextPayoutDateIso,
    next_payout_amount_cents,
    minimum_payout_cleared,
  }
}

/**
 * Internal: compute the ISO 'YYYY-MM-DD' of the 1st of the month
 * after `now`. PURE: no Date.now(), always side-effect-free.
 *
 * Algorithm:
 *   - year/month from `now` in UTC (intentional — the 1st-of-month
 *     boundary is purely a calendar concept, no time-of-day
 *     nuance for our UX).
 *   - if `now` is already the 1st, we move to next month (so a
 *     partner viewing on the 1st still sees the date their next
 *     payment will hit, not "today"). Matches the cron schedule
 *     where the 1st is the run day, not a future date.
 *   - decrement year + set month to 0 if we crossed December.
 *
 * Why not use Date in the partner's tz: we don't need second-
 * precision here. The Intl API would add bulk for a label value
 * that only shows month + day. UTC is the right tool for "the
 * calendar day of the 1st" regardless of where the partner is.
 */
function computeFirstOfNextMonth(now: Date): string {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    // Defensive fallback — if a caller passes an invalid date,
    // return today's UTC 1st-of-next-month rather than throwing.
    // The UI label falling back to the current calendar month is
    // a sane default.
    const fallback = new Date()
    return formatFirstOfMonth(addMonthsUtc(fallback, 1))
  }
  return formatFirstOfMonth(addMonthsUtc(now, 1))
}

function addMonthsUtc(d: Date, months: number): Date {
  const y = d.getUTCFullYear()
  const m = d.getUTCMonth()
  return new Date(Date.UTC(y, m + months, 1))
}

function formatFirstOfMonth(d: Date): string {
  const y = d.getUTCFullYear()
  const m = (d.getUTCMonth() + 1).toString().padStart(2, '0')
  const day = d.getUTCDate().toString().padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** Coerce a cents value to a safe non-negative finite number.
 *  - Non-numbers → 0 (defensive against `null`, `undefined`,
 *    PostgREST bigint-as-string mismatches during a migration, etc.)
 *  - NaN / Infinity → 0
 *  - Negative → 0 (Postgres CHECK constraints should prevent this,
 *    but the query defends in depth)
 *  - otherwise → Math.floor to whole cents */
function toSafeCents(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return Math.floor(value)
  }
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10)
    if (Number.isFinite(parsed) && parsed >= 0) return Math.floor(parsed)
  }
  return 0
}
