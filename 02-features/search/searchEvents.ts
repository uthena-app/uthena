// searchEvents — module-scoped constants for the cross-component
// trigger the SiteHeader uses to ask the SearchOverlay to open.
//
// Why a window event instead of an imperative ref:
// - The header (RSC) and the overlay (client) are siblings in the
//   layout. Passing a ref down would either require lifting the
//   overlay into a wrapper client component (more JS shipped) or
//   duplicating open-state across both layers (race conditions).
// - A named CustomEvent lets the header stay RSC and the overlay
//   own all of its own state. It also makes the trigger trivially
//   callable from anywhere (e.g. a future admin command palette).

export const SEARCH_TRIGGER_OPEN_EVENT = 'uthena:search:open'