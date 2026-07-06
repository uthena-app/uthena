// Types for the admin partners list page (P14.3).
//
// These shapes mirror the SECURITY DEFINER RPCs in
// `04-platform/migrations/0054_admin_partners_query.sql`. The PostgREST
// driver coerces bigint to string (defense-in-depth per P2.3 +
// `coerceBigint` pattern).

import { z } from 'zod'

/** Valid `status` filter values for the partners list. Mirrors the
 *  `partner_status` enum + the Postgres CHECK on the text columns. */
export const PARTNER_STATUS_FILTERS = ['pending', 'approved', 'suspended'] as const

export type PartnerStatus = (typeof PARTNER_STATUS_FILTERS)[number]

/** Valid `kyc_status` filter values. */
export const PARTNER_KYC_FILTERS = ['none', 'pending', 'approved', 'rejected'] as const

export type PartnerKycStatus = (typeof PARTNER_KYC_FILTERS)[number]

/** Valid `tax_form_status` filter values. */
export const PARTNER_TAX_FORM_FILTERS = [
  'none',
  'pending',
  'submitted',
  'approved',
] as const

export type PartnerTaxFormStatus = (typeof PARTNER_TAX_FORM_FILTERS)[number]

/**
 * Sort keys accepted by the page URL. Default: `revenue_desc`
 * (spec line 55).
 */
export const PARTNER_SORT_KEYS = [
  'name_asc',
  'name_desc',
  'applied_asc',
  'applied_desc',
  'revenue_asc',
  'revenue_desc',
  'paid_asc',
  'paid_desc',
  'courses_asc',
  'courses_desc',
  'activity_asc',
  'activity_desc',
] as const

export type PartnerSortKey = (typeof PARTNER_SORT_KEYS)[number]

export const DEFAULT_PARTNER_SORT: PartnerSortKey = 'revenue_desc'

/** Default page size (spec line 22: 50 per page default). */
export const DEFAULT_PARTNER_PAGE_SIZE = 50

/** Hard cap per the migration's `least(200, …)` ceiling. */
export const MAX_PARTNER_PAGE_SIZE = 200

/** Stats row shape (5 cards, line 15 of admin-partners.md). */
export type PartnerStats = {
  total: number
  pending: number
  suspended: number
  approvedThisMonth: number
  lifetimeRevenueCents: number
}

export const EMPTY_PARTNER_STATS: PartnerStats = {
  total: 0,
  pending: 0,
  suspended: 0,
  approvedThisMonth: 0,
  lifetimeRevenueCents: 0,
}

/** One partner row as returned by `get_admin_partners_list`. */
export type PartnerRow = {
  partner_id: number
  user_id: string
  display_name: string
  email: string
  status: PartnerStatus
  kyc_status: PartnerKycStatus
  tax_form_status: PartnerTaxFormStatus
  courses_count: number
  lifetime_revenue_cents: number
  lifetime_paid_out_cents: number
  applied_at: string
  approved_at: string | null
  last_active_at: string
  total_count: number
}

/**
 * Zod schema for the page-level URL filter bag. All fields optional;
 * unknown values fall back to "no filter" (graceful degradation).
 */
export const PartnerFiltersSchema = z.object({
  status: z.enum(PARTNER_STATUS_FILTERS).optional(),
  kycStatus: z.enum(PARTNER_KYC_FILTERS).optional(),
  taxFormStatus: z.enum(PARTNER_TAX_FORM_FILTERS).optional(),
  /** ISO date string YYYY-MM-DD — `partners.created_at >= appliedFrom`. */
  appliedFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  /** ISO date string YYYY-MM-DD — `partners.created_at <= appliedTo`. */
  appliedTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  /** Free-text search matches display_name OR email ILIKE. */
  q: z.string().min(1).max(100).optional(),
})

export type PartnerFiltersInput = z.infer<typeof PartnerFiltersSchema>

