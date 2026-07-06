// MobileNav feature — global mobile nav drawer for the SiteHeader.
// P0.5.
//
// Exports:
//   - MobileNav: the drawer itself. Renders nothing when closed.
//     Mount once from the root layout.
//   - MobileNavTrigger: tiny client island that turns any element
//     with `data-mobile-nav-trigger` into an "open the drawer"
//     button. Mount once from the root layout alongside MobileNav.
//
// Why a separate trigger island (mirrors SearchTrigger):
// - The SiteHeader is RSC. The trigger must run JS to dispatch the
//   window event, so we mount a tiny island (returns null) and
//   delegate via data-* attribute on the hamburger button.

export { MobileNav, type MobileNavLink, type MobileNavProps } from './MobileNav'
export { MobileNavTrigger } from './MobileNavTrigger'
