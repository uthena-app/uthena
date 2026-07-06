// Types for the admin affiliates list page (P14.6).
//
// These shapes mirror the SECURITY DEFINER RPCs in
// `04-platform/migrations/0056_admin_affiliates_query.sql`. The PostgREST
// driver coerces bigint to string (defense-in-depth per P2.3 +
// `coerceBigint` pattern).

import { z } from 'zod'

/** Valid `status` filter values for the affiliates list. Mirrors the
 *  CHECK constraint on the `affiliates.status` text column. */
export const AFFILIATE_STATUS_FILTERS = ['pending', 'approved', 'suspended'] as const

export type AffiliateStatus = (typeof AFFILIATE_STATUS_FILTERS)[number]

/**
 * Sort keys accepted by the page URL. Default: `earned_desc`
 * (spec line 56: default sort is lifetime_earned desc).
 */
export const AFFILIATE_SORT_KEYS = [
  'name_asc',
  'name_desc',
  'earned_asc',
  'earned_desc',
  'conversions_asc',
  'conversions_desc',
  'clicks_asc',
  'clicks_desc',
  'activity_asc',
  'activity_desc',
] as const

export type AffiliateSortKey = (typeof AFFILIATE_SORT_KEYS)[number]

export const DEFAULT_AFFILIATE_SORT: AffiliateSortKey = 'earned_desc'

/** Default page size (spec line 21: 50 per page default). */
export const DEFAULT_AFFILIATE_PAGE_SIZE = 50

/** Hard cap per the migration's `least(200, …)` ceiling. */
export const MAX_AFFILIATE_PAGE_SIZE = 200

/** Stats row shape (5 cards, line 15 of admin-affiliates.md). */
export type AffiliateStats = {
  total: number
  pending: number
  suspended: number
  approvedThisMonth: number
  thisMonthCommissionPaidCents: number
}

export const EMPTY_AFFILIATE_STATS: AffiliateStats = {
  total: 0,
  pending: 0,
  suspended: 0,
  approvedThisMonth: 0,
  thisMonthCommissionPaidCents: 0,
}

/** One affiliate row as returned by `get_admin_affiliates_list`. */
export type AffiliateRow = {
  affiliate_id: number
  user_id: string
  handle: string
  display_name: string
  email: string
  status: AffiliateStatus
  lifetime_earned_cents: number
  pending_balance_cents: number
  available_balance_cents: number
  clicks_30d: number
  conversions_30d: number
  joined_at: string
  approved_at: string | null
  last_activity_at: string
  total_count: number
}

/**
 * Zod schema for the page-level URL filter bag. All fields optional;
 * unknown values fall back to "no filter" (graceful degradation).
 */
export const AffiliateFiltersSchema = z.object({
  status: z.enum(AFFILIATE_STATUS_FILTERS).optional(),
  /** ISO date string YYYY-MM-DD — `affiliates.created_at >= joinedFrom`. */
  joinedFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  /** ISO date string YYYY-MM-DD — `affiliates.created_at <= joinedTo`. */
  joinedTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  /** Free-text search matches handle (exact), display_name (ILIKE), or email (ILIKE). */
  q: z.string().min(1).max(100).optional(),
})

export type AffiliateFiltersInput = z.infer<typeof AffiliateFiltersSchema>

/** Filter URL shape after parsing. */
export type ParsedAffiliateFilters = {
  status: AffiliateStatus | null
  joinedFrom: string | null
  joinedTo: string | null
  q: string | null
}

/**
 * Parses the URL search params into a typed filter bag. Each
 * field is independently validated; a malformed value drops that
 * single filter rather than rejecting the whole request.
 *
 * Pure function — no I/O, easy to test.
 */
export function parseAffiliateFilters(
  sp: Record<string, string | string[] | undefined> | null | undefined,
): ParsedAffiliateFilters {
  const out: ParsedAffiliateFilters = {
    status: null,
    joinedFrom: null,
    joinedTo: null,
    q: null,
  }
  if (!sp) return out

  const first = (v: string | string[] | undefined): string | null => {
    if (Array.isArray(v)) return v[0] ?? null
    return v ?? null
  }

  const status = first(sp.status)
  if (status && (AFFILIATE_STATUS_FILTERS as readonly string[]).includes(status)) {
    out.status = status as AffiliateStatus
  }

  const from = first(sp.joinedFrom)
  if (from && isValidIsoDate(from)) out.joinedFrom = from

  const to = first(sp.joinedTo)
  if (to && isValidIsoDate(to)) out.joinedTo = to

  const q = first(sp.q)
  if (q) {
    const trimmed = q.trim().slice(0, 100)
    if (trimmed.length > 0) out.q = trimmed
  }

  return out
}

/** Builds the JSONB shape expected by the RPC. */
export function affiliateFiltersToRpcPayload(p: ParsedAffiliateFilters): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (p.status) out.status = p.status
  if (p.joinedFrom) out.joinedFrom = p.joinedFrom
  if (p.joinedTo) out.joinedTo = p.joinedTo
  if (p.q) out.q = p.q
  return out
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

/** Human-readable label for a sort key. */
export const AFFILIATE_SORT_LABEL: Record<AffiliateSortKey, string> = {
  name_asc: 'Name (A–Z)',
  name_desc: 'Name (Z–A)',
  earned_asc: 'Lifetime earned (low → high)',
  earned_desc: 'Lifetime earned (high → low)',
  conversions_asc: '30-day conversions (fewest first)',
  conversions_desc: '30-day conversions (most first)',
  clicks_asc: '30-day clicks (fewest first)',
  clicks_desc: '30-day clicks (most first)',
  activity_asc: 'Last activity (oldest first)',
  activity_desc: 'Last activity (newest first)',
}

/** Human-readable label for an affiliate status. */
export const AFFILIATE_STATUS_LABEL: Record<AffiliateStatus, string> = {
  pending: 'Pending',
  approved: 'Approved',
  suspended: 'Suspended',
}

/** Format a conversion rate (conversions_30d / clicks_30d) as a 1-decimal
 *  percent string. Sub-1% rates render as `0.X%`. When clicks=0, returns
 *  `'—'` (the affiliate has nothing to convert yet — showing `0%` would
 *  be misleading). */
export function formatConversionRate(conversions: number, clicks: number): string {
  if (!Number.isFinite(conversions) || !Number.isFinite(clicks)) return '—'
  if (clicks <= 0) return '—'
  const ratio = Math.max(0, conversions) / Math.max(1, clicks)
  return `${(ratio * 100).toFixed(1)}%`
}