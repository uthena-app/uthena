// parseCustomerDetailTab.ts — pure helper for validating the `?tab=`
// URL param on /admin/customers/[id].
//
// The 9 tabs are URL-driven; the page reads `?tab=<value>` and renders
// the matching content. Invalid values fall back to 'overview'
// (graceful degradation — same pattern as the catalog sort key).
//
// Pure function. No I/O.

export const CUSTOMER_DETAIL_TABS = [
  'overview',
  'profile',
  'orders',
  'library',
  'refunds',
  'reviews',
  'sessions',
  'notes',
  'activity',
] as const

export type CustomerDetailTab = (typeof CUSTOMER_DETAIL_TABS)[number]

export const DEFAULT_CUSTOMER_DETAIL_TAB: CustomerDetailTab = 'overview'

/** Tab → human label, used in the tab nav and the breadcrumb. */
export const CUSTOMER_DETAIL_TAB_LABEL: Record<CustomerDetailTab, string> = {
  overview: 'Overview',
  profile: 'Profile',
  orders: 'Orders',
  library: 'Library',
  refunds: 'Refunds',
  reviews: 'Reviews',
  sessions: 'Sessions',
  notes: 'Notes',
  activity: 'Activity',
}

/**
 * Parses the `?tab=` URL param. Returns the canonical tab value on
 * success, or the default 'overview' on any failure (empty / unknown /
 * SQL-injection-shaped / CRLF / oversized / non-string).
 *
 * The 9-tab allowlist is enforced here — anything else returns the
 * default so a typo in the URL doesn't render an empty tab body.
 */
export function parseCustomerDetailTab(
  raw: string | string[] | undefined | null,
): CustomerDetailTab {
  const value = first(raw)
  if (!value) return DEFAULT_CUSTOMER_DETAIL_TAB
  const trimmed = value.trim()
  if (trimmed.length === 0) return DEFAULT_CUSTOMER_DETAIL_TAB
  if (trimmed.length > 32) return DEFAULT_CUSTOMER_DETAIL_TAB
  if ((CUSTOMER_DETAIL_TABS as readonly string[]).includes(trimmed)) {
    return trimmed as CustomerDetailTab
  }
  return DEFAULT_CUSTOMER_DETAIL_TAB
}

function first(raw: string | string[] | undefined | null): string | null {
  if (raw === null || raw === undefined) return null
  if (Array.isArray(raw)) return raw[0] ?? null
  return raw
}