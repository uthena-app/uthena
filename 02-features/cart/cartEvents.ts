// cartEvents.ts — module-scoped constants for the cart drawer's
// window-event bridge.
//
// Why window events (instead of refs / context):
// - The cart drawer is mounted at the root layout so it persists
//   across page navigations. The header cart button is in a
//   sibling RSC tree. Passing a ref down would either require
//   lifting the drawer into a wrapper client component (more
//   JS shipped) or duplicating open-state across both layers
//   (race conditions).
// - A named CustomEvent lets the header stay RSC and the drawer
//   own all of its own state. Same convention as SearchOverlay
//   (SEARCH_TRIGGER_OPEN_EVENT) and MobileNav (MOBILE_NAV_OPEN_EVENT).
//
// Two events for two semantics:
// - `uthena:cart:open` — explicit open trigger (header button click
//   OR add-to-cart success). The drawer opens and refreshes data.
// - `uthena:cart:changed` — fired after any cart mutation (add,
//   remove, qty change, license change, clear). If the drawer is
//   open, it re-fetches. The header cart count badge updates via
//   the same RSC revalidation the action already triggers, so this
//   event is only for the drawer's client-side data refresh.

export const CART_OPEN_EVENT = 'uthena:cart:open'
export const CART_CHANGED_EVENT = 'uthena:cart:changed'

/**
 * Detail payload for `CART_CHANGED_EVENT`. The drawer reads the
 * `count` to update its header label without waiting for the
 * /api/cart round-trip; it still re-fetches to get full line
 * data.
 */
export type CartChangedDetail = {
  /** New total item count (sum of quantities across active lines). */
  count: number
}
