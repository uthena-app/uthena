// app/global-error.tsx — root-layout crash boundary.
//
// Renders when an unrecoverable error fires from the root layout itself,
// the root error boundary (app/error.tsx), or a server component so deep
// in the tree that the entire request fails. REPLACES the root layout —
// SiteHeader, SiteFooter, SearchOverlay, MobileNav, the global
// Organization JSON-LD, and the analytics tags are all GONE. This page
// must be self-contained.
//
// Per error-global.md §Security: must include its own <html> + <body>
// tags (the root layout is gone), and MUST NOT leak any error details
// to the user. The only context the user sees is the opaque ERR-{id}.
// No Sentry client-side error reporting (the SDK is gone with the root
// layout; PH18 wires the browser SDK + global handler which will pick
// up the same unhandled exception from the client side).
//
// Per error-global.md §Security: "Audit logged: the upstream error is
// logged to Sentry (when the SDK is available — root layout crash may
// prevent this). This page itself emits no logs." This page therefore
// does NOT call the `captureError` seam — the seam is server-only (it
// pulls in pino + zod which the browser can't load) and this page is
// rendered without the root layout, so any server-side capture would
// race with the layout crash anyway.
//
// HTTP status: 500. Next.js sets this automatically when this boundary
// renders.
//
// 'use client' is required by Next.js for global-error.tsx (reset() is
// only available on the client runtime).

'use client'

import Link from 'next/link'
import { useState } from 'react'
import { makeErrorReference, WarnGlyph } from '@foundations/ui/error'
import styles from './global-error.module.css'

export default function GlobalError({
  reset,
}: {
  // The `error` prop is typed but intentionally unused here. It's typed
  // in Next.js's signature so the boundary matches the expected shape;
  // we don't log or surface it (per the PII-safety contract).
  error: Error & { digest?: string }
  reset: () => void
}) {
  // Same ID-once-per-mount pattern as app/error.tsx.
  const [errId] = useState(makeErrorReference)

  return (
    <html lang="en" className={styles.doc}>
      <body className={styles.doc}>
        <main className={styles.wrap} role="alert">
          <div className={styles.iconWrap} aria-hidden="true">
            <WarnGlyph />
          </div>
          <p className={styles.eyebrow}>Error</p>
          <h1 className={styles.h1}>Something went wrong.</h1>
          <p className={styles.lede}>
            The page failed to load. Please try again, or head back home
            and start fresh.
          </p>

          <div className={styles.refCard} aria-label="Error reference code">
            <span className={styles.refLabel}>Reference</span>
            <code className={styles.refCode}>{errId}</code>
          </div>

          <div className={styles.actions}>
            <button type="button" onClick={() => reset()} className={styles.btnPrimary}>
              Try again
            </button>
            <Link href="/" className={styles.btnSecondary} aria-label="Go to the homepage">
              Go home
            </Link>
          </div>

          <p className={styles.foot}>
            Share this reference with support if the problem persists.
            Your data is safe — we never display account details here.
          </p>
        </main>
      </body>
    </html>
  )
}