'use client'

// /affiliate/onboarding — error boundary (P13.1 Slice 1).
//
// Catches any uncaught server-side rendering error on the wizard
// route. Logs only the digest (never the raw message — per AGENTS.md
// "no PII in logs"), renders a friendly retry card with a hard
// reload CTA.

import { useEffect } from 'react'
import Link from 'next/link'
import styles from './error.module.css'

export default function AffiliateOnboardingError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // Surface only the digest (server-assigned error id) so a real
    // message containing PII never reaches the client console.
    // eslint-disable-next-line no-console
    console.error('Affiliate onboarding error digest:', error.digest ?? 'unknown')
  }, [error.digest])

  return (
    <main className={styles.page}>
      <section className={styles.card} aria-labelledby="error-h">
        <p className={styles.eyebrow}>Something went wrong</p>
        <h1 id="error-h" className={styles.title}>
          We couldn&apos;t load your onboarding.
        </h1>
        <p className={styles.body}>
          The wizard failed to load. Please try again, or head back to your library — your
          progress is preserved.
        </p>
        <div className={styles.actions}>
          <button type="button" onClick={() => reset()} className={styles.retry}>
            Try again
          </button>
          <Link href="/library" className={styles.link}>
            Back to library
          </Link>
        </div>
      </section>
    </main>
  )
}