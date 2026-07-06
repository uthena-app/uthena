// /affiliate/settings loading state — RSC skeleton.
//
// Mirrors the SettingsHub layout (page header + 2 sections) with
// pure Skeleton primitives. Renders within the parent's loading
// boundary. Zero client JS.

import { Skeleton } from '@foundations/ui/primitives/Skeleton'
import styles from './loading.module.css'

export default function AffiliateSettingsLoading() {
  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <Skeleton width={80} height={14} radius={4} />
        <Skeleton width={220} height={28} radius={6} />
        <Skeleton width={420} height={16} radius={4} />
      </div>
      <div className={styles.sectionStack}>
        {[0, 1].map((i) => (
          <div key={i} className={styles.section}>
            <Skeleton width={120} height={20} radius={4} />
            <Skeleton width={280} height={14} radius={4} />
            <div className={styles.formGrid}>
              <Skeleton width="100%" height={42} radius={6} />
              <Skeleton width="100%" height={96} radius={6} />
              <Skeleton width={140} height={32} radius={6} />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}