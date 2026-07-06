// CartSummary.tsx — sticky sidebar on /cart with subtotal, CTA,
// optional coupon, and the trust strip. Server component — no JS.

import Link from 'next/link'
import { formatMoney } from '@foundations/money/cents'
import { ClearCartButton } from './ClearCartButton'
import { CouponForm } from './CouponForm'
import styles from './CartSummary.module.css'

export function CartSummary({
  subtotalCents,
  itemCount,
  isAuthed,
}: {
  subtotalCents: number
  itemCount: number
  isAuthed: boolean
}) {
  const checkoutHref = isAuthed ? '/checkout' : `/login?next=${encodeURIComponent('/checkout')}`
  return (
    <aside className={styles.wrap} aria-label="Order summary">
      <h2 className={styles.h2}>Order summary</h2>
      <dl className={styles.list}>
        <div className={styles.row}>
          <dt>Items</dt>
          <dd className={styles.num}>{itemCount}</dd>
        </div>
        <div className={styles.row}>
          <dt>Subtotal</dt>
          <dd className={styles.num}>{formatMoney(subtotalCents, 'USD')}</dd>
        </div>
        <div className={styles.row}>
          <dt>Tax</dt>
          <dd className={styles.muted}>Calculated at checkout</dd>
        </div>
      </dl>
      <CouponForm />
      <Link href={checkoutHref} className={styles.cta}>
        Continue to checkout
      </Link>
      <a href="/browse" className={styles.secondaryLink}>
        Continue shopping
      </a>
      <ClearCartButton />
      <ul className={styles.trust}>
        <li>14-day return rights</li>
        <li>Secure checkout (Stripe)</li>
        <li>Instant download after payment</li>
      </ul>
    </aside>
  )
}
