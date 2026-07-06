// /partner/onboarding/loading — RSC. Mirrors the shell shape so the
// page never flashes unstyled content while the draft + partner-row
// reads resolve. Same pattern as P0.24's loading surfaces.

import styles from './loading.module.css'

export default function PartnerOnboardingLoading() {
  return (
    <main className={styles.page} aria-busy="true" aria-live="polite">
      <div className={styles.shell}>
        <div className={styles.eyebrow} />
        <div className={styles.title} />
        <div className={styles.lede} />
        <div className={styles.stepper} />
        <div className={styles.body} />
        <div className={styles.toolbar} />
      </div>
    </main>
  )
}
