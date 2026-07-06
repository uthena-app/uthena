// /pricing — public marketing landing page for the Personal Access
// subscription tier (P5.1). RSC + ISR 300s. Composes:
//   - Hero (eyebrow + H1 + lede + price + tagline)
//   - Inline CTA (auth-aware href + label — anon goes to
//     /signup?next=/account/subscriptions; authed goes to
//     /account/subscriptions which calls startSubscriptionAction)
//   - StartSubscriptionCard centerpiece (reuses the existing feature
//     component, which already handles the "Stripe not configured"
//     graceful-degrade notice + disabled CTA)
//   - "What's included" 6-feature grid (from PRICING_FEATURES)
//   - FAQ accordion with 8 questions (from PRICING_FAQ)
//
// The page does NOT call startSubscriptionAction directly — that
// action lives on /account/subscriptions (auth-gated). The CTA is a
// pure `<Link>` to that surface.
//
// No new client islands: the existing StartSubscriptionButton is the
// only client component (already shipped by P5.x prior work). The FAQ
// uses native <details>/<summary> so no accordion JS is added.

import type { Metadata } from 'next'
import Link from 'next/link'
import {
  StartSubscriptionCard,
  PRICING_FEATURES,
  PRICING_FAQ,
  getCurrentSubscription,
} from '@features/subscriptions'
import { getSessionUser } from '@foundations/auth/guards'
import { isStripeConfigured } from '@foundations/money/stripe'
import { getEnv } from '@foundations/env'
import { buildPageMetadata } from '@foundations/metadata'
import styles from './page.module.css'

// P0.21 — indexable marketing surface. Public route, no auth.
export const metadata: Metadata = buildPageMetadata({
  title: 'Personal Access — Uthena Pricing',
  description:
    'Get 15% off every PLR course on Uthena with Personal Access. $19/month. Cancel anytime. Secure Stripe billing.',
  path: '/pricing',
})

export const revalidate = 300

export default async function PricingPage() {
  // Fetch session + subscription in parallel (same pattern as
  // /account/subscriptions). For anon users `getCurrentSubscription()`
  // short-circuits before any DB hit (it requires a session).
  const [user, sub, env] = await Promise.all([
    getSessionUser(),
    getCurrentSubscription(),
    Promise.resolve(getEnv()),
  ])
  const stripeReady = isStripeConfigured()
  const priceConfigured = Boolean(env.STRIPE_PRICE_PERSONAL_ACCESS_MONTHLY)

  // Compute the CTA href + label based on auth + subscription state.
  // - Anon: send through /signup so they get an account first; the
  //   `next` param bounces them back to /account/subscriptions to
  //   start the subscribe flow.
  // - Authed, no sub: send to /account/subscriptions which calls
  //   startSubscriptionAction server-side.
  // - Authed, active sub: same target (the management page shows
  //   the status + cancel CTA — they don't need a fresh "subscribe"
  //   button). The label says "Manage subscription" so they know.
  const ctaDisabled = !stripeReady || !priceConfigured
  const ctaHref = user
    ? '/account/subscriptions'
    : '/signup?next=/account/subscriptions'
  const ctaLabel = sub ? 'Manage subscription' : user ? 'Subscribe' : 'Sign up & subscribe'

  return (
    <main id="main" className={styles.page}>
      {/* ---- Hero ---- */}
      <section className={styles.hero} aria-labelledby="pricing-h1">
        <p className={styles.heroEyebrow}>Subscription</p>
        <h1 id="pricing-h1" className={styles.heroH1}>
          Personal Access
        </h1>
        <p className={styles.heroLede}>
          A monthly subscription that gives you an automatic 15% discount on every PLR
          course you buy on Uthena. Works across the full catalog. Cancel anytime.
        </p>
        <p className={styles.heroPrice}>
          $19<span className={styles.heroPer}>/month</span>
        </p>
        <p className={styles.heroTagline}>
          {priceConfigured
            ? 'Billed monthly via Stripe. Cancel from /account/subscriptions in two clicks.'
            : 'Pricing not configured in this environment.'}
        </p>
      </section>

      {/* ---- Inline CTA above the card ---- */}
      <div className={styles.ctaWrap}>
        {ctaDisabled ? (
          <span
            className={`${styles.cta} ${styles.ctaDisabled}`}
            aria-disabled="true"
            role="link"
          >
            {ctaLabel}
          </span>
        ) : (
          <Link href={ctaHref} className={styles.cta}>
            {ctaLabel}
          </Link>
        )}
        <Link href="/browse" className={styles.ctaSecondary}>
          Or browse the catalog first →
        </Link>
      </div>

      {/* ---- Card centerpiece (reused feature component) ---- */}
      <div className={styles.cardSlot}>
        <StartSubscriptionCard stripeReady={stripeReady} priceConfigured={priceConfigured} />
      </div>

      {/* ---- What's included ---- */}
      <section className={styles.features} aria-labelledby="pricing-features-h">
        <div className={styles.featuresHead}>
          <p className={styles.featuresEyebrow}>What you get</p>
          <h2 id="pricing-features-h" className={styles.featuresH2}>
            What's included
          </h2>
        </div>
        <div className={styles.featuresGrid}>
          {PRICING_FEATURES.map((feat) => (
            <article key={feat.title} className={styles.feature}>
              <h3 className={styles.featureTitle}>{feat.title}</h3>
              <p className={styles.featureBody}>{feat.body}</p>
            </article>
          ))}
        </div>
      </section>

      {/* ---- FAQ ---- */}
      <section className={styles.faq} aria-labelledby="pricing-faq-h">
        <div className={styles.faqHead}>
          <p className={styles.faqEyebrow}>Questions</p>
          <h2 id="pricing-faq-h" className={styles.faqH2}>
            Frequently asked
          </h2>
        </div>
        <div className={styles.faqList}>
          {PRICING_FAQ.map((item, i) => (
            <details key={item.q} className={styles.faqRow} open={i === 0}>
              <summary className={styles.faqSummary}>
                <span>{item.q}</span>
                <span className={styles.faqMarker} aria-hidden="true" />
              </summary>
              <p className={styles.faqAnswer}>{item.a}</p>
            </details>
          ))}
        </div>
      </section>
    </main>
  )
}