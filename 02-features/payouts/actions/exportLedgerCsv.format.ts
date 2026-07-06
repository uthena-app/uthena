// exportLedgerCsv.format.ts — pure CSV builder helpers. No I/O,
// no server-only imports. Lives in its own module because
// `'use server'` files in Next.js can only export async functions;
// the server action re-imports these helpers from here.
//
// Spec (`01-specs/pages/instructor-payouts.md`) — the CSV must be
// full-ledger for accounting, RFC 4180-compliant, and survive
// every spreadsheet app's quirks (Excel + Google Sheets + Numbers
// all handle CRLF + double-quoted fields correctly).

/** Spec contract: 10 exports per partner per hour. Same window as
 *  the signed-URL rate limit (60 min) — keeps the math simple for
 *  ops + the floor is well below any "I'm doing my taxes at midnight"
 *  real-world need. */
export const EXPORT_RATE_LIMIT_MAX_PER_PARTNER = 10
export const EXPORT_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000

/** Cap the CSV at a reasonable size. A partner with 5000 ledger
 *  rows is a 100-year career; if we ever see a real partner hit
 *  this, we'll switch to streaming + a "next page" UI. v1: bounded. */
export const MAX_EXPORT_ROWS = 5000

/** Escape a single CSV field per RFC 4180. Wrap in double quotes
 *  if the value contains a comma, quote, CR, or LF; double any
 *  embedded quotes. Numbers + null-ish pass through unchanged. */
export function csvEscape(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return ''
  const s = typeof value === 'number' ? String(value) : value
  if (s === '') return ''
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

export type LedgerCsvRow = {
  id: number
  created_at: string
  kind: string
  status: string
  amount_cents: number
  currency: string
  description: string | null
  order_id: number | null
  order_item_id: number | null
  refund_id: number | null
  royalty_pct_bps: number | null
  locked_until: string | null
  available_at: string | null
  paid_at: string | null
  paypal_payout_batch_id: string | null
  stripe_transfer_id: string | null
}

/** Build the CSV body. Pure function — exported for unit testing.
 *  Headers are the spec's "full ledger for accounting" view. Money
 *  is rendered as a decimal with two digits (accounting-friendly —
 *  Stripe & most spreadsheet apps expect $1.23 not ¢123). Dates
 *  are ISO 8601 (UTC) so spreadsheet apps sort correctly. */
export function buildLedgerCsv(rows: ReadonlyArray<LedgerCsvRow>): string {
  const header = [
    'id',
    'created_at',
    'kind',
    'kind_label',
    'status',
    'status_label',
    'amount',
    'currency',
    'amount_cents',
    'royalty_pct',
    'description',
    'order_id',
    'order_item_id',
    'refund_id',
    'locked_until',
    'available_at',
    'paid_at',
    'paypal_payout_batch_id',
    'stripe_transfer_id',
  ]
  // Lazy-load the label maps so this module stays pure + dep-free.
  // Avoids a circular import (format.ts is server-safe but lives in
  // a different folder; keeping the import lazy means the CSV
  // builder can be unit-tested without dragging in the full
  // payouts feature module).
  const lines: string[] = [header.join(',')]
  const kindLabel = ledgerKindLabelMap()
  const statusLabel = ledgerStatusLabelMap()
  for (const r of rows) {
    const royaltyPct = r.royalty_pct_bps != null ? (r.royalty_pct_bps / 100).toFixed(2) : ''
    const amount = (r.amount_cents / 100).toFixed(2)
    lines.push(
      [
        r.id,
        r.created_at,
        r.kind,
        kindLabel[r.kind] ?? r.kind,
        r.status,
        statusLabel[r.status] ?? r.status,
        amount,
        r.currency,
        r.amount_cents,
        royaltyPct,
        r.description ?? '',
        r.order_id ?? '',
        r.order_item_id ?? '',
        r.refund_id ?? '',
        r.locked_until ?? '',
        r.available_at ?? '',
        r.paid_at ?? '',
        r.paypal_payout_batch_id ?? '',
        r.stripe_transfer_id ?? '',
      ]
        .map(csvEscape)
        .join(','),
    )
  }
  // CRLF line terminators per RFC 4180 — Excel + Google Sheets
  // both handle this correctly on every platform. Trailing CRLF
  // is also per the spec.
  return lines.join('\r\n') + '\r\n'
}

// --- Lazy label maps ----------------------------------------------------
// Mirror the values in `02-features/payouts/format.ts`. Inlined here
// (rather than imported) so this module has no feature dependencies
// — it can be unit-tested in isolation. If the canonical map ever
// changes, both copies must change in lockstep. STUB-047 covers the
// move to a single shared `00-foundations/data/enums.ts` source.

function ledgerKindLabelMap(): Record<string, string> {
  return {
    order_sale: 'Sale',
    subscription: 'Subscription',
    refund: 'Refund',
    adjustment: 'Adjustment',
    payout: 'Payout',
    clawback: 'Clawback',
  }
}

function ledgerStatusLabelMap(): Record<string, string> {
  return {
    accruing: 'Accruing',
    pending_payout: 'Pending payout',
    locked: 'Locked (refund window)',
    available: 'Available',
    paid: 'Paid',
    void: 'Void',
  }
}