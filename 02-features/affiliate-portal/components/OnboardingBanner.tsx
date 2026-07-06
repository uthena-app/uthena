// OnboardingBanner.tsx — P13.3 onboarding callout.
//
// Renders the "you still need to finish X" callout per the spec
// acceptance criterion #2 ("Onboarding banner: (only if
// affiliate.status != 'approved' OR payout method not set)"). The
// callout surfaces the missing step(s) with one CTA each.
//
// Trigger conditions:
//   - status === 'pending'          → "Your application is under
//                                       review" (no CTA — wait for
//                                       admin approval).
//   - status === 'suspended'        → "Your account is suspended"
//                                     (no CTA — contact support).
//   - payoutMethodPresent === false → "Add a payout method so
//                                       you can request payouts"
//                                       (CTA → /affiliate/settings/payout).
//
// We render the banner in priority order: suspended first (most
// severe), then pending, then payout. Multiple banners can stack
// if more than one condition applies.

import Link from 'next/link'
import styles from './OnboardingBanner.module.css'

import type { AffiliateRow } from '../queries/getAffiliateDashboard'

type Banner = {
  /** Title shown at the top of the banner. */
  title: string
  /** Body copy below the title. */
  body: string
  /** Optional CTA. When omitted, the banner is informational only. */
  ctaHref?: string
  ctaLabel?: string
  /** Tone; drives the data-tone attribute + border color. */
  tone: 'info' | 'warn' | 'danger'
}

export function OnboardingBanner({ affiliate }: { affiliate: AffiliateRow }) {
  const banners: Banner[] = []

  // Suspended first (highest severity). No CTA — the affiliate needs
  // to contact support / wait for a decision.
  if (affiliate.status === 'suspended') {
    banners.push({
      title: 'Your affiliate account is suspended',
      body: 'New commissions are paused while your account is suspended. Please contact support@uthena.com if you believe this is a mistake.',
      tone: 'danger',
    })
  }

  // Pending review. Informational only — the CTA is "wait for the
  // admin team to approve your application" (no self-serve action).
  if (affiliate.status === 'pending') {
    banners.push({
      title: 'Your application is under review',
      body: 'We typically approve new affiliates within 1–2 business days. You can keep exploring the dashboard — approved affiliates will see commissions, clicks, and the affiliate link hero immediately after approval.',
      tone: 'info',
    })
  }

  // Payout method not configured. The CTA navigates to the
  // settings/payout route (P13.11 — not yet shipped; the link is a
  // forward-declared contract that the route will fulfil).
  if (!affiliate.payoutMethodPresent) {
    banners.push({
      title: 'Add a payout method to unlock withdrawals',
      body: 'You can browse the dashboard without a payout method, but you will need a verified PayPal email to request payouts once your commissions become available.',
      ctaHref: '/affiliate/settings/payout',
      ctaLabel: 'Add payout method →',
      tone: 'warn',
    })
  }

  if (banners.length === 0) return null

  return (
    <div className={styles.stack} role="status" aria-live="polite">
      {banners.map((b, i) => (
        <article
          key={i}
          className={styles.banner}
          data-tone={b.tone}
          aria-label={b.title}
        >
          <div className={styles.body}>
            <h2 className={styles.title}>{b.title}</h2>
            <p className={styles.copy}>{b.body}</p>
          </div>
          {b.ctaHref && b.ctaLabel ? (
            <Link href={b.ctaHref} className={styles.cta}>
              {b.ctaLabel}
            </Link>
          ) : null}
        </article>
      ))}
    </div>
  )
}
