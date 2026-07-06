// PastDueRetryButton.tsx — client island that opens the Stripe
// Billing Portal so the user can update their payment method.
//
// Reuses `openBillingPortalAction` (the same action ManageInStripeButton
// uses) so there's exactly one place that knows how to mint a portal
// session. The button stays disabled while the action is in flight and
// alerts on failure (mirroring ManageInStripeButton's error UX).

'use client'

import { useTransition } from 'react'
import { openBillingPortalAction } from '../actions/openBillingPortal'
import styles from './PastDueRetryButton.module.css'

export function PastDueRetryButton() {
  const [isPending, startTransition] = useTransition()
  function onClick() {
    startTransition(async () => {
      const res = await openBillingPortalAction({})
      if (!res.ok) {
        alert(res.error)
        return
      }
      window.location.href = res.url
    })
  }
  return (
    <button type="button" onClick={onClick} disabled={isPending} className={styles.button}>
      {isPending ? 'Opening…' : 'Update payment method'}
    </button>
  )
}
