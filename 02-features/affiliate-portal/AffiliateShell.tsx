// AffiliateShell — role-gated layout for /affiliate/*. Renders the
// sidebar + main content area. Server component.
//
// This is the P1.7 placeholder shell — the full dashboard, link
// generator, mini-shop, payouts, and settings land in Phase 13
// (P13.x). The shell itself ships now so the role-aware nav link
// in the account sidebar doesn't 404 for affiliate-role users.
//
// Visual contract mirrors the AdminShell + AccountShell + PartnerShell:
// sidebar width 260px, sticky on desktop, collapses on mobile.
//
// Active-link state lives in `AffiliateSidebarActive` (client island)
// — same pattern as the other three role shells.

import Link from 'next/link'
import { redirect } from 'next/navigation'
import { requireRole } from '@foundations/auth/guards'
import { signOutAction } from '@features/auth/actions'
import { AffiliateSidebarActive } from './AffiliateSidebarActive'
import styles from './AffiliateShell.module.css'

type NavItem = { href: string; label: string }

// P1.7 ships the Dashboard placeholder link. P13.5 Slice 1 added
// the Links entry. P13.11 Slice 1 adds the Settings entry. The
// Settings entry is added now (not gated on Slice 2+ completion)
// because the page exists at /affiliate/settings and works for
// the Profile + Notifications sections; the Sessions / Connected
// accounts / Language & region / audit-strip sub-surfaces are
// documented inside the page as "Coming in next slices" so the
// spec stays honest about what's shipping per P13.11 slice.
//
// { href: '/affiliate/mini-shop', label: 'Mini-shop' },   // P13.8
// { href: '/affiliate/payouts', label: 'Payouts' },       // P13.x
const NAV: NavItem[] = [
  { href: '/affiliate', label: 'Dashboard' },
  // P13.5 Slice 1 — link manager ships. Active state mirrors the
  // dashboard pattern (pathname.startsWith('/affiliate/links')
  // matches /affiliate/links AND future /affiliate/links/[id]
  // sub-routes).
  { href: '/affiliate/links', label: 'Links' },
  // P13.11 Slice 1 — affiliate settings ships (Profile +
  // Notifications sections). The remaining sections land in
  // Slice 2+ (filed as STUB-111).
  { href: '/affiliate/settings', label: 'Settings' },
]

export async function AffiliateShell({ children }: { children: React.ReactNode }) {
  // requireRole handles anonymous (→ /login) AND non-affiliate
  // (→ /403). This is the right trust boundary: a buyer visiting
  // /affiliate sees the 403 page, not the placeholder dashboard.
  const user = await requireRole(['affiliate', 'admin', 'super_admin'])

  return (
    <div className={styles.shell}>
      <a href="#affiliate-main" className="skip-link">
        Skip to affiliate content
      </a>
      <aside className={styles.sidebar} aria-label="Affiliate navigation">
        <div className={styles.userCard}>
          <p className={styles.userName}>{user.display_name}</p>
          <p className={styles.userEmail}>{user.email}</p>
          <span className={styles.userRole}>Affiliate</span>
        </div>

        <AffiliateSidebarActive items={NAV} />

        <div className={styles.spacer} />
        <Link href="/account" className={styles.secondaryLink}>
          ← Back to account
        </Link>
        <form action={signOutAction} className={styles.signOutForm}>
          <button type="submit" className={styles.signOut}>
            Sign out
          </button>
        </form>
      </aside>
      <main id="affiliate-main" className={styles.content} tabIndex={-1}>
        {children}
      </main>
    </div>
  )
}

// Re-export redirect so route files can use it after a guard.
export { redirect }