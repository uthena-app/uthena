// mobileNavEvents — module-scoped constants for the cross-component
// trigger the SiteHeader uses to ask the MobileNav drawer to open.
//
// Why a window event instead of a ref:
// - The header (RSC) and the drawer (client) are siblings in the
//   layout. Passing a ref down would either require lifting the
//   drawer into a wrapper client component (more JS shipped) or
//   duplicating open-state across both layers (race conditions).
// - A named CustomEvent lets the header stay RSC and the drawer
//   own all of its own state. It also makes the trigger trivially
//   callable from anywhere (e.g. a future /admin command palette
//   or a "menu" key shortcut).

export const MOBILE_NAV_OPEN_EVENT = 'uthena:mobile-nav:open'
