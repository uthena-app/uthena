// getPartnerPayoutsHistory.ts — P12.14 partner payouts history read.
//
// Reads from the SECURITY DEFINER RPC
// `get_partner_payouts_history(p_partner_id, p_limit)` shipped in
// migration 0043. The RPC is auth-checked internally (caller must be
// the partner OR an admin); this wrapper adds the partner lookup +
// the ownership defense-in-depth so a future RPC drift never leaks
// another partner's batch data.
//
// Fail-soft contract (mirrors P12.4 / P12.6 / P6.5 / P12.11): if the
// RPC fails, log a warn with a hashed partner_id (PII safety) and
// return an empty array. The Payouts history section MUST never error
// out because of a transient RPC hiccup — the rest of the page can
// still render with the empty-history state ("Your first payout will
// appear here...").
//
// Spec: `01-specs/pages/instructor-payouts.md` lines 10-15 — the
// "Payouts history" section is one row per PayPal Mass Payout batch.
// The shape here is one row per (batch_id, currency) — grouping by
// currency is defensive (the same batch_id should never have mixed
// currencies, but grouping by both keeps the SUM correct if it ever
// does).

import 'server-only'
import { getServerSupabase } from '@foundations/data/supabase'
import { getSessionUser } from '@foundations/auth/guards'
import { loggerFor } from '@foundations/log/pino'

const log = loggerFor({ component: 'payouts.getPartnerPayoutsHistory' })

/** Single PayPal Mass Payout batch for the partner.
 *  Numbers coerced to JS number; timestamps are ISO-8601 strings. */
export type PayoutBatch = {
  /** The shared PayPal Mass Payout batch id. Displayed in mono font
   *  in the UI so the partner can copy it for PayPal support. */
  paypalPayoutBatchId: string
  /** Earliest ledger row paid in the batch (ISO-8601). */
  periodStart: string
  /** Latest ledger row paid in the batch (ISO-8601). */
  periodEnd: string
  /** Sum of amount_cents across all rows in the batch. NET: positive
   *  commission credits + negative payout debits cancel out so the
   *  total is the partner's actual gross payout. */
  amountCents: number
  /** ISO-4217 currency code (always 'USD' for v1). */
  currency: string
  /** Count of underlying commission rows (sales / subscriptions)
   *  paid out in this batch. Each commission produces a matching
   *  payout debit row that is NOT counted — so a batch with 3
   *  sales of $45 has commission_count = 3. */
  commissionCount: number
  /** Earliest ledger row created_at in the batch (ISO-8601). Used as
   *  a stable secondary sort; the primary sort is paid_at desc. */
  createdAt: string
}

/** PostgREST bigint-as-string → number. Returns 0 for null / NaN /
 *  non-numeric / wire-string. Used for amount_cents + commission_count. */
function coerceBigint(v: unknown): number {
  if (v == null) return 0
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0
  if (typeof v === 'string') {
    const n = Number.parseInt(v, 10)
    return Number.isFinite(n) ? n : 0
  }
  return 0
}

/** ISO timestamp guard — RPCs that return `timestamptz` typically
 *  serialize as full ISO (`2026-06-30T10:00:00+00:00` or `...Z`).
 *  Returns the string verbatim when it's a valid ISO date, or null
 *  for anything else (empty / non-string / NaN date). */
function coerceIsoTimestamp(v: unknown): string | null {
  if (typeof v !== 'string' || v.length === 0) return null
  const t = new Date(v)
  if (Number.isNaN(t.getTime())) return null
  return t.toISOString()
}

/** Stable FNV-1a 32-bit hash for the partner_id in log payloads.
 *  FNV-1a 32-bit is fast, non-cryptographic, and sufficient for "is
 *  this the same partner across log lines" correlation. NOT a security
 *  boundary; just a redaction helper for the `check:pii` script. */
