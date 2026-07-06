// app/error.tsx — route-level error boundary.
//
// Catches unhandled exceptions from any RSC, route handler, or server
// action beneath the root layout. Renders INSIDE the root layout (so
// SiteHeader + SiteFooter are still visible). HTTP status: 500.
//
// 'use client' is required by Next.js for error.tsx — the `reset()`
// function and the clipboard handler both need the client runtime.
//
// Per error-500.md §Security (the CRITICAL constraint): the page MUST
// NOT leak the stack trace, the error message, the failing component
// name, the database query, the user_id, the user's email, the request
// body, the IP, the user agent, or any PII. The only error context the
// user sees is the opaque ERR-{id} reference card. The Sentry seam
// captures the structured event (P2.11) — the SDK itself ships in PH18.

'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { Button } from '@foundations/ui/primitives/Button'
import { makeErrorReference, WarnGlyph } from '@foundations/ui/error'
import { reportError } from '@foundations/observability/client-report'
import styles from './error.module.css'

export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  // Generate the ID once per mount — `useState` initializer runs only on
  // the first render. The error is intentional; we don't want the ID
  // changing across retries.
  const [errId] = useState(makeErrorReference)
  const [copied, setCopied] = useState(false)
  const subject = encodeURIComponent(`Error ${errId}`)

  useEffect(() => {
    // Sentry seam — PII-safe payload (error.name + errId only, never
    // error.message or error.stack). The client wrapper POSTs to
    // /api/errors/report; the server-side route handler calls
    // captureError with the server-only seam. The seam writes the
    // structured event to pino; the SDK init lands in PH18.
    reportError(error, { surface: 'app.error', errId })
  }, [errId, error])

  return (
    <main id="main" className={styles.wrap} role="alert">
      <div className={styles.iconWrap} aria-hidden="true">
        <WarnGlyph />
      </div>
      <p className={styles.eyebrow}>Error</p>
      <h1 className={styles.h1}>Something went wrong.</h1>
      <p className={styles.lede}>
        We&apos;ve been notified and are looking into it. Please try again
        in a moment — most blips are transient.
      </p>

      <div className={styles.refCard} aria-label="Error reference code">
        <span className={styles.refLabel}>Reference</span>
        <code className={styles.refCode}>{errId}</code>
        <button
          type="button"
          onClick={async () => {
            if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) return
            try {
              await navigator.clipboard.writeText(errId)
              setCopied(true)
              // Reset the "Copied" label after a short delay.
              window.setTimeout(() => setCopied(false), 1600)
            } catch {
              // Clipboard write can fail (insecure context, permission
              // denied). Silently fall through — the user can still
              // select-and-copy the code from the page.
            }
          }}
          aria-label="Copy reference"
          className={copied ? styles.refCopied : styles.refCopy}
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>

      <div className={styles.actions}>
        <Button onClick={() => reset()}>Try again</Button>
        <Link href="/" aria-label="Go to the homepage">
          <Button variant="secondary">Go home</Button>
        </Link>
        <a
          href={`mailto:support@uthena.com?subject=${subject}`}
          aria-label="Email support with this error reference"
        >
          <Button variant="secondary">Contact support</Button>
        </a>
      </div>

      <p className={styles.foot}>
        Your data is safe. We never display account details on this page.
        The reference above is the only piece of context you can share
        with support.
      </p>
    </main>
  )
}