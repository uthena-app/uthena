// SiteHeaderNavActive — small client island that reads `usePathname`
// and applies the active class + aria-current to the matching link
// in the global secondary nav. Server component (SiteHeader) renders
// the surrounding chrome; only the active-state logic is client-side
// (mirrors the AdminSidebar / AdminSidebarActive pattern in
// 02-features/admin/shell/).
//
// Why a separate file:
// - SiteHeader must stay RSC so the announcement bar, search, and
//   right-side actions can read auth + cart count server-side with no
//   hydration cost.
// - `usePathname` is the only piece that needs the client. Keeping
//   it isolated means the rest of the header ships zero JS.

'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import styles from './SiteHeader.module.css'

export type NavLink = {
  href: string
  label: string
  /** Optional small badge (e.g. the live-course count). */
  badge?: string | number
  /** Visually de-emphasize. Mockup uses this for FAQs + Course Portal. */
  dim?: boolean
}

function isMatch(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/'
  return pathname === href || pathname.startsWith(`${href}/`)
}

export function SiteHeaderNavActive({ items }: { items: NavLink[] }) {
  const pathname = usePathname() ?? ''
  return (
    <>
      {items.map((item) => {
        const active = isMatch(pathname, item.href)
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
          >
            <span>{item.label}</span>
            {item.badge !== undefined && (
              <span className={styles.navBadge}>{item.badge}</span>
            )}
          </Link>
        )
      })}
    </>
  )
}
