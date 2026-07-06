// MiniShopFooter — P13.8 public mini-shop thin footer.
//
// Renders a thin 2-row footer with: copyright line + Powered by
// Uthena + privacy/terms/DMCA links. Per the spec at
// affiliate-minishop.md:19 — "© year + affiliate name, Powered by
// Uthena, privacy/terms/DMCA". The privacy/terms/DMCA links are
// the platform-wide legal pages (no per-affiliate customization).
//
// RSC, zero client JS.

import Link from 'next/link'
import type { ShopAffiliate } from '../queries/getMiniShop'
import styles from './MiniShopFooter.module.css'

export function MiniShopFooter({ affiliate }: { affiliate: ShopAffiliate }) {
  const year = new Date().getUTCFullYear()
  return (
    <footer className={styles.footer} aria-label="Mini-shop footer">
      <div className={styles.row}>
        <span className={styles.copy}>
          © {year} {affiliate.brandName ?? `@${affiliate.handle}`}
        </span>
        <span className={styles.divider} aria-hidden>
          ·
        </span>
        <span className={styles.powered}>Powered by Uthena</span>
      </div>
      <ul className={styles.links} aria-label="Legal">
        <li>
          <Link href="/privacy" className={styles.link}>
            Privacy
          </Link>
        </li>
        <li>
          <Link href="/terms" className={styles.link}>
            Terms
          </Link>
        </li>
        <li>
          <Link href="/dmca" className={styles.link}>
            DMCA
          </Link>
        </li>
        <li>
          <Link href="/refund-policy" className={styles.link}>
            Refund policy
          </Link>
        </li>
      </ul>
    </footer>
  )
}