function hashPartnerId(value: number): string {
  let hash = 0x811c9dc5
  for (const ch of String(value)) {
    hash ^= ch.charCodeAt(0)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

/** Default limit when the caller doesn't specify one. Matches the
 *  P6.3 ledger entries default (50 per page). */
export const DEFAULT_PAYOUT_HISTORY_LIMIT = 50

/** Hard cap on the limit — matches the P6.3 cap (200). */
export const MAX_PAYOUT_HISTORY_LIMIT = 200

/** Read the partner's payouts history: one row per PayPal Mass
 *  Payout batch that included this partner, newest first.
 *
 *  Returns an empty array when:
 *    - the caller has no auth session
 *    - the caller is not a partner (no `partners` row)
 *    - the partner has no paid-out batches yet
 *    - the RPC errors out (fail-soft + warn log)
 *
 *  The RPC enforces authorization internally (STABLE SECURITY DEFINER
 *  + `current_partner_id() = p_partner_id or is_admin()`); this
 *  wrapper adds the partner lookup so the caller only ever sees
 *  their own batches (defense-in-depth against RPC drift). */
export async function getPartnerPayoutsHistory(
  limit: number = DEFAULT_PAYOUT_HISTORY_LIMIT,
): Promise<PayoutBatch[]> {
  // Sanitize the limit at the wrapper boundary (the RPC also caps
  // it via `greatest(p_limit, 0)` but we want a deterministic JS-side
  // guard for the page's UI contract).
  const safeLimit = Number.isInteger(limit) && limit > 0
    ? Math.min(limit, MAX_PAYOUT_HISTORY_LIMIT)
    : DEFAULT_PAYOUT_HISTORY_LIMIT

  const user = await getSessionUser()
  if (!user) return []

  const supabase = await getServerSupabase()

  // Partner row lookup keyed off user_id. Single-row read on the
  // unique index — cheap. Same shape as getPartnerLedger's lookup.
  const { data: partner, error: partnerErr } = await supabase
    .from('partners')
    .select('id, user_id')
    .eq('user_id', user.id)
    .maybeSingle()

  if (partnerErr) {
    log.warn(
      { code: partnerErr.code ?? null, msg: partnerErr.message },
      'partner lookup failed for payouts history',
    )
    return []
  }
  if (!partner) return []

  const callerPartnerId = (partner as { id: unknown }).id as number
  if (!Number.isInteger(callerPartnerId) || callerPartnerId <= 0) {
    log.warn(
      { code: 'partner_id_invalid' },
      'partner row has invalid id; refusing to query payouts history',
    )
    return []
  }

  const { data, error } = await supabase.rpc('get_partner_payouts_history', {
    p_partner_id: callerPartnerId,
    p_limit: safeLimit,
  })

  if (error) {
    log.warn(
      {
        partner_id_hash: hashPartnerId(callerPartnerId),
        code: error.code ?? null,
      },
      'payouts history RPC failed',
    )
    return []
  }

  if (!Array.isArray(data)) {
    // RPC always returns a setof (table); defensive parse.
    return []
  }

  return data.map((row) => mapBatchRow(row as Record<string, unknown>))
}

/** Map one raw RPC row into the typed `PayoutBatch` shape. Defensive
 *  — coerces / null-fills every field so a malformed row never crashes
 *  the page. */
function mapBatchRow(row: Record<string, unknown>): PayoutBatch {
  return {
    paypalPayoutBatchId:
      typeof row.paypal_payout_batch_id === 'string'
        ? row.paypal_payout_batch_id
        : '',
    periodStart: coerceIsoTimestamp(row.period_start) ?? new Date(0).toISOString(),
    periodEnd: coerceIsoTimestamp(row.period_end) ?? new Date(0).toISOString(),
    amountCents: coerceBigint(row.amount_cents),
    currency:
      typeof row.currency === 'string' && row.currency.length > 0 ? row.currency : 'USD',
    commissionCount: coerceBigint(row.commission_count),
    createdAt: coerceIsoTimestamp(row.created_at) ?? new Date(0).toISOString(),
  }
}
