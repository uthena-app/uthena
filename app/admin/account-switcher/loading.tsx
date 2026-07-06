// /admin/account-switcher — per-route loading skeleton. Mirrors the
// search + results + recent-sessions shape of the page so the loading
// state is recognisable. Pure RSC, token-only, zero client JS.
// `aria-busy="true"` + `aria-label="Loading…"` on the parent <main>.

import { AdminShell } from '@features/admin'
import { Skeleton } from '@foundations/ui/primitives/Skeleton'
import styles from './loading.module.css'

export default function Loading() {
  return (
    <AdminShell title="Account switcher">
      <div className={styles.section} aria-busy="true" aria-label="Loading account switcher…">
        <Skeleton variant="text" count={2} />
        <div className={styles.gap} />
        <Skeleton variant="text" />
        <Skeleton variant="text" width="60%" />
        <div className={styles.gap} />
        <Skeleton variant="text" />
        <Skeleton variant="rect" height={120} />
        <div className={styles.gap} />
        <Skeleton variant="text" />
        <Skeleton variant="rect" height={180} />
      </div>
    </AdminShell>
  )
}
