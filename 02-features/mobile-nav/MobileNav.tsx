// MobileNav — global mobile-nav drawer (P0.5).
//
// Why a single client component (not a portal + remote trigger):
// - The drawer owns one DOM tree: nav links + search shortcut +
//   account + cart. Splitting it across files would mean
//   prop-drilling the open state across the boundary anyway.
// - The trigger (hamburger) and the listener live on the same
//   window; the data-attr bridge (MobileNavTrigger) is the only
//   piece outside.
//
// Behavior contract:
//   • Opens when the user clicks the hamburger in the SiteHeader
//     (the header is RSC; MobileNavTrigger island bridges the
//     click to MOBILE_NAV_OPEN_EVENT, which this component listens
//     for).
//   • Closes on Escape, click on the backdrop, click on any link
//     inside the drawer (programmatic — usePathname detects route
//     changes), or programmatic close().
//   • Body scroll is locked while open.
//   • Focus moves into the drawer (close button) on open; focus
//     is restored to the previously-focused element (or the
//     hamburger) on close.
//   • Tab is trapped inside the drawer while open so keyboard
//     focus never leaks to the page underneath.
//
// Visual language (mirrors the search overlay's modal style):
//   - Backdrop: --bg-overlay + 6px blur.
//   - Drawer:   --bg-elev-1 with --line left border (slide-in
//               from the left). Width: min(85vw, 360px).
//   - Header:   brand + close button.
//   - Search:   the same pill input as the SiteHeader; clicking
//               it (or pressing Enter inside it) opens the
//               SearchOverlay so the user doesn't lose the
//               drawer's open state while typing a query.
//   - Nav:      primary nav links with the same active-state
//               pattern as the desktop secondary nav.
//   - Account:  "Log in" or user's display name.
//   - Cart:     full-width orange CTA pinned to the bottom.

'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react'
import {
  useBodyScrollLock,
  useFocusRestore,
  useFocusTrap,
} from '@foundations/ui/focus'
import { MOBILE_NAV_OPEN_EVENT } from './mobileNavEvents'
import { SEARCH_TRIGGER_OPEN_EVENT } from '@features/search/client'
import styles from './MobileNav.module.css'

export type MobileNavLink = {
  href: string
  label: string
  /** Optional small badge (e.g. the live-course count). */
  badge?: string | number
  /** Visually de-emphasize. Mockup uses this for FAQs + Course Portal. */
  dim?: boolean
}

export type MobileNavProps = {
  /** Primary nav items, sourced from the SiteHeader (RSC) so they
   *  stay in sync with the desktop secondary nav. */
  navItems: MobileNavLink[]
  /** Cart line-item count, for the drawer's bottom cart CTA. */
  cartCount: number
  /** Either the user's display_name (signed in) or null (anon). */
  userDisplayName: string | null
  /** Account href: `/account` (authed) or `/login` (anon). */
  accountHref: string
  /** Cart href: `/cart` (authed) or `/login?next=/cart` (anon). */
  cartHref: string
}

