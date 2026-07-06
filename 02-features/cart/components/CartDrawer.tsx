// CartDrawer.tsx — global slide-in cart drawer (P4.1).
//
// Slide-in direction: from the right (mirrors mobile-nav which
// slides in from the left). Triggers:
//   1. Header cart button click (via CartTrigger island +
//      `data-cart-trigger` attribute on the header button).
//   2. Any `uthena:cart:open` window event (fired by the add-to-cart
//      success handlers in AddToCartButton + LicenseSelector per
//      the spec: "Add-to-cart from any page slides the drawer in").
//
// Data flow:
//   - The drawer is a client island; it fetches /api/cart when it
//     opens and on every `uthena:cart:changed` event.
//   - The drawer renders a compact, read-only line-item list +
//     subtotal + view-cart / checkout CTAs. Editing happens on
//     the full /cart page (per spec: drawer shows lines + subtotal
//     + view-cart / checkout buttons, not editing).
//   - A small remove (✕) button per line lets the user drop items
//     without leaving the drawer. On success, the line dispatches
//     CART_CHANGED_EVENT so the drawer re-fetches.
//
// P4.3 — the /api/cart response now carries `daysUntilExpiry`. When
// that field is a non-null number ≤ 5, the drawer renders a compact
// `CartExpirationBanner` at the top of the line list (warn palette,
// tight padding, smaller type). The banner is purely informational;
// users keep shopping to reset the idle clock.
//
// WAI-ARIA modal-dialog pattern (the same pattern SearchOverlay +
// MobileNav use). Tab is trapped inside the drawer; focus moves to
// the close button on open; previously-focused element is restored
// on close. Body scroll is locked while open.

'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react'
import {
  useBodyScrollLock,
  useFocusRestore,
  useFocusTrap,
} from '@foundations/ui/focus'
import { formatMoney } from '@foundations/money/cents'
import { removeLineAction } from '@features/cart/actions/removeLine'
import { LICENSE_LABELS, LICENSE_DESCRIPTIONS } from '@features/cart/format'
import { CartExpirationBanner } from './CartExpirationBanner'
import {
  CART_CHANGED_EVENT,
  CART_OPEN_EVENT,
  type CartChangedDetail,
} from '../cartEvents'
import styles from './CartDrawer.module.css'

type DrawerLine = {
  /** P4.2 — `number | string`. Auth lines use the DB bigint; anon
   *  lines use the synthesized `anon:<product_id>:<license>` string.
   *  The remove action branches on the prefix. */
  id: number | string
  product_id: number
  slug: string
  title: string
  thumbnail_url: string | null
  category_name: string | null
  license: 'plr' | 'mrr' | 'rr' | 'personal'
  quantity: number
  unit_price_cents: number
  line_total_cents: number
}

type CartResponse = {
  isAuthed: boolean
  count: number
  subtotalCents: number
  lines: DrawerLine[]
  /** P4.3 — ISO timestamp of the cart's most recent mutation.
   *  null when the cart is empty. */
  lastActivityAt: string | null
  /** P4.3 — number of days until the cart's idle expiry window
   *  crosses 30 days. null when the cart is empty or fresh
   *  (more than 5 days remaining). The drawer renders the
   *  warning banner only when this is a non-null integer ≤ 5. */
  daysUntilExpiry: number | null
}

const ZERO: CartResponse = {
  isAuthed: false,
  count: 0,
  subtotalCents: 0,
  lines: [],
  lastActivityAt: null,
  daysUntilExpiry: null,
}

