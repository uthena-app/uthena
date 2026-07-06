// getMyCourseSalesSummary.ts — P12.11 Slice 1 partner sales summary read.
//
// Reads from the SECURITY DEFINER RPC
// `get_partner_course_sales_summary(p_partner_id, p_product_id)` shipped
// in migration 0042. The RPC is auth-checked internally (caller must be
// the partner OR an admin); this wrapper adds the partner lookup + the
// ownership check that defends against RPC drift.
//
// Fail-soft contract (mirrors P12.4 / P12.6 / P6.5): if the RPC fails,
// log a warn with a hashed partner_id (PII safety) and return the
// empty-summary default. The Sales tab on the course detail page MUST
// never error out because the summary is transient.

import 'server-only'
import { getServerSupabase } from '@foundations/data/supabase'
import { loggerFor } from '@foundations/log/pino'

/** Coerce a PostgREST bigint-as-string value back to a number. Used
 *  for revenue_cents, units_sold, order_count, refund_count. Returns
 *  0 for null / NaN / non-numeric / wire-string. */
function coerceBigint(v: unknown): number {
  if (v == null) return 0
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0
  if (typeof v === 'string') {
    const n = Number.parseInt(v, 10)
    return Number.isFinite(n) ? n : 0
  }
  return 0
}

/** The single partner product summary shape returned to the page.
 *  Numbers coerced to JS number; timestamps are ISO-8601 strings (or
 *  null when there's no sale yet). avgRating is null when the product
 *  has zero published reviews — the page renders "No reviews yet"
 *  in that case (NOT a 0.00 fallback). */
export type PartnerCourseSalesSummary = {
  revenueCents: number
  unitsSold: number
  orderCount: number
  refundCount: number
  /** Refund rate as a fraction in [0, 1]. The page renders this as a
   *  percentage via `${(rate * 100).toFixed(1)}%`. 0 when orderCount is
   *  zero — never NaN, never a divide-by-zero. */
  refundRate: number
  /** Published-only average rating in [1, 5]. Null when the product has
   *  zero published reviews; the page renders "No reviews yet" instead
   *  of a 0.00 fallback (preserves the RPC's NULL contract). */
  avgRating: number | null
  /** ISO-8601 string for the earliest paid sale; null when no sales. */
  firstSaleAt: string | null
  /** ISO-8601 string for the most recent paid sale; null when no sales. */
  lastSaleAt: string | null
}

/** The default "empty" summary — every numeric is 0, avgRating is null,
 *  timestamps are null. Returned on auth-fail / RPC-error / no-data. */
export function emptyPartnerCourseSalesSummary(): PartnerCourseSalesSummary {
  return {
    revenueCents: 0,
    unitsSold: 0,
    orderCount: 0,
    refundCount: 0,
    refundRate: 0,
    avgRating: null,
    firstSaleAt: null,
    lastSaleAt: null,
  }
}

/** Stable FNV-1a 32-bit hash for the partner_id (and product_id) in
 *  log payloads. FNV-1a 32-bit is fast, non-cryptographic, and
 *  sufficient for "is this the same partner across log lines"
 *  correlation. NOT a security boundary; just a redaction helper for
 *  the `check:pii` script. Duplicated from the P12.4 helpers — the
 *  alternative (a shared `lib/log-hash.ts`) is a bigger refactor than
 *  this slice wants. */
