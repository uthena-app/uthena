// /admin/affiliates loading skeleton (P14.6 Slice 1).
//
// RSC skeleton that mirrors the page shape: stats row + filter form +
// table + pagination. Token-only CSS, no client JS. Matches the
// pattern from /admin/partners + /admin/customers.

import styles from './loading.module.css'

export default function AdminAffiliatesLoading() {
  return (
    <div className={styles.shell} aria-busy="true" aria-label="Loading affiliates">
      <div className={styles.headerRow}>
        <div className={styles.h1Bar} />
        <div className={styles.subBar} />
      </div>

      <div className={styles.statsRow}>
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className={styles.statCard}>
            <div className={styles.statLabel} />
            <div className={styles.statValue} />
          </div>
        ))}
      </div>

      <div className={styles.filterBar}>
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className={styles.filterField} />
        ))}
      </div>

      <div className={styles.tableScroll}>
        <table className={styles.table}>
          <thead>
            <tr>
              {Array.from({ length: 11 }).map((_, i) => (
                <th key={i} className={styles.thBar} />
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: 10 }).map((_, row) => (
              <tr key={row}>
                {Array.from({ length: 11 }).map((_, col) => (
                  <td key={col} className={styles.tdBar} />
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}