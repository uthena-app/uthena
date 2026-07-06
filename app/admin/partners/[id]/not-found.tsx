// /admin/partners/[id] — not-found surface. Triggered when:
//   - the id is not a valid bigint
//   - the partners row doesn't exist
//   - the RPC returns 0 rows (orphaned / deleted)
//
// Pure RSC, no client JS. Token-only CSS. The breadcrumb links back
// to the partners list (the only useful exit; this isn't an error
// page that needs a "go home" CTA — the admin is in the middle of
// a workflow and needs to get back to the list).

import Link from 'next/link'
import { AdminShell } from '@features/admin'
import styles from './not-found.module.css'

export default function AdminPartnerNotFound() {
  return (
    <AdminShell title="Partner not found">
      <div className={styles.wrap}>
        <h1 className={styles.h1}>Partner not found</h1>
        <p className={styles.lede}>
          This partner may not exist, may have been deleted, or you may
          have followed a stale link. The page is admin-only — admins are
          the only callers, and they always land here from a list or
          search.
        </p>
        <Link href="/admin/partners" className={styles.link}>
          ← Back to all partners
        </Link>
      </div>
    </AdminShell>
  )
}