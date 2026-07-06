// Payouts formatters. Server-safe.

import { formatMoney as fmtCents } from '@foundations/money/cents'

export const LEDGER_KIND_LABEL: Record<string, string> = {
  order_sale: 'Sale',
  subscription: 'Subscription',
  refund: 'Refund',
  adjustment: 'Adjustment',
  payout: 'Payout',
  clawback: 'Clawback',
}

/** Short labels used for the filter-chip strip in the UI. Tighter
 *  than the row labels because chips have less horizontal room. */
export const LEDGER_KIND_CHIP_LABEL: Record<string, string> = {
  order_sale: 'Sale',
  subscription: 'Sub',
  refund: 'Refund',
  adjustment: 'Adjust',
  payout: 'Payout',
  clawback: 'Clawback',
}

export const LEDGER_STATUS_LABEL: Record<string, string> = {
  accruing: 'Accruing',
  pending_payout: 'Pending payout',
  locked: 'Locked (refund window)',
  available: 'Available',
  paid: 'Paid',
  void: 'Void',
}

export const LEDGER_STATUS_CHIP_LABEL: Record<string, string> = {
  accruing: 'Accruing',
  pending_payout: 'Pending',
  locked: 'Locked',
  available: 'Available',
  paid: 'Paid',
  void: 'Void',
}

export const LEDGER_STATUS_COLOR: Record<string, 'success' | 'warn' | 'danger' | 'mute' | 'accent'> = {
  accruing: 'mute',
  pending_payout: 'warn',
  locked: 'warn',
  available: 'success',
  paid: 'mute',
  void: 'danger',
}

/** Human-readable order status for partner-facing surfaces. The
 *  order status enum (`order_status` in migration 0001) covers the
 *  full lifecycle including admin-only states (e.g. `disputed`).
 *  Partners see only the states their orders normally take. */
export const ORDER_STATUS_LABEL: Record<string, string> = {
  pending: 'Pending',
  paid: 'Paid',
  fulfilled: 'Fulfilled',
  refunded: 'Refunded',
  partially_refunded: 'Partially refunded',
  canceled: 'Canceled',
  failed: 'Failed',
  disputed: 'Disputed',
}

/** Human-readable refund reason — mirrors the DB CHECK constraint
 *  on `refunds.reason` (see migration 0001). */
export const REFUND_REASON_LABEL: Record<string, string> = {
  duplicate: 'Duplicate charge',
  fraudulent: 'Fraudulent',
  requested_by_customer: 'Requested by customer',
  product_not_received: 'Product not received',
  product_unacceptable: 'Product unacceptable',
  other: 'Other',
}

/** P6.7 — payout_request row status (mirrors the DB CHECK constraint
 *  on `payout_requests.status` from migration 0031). The admin queue
 *  renders these as filter chips + status pills. */
export const PAYOUT_REQUEST_STATUS_LABEL: Record<string, string> = {
  pending: 'Pending',
  approved: 'Approved',
  denied: 'Denied',
  paid: 'Paid',
  failed: 'Failed',
  canceled: 'Canceled',
}

/** P6.7 — color hint for the status pill on the admin queue page.
 *  Mirrors the `LEDGER_STATUS_COLOR` pattern from P6.3. The CSS
 *  attribute selectors on `[data-status='...']` are the visual source
 *  of truth — this map exists for any future non-CSS consumer
 *  (email, log, etc.). */
export const PAYOUT_REQUEST_STATUS_COLOR: Record<string, 'success' | 'warn' | 'danger' | 'mute' | 'accent'> = {
  pending: 'accent',
  approved: 'success',
  paid: 'success',
  denied: 'danger',
  failed: 'danger',
  canceled: 'mute',
}

export function money(cents: number, currency = 'USD'): string {
  return fmtCents(cents, currency as 'USD')
}

/** Format an ISO timestamp in the partner's IANA timezone (e.g.
 *  'America/Los_Angeles'). Falls back to the browser/server
 *  locale if `timeZone` is falsy. `Intl.DateTimeFormat` does the
 *  heavy lifting — no library needed.
 *
 *  Accepts both `null`/`undefined` (renders '—') and a malformed
 *  ISO string (renders the raw value as a defensive fallback —
 *  the alternative is a crash on bad DB data).
 */
export function formatDate(
  iso: string | null | undefined,
  locale = 'en-US',
  timeZone?: string | null,
): string {
  if (!iso) return '—'
  try {
    const fmt = new Intl.DateTimeFormat(locale, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      timeZone: timeZone || undefined,
    })
    return fmt.format(new Date(iso))
  } catch {
    return iso
  }
}

/** Same shape as `formatDate` but with a time component, for any
 *  future ledger surface that needs sub-day resolution (e.g. a
 *  per-row "Released at 2:47 PM" tooltip). Not used by the
 *  current page — kept here so the helper pair lives in one place. */
export function formatDateTime(
  iso: string | null | undefined,
  locale = 'en-US',
  timeZone?: string | null,
): string {
  if (!iso) return '—'
  try {
    const fmt = new Intl.DateTimeFormat(locale, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZone: timeZone || undefined,
    })
    return fmt.format(new Date(iso))
  } catch {
    return iso
  }
}