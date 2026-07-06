'use client'

// InvoiceDownloadButton — client island. The actual navigation
// target is Stripe's hosted invoice URL (per STUB-051 resolution:
// link, do not regenerate). On click we (a) log the audit row via
// the `logInvoiceDownloadAction` server action so the admin queue
// has visibility, then (b) navigate in a new tab with
// `rel="noopener noreferrer"` so the user's primary tab stays on
// the order page.
//
// Three render states:
//   1. hostedInvoice !== null  → "View invoice" link (primary CTA)
//   2. Stripe not configured / lookup failed (no hostedInvoice) →
//      hidden entirely (the page already shows an empty state — we
//      do not render a disabled "Coming soon" button, AGENTS.md /
//      QWEN.md forbid placeholders).
//   3. Error path: server action rejects with rate_limited →
//      we surface an inline `role="alert"` message; user can retry.

import { useState, useTransition } from 'react'
import { logInvoiceDownloadAction } from '../actions/logInvoiceDownload'
import type { HostedInvoice } from '../queries/getHostedInvoiceForOrder'
import styles from './InvoiceDownloadButton.module.css'

export function InvoiceDownloadButton({
  orderId,
  hostedInvoice,
}: {
  orderId: number
  hostedInvoice: HostedInvoice | null
}) {
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  if (!hostedInvoice) {
    // No Stripe invoice available yet — we deliberately render nothing
    // (no disabled placeholder). The page-level "Payment" section
    // already explains that card brand/last4 surface once Stripe
    // populates the snapshot; the invoice is part of the same story.
    return null
  }

  const handleClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    // The audit row is fire-and-forget — we don't block the
    // navigation if the audit write fails (Stripe is the
    // authoritative invoice access log; ours is supplemental).
    e.preventDefault()
    setError(null)
    const href = hostedInvoice.hostedInvoiceUrl
    startTransition(async () => {
      const result = await logInvoiceDownloadAction({
        orderId,
        invoiceId: hostedInvoice.invoiceId,
      })
      if (!result.ok) {
        if (result.error === 'rate_limited') {
          setError('Too many invoice downloads. Try again in a few minutes.')
        } else if (result.error === 'not_authenticated') {
          setError('You need to sign in to download the invoice.')
        } else {
          setError('Could not record the download. The invoice will still open.')
        }
        // Open the invoice even if audit failed — Stripe is the
        // canonical log; refusing the user would be worse than
        // missing a supplemental audit row.
      }
      window.open(href, '_blank', 'noopener,noreferrer')
    })
  }

  return (
    <span className={styles.wrap}>
      <a
        href={hostedInvoice.hostedInvoiceUrl}
        onClick={handleClick}
        className={`${styles.btn} ${styles.btnPrimary} ${isPending ? styles.btnLoading : ''}`}
        target="_blank"
        rel="noopener noreferrer"
        aria-busy={isPending || undefined}
      >
        {hostedInvoice.invoiceNumber
          ? `View invoice ${hostedInvoice.invoiceNumber}`
          : 'View invoice'}
      </a>
      {error && (
        <span role="alert" className={styles.error}>
          {error}
        </span>
      )}
    </span>
  )
}