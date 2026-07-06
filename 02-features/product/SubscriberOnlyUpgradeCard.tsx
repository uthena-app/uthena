// SubscriberOnlyUpgradeCard.tsx — P8.3 PDP upgrade CTA.
//
// Replaces the `LicenseSelector` (the radio + Add-to-cart form) when:
//   1. The product is flagged `subscriber_only = true` (migration 0032),
//      AND
//   2. The current user does NOT have an active Personal Access
//      subscription (per the existing `getSubscriptionCatalogAccess`
//      query's new `hasActiveSubscription` boolean).
//
// **Why a dedicated component, not inline in the page.** The condition
// has 4 branches (subscriber-only × subscriber) and each branch renders
// a different shape (LicenseSelector vs banner vs upgrade card vs
// nothing). Extracting the upgrade card to a focused component keeps the
// page render code readable + lets the component own its CSS module.
//
// **Visual language.** Orange DNA (action color — the user needs to
// subscribe). Same color tokens as the rest of the call-to-action
// surfaces (compare-at price block, MRR/RR license tags, the Add to
// cart primary button). Pair color is the teal of the P8.2 "Included
// with Personal Access" banner that this card complements — when the
// user IS a subscriber, they see teal; when they aren't, they see
// orange.
//
// **Auth-aware CTA copy.** Anon users get a primary "See Personal
// Access" CTA + a secondary "Already subscribed? Sign in" link that
// preserves `?next=/products/[slug]`. Authed non-subscribers skip the
// sign-in affordance (they're already signed in).
//
// **Why server component (RSC).** Zero interactivity. Pure Link + text.
// The page already passes the `isAnonymous` flag (so this component
// doesn't need its own session check). Mirrors the design pattern of
// the other PDP components in `02-features/product/`.

import Link from 'next/link'
import { Button } from '@foundations/ui/primitives/Button'
import styles from './SubscriberOnlyUpgradeCard.module.css'

type Props = {
  /** Product slug — used to build the `?next=` for the sign-in CTA. */
  productSlug: string
  /** Whether the visitor is anonymous (no session). */
  isAnonymous: boolean
}

export function SubscriberOnlyUpgradeCard({ productSlug, isAnonymous }: Props) {
  const signInHref = `/login?next=${encodeURIComponent(`/products/${productSlug}`)}`
  return (
    <aside className={styles.card} role="region" aria-label="Subscriber-only content">
      <span className={styles.eyebrow}>
        <span className={styles.eyebrowIcon} aria-hidden>
          ★
        </span>
        Subscriber-only content
      </span>
      <h3 className={styles.title}>Get every course with Personal Access</h3>
      <p className={styles.body}>
        This course is available with a Personal Access subscription.{' '}
        Subscribe to add it to your cart and unlock the full Uthena library —{' '}
        <span className={styles.priceLine}>$19 / month</span>, cancel anytime.
      </p>
      <div className={styles.ctas}>
        <Link href="/pricing" className={styles.primaryCtaLink}>
          <Button variant="primary" size="lg" fullWidth iconRight={<span aria-hidden>→</span>}>
            See Personal Access
          </Button>
        </Link>
        {isAnonymous ? (
          <Link href={signInHref} className={styles.secondaryLink}>
            Already subscribed? Sign in
          </Link>
        ) : null}
      </div>
      <p className={styles.fineprint}>
        Subscribers also get 15% off every PLR order outside the
        subscription, plus first access to new releases.
      </p>
    </aside>
  )
}