export function CartDrawer() {
  const [open, setOpen] = useState(false)
  const [data, setData] = useState<CartResponse>(ZERO)
  const [loading, setLoading] = useState(false)
  // P4.2 — anon lines are addressed by the synthesized string id;
  // auth lines by the DB bigint. `Set<string | number>` would also
  // work; we use null + comparison to avoid forcing the drawer to
  // own a Set.
  const [removingId, setRemovingId] = useState<number | string | null>(null)
  const [removeError, setRemoveError] = useState<string | null>(null)
  const router = useRouter()
  const dialogRef = useRef<HTMLDivElement>(null)
  const closeBtnRef = useRef<HTMLButtonElement>(null)
  const titleId = useId()

  // ----- Shared focus + scroll behavior (00-foundations/ui/focus/) ------
  useBodyScrollLock(open)
  useFocusTrap(dialogRef, open)
  useFocusRestore(open)

  const closeDrawer = useCallback(() => {
    setOpen(false)
    setRemoveError(null)
  }, [])

  // ----- Open trigger -------------------------------------------------
  useEffect(() => {
    function onOpen() {
      setOpen(true)
    }
    window.addEventListener(CART_OPEN_EVENT, onOpen)
    return () => window.removeEventListener(CART_OPEN_EVENT, onOpen)
  }, [])

  // ----- Escape closes ------------------------------------------------
  useEffect(() => {
    if (!open) return
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault()
        closeDrawer()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, closeDrawer])

  // ----- Fetch on open + on cart changes ------------------------------
  const refetch = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/cart', {
        headers: { Accept: 'application/json' },
        cache: 'no-store',
      })
      if (!res.ok) {
        // Don't tear down the drawer on a network blip; keep stale data.
        return
      }
      const next = (await res.json()) as CartResponse
      setData(next)
    } catch {
      // Same as above — keep stale data so the drawer stays useful.
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!open) return
    void refetch()
  }, [open, refetch])

  useEffect(() => {
    function onChanged(_e: Event) {
      // e.detail.count is the optimistic new total; we still re-fetch
      // to get the full line-item shape. The detail is informational.
      void refetch()
    }
    window.addEventListener(CART_CHANGED_EVENT, onChanged)
    return () => window.removeEventListener(CART_CHANGED_EVENT, onChanged)
  }, [refetch])

  // ----- Focus close button on open -----------------------------------
  useEffect(() => {
    if (!open) return
    const raf = requestAnimationFrame(() => {
      closeBtnRef.current?.focus()
    })
    return () => cancelAnimationFrame(raf)
  }, [open])

  // ----- Remove handler (inline so we can show inline error) ----------
  const onRemove = useCallback(
    async (line: DrawerLine) => {
      setRemoveError(null)
      setRemovingId(line.id)
      try {
        const res = await removeLineAction({ cart_item_id: line.id })
        if (!res.ok) {
          setRemoveError(res.error)
          return
        }
        // Re-fetch now so the user sees the row vanish without waiting
        // for the change event to round-trip the parent layout.
        void refetch()
      } finally {
        setRemovingId(null)
      }
    },
    [refetch],
  )

  // ----- Navigation helpers (close then route) -------------------------
  const onViewCart = useCallback(() => {
    closeDrawer()
    router.push('/cart')
  }, [closeDrawer, router])

  const onCheckout = useCallback(() => {
    closeDrawer()
    if (data.isAuthed) {
      router.push('/checkout')
    } else {
      router.push(`/login?next=${encodeURIComponent('/checkout')}`)
    }
  }, [closeDrawer, router, data.isAuthed])

  if (!open) return null

  // ----- Computed display values ---------------------------------------
  const { lines, count, subtotalCents, isAuthed } = data
  const hasItems = lines.length > 0
  const titleText = `Your cart${count > 0 ? ` (${count} ${count === 1 ? 'item' : 'items'})` : ''}`

  return (
    <div
      className={styles.backdrop}
      onMouseDown={(e) => {
        // Close only when the click started on the backdrop itself,
        // not on the drawer or any of its descendants.
        if (e.target === e.currentTarget) closeDrawer()
      }}
      role="presentation"
    >
      <aside
        ref={dialogRef}
        className={styles.drawer}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <header className={styles.header}>
          <h2 id={titleId} className={styles.title}>
            {titleText}
          </h2>
          <button
            ref={closeBtnRef}
            type="button"
            className={styles.closeBtn}
            onClick={closeDrawer}
            aria-label="Close cart"
          >
            <span aria-hidden>×</span>
          </button>
        </header>

        <div className={styles.body} aria-busy={loading ? 'true' : undefined}>
          {!hasItems ? (
            <EmptyState onContinueShopping={closeDrawer} />
          ) : (
            <ul className={styles.list} aria-label="Cart items">
              {data.daysUntilExpiry !== null && (
                <li className={styles.expirationSlot}>
                  <CartExpirationBanner daysUntilExpiry={data.daysUntilExpiry} compact />
                </li>
              )}
              {lines.map((line) => {
                const tagLabel = LICENSE_LABELS[line.license] ?? line.license.toUpperCase()
                const tagDesc = LICENSE_DESCRIPTIONS[line.license] ?? ''
                const removing = removingId === line.id
                return (
                  <li key={line.id} className={styles.line}>
                    <Link
                      href={`/products/${line.slug}`}
                      className={styles.thumbLink}
                      onClick={closeDrawer}
                      aria-label={line.title}
                    >
                      {line.thumbnail_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={line.thumbnail_url}
                          alt=""
                          className={styles.thumb}
                          loading="lazy"
                          decoding="async"
                        />
                      ) : (
                        <span className={styles.thumbPlaceholder} aria-hidden />
                      )}
                    </Link>
                    <div className={styles.lineBody}>
                      {line.category_name && (
                        <p className={styles.eyebrow}>{line.category_name}</p>
                      )}
                      <Link
                        href={`/products/${line.slug}`}
                        className={styles.lineTitle}
                        onClick={closeDrawer}
                      >
                        {line.title}
                      </Link>
                      <p className={styles.license}>
                        {tagLabel}
                        {tagDesc && <span className={styles.licenseDesc}> — {tagDesc}</span>}
                      </p>
                      <p className={styles.linePrice}>
                        {formatMoney(line.unit_price_cents, 'USD')}
                        {line.quantity > 1 && (
                          <span className={styles.linePriceEach}> × {line.quantity}</span>
                        )}
                      </p>
                    </div>
                    <button
                      type="button"
                      className={styles.removeBtn}
                      onClick={() => onRemove(line)}
                      disabled={removing}
                      aria-label={`Remove ${line.title} from cart`}
                    >
                      {removing ? (
                        <span aria-hidden className={styles.removeSpinner} />
                      ) : (
                        <span aria-hidden>×</span>
                      )}
                    </button>
                  </li>
                )
              })}
            </ul>
          )}

          {removeError && (
            <p role="alert" className={styles.removeError}>
              {removeError}
            </p>
          )}
        </div>

        {hasItems && (
          <footer className={styles.footer}>
            <div className={styles.subtotalRow}>
              <span className={styles.subtotalLabel}>Subtotal</span>
              <span className={styles.subtotalValue}>
                {formatMoney(subtotalCents, 'USD')}
              </span>
            </div>
            <p className={styles.taxNote}>Tax calculated at checkout</p>
            <button type="button" className={styles.checkoutBtn} onClick={onCheckout}>
              {isAuthed ? 'Checkout' : 'Sign in to checkout'}
            </button>
            <button type="button" className={styles.viewCartBtn} onClick={onViewCart}>
              View full cart
            </button>
          </footer>
        )}
      </aside>
    </div>
  )
}

function EmptyState({ onContinueShopping }: { onContinueShopping: () => void }) {
  return (
    <div className={styles.empty}>
      <div className={styles.emptyIcon} aria-hidden>
        <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M3 3h2l2.4 12.4a2 2 0 0 0 2 1.6h7.6a2 2 0 0 0 2-1.6L21 7H6" />
          <circle cx="9" cy="20" r="1.5" />
          <circle cx="18" cy="20" r="1.5" />
        </svg>
      </div>
      <p className={styles.emptyTitle}>Your cart is empty</p>
      <p className={styles.emptyBody}>Browse the catalog to add your first course.</p>
      <Link href="/browse" className={styles.emptyCta} onClick={onContinueShopping}>
        Browse catalog
      </Link>
    </div>
  )
}

// Re-export so the cart barrel can pull the event constants too.
export { CART_OPEN_EVENT, CART_CHANGED_EVENT, type CartChangedDetail }