function hashNumericId(value: number): string {
  let hash = 0x811c9dc5
  for (const ch of String(value)) {
    hash ^= ch.charCodeAt(0)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
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

const SUMMARY_LOG = loggerFor({ component: 'partner.courseSalesSummary' })

/**
 * Read the lifetime sales summary for one of the partner's products.
 *
 * @param productId  The product id (products.id, bigint). Caller is
 *                   responsible for validating it's a positive
 *                   integer; the page already does this via
 *                   `getMyCourseDetail` which 404s on bad ids.
 *
 * Returns the `emptyPartnerCourseSalesSummary()` when:
 *   - the caller has no auth session
 *   - the caller is not a partner (no `partners` row)
 *   - the partner does not own this product
 *   - the RPC errors out (fail-soft + warn log)
 *
 * The RPC enforces authorization internally (STABLE SECURITY DEFINER
 * + `current_partner_id() = p_partner_id or is_admin()`); this wrapper
 * adds a defense-in-depth ownership check so a future RPC drift never
 * leaks another partner's aggregates.
 */
export async function getMyCourseSalesSummary(
  productId: number,
): Promise<PartnerCourseSalesSummary> {
  if (!Number.isInteger(productId) || productId <= 0) {
    return emptyPartnerCourseSalesSummary()
  }

  const supabase = await getServerSupabase()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return emptyPartnerCourseSalesSummary()

  // Resolve the partner row + verify product ownership in ONE
  // composite read: `partner_id` projected on the products row tells
  // us if the caller owns this product in a single RT, no separate
  // partners SELECT required.
  const { data: ownership, error: ownErr } = await supabase
    .from('products')
    .select(
      'id, partner_id!inner(user_id)',
    )
    .eq('id', productId)
    .maybeSingle()

  if (ownErr || !ownership) return emptyPartnerCourseSalesSummary()

  // PostgREST returns the joined partner as a single object (or array
  // when the join is multi-row). With `!inner` it's always a single
  // object. Narrow defensively.
  const productPartnerId = readInnerPartnerId(ownership.partner_id)
  if (productPartnerId == null) return emptyPartnerCourseSalesSummary()

  // Now look up the partner row to get its canonical id (the RPC
  // signature is `(p_partner_id, p_product_id)` and the partner_id
  // used in payouts / RPCs is `partners.id`, not `auth.uid()`).
  const { data: partner } = await supabase
    .from('partners')
    .select('id, user_id')
    .eq('user_id', user.id)
    .maybeSingle()
  if (!partner) return emptyPartnerCourseSalesSummary()

  // Belt-and-suspenders ownership: even if the join drifted and the
  // product's partner_id doesn't match the caller's partner row, we
  // refuse to call the RPC with mismatched ids.
  const callerPartnerId = (partner as { id: unknown }).id as number
  if (callerPartnerId !== productPartnerId) {
    SUMMARY_LOG.warn(
      {
        partner_id_hash: hashNumericId(callerPartnerId),
        product_id_hash: hashNumericId(productId),
        code: 'partner_course_sales_summary_ownership_mismatch',
      },
      'partner requested a sales summary for a product they do not own (RLS should have hidden this)',
    )
    return emptyPartnerCourseSalesSummary()
  }

  const { data, error } = await supabase.rpc('get_partner_course_sales_summary', {
    p_partner_id: callerPartnerId,
    p_product_id: productId,
  })

  if (error) {
    SUMMARY_LOG.warn(
      {
        partner_id_hash: hashNumericId(callerPartnerId),
        product_id_hash: hashNumericId(productId),
        code: error.code ?? null,
      },
      'course sales summary RPC failed',
    )
    return emptyPartnerCourseSalesSummary()
  }
  if (!Array.isArray(data) || data.length === 0) {
    // The RPC always returns exactly one row when authorized; in
    // practice when unauthorized the auth-bypass returns 0/null
    // defaults. Defensive parse in case the SQL ever changes.
    return emptyPartnerCourseSalesSummary()
  }

  const row = data[0] as Record<string, unknown>
  const orderCount = coerceBigint(row.order_count)
  const refundCount = coerceBigint(row.refund_count)
  // Refund rate: ratio of refunds to orders. Floor at 0 when the
  // partner has zero orders (no NaN, no Infinity). The page renders
  // this as `refundRate * 100` with one decimal place.
  const refundRate =
    orderCount > 0 ? Math.min(1, Math.max(0, refundCount / orderCount)) : 0

  // avg_rating from the RPC is a `numeric(4,2)` returned as a JSON
  // string ('4.50') OR a number on older PostgREST versions. Parse
  // both shapes; null means "no published reviews yet".
  const avgRaw = row.avg_rating
  let avgRating: number | null = null
  if (typeof avgRaw === 'number') {
    avgRating = Number.isFinite(avgRaw) ? avgRaw : null
  } else if (typeof avgRaw === 'string' && avgRaw.length > 0) {
    const n = Number.parseFloat(avgRaw)
    avgRating = Number.isFinite(n) ? n : null
  }

  return {
    revenueCents: coerceBigint(row.revenue_cents),
    unitsSold: coerceBigint(row.units_sold),
    orderCount,
    refundCount,
    refundRate,
    avgRating,
    firstSaleAt: coerceIsoTimestamp(row.first_sale_at),
    lastSaleAt: coerceIsoTimestamp(row.last_sale_at),
  }
}

/** Read the `partners.id` out of the PostgREST `partner_id!inner`
 *  join result. The join can be returned as either a single object
 *  or a single-item array depending on PostgREST version + Supabase
 *  client. Defensive coercion. */
function readInnerPartnerId(v: unknown): number | null {
  if (v == null) return null
  if (typeof v === 'object') {
    const obj = v as Record<string, unknown>
    const candidate = obj.id
    if (typeof candidate === 'number') return Number.isFinite(candidate) ? candidate : null
    if (typeof candidate === 'string') {
      const n = Number.parseInt(candidate, 10)
      return Number.isFinite(n) ? n : null
    }
  }
  if (Array.isArray(v) && v.length > 0) return readInnerPartnerId(v[0])
  return null
}