export function MobileNav({
  navItems,
  cartCount,
  userDisplayName,
  accountHref,
  cartHref,
}: MobileNavProps) {
  const [open, setOpen] = useState(false)
  const pathname = usePathname() ?? ''
  const dialogRef = useRef<HTMLDivElement>(null)
  const closeBtnRef = useRef<HTMLButtonElement>(null)
  const titleId = useId()

  // ----- Shared focus + scroll behavior (00-foundations/ui/focus/) ------
  // The shared hooks replace ~60 lines of inline focus / scroll / trap
  // code that used to live in this file. See the README in that folder
  // for the ARIA APG pattern they're implementing.
  useBodyScrollLock(open)
  useFocusTrap(dialogRef, open)
  useFocusRestore(open)

  const openDrawer = useCallback(() => setOpen(true), [])
  const closeDrawer = useCallback(() => setOpen(false), [])

  // ----- Open trigger (window event from MobileNavTrigger) --------------
  useEffect(() => {
    function onOpen() {
      openDrawer()
    }
    window.addEventListener(MOBILE_NAV_OPEN_EVENT, onOpen)
    return () => window.removeEventListener(MOBILE_NAV_OPEN_EVENT, onOpen)
  }, [openDrawer])

  // ----- Close on Escape ------------------------------------------------
  useEffect(() => {
    if (!open) return
    function onKeyDown(e: globalThis.KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault()
        closeDrawer()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, closeDrawer])

  // ----- Close on route change -----------------------------------------
  // When the user taps a link inside the drawer, the new page
  // mounts, usePathname updates, and we auto-close. This also
  // covers programmatic router.push() from inside the drawer.
  useEffect(() => {
    if (!open) return
    setOpen(false)
    // Focus restoration runs from useFocusRestore's cleanup
    // (post-unmount microtask), so we don't need to track the
    // previously-focused element here.
  }, [pathname, open])

  // ----- Focus close button on open ------------------------------------
  useEffect(() => {
    if (!open) return
    // Defer to next frame so the modal is in the DOM before focus.
    const raf = requestAnimationFrame(() => {
      closeBtnRef.current?.focus()
    })
    return () => cancelAnimationFrame(raf)
  }, [open])

  // ----- Search shortcut -----------------------------------------------
  // The drawer's search input delegates to the existing
  // SearchOverlay via the same data-attr convention the SiteHeader
  // uses. We don't have to re-implement instant-search here — the
  // overlay already exists and the user gets the same UX.
  const onSearchKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      const value = (e.currentTarget.value ?? '').trim()
      closeDrawer()
      if (value.length > 0) {
        // Open the overlay with a pre-populated query.
        window.dispatchEvent(
          new CustomEvent(SEARCH_TRIGGER_OPEN_EVENT, { detail: { initial: value } }),
        )
      } else {
        window.dispatchEvent(new CustomEvent(SEARCH_TRIGGER_OPEN_EVENT))
      }
    }
  }

  if (!open) return null

  return (
    <div
      className={styles.backdrop}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) closeDrawer()
      }}
      role="presentation"
    >
      <aside
        ref={dialogRef}
        className={styles.drawer}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <h2 id={titleId} className={styles.srOnly}>
          Site navigation
        </h2>

        {/* ----- Header (brand + close) ----- */}
        <div className={styles.drawerHeader}>
          <Link
            href="/"
            className={styles.brand}
            aria-label="Uthena home"
            onClick={closeDrawer}
          >
            <span className={styles.brandWord}>Uthena</span>
            <span className={styles.brandDot} aria-hidden>
              .
            </span>
          </Link>
          <button
            ref={closeBtnRef}
            type="button"
            className={styles.closeBtn}
            onClick={closeDrawer}
            aria-label="Close menu"
          >
            <span aria-hidden>×</span>
          </button>
        </div>

        {/* ----- Search shortcut ----- */}
        <div className={styles.searchWrap}>
          <span aria-hidden className={styles.searchIcon}>
            ⌕
          </span>
          <label htmlFor="mobile-nav-search" className={styles.srOnly}>
            Search the catalog
          </label>
          <input
            id="mobile-nav-search"
            type="search"
            className={styles.searchInput}
            placeholder="Search the catalog…"
            autoComplete="off"
            onKeyDown={onSearchKeyDown}
            // data-search-trigger makes the SearchTrigger island
            // open the overlay on click; onKeyDown handles Enter.
            data-search-trigger="true"
          />
        </div>

        {/* ----- Primary nav ----- */}
        <nav className={styles.nav} aria-label="Mobile primary">
          {navItems.map((item) => {
            const active =
              item.href === '/'
                ? pathname === '/'
                : pathname === item.href || pathname.startsWith(`${item.href}/`)
            const classes = [
              styles.navLink,
              active ? styles.navLinkActive : '',
              item.dim ? styles.navLinkDim : '',
            ]
              .filter(Boolean)
              .join(' ')
            return (
              <Link
                key={item.href}
                href={item.href}
                className={classes}
                aria-current={active ? 'page' : undefined}
                onClick={closeDrawer}
              >
                <span>{item.label}</span>
                {item.badge !== undefined && (
                  <span className={styles.navBadge}>{item.badge}</span>
                )}
              </Link>
            )
          })}
        </nav>

        {/* ----- Account + cart (sticky bottom) ----- */}
        <div className={styles.bottom}>
          <Link
            href={accountHref}
            className={styles.accountLink}
            onClick={closeDrawer}
          >
            <span className={styles.accountEyebrow}>
              {userDisplayName ? 'Signed in as' : 'Welcome'}
            </span>
            <span className={styles.accountName}>
              {userDisplayName ?? 'Log in'}
            </span>
          </Link>
          <Link
            href={cartHref}
            className={styles.cartBtn}
            aria-label={`Cart, ${cartCount} ${cartCount === 1 ? 'item' : 'items'}`}
            onClick={closeDrawer}
          >
            <span>Cart</span>
            <span className={styles.cartCount}>{cartCount}</span>
          </Link>
        </div>
      </aside>
    </div>
  )
}
