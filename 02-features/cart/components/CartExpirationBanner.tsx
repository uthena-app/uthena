// CartExpirationBanner.tsx — P4.3 cart-expiration warning banner.
//
// A server component that renders a non-blocking warning at the top
// of the /cart page and the CartDrawer when the cart is in the
// 25-30 day idle window (i.e., 5 days or fewer until expiry).
//
// The banner is purely informational — no buttons, no CTAs. Users
// can keep shopping to reset the idle clock; the warning simply
// tells them when their cart will be auto-removed.
//
// A daily email at day 25 is the spec's recommended second surface;
// that's deferred to Phase 17 (STUB-048) because it needs the SES
// adapter + an email template. When the email ships, the banner
// will reference it ("We've also sent you a reminder email") —
// the banner is structured so a second line can be added with a
// single new <p>.
//
// Design tokens only — no inline colors, no magic hex values.
// Warn palette matches the ResendVerificationForm cooldownNotice
// (the canonical "user has limited time" treatment across the
// auth surface).

import Link from 'next/link'
import { formatExpiryWarning } from '../cartExpiration'
import styles from './CartExpirationBanner.module.css'

export function CartExpirationBanner({
  daysUntilExpiry,
  compact = false,
}: {
  daysUntilExpiry: number
  /** Compact variant — used inside the CartDrawer where vertical
   *  space is at a premium. Tighter padding, smaller type. */
  compact?: boolean
}) {
  const className = compact ? `${styles.banner} ${styles.compact}` : styles.banner
  return (
    <aside
      role="status"
      aria-live="polite"
      className={className}
      data-testid="cart-expiration-banner"
    >
      <span aria-hidden className={styles.icon}>
        ⏱
      </span>
      <div className={styles.body}>
        <p className={styles.message}>{formatExpiryWarning(daysUntilExpiry)}</p>
        <p className={styles.hint}>
          Items in your cart will be removed automatically. Continue shopping to keep
          them.{' '}
          <Link href="/browse" className={styles.link}>
            Browse the catalog
          </Link>
          .
        </p>
      </div>
    </aside>
  )
}