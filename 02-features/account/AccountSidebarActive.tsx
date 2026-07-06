// AccountSidebarActive — small client component that reads
// `usePathname` and applies the active style + `aria-current="page"`
// to the matching nav link. Split out so the rest of the shell can
// stay a server component (the user data + nav filter live in the
// RSC parent).
//
// Mirrors `AdminSidebarActive` (02-features/admin/shell/) so all
// role shells share the same active-link UX.

'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import styles from './AccountShell.module.css'

type NavItem = { href: string; label: string }

export function AccountSidebarActive({ items }: { items: ReadonlyArray<NavItem> }) {
  const pathname = usePathname() ?? ''

  return (
    <nav className={styles.nav} aria-label="Account sections">
      {items.map((item) => {
        // Exact match for the section root, prefix match for sub-routes.
        // /account → exact, /account/orders → prefix match for '/account/orders' or any '/account/orders/*'.
        const isActive =
          item.href === '/account'
            ? pathname === '/account'
            : pathname === item.href || pathname.startsWith(`${item.href}/`)

        return (
          <Link
            key={item.href}
            href={item.href}
            className={[styles.navLink, isActive ? styles.navLinkActive : '']
              .filter(Boolean)
              .join(' ')}
            aria-current={isActive ? 'page' : undefined}
          >
            {item.label}
          </Link>
        )
      })}
    </nav>
  )
}