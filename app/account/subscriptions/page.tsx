// /account/subscriptions — self-service subscription management.
// RSC. Branches on three states: anon → /login, no row → start card,
// has row → status card + invoices.

import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getSessionUser } from '@foundations/auth/guards'
import {
  getCurrentSubscription,
  getRecentInvoices,
  SubscriptionStatusCard,
  StartSubscriptionCard,
  RecentInvoices,
  PastDueBanner,
  PLAN_NAME,
} from '@features/subscriptions'
import { isStripeConfigured } from '@foundations/money/stripe'
import { getEnv } from '@foundations/env'
import { sensitivePageMetadata } from '@foundations/metadata'
import styles from './page.module.css'

// P0.21 — `noindex` so the subscriptions surface isn't indexed.
export const metadata: Metadata = sensitivePageMetadata({
  title: 'Subscription',
  description: 'Your Uthena subscription status and invoices.',
  path: '/account/subscriptions',
})
export const dynamic = 'force-dynamic'

export default async function SubscriptionsPage({
  searchParams,
}: {
  searchParams: Promise<{ welcome?: string; canceled?: string }>
}) {
  const user = await getSessionUser()
  if (!user) redirect('/login?next=/account/subscriptions')
  const sp = await searchParams
  const sub = await getCurrentSubscription()
  const invoices = await getRecentInvoices()
  const env = getEnv()
  const stripeReady = isStripeConfigured()
  const priceConfigured = Boolean(env.STRIPE_PRICE_PERSONAL_ACCESS_MONTHLY)

  return (
    <main id="main" className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.h1}>Subscription</h1>
        <p className={styles.sub}>{PLAN_NAME} — $19/month</p>
      </header>

      {sp.welcome === '1' && (
        <div role="status" className={styles.bannerSuccess}>
          <strong>Welcome to {PLAN_NAME}.</strong> Your discount is active on every PLR order.
        </div>
      )}
      {sp.canceled === '1' && (
        <div role="status" className={styles.bannerMute}>
          Checkout canceled. You can start a subscription anytime.
        </div>
      )}

      {sub?.status === 'past_due' && <PastDueBanner />}

      <div className={styles.layout}>
        {sub ? (
          <SubscriptionStatusCard sub={sub} />
        ) : (
          <StartSubscriptionCard stripeReady={stripeReady} priceConfigured={priceConfigured} />
        )}
        <RecentInvoices invoices={invoices} />
      </div>
    </main>
  )
}
