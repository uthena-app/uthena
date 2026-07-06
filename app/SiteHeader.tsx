// SiteHeader.tsx — global sticky header, present on every page.
//
// Structure (matches mockups/home.html lines 15–43):
//   1. <announcement bar> — promo copy, data-driven from `promo.ts`
//   2. <hdr-inner>        — brand · search · right-side actions
//                            (desktop) or brand · hamburger + actions
//                            + search (mobile, ≤ 640px)
//   3. <hdr-nav>          — primary nav links (Home / All Courses /
//                            Bundles / Earn with Uthena / FAQs /
//                            Course Portal). Active state is computed
//                            in the SiteHeaderNavActive client island.
//                            Hidden at ≤ 640px; the mobile-nav drawer
//                            (P0.5) replaces it.
//
// Server component. The only client JS is the active-state island.
// Cart count, session, and the published-product count for the
// "All Courses {N}" badge are read server-side via
// `getSiteHeaderData()` and deduped per request.
//
// The cart button is a real <button data-cart-trigger="true"> (not
// a <Link href="/cart">) so the P4.1 CartDrawer slides in instead
// of navigating. Authed users get the drawer; anon users get the
// same drawer, which routes them through /login?next=/checkout
// when they tap Checkout.

import Link from 'next/link'
import { getSiteHeaderData } from './lib/getSiteHeaderData'
import { ANNOUNCEMENT_BAR } from './lib/promo'
import { SiteHeaderNavActive, type NavLink } from './SiteHeaderActive'
import { MobileNav, type MobileNavLink } from '@features/mobile-nav'
import { CartDrawer } from '@features/cart'
import styles from './SiteHeader.module.css'

export async function SiteHeader() {
  const { user, cartCount, publishedProductCount } = await getSiteHeaderData()

  // Primary nav items. The badge on All Courses reads the live count
  // from `products where status='published'`. When the count is 0
  // (catalog still warming up), we suppress the badge rather than
  // render "All Courses 0" — visually noisy and misleading.
  const navItems: NavLink[] = [
    { href: '/', label: 'Home' },
    {
      href: '/browse',
      label: 'All Courses',
      ...(publishedProductCount > 0 ? { badge: publishedProductCount } : {}),
    },
    { href: '/bundles', label: 'Bundles' },
    { href: '/partner', label: 'Earn with Uthena' },
    { href: '/faq', label: 'FAQs', dim: true },
    { href: '/library', label: 'Course Portal ↗', dim: true },
  ]

  // Same shape, reused for the mobile drawer. Both the desktop
  // secondary nav and the mobile drawer share this data so they
  // never drift.
  const mobileNavItems: MobileNavLink[] = navItems

  // Right-side account action. Anon users see "Log in"; authed users
  // see their display name linking to /account.
  const accountHref = user ? '/account' : '/login'
  const accountLabel = user ? user.display_name : 'Log in'

  // The cart button is a real <button data-cart-trigger="true">
  // (P4.1). The CartTrigger client island listens for clicks on any
  // [data-cart-trigger] element and dispatches CART_OPEN_EVENT,
  // which the CartDrawer mounts at the root and listens for. The
  // drawer's checkout CTA still routes anon users through
  // /login?next=/checkout when they tap Checkout, so we don't lose
  // the bounce.
  //
  // The MobileNav drawer's bottom cart CTA still needs a real href
  // (it's a <Link>, not a button), so we keep the cartHref variant
  // for that one consumer. The desktop header button uses the data-
  // attr trigger instead.
  const cartHref = user ? '/cart' : `/login?next=${encodeURIComponent('/cart')}`

  return (
    <header className={styles.header}>
      {/* ----- 1. Announcement bar (data-driven) ----- */}
      <div className={styles.announcement} role="region" aria-label="Site announcement">
        <span className={styles.announcementInner}>
          <strong>{ANNOUNCEMENT_BAR.lead}</strong>
          <span aria-hidden> — earn </span>
          <span className={styles.annAccent}>{ANNOUNCEMENT_BAR.earn}</span>
          <span aria-hidden> on every sale </span>
          <span aria-hidden className={styles.annSep}>
            ·
          </span>
          <span className={styles.annDim}>{ANNOUNCEMENT_BAR.suffix}</span>
        </span>
      </div>

      {/* ----- 2. Header inner row: brand · search · actions ----- */}
      <div className={styles.container}>
        <div className={styles.hdrInner}>
          <Link href="/" className={styles.logo} aria-label="Uthena home">
            <span className={styles.logoWord}>Uthena</span>
            <span className={styles.logoDot} aria-hidden>
              .
            </span>
          </Link>

          <form
            action="/search"
            method="get"
            className={styles.search}
            role="search"
            data-search-trigger="true"
          >
            <span aria-hidden className={styles.searchIcon}>
              ⌕
            </span>
            <label htmlFor="site-search" className={styles.srOnly}>
              Search the catalog
            </label>
            <input
              id="site-search"
              name="q"
              type="search"
              placeholder="Find your favorite courses…"
              className={styles.searchInput}
              autoComplete="off"
            />
            <kbd className={styles.kbd} aria-hidden>
              ⌘K
            </kbd>
            <button type="submit" className={styles.srOnly}>
              Search
            </button>
          </form>

          <div className={styles.actions}>
            {/* Mobile-only hamburger trigger (P0.5). Hidden on desktop
                via CSS; the MobileNavTrigger island listens for clicks
                on this element and dispatches the open event. */}
            <button
              type="button"
              className={styles.hamburger}
              data-mobile-nav-trigger="true"
              aria-label="Open menu"
              aria-controls="mobile-nav"
            >
              <span aria-hidden className={styles.hamburgerBar} />
              <span aria-hidden className={styles.hamburgerBar} />
              <span aria-hidden className={styles.hamburgerBar} />
            </button>
            <Link href={accountHref} className={`${styles.btn} ${styles.btnGhost}`}>
              {accountLabel}
            </Link>
            <button
              type="button"
              data-cart-trigger="true"
              className={`${styles.btn} ${styles.btnPrimary}`}
              aria-label={`Open cart, ${cartCount} ${cartCount === 1 ? 'item' : 'items'}`}
            >
              <span>Cart</span>
              <span className={styles.cartCount}>{cartCount}</span>
            </button>
          </div>
        </div>

        {/* ----- 3. Secondary nav row (desktop only; hidden ≤ 640px) ----- */}
        <nav className={styles.nav} aria-label="Primary">
          <SiteHeaderNavActive items={navItems} />
        </nav>
      </div>

      {/* ----- 4. Mobile nav drawer (P0.5) -----
          Lives at the header's bottom so it sits between the
          secondary nav and the page content in the DOM (helps
          screen readers announce header → drawer → main). The
          drawer returns null when closed, so it adds zero markup
          to the steady-state DOM. */}
      <MobileNav
        navItems={mobileNavItems}
        cartCount={cartCount}
        userDisplayName={user?.display_name ?? null}
        accountHref={accountHref}
        cartHref={cartHref}
      />

      {/* ----- 5. Cart drawer (P4.1) -----
          Also mounted here so it sits next to the mobile-nav
          surface (sibling global modals). The drawer is fully
          self-contained: it owns its open state, listens for
          CART_OPEN_EVENT (fired by the CartTrigger island on any
          [data-cart-trigger] click OR by add-to-cart success), and
          fetches /api/cart when it opens. Returns null when
          closed, so the steady-state DOM is unchanged. */}
      <CartDrawer />
    </header>
  )
}
