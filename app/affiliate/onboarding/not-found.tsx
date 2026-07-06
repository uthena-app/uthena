// /affiliate/onboarding — not-found boundary.
//
// P13.1 Slice 1 — Next.js triggers this when the route doesn't
// match. Rare (the page always matches), but the convention from
// partner onboarding calls for the surface + a friendly card so
// deep-links never render a generic 404.

import Link from 'next/link'
import styles from './not-found.module.css'

export default function AffiliateOnboardingNotFound() {
  return (
    <main className={styles.page}>
      <section className={styles.card} aria-labelledby="nf-h">
        <p className={styles.eyebrow}>Not found</p>
        <h1 id="nf-h" className={styles.title}>
          That onboarding step doesn&apos;t exist.
        </h1>
        <p className={styles.body}>
          The wizard has 6 steps. If you followed a link, it might be stale — head back to the
          start.
        </p>
        <div className={styles.actions}>
          <Link href="/affiliate/onboarding" className={styles.cta}>
            Restart the wizard
          </Link>
          <Link href="/library" className={styles.link}>
            Back to library
          </Link>
        </div>
      </section>
    </main>
  )
}