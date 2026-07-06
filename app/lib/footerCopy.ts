// Footer copy — data-driven nav + brand line + pay chips for the global
// site footer. Mirrors `promo.ts` (used by the SiteHeader announcement
// bar) so the shell copy lives in one small file per element.
//
// Phase 17 wires the admin-editable versions of these strings; for now
// the source-of-truth is the mockup (`mockups/home.html` lines 257–300)
// and this file is the only place a human editor needs to touch to
// adjust the footer's text.
//
// Routing note: every link points to a Next.js route the global nav
// already advertises or to a phase that's planned. Links to routes that
// don't exist yet (`/affiliate` — Phase 13 P13.1, `/about` — Phase 19
// P19.8) currently render our not-found page; that's accepted per the
// per-phase shipping cadence and gets resolved as those phases land.

export type FooterLink = {
  /** Visible label. */
  label: string
  /** Target route. Relative — resolved against the app base path. */
  href: string
}

export type FooterColumn = {
  /** All-caps column heading, e.g. "Marketplace". */
  heading: string
  /** Links in display order (top → bottom). */
  links: readonly FooterLink[]
}

/** Three link columns: Marketplace / Earn / Company. */
export const FOOTER_COLUMNS: readonly FooterColumn[] = [
  {
    heading: 'Marketplace',
    links: [
      { label: 'All courses', href: '/browse' },
      { label: 'Bundles', href: '/bundles' },
      { label: 'Pricing', href: '/pricing' },
      { label: 'New releases', href: '/browse?sort=newest' },
      { label: 'Best sellers', href: '/browse?sort=popular' },
    ],
  },
  {
    heading: 'Earn',
    links: [
      { label: 'Affiliate program', href: '/affiliate' },
      { label: 'Sell your courses', href: '/partner' },
      { label: 'Become a reseller', href: '/partner' },
      { label: 'Instructor login', href: '/login?next=/library' },
    ],
  },
  {
    heading: 'Company',
    links: [
      { label: 'About', href: '/about' },
      { label: 'Newsletter', href: '/newsletter' },
      { label: 'Privacy policy', href: '/privacy' },
      { label: 'Terms', href: '/terms' },
      { label: 'Refunds', href: '/refund-policy' },
      { label: 'Cookie preferences', href: '/cookie-preferences' },
    ],
  },
] as const

/** Pay-method chips rendered under the brand line (monospace, bordered). */
export const PAYMENT_CHIPS: readonly string[] = [
  'VISA',
  'MASTERCARD',
  'AMEX',
  'PAYPAL',
  'APPLE PAY',
  'SHOP PAY',
  'USDC',
] as const

/** Single-line brand descriptor under the wordmark. Matches mockup line 262. */
export const FOOTER_BRAND_LINE =
  'Buy PLR licenses for video courses on Uthena. Pay once and sell the courses as part of your own offering — keep every dollar of revenue.'

/** Copyright line at the bottom-left of the bar. Year is intentional — update annually. */
export const FOOTER_COPYRIGHT = '© 2026 Uthena. All rights reserved.'

/** Trailing tagline on the bottom-right. Matches mockup line 297. */
export const FOOTER_TAGLINE = 'Built for course creators who resell.'