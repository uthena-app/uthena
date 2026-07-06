// PartnerSidebarActive — small client component that reads
// `usePathname` and applies the active style + `aria-current="page"`
// to the matching nav link. Split out so the rest of the PartnerShell
// can stay a server component.
//
// Mirrors `AdminSidebarActive` and `AccountSidebarActive` so all
// role shells share the same active-link UX.

'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import styles from './PartnerShell.module.css'

type NavItem = { href: string; label: string }

export function PartnerSidebarActive({ items }: { items: ReadonlyArray<NavItem> }) {
  const pathname = usePathname() ?? ''

  return (
    <nav className={styles.nav} aria-label="Partner sections">
      {items.map((item) => {
        // Exact match for /partner, prefix match for sub-routes.
        const isActive =
          item.href === '/partner'
            ? pathname === '/partner'
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