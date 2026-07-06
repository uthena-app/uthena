// /checkout/canceled — friendly "you bailed out" landing. RSC.
// Shows the auth/anon cart preview per spec.

import type { Metadata } from 'next'
import Link from 'next/link'
import { getSessionUser } from '@foundations/auth/guards'
import { getCart, getCartSubtotalCents, LICENSE_LABELS } from '@features/cart'
import { formatMoney } from '@foundations/money/cents'
import { sensitivePageMetadata } from '@foundations/metadata'
import styles from './canceled.module.css'

// P0.21 — `noindex` so the canceled-checkout surface isn't indexed.
export const metadata: Metadata = sensitivePageMetadata({
  title: 'Payment canceled',
  description: 'Your Uthena checkout was canceled. Your cart is saved — try again anytime.',
  path: '/checkout/canceled',
})
export const dynamic = 'force-dynamic'

type Search = Promise<{ reason?: string | string[] }>

const REASON_LINES: Record<string, string> = {
  user_canceled: 'You canceled at Stripe. You can try again anytime.',
  expired: 'Your checkout session expired before you completed payment. You can start a new one.',
  failed: 'The payment attempt failed. You can try a different payment method.',
}

export default async function CheckoutCanceledPage({ searchParams }: { searchParams: Search }) {
  const sp = await searchParams
  const reasonRaw = Array.isArray(sp.reason) ? sp.reason[0] : sp.reason
  const reasonLine = reasonRaw ? REASON_LINES[reasonRaw] : null

  const user = await getSessionUser()
  const checkoutHref = user
    ? '/checkout'
    : `/signup?next=${encodeURIComponent('/checkout')}`

  const lines = user ? await getCart() : []
  const subtotal = user ? await getCartSubtotalCents() : 0
  const visibleLines = lines.slice(0, 3)
  const hiddenCount = lines.length - visibleLines.length

  return (
    <main id="main" className={styles.page}>
      <div className={styles.icon} aria-hidden>
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </div>
      <h1 className={styles.h1}>Payment canceled</h1>
      <p className={styles.sub}>No charge was made. Your cart is still saved.</p>
      {reasonLine && <p className={styles.reason}>{reasonLine}</p>}

      {!user ? (
        <div className={styles.signinCard}>
          <p>Sign in to save your cart and continue.</p>
          <div className={styles.actions}>
            <Link href={`/login?next=${encodeURIComponent('/cart')}`} className={styles.primaryCta}>
              Sign in
            </Link>
            <Link href={`/signup?next=${encodeURIComponent('/cart')}`} className={styles.secondaryCta}>
              Create account
            </Link>
            <Link href="/browse" className={styles.tertiaryCta}>
              Continue shopping
            </Link>
          </div>
        </div>
      ) : lines.length === 0 ? (
        <div className={styles.emptyCard}>
          <p>Your cart is empty.</p>
          <div className={styles.actions}>
            <Link href="/browse" className={styles.primaryCta}>
              Browse catalog
            </Link>
          </div>
        </div>
      ) : (
        <section className={styles.preview} aria-label="Your cart">
          <h2 className={styles.previewH2}>Your cart</h2>
          <ul className={styles.previewList}>
            {visibleLines.map((line) => (
              <li key={String(line.id)} className={styles.previewItem}>
                {line.thumbnail_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={line.thumbnail_url} alt="" className={styles.previewThumb} />
                ) : (
                  <div className={styles.previewThumbPlaceholder} aria-hidden />
                )}
                <div className={styles.previewBody}>
                  <p className={styles.previewTitle}>{line.title}</p>
                  <p className={styles.previewMeta}>
                    {LICENSE_LABELS[line.license] ?? line.license}
                  </p>
                </div>
                <p className={styles.previewPrice}>{formatMoney(line.unit_price_cents, 'USD')}</p>
              </li>
            ))}
            {hiddenCount > 0 && (
              <li className={styles.previewMore}>+{hiddenCount} more item{hiddenCount === 1 ? '' : 's'}</li>
            )}
          </ul>
          <p className={styles.subtotal}>
            <span>Subtotal</span>
            <span className={styles.subtotalNum}>{formatMoney(subtotal, 'USD')}</span>
          </p>
          <p className={styles.saved}>(items in your cart are saved)</p>
          <div className={styles.actions}>
            <Link href={checkoutHref} className={styles.primaryCta}>
              Back to checkout
            </Link>
            <Link href="/browse" className={styles.secondaryCta}>
              Continue shopping
            </Link>
            <a
              href="mailto:support@uthena.com?subject=Checkout%20canceled%20%E2%80%94%20order%20not%20placed"
              className={styles.tertiaryCta}
            >
              Need help? Email support
            </a>
          </div>
        </section>
      )}
    </main>
  )
}
