// AdminSidebarActive — small client component that reads `usePathname`
// and applies the active style to the matching link. Split out so the
// rest of the sidebar can stay a server component.

'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import styles from './AdminShell.module.css'

type NavItem = { href: string; label: string }

export function AdminSidebarActive({ items }: { items: NavItem[] }) {
  const pathname = usePathname() ?? ''

  return (
    <>
      {items.map((item) => {
        // Exact match for /admin, prefix match for sub-routes.
        const isActive =
          item.href === '/admin'
            ? pathname === '/admin'
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
    </>
  )
}
