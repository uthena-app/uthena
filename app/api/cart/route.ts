// GET /api/cart — returns the current user's cart state for the
// CartDrawer (P4.1). The drawer fetches this when it opens and
// whenever a `uthena:cart:changed` event fires (so it reflects
// in-drawer removals + page-level mutations while the drawer is
// still open).
//
// P4.2 — anon-cookie cart: anon callers now get their cookie cart
// rendered through the same `getCart()` query (which falls through
// to `resolveAnonCart`). `isAuthed: false` tells the drawer to
// render the "Sign in to checkout" CTA instead of the bare
// "Checkout" link.
//
// P4.3 — cart expiration: response now also carries `lastActivityAt`
// (ISO string of the cart's most recent mutation, or null if the
// cart is empty) + `daysUntilExpiry` (the integer used by the
// drawer's warning banner; null when the cart is empty or fresh).
// The drawer renders the banner only when `daysUntilExpiry !== null
// && daysUntilExpiry <= 5`. The expiration math is pure and runs
// server-side so the client just consumes a ready-made number.
//
// Response shape (always JSON):
//   { isAuthed, count, subtotalCents, lines: CartLine[],
//     lastActivityAt: string | null,
//     daysUntilExpiry: number | null }
//
// `Cache-Control: private, no-store` — never cache (cart is
// user-specific and changes on every mutation).

import { NextResponse } from 'next/server'
import { getSessionUser } from '@foundations/auth/guards'
import { getCart } from '@features/cart/queries/getCart'
import { getCartSubtotalCents } from '@features/cart/queries/getCartSubtotal'
import { getAuthCartLastActivity } from '@features/cart/queries/getCartLastActivity'
import { readAnonCart } from '@foundations/cookies/anon-cart'
import {
  getAnonCartLastActivity,
  getCartExpirationStatus,
  isInCartExpirationWarnWindow,
} from '@features/cart/cartExpiration'

export const dynamic = 'force-dynamic'

export async function GET() {
  const [user, lines, subtotalCents] = await Promise.all([
    getSessionUser(),
    getCart(),
    getCartSubtotalCents(),
  ])
  const isAuthed = Boolean(user)
  const count = lines.reduce((sum, l) => sum + l.quantity, 0)

  // P4.3 — cart-expiration lookup. Same branches as the /cart page.
  // For auth users, the DB read is cheap (MAX(updated_at) on the
  // existing `cart_items_active_updated_idx`); for anon, the cookie
  // already has the per-line added_at, no DB needed.
  const lastActivityAt = user
    ? await getAuthCartLastActivity()
    : getAnonCartLastActivity(await readAnonCart())
  const expirationStatus = getCartExpirationStatus(lastActivityAt)
  const daysUntilExpiry =
    lines.length > 0 && isInCartExpirationWarnWindow(expirationStatus)
      ? expirationStatus?.kind === 'warn'
        ? expirationStatus.daysUntilExpiry
        : null
      : null

  return NextResponse.json(
    {
      isAuthed,
      count,
      subtotalCents,
      lines,
      lastActivityAt,
      daysUntilExpiry,
    },
    {
      status: 200,
      headers: { 'Cache-Control': 'private, no-store' },
    },
  )
}
