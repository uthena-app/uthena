// AdminShell — composes the sidebar + topbar + children. The page-level
// layout (`app/admin/layout.tsx`) handles the auth gate; this component
// is pure presentation and contains no auth logic of its own.

import type { ReactNode } from 'react'
import { AdminSidebar } from './AdminSidebar'
import { AdminTopbar } from './AdminTopbar'
import styles from './AdminShell.module.css'

export function AdminShell({
  title,
  children,
  topbarRight,
}: {
  /** Title shown in the topbar. */
  title: string
  /** Page content. */
  children: ReactNode
  /** Optional right-aligned content in the topbar (e.g. action buttons). */
  topbarRight?: ReactNode
}) {
  return (
    <div className={styles.shell}>
      <a href="#admin-main" className="skip-link">
        Skip to admin content
      </a>
      <AdminSidebar />
      <div>
        <AdminTopbar title={title} />
        <main id="admin-main" className={styles.content} tabIndex={-1}>
          <div className={styles.contentInner}>
            {topbarRight ? (
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
                {topbarRight}
              </div>
            ) : null}
            {children}
          </div>
        </main>
      </div>
    </div>
  )
}
