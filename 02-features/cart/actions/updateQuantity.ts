// updateQuantity.ts — set a cart line's quantity (1..99).
// Setting to 0 is treated as a remove (we use a separate remove action
// for explicit deletes; this keeps quantity semantics single-purpose).
//
// P4.2 — anon-cookie branch rewrites the cookie.

'use server'

import { revalidatePath } from 'next/cache'
import { getServerSupabase } from '@foundations/data/supabase'
import { UpdateCartLineQuantityInput } from '@foundations/data/schemas'
import { getSessionUser } from '@foundations/auth/guards'
import { loggerFor } from '@foundations/log/pino'
import {
  parseAnonLineId,
  readAnonCart,
  writeAnonCart,
} from '@foundations/cookies/anon-cart'

const log = loggerFor({ component: 'cart.updateQuantity' })

export async function updateQuantityAction(
  raw: FormData | Record<string, unknown>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const obj = raw instanceof FormData ? Object.fromEntries(raw.entries()) : raw
  const parsed = UpdateCartLineQuantityInput.safeParse({
    cart_item_id: obj.cart_item_id,
    quantity: obj.quantity,
  })
  if (!parsed.success) return { ok: false, error: 'Invalid quantity.' }

  const { cart_item_id, quantity } = parsed.data

  // P4.2 — anon-cookie branch.
  if (typeof cart_item_id === 'string') {
    const ref = parseAnonLineId(cart_item_id)
    if (!ref) return { ok: false, error: 'Invalid cart line.' }
    const cookie = await readAnonCart()
    if (!cookie) return { ok: false, error: 'Cart line not found.' }
    const idx = cookie.lines.findIndex(
      (l) => l.p === ref.productId && l.l === ref.license,
    )
    if (idx < 0) return { ok: false, error: 'Cart line not found.' }
    const source = cookie.lines[idx]
    if (!source) return { ok: false, error: 'Cart line not found.' }
    cookie.lines[idx] = { p: source.p, l: source.l, q: quantity, a: source.a }
    await writeAnonCart(cookie)
    revalidatePath('/cart')
    revalidatePath('/', 'layout')
    log.info(
      { anon: true, product_id: ref.productId, license: ref.license, qty: quantity },
      'updateQuantity anon ok',
    )
    return { ok: true }
  }

  const user = await getSessionUser()
  if (!user) return { ok: false, error: 'Sign in to edit your cart.' }

  const supabase = await getServerSupabase()
  const { error } = await supabase
    .from('cart_items')
    .update({ quantity })
    .eq('id', cart_item_id)
    .eq('user_id', user.id)
  if (error) {
    log.warn({ code: 'update_qty_failed', msg: error.message }, 'updateQuantity failed')
    return { ok: false, error: 'Could not update quantity.' }
  }
  revalidatePath('/cart')
  log.info({ user_id: user.id, cart_item_id, quantity }, 'updateQuantity ok')
  return { ok: true }
}
