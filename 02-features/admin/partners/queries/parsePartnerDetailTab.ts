// parsePartnerDetailTab.ts — pure helper for validating the `?tab=`
// URL param on /admin/partners/[id].
//
// The 10 tabs are URL-driven; the page reads `?tab=<value>` and renders
// the matching content. Invalid values fall back to 'overview'
// (graceful degradation — same pattern as the customer detail).
//
// Pure function. No I/O.

export const PARTNER_DETAIL_TABS = [
  'overview',
  'profile',
  'kyc',
  'tax',
  'courses',
  'sales',
  'payouts',
  'refunds',
  'notes',
  'activity',
] as const

export type PartnerDetailTab = (typeof PARTNER_DETAIL_TABS)[number]

export const DEFAULT_PARTNER_DETAIL_TAB: PartnerDetailTab = 'overview'

/** Tab → human label, used in the tab nav and the breadcrumb. */
export const PARTNER_DETAIL_TAB_LABEL: Record<PartnerDetailTab, string> = {
  overview: 'Overview',
  profile: 'Profile',
  kyc: 'KYC',
  tax: 'Tax',
  courses: 'Courses',
  sales: 'Sales',
  payouts: 'Payouts',
  refunds: 'Refunds',
  notes: 'Notes',
  activity: 'Activity',
}

/**
 * Parses the `?tab=` URL param. Returns the canonical tab value on
 * success, or the default 'overview' on any failure (empty / unknown /
 * SQL-injection-shaped / CRLF / oversized / non-string).
 *
 * The 10-tab allowlist is enforced here — anything else returns the
 * default so a typo in the URL doesn't render an empty tab body.
 */
export function parsePartnerDetailTab(
  raw: string | string[] | undefined | null,
): PartnerDetailTab {
  const value = first(raw)
  if (!value) return DEFAULT_PARTNER_DETAIL_TAB
  const trimmed = value.trim()
  if (trimmed.length === 0) return DEFAULT_PARTNER_DETAIL_TAB
  if (trimmed.length > 32) return DEFAULT_PARTNER_DETAIL_TAB
  if ((PARTNER_DETAIL_TABS as readonly string[]).includes(trimmed)) {
    return trimmed as PartnerDetailTab
  }
  return DEFAULT_PARTNER_DETAIL_TAB
}

function first(raw: string | string[] | undefined | null): string | null {
  if (raw === null || raw === undefined) return null
  if (Array.isArray(raw)) return raw[0] ?? null
  return raw
}