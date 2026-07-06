// /cart — the buyer's pre-checkout staging area. RSC. Reads the cart,
// renders rows + summary, and gates "Continue to checkout" on auth.
//
// P4.2 — anon-cookie cart: unauthenticated visitors see their
// cookie-backed cart rendered the same way as auth users. The
// `getCart()` query resolves both branches transparently. The
// Checkout button still routes anon users through `/login?next=/checkout`
// (handled inside CartSummary) so the post-login redirect lands
// them at the canonical entry point.
//
// P4.3 — cart expiration: when the cart's last activity is in the
// 25-30 day window (5 days or fewer until expiry), a non-blocking
// `CartExpirationBanner` is rendered above the line list. The
// last-activity lookup is one extra query for auth users + one
// MAX over cookie `line.a` for anon — both are pure-read and
// fail-soft to "no banner" if the underlying fetch fails.
//
// Renders are read-only server components. Each interactive row
// (license change, qty, remove) is a client island that calls the
// feature's server action — which also has both branches.

import type { Metadata } from 'next'
import { getSessionUser } from '@foundations/auth/guards'
import {
  getCart,
  getCartSubtotalCents,
  CartLineRow,
  CartSummary,
  CartExpirationBanner,
  EmptyCartState,
} from '@features/cart'
import { getAuthCartLastActivity } from '@features/cart/queries/getCartLastActivity'
import { readAnonCart } from '@foundations/cookies/anon-cart'
import {
  getAnonCartLastActivity,
  getCartExpirationStatus,
  isInCartExpirationWarnWindow,
} from '@features/cart/cartExpiration'
import { getServerSupabase } from '@foundations/data/supabase'
import { sensitivePageMetadata } from '@foundations/metadata'
import styles from './cart.module.css'

// P0.21 — `noindex` so the cart surface isn't indexed. Sharing a
// cart URL would leak the buyer's selection in screenshots.
export const metadata: Metadata = sensitivePageMetadata({
  title: 'Your cart',
  description: 'Review the courses in your Uthena cart and continue to checkout.',
  path: '/cart',
})
export const dynamic = 'force-dynamic'

export default async function CartPage() {
  const [user, lines, subtotalCents] = await Promise.all([
    getSessionUser(),
    getCart(),
    getCartSubtotalCents(),
  ])

  // P4.3 — last-activity lookup for the warning banner. Auth branch
  // hits the DB (MAX(updated_at) on cart_items); anon branch reads
  // the cookie (MAX(line.a)). Fail-soft: null on error → no banner.
  const lastActivityAt = user
    ? await getAuthCartLastActivity()
    : getAnonCartLastActivity(await readAnonCart())
  const expirationStatus = getCartExpirationStatus(lastActivityAt)
  const showExpirationBanner =
    lines.length > 0 && isInCartExpirationWarnWindow(expirationStatus)

  if (lines.length === 0) {
    return (
      <main id="main" className={styles.page}>
        <h1 className={styles.h1}>Your cart</h1>
        <EmptyCartState />
      </main>
    )
  }

  // For each line, look up the available licenses on the product.
  // The /cart page only changes a license between ACTIVE pricing
  // rows. This is a small extra query but lets the dropdown show
  // only what the user can switch to.
  const supabase = await getServerSupabase()
  const productIds = [...new Set(lines.map((l) => l.product_id))]
  const { data: pricingRows } = await supabase
    .from('product_pricing')
    .select('product_id, license')
    .in('product_id', productIds)
    .eq('is_active', true)
  const availableByProduct = new Map<number, Array<'plr' | 'mrr' | 'rr' | 'personal'>>()
  for (const p of pricingRows ?? []) {
    const list = availableByProduct.get(p.product_id) ?? []
    list.push(p.license as 'plr' | 'mrr' | 'rr' | 'personal')
    availableByProduct.set(p.product_id, list)
  }

  const itemCount = lines.reduce((sum: number, l) => sum + l.quantity, 0)
  const bannerDays =
    showExpirationBanner && expirationStatus?.kind === 'warn'
      ? expirationStatus.daysUntilExpiry
      : 0

  return (
    <main id="main" className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.h1}>Your cart</h1>
        <p className={styles.sub}>
          {itemCount} {itemCount === 1 ? 'item' : 'items'}
        </p>
      </header>

      {showExpirationBanner && (
        <div className={styles.bannerSlot}>
          <CartExpirationBanner daysUntilExpiry={bannerDays} />
        </div>
      )}

      <div className={styles.layout}>
        <section className={styles.lines} aria-label="Cart items">
          <ul className={styles.list}>
            {lines.map((line) => (
              <CartLineRow
                key={String(line.id)}
                line={line}
                availableLicenses={
                  availableByProduct.get(line.product_id) ?? [line.license]
                }
              />
            ))}
          </ul>
        </section>

        <CartSummary
          subtotalCents={subtotalCents}
          itemCount={itemCount}
          isAuthed={Boolean(user)}
        />
      </div>
    </main>
  )
}
