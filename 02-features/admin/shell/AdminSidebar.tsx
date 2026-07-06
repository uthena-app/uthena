// AdminSidebar — server component (the links are static, the active
// state is computed via a small client wrapper to read `usePathname`).
// Renders the navigation: Moderation / Users / System, plus a sign-out
// button at the bottom. Active state is read from a context-free
// `usePathname()` in the client sibling to keep the server tree simple.

import Link from 'next/link'
import { getSessionUser } from '@foundations/auth/guards'
import { SignOutButton } from './SignOutButton'
import { AdminSidebarActive } from './AdminSidebarActive'
import styles from './AdminShell.module.css'

type NavItem = { href: string; label: string }

const SECTIONS: { label: string; items: NavItem[] }[] = [
  {
    label: 'Moderation',
    items: [
      { href: '/admin/review', label: 'Review queue' },
      { href: '/admin/refunds', label: 'Refunds' },
      { href: '/admin/reports', label: 'Reports' },
      { href: '/admin/moderation', label: 'Content moderation' },
      { href: '/admin/audit-log', label: 'Audit log' },
      { href: '/admin/categories', label: 'Categories' },
      { href: '/admin/payouts', label: 'Payouts' },
    ],
  },
  {
    label: 'Users',
    items: [
      { href: '/admin/partners', label: 'Partners' },
      { href: '/admin/affiliates', label: 'Affiliates' },
      { href: '/admin/customers', label: 'Customers' },
    ],
  },
  {
    label: 'System',
    items: [
      { href: '/admin/analytics', label: 'Analytics' },
      { href: '/admin/settings', label: 'Settings' },
      // P10.4 — DMCA designated agent editor. The contact shown on
      // /dmca is read from `platform_settings.dmca_agent`; this page
      // is the single source of truth for keeping that row current.
      { href: '/admin/dmca-agent', label: 'DMCA agent' },
      // P1.10 — super_admin-only entry point for impersonation.
      // Filtered below so non-super_admin admins don't see the link.
      { href: '/admin/account-switcher', label: 'Account switcher' },
    ],
  },
]

export async function AdminSidebar() {
  const user = await getSessionUser()
  // The shell is only rendered after requireRole(['admin']) succeeds, so
  // user is always present at this point. Defensive fallback for safety.
  if (!user) return null

  // P1.10 — filter out super_admin-only items for non-super_admin admins.
  // Defense in depth: even if the link were visible, the page itself
  // gates on `requireRole(['super_admin'])` and would 403.
  const visibleSections = SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter((item) => {
      if (item.href === '/admin/account-switcher' && user.role !== 'super_admin') return false
      return true
    }),
  })).filter((section) => section.items.length > 0)

  return (
    <aside className={styles.sidebar} aria-label="Admin navigation">
      <div className={styles.sidebarHeader}>
        <span className={styles.sidebarBrand}>Uthena · Admin</span>
        <span className={styles.sidebarUser}>{user.display_name}</span>
        <span className={styles.sidebarRole}>{user.role.replace('_', ' ')}</span>
      </div>

      {visibleSections.map((section) => (
        <div key={section.label} className={styles.section}>
          <span className={styles.sectionLabel}>{section.label}</span>
          <AdminSidebarActive items={section.items} />
        </div>
      ))}

      <div className={styles.signOutForm}>
        <SignOutButton className={styles.signOut} />
      </div>
    </aside>
  )
}

// Re-export the link list with active highlighting as a typed shape
// so the layout/page can also use it for the dashboard's stat cards
// and breadcrumbs.
export const ADMIN_NAV_SECTIONS = SECTIONS
