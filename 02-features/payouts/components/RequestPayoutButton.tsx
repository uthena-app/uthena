// RequestPayoutButton.tsx — client island for /partner/payouts.
//
// P6.6 — explicit "Request payout" action. The button renders in
// three states driven by the props the page passes from the server:
//
//   1. **Idle / ready** — no pending request + available balance ≥
//      MIN_PAYOUT_REQUEST_CENTS. Click → calls requestPayoutAction,
//      shows the success state on resolve.
//
//   2. **Pending already exists** — the partner has a pending
//      payout request. The button is disabled + the banner shows
//      "You already have a pending payout request for $X.00 — wait
//      for it to be processed before requesting another."
//
//   3. **Below minimum** — available balance < MIN_PAYOUT_REQUEST_CENTS.
//      The button is disabled + the banner shows the friendly copy
//      from the action's `below_minimum` error code.
//
//   4. **No balance** — available balance is 0 (or negative). The
//      button is disabled + the banner shows "You have no available
//      balance to pay out."
//
// The page does the server-side reads (available balance +
// pending request). The button is a pure client island that
// renders the button + banner + handles the action call + the
// success state.
//
// On success, the button shows a "Request submitted — redirecting…"
// message and reloads the page after 1.5s (so the page re-reads the
// pending request + the now-zero available balance + the new
// status='pending_payout' ledger rows).
//
// On error, the action's error string renders inline in a
// `role="alert"` block. We do NOT use toast notifications — the
// `role="alert"` affordance is enough for v1 and matches the
// existing ExportCsvButton pattern.

'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { requestPayoutAction } from '../actions/requestPayout'
import { MIN_PAYOUT_REQUEST_CENTS } from '../request-options'
import styles from './RequestPayoutButton.module.css'

type Props = {
  /** The partner's available balance in cents (from the P6.3
   *  summary read). */
  availableCents: number
  /** The partner's most-recent pending request, if any. The page
   *  resolves this via `getPendingPayoutRequest()`. */
  pendingRequest: {
    id: number
    amountCents: number
    currency: string
    maskedPaypal: string
    createdAt: string
  } | null
}

function formatDollars(cents: number, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100)
}

export function RequestPayoutButton({ availableCents, pendingRequest }: Props) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  // Resolve state — the page pre-reads everything; the button just
  // decides which message + which disabled-ness to render. No
  // double-reads in the browser.
  const minDollars = MIN_PAYOUT_REQUEST_CENTS / 100
  const availableDollars = availableCents / 100
  const hasPending = pendingRequest !== null
  const noBalance = availableCents <= 0
  const belowMinimum = !noBalance && availableCents < MIN_PAYOUT_REQUEST_CENTS
  const canRequest = !hasPending && !noBalance && !belowMinimum

  function onClick() {
    setError(null)
    setSuccess(null)
    startTransition(async () => {
      const res = await requestPayoutAction()
      if (!res.ok) {
        setError(res.error)
        return
      }
      setSuccess(
        `Request #${res.requestId} submitted for ${formatDollars(res.amountCents, res.currency)}. Refreshing…`,
      )
      // Refresh the page after a beat so the partner sees the
      // "pending" banner (the server re-reads the new pending row +
      // the now-zero available balance + the flipped pending_payout
      // ledger rows). Use router.refresh() rather than location.reload
      // so Next.js can keep the RSC payload warm + avoid a full
      // page reload.
      setTimeout(() => router.refresh(), 1500)
    })
  }

  // Pending state — banner only, button hidden. The partner can't
  // request a 2nd payout until the first one is approved/denied.
  if (hasPending && pendingRequest) {
    return (
      <div className={styles.wrap}>
        <div className={styles.banner} role="status" data-state="pending">
          <p className={styles.bannerTitle}>Pending payout request</p>
          <p className={styles.bannerBody}>
            You already have a pending payout request for{' '}
            <strong>{formatDollars(pendingRequest.amountCents, pendingRequest.currency)}</strong>{' '}
            to <strong>{pendingRequest.maskedPaypal}</strong>. You&apos;ll get an email when it&apos;s
            processed.
          </p>
        </div>
      </div>
    )
  }

  // Below minimum state — banner with the threshold + a disabled
  // button (so the partner sees the affordance + the reason).
  if (belowMinimum) {
    return (
      <div className={styles.wrap}>
        <button
          type="button"
          className={styles.button}
          disabled
          aria-label={`Request payout (available balance below $${minDollars.toFixed(2)} minimum)`}
        >
          Request payout
        </button>
        <div className={styles.banner} role="status" data-state="below">
          <p className={styles.bannerBody}>
            Your available balance ({formatDollars(availableCents)}) is below the $
            {minDollars.toFixed(2)} minimum for a payout request. Earnings will move from{' '}
            <strong>locked</strong> to <strong>available</strong> as the 14-day refund window
            closes.
          </p>
        </div>
      </div>
    )
  }

  // No balance state — only show a muted banner + no button. The
  // partner hasn't earned anything yet; we don't want a button that
  // does nothing.
  if (noBalance) {
    return (
      <div className={styles.wrap}>
        <div className={styles.banner} role="status" data-state="empty">
          <p className={styles.bannerBody}>
            No available balance to pay out. Earnings will appear here as the 14-day refund
            window closes.
          </p>
        </div>
      </div>
    )
  }

  // Ready state — enabled button. The success / error messages render
  // below.
  return (
    <div className={styles.wrap}>
      <button
        type="button"
        className={styles.button}
        onClick={onClick}
        disabled={isPending || !canRequest}
        aria-label={`Request payout for ${formatDollars(availableCents)}`}
      >
        {isPending ? 'Submitting…' : `Request payout — ${formatDollars(availableCents)}`}
      </button>
      {success && (
        <p className={styles.success} role="status">
          {success}
        </p>
      )}
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
    </div>
  )
}