/** Filter URL shape after parsing. */
export type ParsedPartnerFilters = {
  status: PartnerStatus | null
  kycStatus: PartnerKycStatus | null
  taxFormStatus: PartnerTaxFormStatus | null
  appliedFrom: string | null
  appliedTo: string | null
  q: string | null
}

/**
 * Parses the URL search params into a typed filter bag. Each
 * field is independently validated; a malformed value drops that
 * single filter rather than rejecting the whole request.
 *
 * Pure function — no I/O, easy to test.
 */
export function parsePartnerFilters(
  sp: Record<string, string | string[] | undefined> | null | undefined,
): ParsedPartnerFilters {
  const out: ParsedPartnerFilters = {
    status: null,
    kycStatus: null,
    taxFormStatus: null,
    appliedFrom: null,
    appliedTo: null,
    q: null,
  }
  if (!sp) return out

  const first = (v: string | string[] | undefined): string | null => {
    if (Array.isArray(v)) return v[0] ?? null
    return v ?? null
  }

  const status = first(sp.status)
  if (status && (PARTNER_STATUS_FILTERS as readonly string[]).includes(status)) {
    out.status = status as PartnerStatus
  }

  const kyc = first(sp.kycStatus)
  if (kyc && (PARTNER_KYC_FILTERS as readonly string[]).includes(kyc)) {
    out.kycStatus = kyc as PartnerKycStatus
  }

  const tax = first(sp.taxFormStatus)
  if (tax && (PARTNER_TAX_FORM_FILTERS as readonly string[]).includes(tax)) {
    out.taxFormStatus = tax as PartnerTaxFormStatus
  }

  const from = first(sp.appliedFrom)
  if (from && isValidIsoDate(from)) out.appliedFrom = from

  const to = first(sp.appliedTo)
  if (to && isValidIsoDate(to)) out.appliedTo = to

  const q = first(sp.q)
  if (q) {
    const trimmed = q.trim().slice(0, 100)
    if (trimmed.length > 0) out.q = trimmed
  }

  return out
}

/** Builds the JSONB shape expected by the RPC. */
export function partnerFiltersToRpcPayload(p: ParsedPartnerFilters): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (p.status) out.status = p.status
  if (p.kycStatus) out.kycStatus = p.kycStatus
  if (p.taxFormStatus) out.taxFormStatus = p.taxFormStatus
  if (p.appliedFrom) out.appliedFrom = p.appliedFrom
  if (p.appliedTo) out.appliedTo = p.appliedTo
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
export const PARTNER_SORT_LABEL: Record<PartnerSortKey, string> = {
  name_asc: 'Name (A–Z)',
  name_desc: 'Name (Z–A)',
  applied_asc: 'Applied (oldest first)',
  applied_desc: 'Applied (newest first)',
  revenue_asc: 'Lifetime revenue (low → high)',
  revenue_desc: 'Lifetime revenue (high → low)',
  paid_asc: 'Lifetime paid out (low → high)',
  paid_desc: 'Lifetime paid out (high → low)',
  courses_asc: 'Courses (fewest first)',
  courses_desc: 'Courses (most first)',
  activity_asc: 'Last active (oldest first)',
  activity_desc: 'Last active (newest first)',
}

/** Human-readable label for a partner status. */
export const PARTNER_STATUS_LABEL: Record<PartnerStatus, string> = {
  pending: 'Pending',
  approved: 'Approved',
  suspended: 'Suspended',
}

/** Human-readable label for a KYC status. */
export const PARTNER_KYC_LABEL: Record<PartnerKycStatus, string> = {
  none: 'Not submitted',
  pending: 'Pending review',
  approved: 'Approved',
  rejected: 'Rejected',
}

/** Human-readable label for a tax form status. */
export const PARTNER_TAX_FORM_LABEL: Record<PartnerTaxFormStatus, string> = {
  none: 'Not submitted',
  pending: 'Pending',
  submitted: 'Submitted',
  approved: 'Approved',
}