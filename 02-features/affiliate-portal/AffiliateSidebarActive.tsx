// AffiliateSidebarActive — small client component that reads
// `usePathname` and applies the active style + `aria-current="page"`
// to the matching nav link. Mirrors the other role shells'
// `*SidebarActive` client islands.

'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import styles from './AffiliateShell.module.css'

type NavItem = { href: string; label: string }

export function AffiliateSidebarActive({ items }: { items: ReadonlyArray<NavItem> }) {
  const pathname = usePathname() ?? ''

  return (
    <nav className={styles.nav} aria-label="Affiliate sections">
      {items.map((item) => {
        // Exact match for /affiliate, prefix match for sub-routes.
        const isActive =
          item.href === '/affiliate'
            ? pathname === '/affiliate'
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