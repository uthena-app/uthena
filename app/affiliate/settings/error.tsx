'use client'

// /affiliate/settings error boundary — catches render-time errors
// on the page. Logs the error via the platform loggerFor and
// renders a friendly retry surface. Matches the platform's
// RouteError pattern (see 00-foundations/ui/error/RouteError.tsx).

import { useEffect } from 'react'
import Link from 'next/link'
import styles from './error.module.css'

export default function AffiliateSettingsError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // Log the error via console — the platform's Sentry capture
    // (Phase 18 P18.1) will replace this with a Sentry.capture call.
    // No PII here — the digest is the only identifying token.
    // eslint-disable-next-line no-console
    console.error('affiliate settings page error', error.digest ?? null)
  }, [error])

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <p className={styles.eyebrow}>Settings</p>
        <h1 className={styles.heading}>We couldn't load your settings</h1>
        <p className={styles.body}>
          Something went wrong on our end. Try again, or head back to your dashboard.
        </p>
        {error.digest && (
          <p className={styles.digest}>Error ID: {error.digest}</p>
        )}
        <div className={styles.actions}>
          <button type="button" onClick={reset} className={styles.primaryBtn}>
            Try again
          </button>
          <Link href="/affiliate" className={styles.secondaryBtn}>
            Dashboard
          </Link>
        </div>
      </div>
    </div>
  )
}