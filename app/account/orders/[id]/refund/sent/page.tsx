// /account/orders/[id]/refund/sent — confirmation page. RSC.
//
// The user lands here after `createRefundRequestAction` returns ok.
// The form redirects to `/account/orders/[id]/refund/sent?refundId=<id>`
// and the page reads the refund row (RLS-gated via
// `getRefundConfirmation`) to display the human-facing reference
// number, the 2-business-day response window, and the 3-step
// "what happens next" explainer.
//
// Layout (token-only, no inline colors — see `sent.module.css`):
//   ┌─────────────────────────────────────────────┐
//   │ [✓] Refund request submitted                 │
//   │ Reference: R-12345                          │
//   │                                             │
//   │ We'll respond within 2 business days. …    │
//   │                                             │
//   │ What happens next                           │
//   │   1. We review your request.                │
//   │   2. We email you with a decision.          │
//   │   3. If approved, money is back in 5–10 BD. │
//   │                                             │
//   │ [Back to order] [Back to all orders]        │
//   └─────────────────────────────────────────────┘
//
// Edge cases:
//   - Anon → requireUser redirects to /login?next=…
//   - Bad orderId or refundId in URL → 404 (notFound)
//   - Order is owned by another user (RLS hides the row) → 404
//   - Refund was created by another user (explicit `requested_by`
//     predicate) → 404

import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireUser } from '@foundations/auth/guards'
import {
  formatRefundReference,
  parseOrderId,
  parseRefundId,
} from '@features/account/profile/lib/formatRefundUrlParams'
import { getRefundConfirmation } from '@features/account/profile/queries/getRefundConfirmation'
import { sensitivePageMetadata } from '@foundations/metadata'
import styles from './sent.module.css'

// P0.21 — `noindex` so the refund-confirmation surface isn't indexed.
export const metadata: Metadata = sensitivePageMetadata({
  title: 'Refund request submitted',
  description: 'Your Uthena refund request was submitted.',
  path: '/account/orders/[id]/refund/sent',
})

type Props = {
  params: Promise<{ id: string }>
  searchParams: Promise<{ refundId?: string }>
}

export default async function AccountRefundSentPage({ params, searchParams }: Props) {
  const user = await requireUser('/account/orders')
  const { id } = await params
  const { refundId } = await searchParams

  const orderId = parseOrderId(id)
  const refundIdNum = parseRefundId(refundId)
  if (orderId === null || refundIdNum === null) notFound()

  const refund = await getRefundConfirmation({ orderId, refundId: refundIdNum })
  if (!refund) notFound()

  return (
    <div className={styles.wrap}>
      <div className={styles.iconRow}>
        <span className={styles.checkmark} aria-hidden>
          ✓
        </span>
        <h1 className={styles.h1}>Refund request submitted</h1>
      </div>
      <p className={styles.lede}>
        Reference: <span className={styles.ref}>{formatRefundReference(refund.id)}</span>
      </p>
      <p className={styles.body}>
        We&apos;ll respond within 2 business days. You&apos;ll get an email at{' '}
        <strong>{user.email}</strong> when we decide.
      </p>

      <section className={styles.next}>
        <h2 className={styles.h2}>What happens next</h2>
        <ol className={styles.steps}>
          <li>
            <strong>We review your request.</strong> An admin reads the reason and any
            supporting notes.
          </li>
          <li>
            <strong>We email you with a decision.</strong> Approved, partially approved, or
            declined — with a one-line explanation.
          </li>
          <li>
            <strong>If approved, the money is back on your card in 5–10 business days.</strong>{' '}
            Your original payment method is refunded automatically.
          </li>
        </ol>
      </section>

      <div className={styles.actions}>
        <Link href={`/account/orders/${orderId}`} className={styles.primaryLink}>
          Back to order
        </Link>
        <Link href="/account/orders" className={styles.secondaryLink}>
          Back to all orders
        </Link>
      </div>
    </div>
  )
}
