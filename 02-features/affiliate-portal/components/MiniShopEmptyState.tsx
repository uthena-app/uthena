// MiniShopEmptyState — P13.8 public mini-shop empty-state branch.
//
// Renders when the affiliate has 0 curated products in their shop
// (per spec acceptance #11: "If the affiliate has 0 products
// curated, show a 'Coming soon' message (not an error)"). The
// component is intentionally a single, calm block — the spec
// explicitly rejects the "error" framing because the affiliate
// may simply be in the middle of curating their shop and the
// public page should not punish that with a stack-trace-shaped
// fallback.
//
// RSC, zero client JS.

import type { ShopAffiliate } from '../queries/getMiniShop'
import styles from './MiniShopEmptyState.module.css'

export function MiniShopEmptyState({
  affiliate,
}: {
  affiliate: ShopAffiliate
}) {
  return (
    <section
      className={styles.card}
      aria-labelledby="minishop-empty-heading"
    >
      <svg
        viewBox="0 0 24 24"
        className={styles.icon}
        aria-hidden
        focusable="false"
      >
        <path
          d="M12 2l2.6 5.6 6.2.6-4.6 4.2 1.3 6.1L12 15.6 6.5 18.5l1.3-6.1L3.2 8.2l6.2-.6L12 2z"
          fill="currentColor"
        />
      </svg>
      <h2 id="minishop-empty-heading" className={styles.heading}>
        Coming soon
      </h2>
      <p className={styles.body}>
        @{affiliate.handle} hasn&rsquo;t added any products to their shop
        yet. Check back in a few days &mdash; their picks will appear here
        once they&rsquo;re ready.
      </p>
    </section>
  )
}
