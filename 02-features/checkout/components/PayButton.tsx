// PayButton.tsx — client form for /checkout. Submits the
// create-checkout server action; on success, follows the returned
// Stripe URL via window.location. On error, displays the message
// inline. Replaces the legacy inline-styled PayButton that lived in
// /app/checkout/ — now lives in the checkout feature module so the
// wizard step (ReviewStep) and the page route both share one source
// of truth, and the styles are token-only (per the AGENTS.md "no
// inline colors" rule).

'use client'

import { useState, useTransition } from 'react'
import { createCheckoutSessionAction } from '@features/checkout/actions/createCheckoutSession'
import styles from './PayButton.module.css'

export function PayButton({ disabled, email }: { disabled?: boolean; email: string }) {
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    startTransition(async () => {
      const res = await createCheckoutSessionAction({})
      if (!res.ok) {
        setError(res.error)
        return
      }
      window.location.href = res.url
    })
  }

  return (
    <form onSubmit={onSubmit}>
      {error && (
        <div role="alert" className={styles.error}>
          {error}
        </div>
      )}
      <button
        type="submit"
        disabled={disabled || isPending}
        className={styles.pay}
        aria-busy={isPending || undefined}
      >
        {isPending ? 'Redirecting to Stripe…' : 'Pay with Stripe'}
      </button>
      <p className={styles.helper}>
        You will be redirected to Stripe to enter your card details. Receipt will be sent to{' '}
        <strong className={styles.email}>{email || '(your account email)'}</strong>.
      </p>
    </form>
  )
}