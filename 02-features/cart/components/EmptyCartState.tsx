// EmptyCartState.tsx — the empty-state view for /cart. Centered card
// with a short message and a primary CTA back to /browse.

import Link from 'next/link'
import styles from './EmptyCartState.module.css'

export function EmptyCartState() {
  return (
    <div className={styles.wrap}>
      <div className={styles.icon} aria-hidden>
        {/* simple cart glyph, monochrome hairline */}
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M3 3h2l2.4 12.4a2 2 0 0 0 2 1.6h7.6a2 2 0 0 0 2-1.6L21 7H6" />
          <circle cx="9" cy="20" r="1.5" />
          <circle cx="18" cy="20" r="1.5" />
        </svg>
      </div>
      <h2 className={styles.h2}>Your cart is empty</h2>
      <p className={styles.p}>Browse the catalog to add your first course.</p>
      <Link href="/browse" className={styles.cta}>
        Browse catalog
      </Link>
    </div>
  )
}
