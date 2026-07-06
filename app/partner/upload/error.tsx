'use client'

// /partner/upload — error boundary (P12.7 Slice 1).
//
// Renders when the page's RSC throws. Per Next.js convention, error
// boundaries MUST be a client component (`'use client'`). We log only
// `error.digest` — never the raw message (PII risk + info-leak risk).

import { useEffect } from 'react'
import { Button } from '@foundations/ui/primitives/Button'
import styles from './upload.module.css'

export default function PartnerUploadError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // Server-side errors carry a `digest` (the on-server hash); we
    // log the digest only. The raw message is never logged.
    console.error(`[partner-upload] error.digest=${error.digest ?? 'unknown'}`)
  }, [error])

  return (
    <main className={styles.page}>
      <div className={styles.header}>
        <p className={styles.eyebrow}>Partner upload</p>
        <h1 className={styles.title}>Something went wrong</h1>
        <p className={styles.lede}>
          We couldn&apos;t load the upload wizard. Please try again — your draft is safe on our
          end.
        </p>
        <div>
          <Button type="button" variant="primary" size="md" onClick={reset}>
            Try again
          </Button>
        </div>
        {error.digest && (
          <p className={styles.meta}>
            Reference: <code>{error.digest}</code>
          </p>
        )}
      </div>
    </main>
  )
}
