// /partner/onboarding/thanks/error — client component per Next.js
// convention. Renders a token-styled fallback if a query throws
// (PostgREST outage, RLS policy changed, etc.). Reuses the same
// shape as the /partner/onboarding sibling route.

'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import styles from './error.module.css'

export default function PartnerOnboardingThanksError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // Surface to whatever client-side telemetry exists; never log
    // the raw `error.message` to the console without PII scrubbing.
    if (typeof window !== 'undefined' && error.digest) {
      // Logged to the console with the digest only — Klaas can
      // correlate with the server-side request_id.
      console.error('partner-onboarding/thanks route errored:', error.digest)
    }
  }, [error])

  return (
    <main className={styles.page} role="alert" aria-live="assertive">
      <div className={styles.card}>
        <h1 className={styles.h1}>We couldn&apos;t load your application status.</h1>
        <p className={styles.lede}>
          Something went wrong on our side. Your application is safe — try
          again, or come back in a minute.
        </p>
        {error.digest && (
          <p className={styles.digest} aria-label="Reference">
            Reference: <code>{error.digest}</code>
          </p>
        )}
        <div className={styles.actions}>
          <button type="button" onClick={() => reset()} className={styles.primary}>
            Try again
          </button>
          <Link href="/library" className={styles.secondary}>
            Back to library
          </Link>
        </div>
      </div>
    </main>
  )
}