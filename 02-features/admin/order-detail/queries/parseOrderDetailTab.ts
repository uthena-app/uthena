// parseOrderDetailTab.ts — pure helper for validating the `?tab=` URL
// param on `/admin/orders/[id]`.
//
// Slice 1 ships the single 'overview' tab (with all panels visible).
// Slices 2+ will add 'actions' / 'notes' / 'activity' when the
// destructive-action panel + customer-view embed + admin notes land.
//
// Pure function. No I/O.

export const ORDER_DETAIL_TABS = [
  'overview',
] as const

export type OrderDetailTab = (typeof ORDER_DETAIL_TABS)[number]

export const DEFAULT_ORDER_DETAIL_TAB: OrderDetailTab = 'overview'

/** Tab → human label. Single entry for Slice 1. */
export const ORDER_DETAIL_TAB_LABEL: Record<OrderDetailTab, string> = {
  overview: 'Overview',
}

/**
 * Parses the `?tab=` URL param. Returns the canonical tab value on
 * success, or the default 'overview' on any failure (empty / unknown /
 * SQL-injection-shaped / CRLF / oversized / non-string).
 *
 * The 1-tab allowlist is enforced here — anything else returns the
 * default so a typo in the URL doesn't render an empty tab body.
 * Forward-compatible: when Slice 2 introduces 'actions' / 'notes',
 * the parser will accept them automatically (the URL contract is the
 * allowlist in `ORDER_DETAIL_TABS`).
 */
export function parseOrderDetailTab(
  raw: string | string[] | undefined | null,
): OrderDetailTab {
  const value = first(raw)
  if (!value) return DEFAULT_ORDER_DETAIL_TAB
  const trimmed = value.trim()
  if (trimmed.length === 0) return DEFAULT_ORDER_DETAIL_TAB
  if (trimmed.length > 32) return DEFAULT_ORDER_DETAIL_TAB
  if ((ORDER_DETAIL_TABS as readonly string[]).includes(trimmed)) {
    return trimmed as OrderDetailTab
  }
  return DEFAULT_ORDER_DETAIL_TAB
}

function first(raw: string | string[] | undefined | null): string | null {
  if (raw === null || raw === undefined) return null
  if (Array.isArray(raw)) return raw[0] ?? null
  return raw
}
