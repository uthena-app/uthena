// Types for the admin customers list page (P14.1).
//
// These shapes mirror the SECURITY DEFINER RPCs in
// `04-platform/migrations/0052_admin_customers_query.sql`. The PostgREST
// driver coerces bigint to string (defense-in-depth per P2.3 +
// `coerceBigint` pattern); the risk score is int.

import { z } from 'zod'

/** Valid `status` filter values for the customers list. */
export const CUSTOMER_STATUS_FILTERS = [
  'active',
  'suspended',
  'banned',
] as const

export type CustomerStatusFilter = (typeof CUSTOMER_STATUS_FILTERS)[number]

/** Roles that show up in the customer list (everything except admin). */
export const CUSTOMER_ROLE_FILTERS = [
  'customer',
  'partner',
  'affiliate',
] as const

export type CustomerRoleFilter = (typeof CUSTOMER_ROLE_FILTERS)[number]

/** Sort keys accepted by the page URL. Default: `spend_desc`. */
export const CUSTOMER_SORT_KEYS = [
  'name_asc',
  'name_desc',
  'email_asc',
  'email_desc',
  'signup_asc',
  'signup_desc',
  'spend_asc',
  'spend_desc',
  'orders_asc',
  'orders_desc',
  'library_asc',
  'library_desc',
  'last_active_asc',
  'last_active_desc',
  'risk_asc',
  'risk_desc',
] as const

export type CustomerSortKey = (typeof CUSTOMER_SORT_KEYS)[number]

export const DEFAULT_CUSTOMER_SORT: CustomerSortKey = 'spend_desc'

/** Default page size (spec line 22: 50 per page default). */
export const DEFAULT_CUSTOMER_PAGE_SIZE = 50

/** Hard cap per the migration's `least(200, …)` ceiling. */
export const MAX_CUSTOMER_PAGE_SIZE = 200

/** Stats row shape (5 cards, line 15 of admin-customers.md). */
export type CustomerStats = {
  total: number
  active: number
  suspended: number
  banned: number
  newThisMonth: number
}

export const EMPTY_CUSTOMER_STATS: CustomerStats = {
  total: 0,
  active: 0,
  suspended: 0,
  banned: 0,
  newThisMonth: 0,
}

/** One customer row as returned by `get_admin_customers_list`. */
export type CustomerRow = {
  user_id: string
  display_name: string
  email: string
  role: CustomerRoleFilter
  status: CustomerStatusFilter
  signup_date: string
  lifetime_spend_cents: number
  order_count: number
  library_size: number
  last_active_at: string
  risk_score: number
  risk_refund_count: number
  risk_dispute_count: number
  risk_signal_severity_sum: number
  total_count: number
}

/**
 * Zod schema for the page-level URL filter bag. All fields optional;
 * unknown values fall back to "no filter" (graceful degradation).
 */
export const CustomerFiltersSchema = z.object({
  role: z.enum(CUSTOMER_ROLE_FILTERS).optional(),
  status: z.enum(CUSTOMER_STATUS_FILTERS).optional(),
  /** ISO date string YYYY-MM-DD. */
  signupFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  signupTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  /** Whole USD cents (bigint-safe). */
  spendMinCents: z.coerce.number().int().min(0).optional(),
  spendMaxCents: z.coerce.number().int().min(0).optional(),
  /** 0-100 risk score range. */
  riskMin: z.coerce.number().int().min(0).max(100).optional(),
  riskMax: z.coerce.number().int().min(0).max(100).optional(),
  /** Free-text search matches display_name OR email ILIKE. */
  q: z.string().min(1).max(100).optional(),
})

export type CustomerFiltersInput = z.infer<typeof CustomerFiltersSchema>

/** Filter URL shape after parsing. */
export type ParsedCustomerFilters = {
  role: CustomerRoleFilter | null
  status: CustomerStatusFilter | null
  signupFrom: string | null
  signupTo: string | null
  spendMinCents: number | null
  spendMaxCents: number | null
  riskMin: number | null
  riskMax: number | null
  q: string | null
}

/**
 * Parses the URL search params into a typed filter bag. Each
 * field is independently validated; a malformed value drops that
 * single filter rather than rejecting the whole request.
 *
 * Pure function — no I/O, easy to test.
 */
