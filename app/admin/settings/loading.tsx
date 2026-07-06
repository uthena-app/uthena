// /admin/settings — loading skeleton (P14.12 — Slice 1). Mirrors the
// page shape: a lede + a card with 3 labeled rows + 3 input fields.
// Pure Skeleton primitives from `@foundations/ui/Skeleton` (used
// elsewhere in the admin area — see /admin/customers/loading.tsx).

import { AdminShell } from '@features/admin'
import { Skeleton } from '@foundations/ui/primitives/Skeleton'
import styles from './loading.module.css'

export default function AdminSettingsLoading() {
  return (
    <AdminShell title="Platform settings">
      <Skeleton width="60%" height="14px" className={styles.lede ?? ''} />
      <div className={styles.section}>
        <Skeleton width="120px" height="12px" className={styles.sectionTitle ?? ''} />
        <div className={styles.card}>
          <div className={styles.row}>
            <Skeleton width="140px" height="12px" />
            <Skeleton width="110px" height="40px" />
            <Skeleton width="80%" height="10px" />
          </div>
          <div className={styles.row}>
            <Skeleton width="160px" height="12px" />
            <Skeleton width="110px" height="40px" />
            <Skeleton width="70%" height="10px" />
          </div>
          <div className={styles.row}>
            <Skeleton width="120px" height="12px" />
            <Skeleton width="110px" height="40px" />
            <Skeleton width="75%" height="10px" />
          </div>
          <div className={styles.actions}>
            <Skeleton width="120px" height="40px" />
            <Skeleton width="80px" height="40px" />
          </div>
        </div>
      </div>
    </AdminShell>
  )
}