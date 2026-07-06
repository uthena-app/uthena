// Search feature — instant-search surface for the global ⌘K overlay
// (P0.4) and the future /search?q= results page (P0.19).
//
// Exports:
//   - SearchOverlay: the global modal. Mount once from the root
//     layout. Owns its own open state + global ⌘K listener + the
//     debounced /api/search fetch loop.
//   - SearchTrigger: tiny client island that turns any element with
//     `data-search-trigger` into an "open the overlay" button.
//     Mount once from the root layout alongside SearchOverlay.
//   - SEARCH_TRIGGER_OPEN_EVENT: the window-event name used to
//     open the overlay from anywhere (e.g. the mobile-nav drawer's
//     search shortcut). Re-exported so callers don't have to
//     reach into the module internals.
//   - searchPublishedProducts: server-side RLS-aware catalog query
//     used by /api/search/route.ts (overlay) and, eventually, the
//     /search?q= server component (results page).

export { SearchOverlay } from './SearchOverlay'
export { SearchTrigger } from './SearchTrigger'
export { SEARCH_TRIGGER_OPEN_EVENT } from './searchEvents'
export { searchPublishedProducts } from './queries'