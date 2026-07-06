// AccountShell — the buyer's authenticated shell. Renders the sidebar
// + content area for every /account/* page. Role-aware: the nav list
// includes portal entries (Partner / Affiliate / Admin) for users
// with those roles, so the shell is the "home base" that links to
// every role area.
//
// Split out from `app/account/layout.tsx` so the shell contract is
// shared (and testable) outside the route file. The route layout
// becomes a thin wrapper that calls <AccountShell>{children}</AccountShell>.

import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getSessionUser } from '@foundations/auth/guards'
import { signOutAction } from '@features/auth/actions'
import { AccountSidebarActive } from './AccountSidebarActive'
import styles from './AccountShell.module.css'

type NavItem = {
  href: string
  label: string
  /** Audience: `'all'` shows for every signed-in user. `'partner' | 'affiliate' | 'admin'`
   *  shows only for users with that role (or a higher admin role — see ROLE_AUDIENCE). */
  show: 'all' | 'partner' | 'affiliate' | 'admin'
}

// Single source of truth for "who can see what". Admin/super_admin
// see every portal link (they may need to switch context).
const ROLE_AUDIENCE: Record<string, ReadonlyArray<NavItem['show']>> = {
  customer: [],
  partner: ['partner'],
  affiliate: ['affiliate'],
  admin: ['partner', 'affiliate', 'admin'],
  super_admin: ['partner', 'affiliate', 'admin'],
}

const NAV: NavItem[] = [
  { href: '/account', label: 'Overview', show: 'all' },
  { href: '/account/orders', label: 'Orders', show: 'all' },
  { href: '/account/library', label: 'Library', show: 'all' },
  { href: '/account/profile', label: 'Profile', show: 'all' },
  { href: '/account/settings', label: 'Settings', show: 'all' },
  // Portal entries — only show for users with the matching role.
  // The labels are user-facing (not "Partner portal" jargon) so the
  // shell reads as a natural home-base nav.
  { href: '/partner', label: 'Partner portal', show: 'partner' },
  { href: '/affiliate', label: 'Affiliate portal', show: 'affiliate' },
  { href: '/admin', label: 'Admin console', show: 'admin' },
]

function visibleForUser(role: string): ReadonlyArray<NavItem['show']> {
  // 'all' is implicitly visible for every signed-in user. The role's
  // audience list only enumerates role-gated items.
  return ['all', ...(ROLE_AUDIENCE[role] ?? [])]
}

export async function AccountShell({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser()
  if (!user) {
    redirect('/login?next=/account')
  }

  const audience = visibleForUser(user.role)
  const visibleNav = NAV.filter((n) => audience.includes(n.show))

  return (
    <div className={styles.shell}>
      <a href="#account-main" className="skip-link">
        Skip to account content
      </a>
      <aside className={styles.sidebar} aria-label="Account navigation">
        <div className={styles.userCard}>
          <p className={styles.userName}>{user.display_name}</p>
          <p className={styles.userEmail}>{user.email}</p>
          <span className={styles.userRole}>{user.role.replace('_', ' ')}</span>
        </div>

        <AccountSidebarActive items={visibleNav} />

        <form action={signOutAction} className={styles.signOutForm}>
          <button type="submit" className={styles.signOut}>
            Sign out
          </button>
        </form>
      </aside>
      <main id="account-main" className={styles.content} tabIndex={-1}>
        {children}
      </main>
    </div>
  )
}

// Re-export the visible-nav predicate so the page-level tests can
// verify the role-aware filter without spinning up a request.
export const __test__ = { visibleForUser, ROLE_AUDIENCE, NAV }

// Sidebar's <Link> map accepts a portal-href; re-export the Link
// component as a sanity hint (matches the AdminSidebar pattern).
export { Link }