// /affiliate/settings not-found surface — shown when the page
// can't render the settings (e.g. the affiliate row vanishes mid-
// request). 404 with a single CTA back to the dashboard.

import Link from 'next/link'
import styles from './not-found.module.css'

export default function AffiliateSettingsNotFound() {
  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <p className={styles.eyebrow}>Settings</p>
        <h1 className={styles.heading}>Affiliate settings unavailable</h1>
        <p className={styles.body}>
          Your affiliate record couldn't be loaded. If you just signed up,
          head back to the dashboard to continue onboarding.
        </p>
        <Link href="/affiliate" className={styles.cta}>
          ← Back to dashboard
        </Link>
      </div>
    </div>
  )
}