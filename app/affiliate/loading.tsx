// /affiliate — loading state. Renders inside the AffiliateShell so
// the user gets the sidebar + the placeholder body shape immediately
// while the page hydrates. Mirrors P0.24 Slice 2's auth-area loading
// pattern (centered skeleton with header + placeholder shape).

import { AffiliateShell } from '@features/affiliate-portal'
import styles from './loading.module.css'

export default function AffiliateLoading() {
  return (
    <AffiliateShell>
      <div className={styles.wrap} aria-busy="true" aria-label="Loading…">
        <div className={styles.eyebrow} />
        <div className={styles.h1} />
        <div className={styles.lede} />
        <div className={styles.card}>
          <div className={styles.cardEyebrow} />
          <div className={styles.cardH} />
          <div className={styles.cardLine} />
          <div className={styles.cardLineShort} />
          <div className={styles.cardListItem} />
          <div className={styles.cardListItem} />
          <div className={styles.cardListItem} />
        </div>
      </div>
    </AffiliateShell>
  )
}