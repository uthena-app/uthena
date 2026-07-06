// request-options.ts — PURE constants + types for the payout
// request surface. No server-only imports; safe to import from
// client components.
//
// P6.6 — Partner payout request.
//
// This file is the counterpart to `filter-options.ts` (P6.3 Slice 1).
// It exports the values + types that BOTH the server action AND the
// client island need to render the request button + read pending
// requests. The barrel-split pattern (server-only queries live in
// their own file; client + server shared constants live here) keeps
// the client bundle free of `import "server-only"` accidents.

/**
 * The minimum available balance (in cents) a partner must have
 * before they can submit a payout request. Hardcoded for v1;
 * admin-configurable threshold is a future enhancement (the
 * spec's open question is "what if a partner wants to opt into a
 * lower threshold with manual approval?").
 *
 * $50.00 = 5000 cents. Matches the spec's "available balance
 * exceeds threshold" wording.
 */
export const MIN_PAYOUT_REQUEST_CENTS = 5000

/**
 * The lifetime thresholds + tiers used by the payout UI for
 * informational copy. NOT enforced (the request action only
 * checks `MIN_PAYOUT_REQUEST_CENTS`) — the spec asks for
 * "next payout date" + "tier copy" on the partner dashboard
 * (P12.4), not the request surface.
 */
export const PAYOUT_TIER_COPY = {
  standard: 'Standard — monthly batch',
  accelerated: 'Accelerated — weekly batch (lifetime sales > $10K)',
} as const

/**
 * The set of valid statuses for a payout_request row. Matches
 * the DB CHECK constraint exactly.
 */
export const PAYOUT_REQUEST_STATUS_VALUES = [
  'pending',
  'approved',
  'denied',
  'paid',
  'failed',
  'canceled',
] as const

export type PayoutRequestStatus = (typeof PAYOUT_REQUEST_STATUS_VALUES)[number]

/**
 * The set of valid payout method kinds. v1 supports PayPal only
 * (P6.5 Slice 1 encrypted the email). Slice 2 will add
 * `'bank'` once the Stripe Connect vs Plaid decision lands.
 */
export const PAYOUT_METHOD_KIND_VALUES = ['paypal'] as const

export type PayoutMethodKind = (typeof PAYOUT_METHOD_KIND_VALUES)[number]

/**
 * The set of error codes the request action can return to the
 * client. Mirrors the ExportLedgerCsvResult pattern (typed
 * result, exhaustive handling at the call site).
 */
export const REQUEST_PAYOUT_ERROR_CODES = [
  'not_authorized',
  'partner_not_found',
  'payout_method_missing',
  'below_minimum',
  'pending_request_exists',
  'no_available_balance',
  'unknown',
] as const

export type RequestPayoutErrorCode = (typeof REQUEST_PAYOUT_ERROR_CODES)[number]