// Account certificates loading fallback. Renders while
// `app/account/certificates/page.tsx` streams in (placeholder page —
// the certificates table ships in PH16 LMS). Mirrors the eventual
// gallery shape — header + 3-card placeholder grid (since v1 has no
// certificates to show, the placeholder is the eventual UX).
//
// No data fetch. No client JS. Pure RSC + the shared `Skeleton` primitive.

import { Skeleton } from '@foundations/ui/primitives/Skeleton'
import styles from './loading.module.css'

export default function AccountCertificatesLoading() {
  return (
    <div className={styles.wrap} aria-busy="true" aria-label="Loading…">
      <header className={styles.header} aria-hidden="true">
        <Skeleton width="40%" height={28} radius={8} ariaLabel="" />
        <Skeleton width="65%" height={14} radius={6} ariaLabel="" />
      </header>

      <section className={styles.grid} aria-hidden="true">
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className={styles.card}>
            <Skeleton width={64} height={64} radius={999} ariaLabel="" />
            <Skeleton width="75%" height={16} radius={6} ariaLabel="" />
            <Skeleton width="50%" height={12} radius={6} ariaLabel="" />
            <Skeleton width="40%" height={11} radius={6} ariaLabel="" />
          </div>
        ))}
      </section>
    </div>
  )
}