export function parseCustomerFilters(
  sp: Record<string, string | string[] | undefined> | null | undefined,
): ParsedCustomerFilters {
  const out: ParsedCustomerFilters = {
    role: null,
    status: null,
    signupFrom: null,
    signupTo: null,
    spendMinCents: null,
    spendMaxCents: null,
    riskMin: null,
    riskMax: null,
    q: null,
  }
  if (!sp) return out

  const first = (v: string | string[] | undefined): string | null => {
    if (Array.isArray(v)) return v[0] ?? null
    return v ?? null
  }

  const role = first(sp.role)
  if (role && (CUSTOMER_ROLE_FILTERS as readonly string[]).includes(role)) {
    out.role = role as CustomerRoleFilter
  }

  const status = first(sp.status)
  if (status && (CUSTOMER_STATUS_FILTERS as readonly string[]).includes(status)) {
    out.status = status as CustomerStatusFilter
  }

  const from = first(sp.signupFrom)
  if (from && isValidIsoDate(from)) out.signupFrom = from

  const to = first(sp.signupTo)
  if (to && isValidIsoDate(to)) out.signupTo = to

  const spendMin = first(sp.spendMinCents)
  if (spendMin && /^\d+$/.test(spendMin)) {
    const n = Number(spendMin)
    if (Number.isFinite(n) && n >= 0) out.spendMinCents = Math.floor(n)
  }

  const spendMax = first(sp.spendMaxCents)
  if (spendMax && /^\d+$/.test(spendMax)) {
    const n = Number(spendMax)
    if (Number.isFinite(n) && n >= 0) out.spendMaxCents = Math.floor(n)
  }

  const riskMin = first(sp.riskMin)
  if (riskMin && /^\d+$/.test(riskMin)) {
    const n = Number(riskMin)
    if (Number.isFinite(n) && n >= 0 && n <= 100) out.riskMin = Math.floor(n)
  }

  const riskMax = first(sp.riskMax)
  if (riskMax && /^\d+$/.test(riskMax)) {
    const n = Number(riskMax)
    if (Number.isFinite(n) && n >= 0 && n <= 100) out.riskMax = Math.floor(n)
  }

  const q = first(sp.q)
  if (q) {
    const trimmed = q.trim().slice(0, 100)
    if (trimmed.length > 0) out.q = trimmed
  }

  return out
}

/** Builds the JSONB shape expected by the RPC. */
export function filtersToRpcPayload(p: ParsedCustomerFilters): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (p.role) out.role = p.role
  if (p.status) out.status = p.status
  if (p.signupFrom) out.signupFrom = p.signupFrom
  if (p.signupTo) out.signupTo = p.signupTo
  if (p.spendMinCents !== null) out.spendMinCents = p.spendMinCents
  if (p.spendMaxCents !== null) out.spendMaxCents = p.spendMaxCents
  if (p.riskMin !== null) out.riskMin = p.riskMin
  if (p.riskMax !== null) out.riskMax = p.riskMax
  if (p.q) out.q = p.q
  return out
}

/** Risk-score band → CSS accent name. Spec line 20. */
export type RiskScoreBand = 'normal' | 'watch' | 'high' | 'severe'

export function riskScoreBand(score: number): RiskScoreBand {
  // Defensive coercion: NaN → normal (conservative default — we
  // don't know the score so we don't flag it), -Infinity → normal,
  // +Infinity → severe. The boundary checks rely on < / <= returning
  // false for NaN so without the early-out the function would
  // always return 'severe' for NaN — not what we want.
  if (Number.isNaN(score)) return 'normal'
  if (!Number.isFinite(score)) {
    return score > 0 ? 'severe' : 'normal'
  }
  if (score <= 30) return 'normal'
  if (score <= 60) return 'watch'
  if (score <= 80) return 'high'
  return 'severe'
}

/** YYYY-MM-DD regex (catches malformed strings like '2026-13-01'). */
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function isValidIsoDate(s: string): boolean {
  if (!ISO_DATE_RE.test(s)) return false
  const [y, m, d] = s.split('-').map((n) => Number.parseInt(n, 10))
  if (!y || !m || !d) return false
  if (m < 1 || m > 12) return false
  if (d < 1 || d > 31) return false
  const dt = new Date(Date.UTC(y, m - 1, d))
  // Round-trip check: catches things like 2026-02-30 (Feb has 28/29 days).
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
}

export const RISK_BAND_LABEL: Record<RiskScoreBand, string> = {
  normal: 'Normal',
  watch: 'Watch',
  high: 'High',
  severe: 'Severe',
}