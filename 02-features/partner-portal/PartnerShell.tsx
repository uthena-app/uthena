// PartnerShell — role-gated layout for /partner/*. Renders the
// sidebar + main content area. Server component.
//
// Active-link state lives in `PartnerSidebarActive` (client island)
// so the rest of the shell can stay RSC. Mirrors the
// `AdminSidebar` + `AccountSidebar` + `AffiliateSidebar` pattern.

import Link from 'next/link'
import { redirect } from 'next/navigation'
import { requirePartner } from '@foundations/auth/guards'
import { signOutAction } from '@features/auth/actions'
import { PartnerSidebarActive } from './PartnerSidebarActive'
import styles from './PartnerShell.module.css'

type NavItem = { href: string; label: string }

const NAV: NavItem[] = [
  { href: '/partner', label: 'Dashboard' },
  { href: '/partner/courses', label: 'Courses' },
  { href: '/partner/sales', label: 'Sales' },
  { href: '/partner/payouts', label: 'Payouts' },
  { href: '/partner/instructor-upload', label: 'Upload' },
  { href: '/partner/settings', label: 'Settings' },
  // P12.19 — API tokens management. Sub-route of settings; surfaced as
  // its own sidebar entry because it is a frequently-used page
  // (Zapier-style integrations are a daily tool for the partner).
  { href: '/partner/settings/api', label: 'API tokens' },
]

export async function PartnerShell({ children }: { children: React.ReactNode }) {
  const user = await requirePartner()
  return (
    <div className={styles.shell}>
      <a href="#partner-main" className="skip-link">
        Skip to partner content
      </a>
      <aside className={styles.sidebar} aria-label="Partner navigation">
        <div className={styles.userCard}>
          <p className={styles.userName}>{user.display_name}</p>
          <p className={styles.userEmail}>{user.email}</p>
          <span className={styles.userRole}>Partner</span>
        </div>

        <PartnerSidebarActive items={NAV} />

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
      <main id="partner-main" className={styles.content} tabIndex={-1}>
        {children}
      </main>
    </div>
  )
}

// Re-export redirect so route files can use it after a guard.
export { redirect }