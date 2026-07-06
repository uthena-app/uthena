// /partner/onboarding/welcome/loading — RSC. Mirrors the welcome
// page shape so the user never sees unstyled content while the
// session + partner-row reads resolve. Same pattern as P0.24's
// loading surfaces + the /partner/onboarding sibling route.

import styles from './loading.module.css'

export default function PartnerOnboardingWelcomeLoading() {
  return (
    <main className={styles.page} aria-busy="true" aria-live="polite">
      <div className={styles.shell}>
        <div className={styles.eyebrow} />
        <div className={styles.title} />
        <div className={styles.lede} />
        <div className={styles.card} />
        <div className={styles.toolbar} />
      </div>
    </main>
  )
}