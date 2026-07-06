// /admin/customers/[id] — not-found surface. Triggered when:
//   - the id is not a valid UUID
//   - the profiles row doesn't exist OR is an admin row
//   - the RPC returns 0 rows (orphaned / deleted)
//
// Pure RSC, no client JS. Token-only CSS. The breadcrumb links back
// to the customers list (the only useful exit; this isn't an error
// page that needs a "go home" CTA — the admin is in the middle of
// a workflow and needs to get back to the list).

import Link from 'next/link'
import { AdminShell } from '@features/admin'
import styles from './not-found.module.css'

export default function AdminCustomerNotFound() {
  return (
    <AdminShell title="Customer not found">
      <div className={styles.wrap}>
        <h1 className={styles.h1}>Customer not found</h1>
        <p className={styles.lede}>
          This customer may not exist, may have been deleted, or you may
          have followed a stale link. The page is admin-only — admins are
          the only callers, and they always land here from a list or
          search.
        </p>
        <Link href="/admin/customers" className={styles.link}>
          ← Back to all customers
        </Link>
      </div>
    </AdminShell>
  )
}