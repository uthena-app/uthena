// RouteError — shared client component used by every per-route
// error.tsx (app/account/error.tsx, app/admin/error.tsx, ...).
//
// Why a shared component (per DRY + the constitution's "code elegant"):
//   - Every per-route error.tsx has the same shape: warn glyph +
//     headline + lede + ERR-{id} card + Try again + Go home + optional
//     mailto + optional "contextual helper text"
//   - The only thing that varies is the surface tag (for Sentry), the
//     headline ("Something went wrong loading your library" vs "loading
//     your account"), and an optional helper text that explains the
//     route context ("Your library will be available as soon as we're
//     back up" vs "Your account data is intact")
//   - The Sentry capture call is centralized here so the call-site
//     contract is one place to audit (PII-safe payload, same as
//     app/error.tsx + app/global-error.tsx)
//
// 'use client' because Next.js's error.tsx requires it (reset() is
// only available on the client runtime). The component is a leaf —
// no children, no further interactivity beyond Try again / Go home /
// mailto / copy-reference.

'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { Button } from '@foundations/ui/primitives/Button'
import { makeErrorReference, WarnGlyph } from '@foundations/ui/error'
import { reportError } from '@foundations/observability/client-report'
import styles from './RouteError.module.css'

export type RouteErrorConfig = {
  /** Sentry surface tag (e.g. `'app.account.error'`). Becomes a tag
   *  on the structured event so support can filter by surface. */
  surface: string
  /** Headline shown above the lede. Defaults to "Something went wrong." */
  headline?: string
  /** Lede paragraph below the headline. Defaults to the generic
   *  "We've been notified..." copy. */
  lede?: string
  /** Optional helper paragraph rendered below the action group —
   *  used by routes that want to explain the route context ("Your
   *  library data is safe — we'll be back shortly" vs the generic
   *  "Your data is safe"). */
  helperText?: string
  /** Where "Go home" links to. Defaults to `/`. */
  homeHref?: string
  /** Whether to render the "Contact support" mailto (the route-level
   *  500 boundary always shows it; per-route boundaries can opt out
   *  if the route context doesn't make a support ticket useful). */
  showSupportMailto?: boolean
}

export function RouteError({
  error,
  reset,
  config,
}: {
  error: Error & { digest?: string }
  reset: () => void
  config: RouteErrorConfig
}) {
  const [errId] = useState(makeErrorReference)
  const [copied, setCopied] = useState(false)
  const subject = encodeURIComponent(`Error ${errId}`)
  const showMailto = config.showSupportMailto !== false

  useEffect(() => {
    // Client-safe wrapper — POSTs to /api/errors/report, which calls
    // the server-only captureError seam. The seam writes the
    // structured event to pino (PII-safe: error.name + errId only);
    // the SDK init lands in PH18.
    reportError(error, { surface: config.surface, errId })
  }, [errId, error, config.surface])

  return (
    <main id="main" className={styles.wrap} role="alert">
      <div className={styles.iconWrap} aria-hidden="true">
        <WarnGlyph />
      </div>
      <p className={styles.eyebrow}>Error</p>
      <h1 className={styles.h1}>{config.headline ?? 'Something went wrong.'}</h1>
      <p className={styles.lede}>
        {config.lede ??
          "We've been notified and are looking into it. Please try again in a moment — most blips are transient."}
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
              window.setTimeout(() => setCopied(false), 1600)
            } catch {
              // Clipboard failed — user can still select-and-copy.
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
        <Link href={config.homeHref ?? '/'} aria-label="Go to the homepage">
          <Button variant="secondary">Go home</Button>
        </Link>
        {showMailto && (
          <a
            href={`mailto:support@uthena.com?subject=${subject}`}
            aria-label="Email support with this error reference"
          >
            <Button variant="secondary">Contact support</Button>
          </a>
        )}
      </div>

      {config.helperText && <p className={styles.helperText}>{config.helperText}</p>}
    </main>
  )
}