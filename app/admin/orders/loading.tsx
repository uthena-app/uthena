// /admin/orders loading skeleton (P14.7 Slice 1).
//
// RSC skeleton that mirrors the page shape: header + 5-card stats row +
// 7-field filter form + 9-column table + pagination. Token-only CSS, no
// client JS. Matches the pattern from /admin/affiliates + /admin/partners.

import styles from './loading.module.css'

export default function AdminOrdersLoading() {
  return (
    <div className={styles.shell} aria-busy="true" aria-label="Loading orders">
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
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className={styles.filterField} />
        ))}
      </div>

      <div className={styles.tableScroll}>
        <table className={styles.table}>
          <thead>
            <tr>
              {Array.from({ length: 9 }).map((_, i) => (
                <th key={i} className={styles.thBar} />
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: 10 }).map((_, row) => (
              <tr key={row}>
                {Array.from({ length: 9 }).map((_, col) => (
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
