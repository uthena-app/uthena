// /affiliate/links — loading state. Renders the page header
// skeleton + the 4-up stats row skeleton + the hero card skeleton +
// the table skeleton. Keeps the AffiliateShell wrapper so the
// sidebar + chrome persist through the loading transition.

import { AffiliateShell } from '@features/affiliate-portal'
import styles from './loading.module.css'

export default function AffiliateLinksLoading() {
  return (
    <AffiliateShell>
      <div className={styles.wrap} aria-busy="true" aria-label="Loading affiliate links">
        {/* Header */}
        <div className={styles.eyebrow} />
        <div className={styles.h1} />
        <div className={styles.lede} />

        {/* Stats row */}
        <div className={styles.statsRow}>
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className={styles.statCell} />
          ))}
        </div>

        {/* Hero card */}
        <div className={styles.hero}>
          <div className={styles.heroHeader} />
          <div className={styles.heroUrl} />
          <div className={styles.heroStrip}>
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className={styles.heroStat} />
            ))}
          </div>
        </div>

        {/* Table */}
        <div className={styles.tableCard}>
          <div className={styles.tableHeader} />
          <div className={styles.tableRow} />
          <div className={styles.tableRow} />
        </div>
      </div>
    </AffiliateShell>
  )
}
