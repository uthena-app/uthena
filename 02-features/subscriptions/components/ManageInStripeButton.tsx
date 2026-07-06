// ManageInStripeButton.tsx — opens the Stripe Billing Portal.
//
// `openBillingPortalAction` mints a short-lived (~5 min) portal session
// URL; we redirect to it. The portal itself is the canonical UI for
// updating payment method, viewing the full invoice history, and (if
// Stripe is configured for it) updating billing address.
//
// Fail-soft: if Stripe is not configured or the user has no Stripe
// Customer row (no billing record), the action returns a typed error
// and we surface it via `alert()` — same UX as `PastDueRetryButton`
// (which uses the same action). No client JS for the redirect; a
// plain `window.location.href` is the simplest correct path.

'use client'

import { useTransition } from 'react'
import { openBillingPortalAction } from '../actions/openBillingPortal'
import styles from './ManageInStripeButton.module.css'

export function ManageInStripeButton() {
  const [isPending, startTransition] = useTransition()
  function onClick() {
    startTransition(async () => {
      const res = await openBillingPortalAction({})
      if (!res.ok) { alert(res.error); return }
      window.location.href = res.url
    })
  }
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={isPending}
      className={styles.button}
      aria-label="Manage subscription in Stripe"
    >
      {isPending ? 'Opening…' : 'Manage in Stripe'}
    </button>
  )
}
