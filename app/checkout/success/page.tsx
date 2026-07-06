// /checkout/success — the post-payment landing page. RSC. Reads the
// order + grant count and renders the confirmation card. Includes the
// PollLibraryReady client island for the "Library ready" flip.

import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getSessionUser } from '@foundations/auth/guards'
import { getOrderForConfirmation, OrderSummary, PollLibraryReady } from '@features/checkout'
import { sensitivePageMetadata } from '@foundations/metadata'
import styles from './success.module.css'

// P0.21 — `noindex` so the order-confirmed surface isn't indexed.
// (Order IDs in the URL would leak the buyer's purchase history.)
export const metadata: Metadata = sensitivePageMetadata({
  title: 'Order confirmed',
  description: 'Your Uthena order is confirmed. Your library is being prepared.',
  path: '/checkout/success',
})
export const dynamic = 'force-dynamic'

type Search = Promise<{ order?: string | string[] }>

export default async function CheckoutSuccessPage({ searchParams }: { searchParams: Search }) {
  const user = await getSessionUser()
  if (!user) {
    const sp = await searchParams
    const orderId = parseOrderId(sp.order)
    const next = orderId
      ? `/login?next=${encodeURIComponent(`/checkout/success?order=${orderId}`)}`
      : '/login?next=/checkout/success'
    redirect(next)
  }

  const sp = await searchParams
  const orderId = parseOrderId(sp.order)
  if (!orderId) {
    return <OrderNotFound />
  }

  const order = await getOrderForConfirmation(orderId)
  if (!order) {
    // Order not found OR not owned by this user. Don't leak existence.
    redirect('/account/orders')
  }

  return (
    <main id="main" className={styles.page}>
      <div className={styles.checkmark} aria-hidden>
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      </div>
      <h1 className={styles.h1}>Thanks for your order!</h1>
      <p className={styles.sub}>
        Order #{order.id} confirmed · We sent a receipt to{' '}
        <strong className={styles.email}>{order.email}</strong>
      </p>
      <div className={styles.statusRow}>
        <PollLibraryReady orderId={order.id} initialGrantCount={order.grant_count} />
      </div>

      <div className={styles.layout}>
        <OrderSummary order={order} />
        <div className={styles.actions}>
          <Link href="/library" className={styles.primaryCta}>
            Go to your library →
          </Link>
          <Link href="/browse" className={styles.secondaryCta}>
            Browse more
          </Link>
          <a
            href={`/account/orders/${order.id}`}
            className={styles.tertiaryCta}
          >
            View order details
          </a>
        </div>
      </div>
    </main>
  )
}

function parseOrderId(raw: string | string[] | undefined): number | null {
  if (!raw) return null
  const v = Array.isArray(raw) ? raw[0] : raw
  const n = Number(v)
  return Number.isInteger(n) && n > 0 ? n : null
}

function OrderNotFound() {
  return (
    <main id="main" className={styles.page}>
      <h1 className={styles.h1}>We can&apos;t find that order</h1>
      <p className={styles.sub}>
        The link you followed is missing an order id, or the order is no longer available.
      </p>
      <div className={styles.actions}>
        <Link href="/account/orders" className={styles.primaryCta}>
          Go to your orders
        </Link>
        <Link href="/browse" className={styles.secondaryCta}>
          Browse catalog
        </Link>
      </div>
    </main>
  )
}
