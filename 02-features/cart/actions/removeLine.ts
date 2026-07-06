// removeLine.ts — delete one cart line. RLS ensures self-only on the
// auth branch. P4.2 — anon-cookie branch reads the synthesized id back
// to (product_id, license) and removes the matching line from the
// signed cookie.

'use server'

import { revalidatePath } from 'next/cache'
import { getServerSupabase } from '@foundations/data/supabase'
import { RemoveCartLineInput } from '@foundations/data/schemas'
import { getSessionUser } from '@foundations/auth/guards'
import { loggerFor } from '@foundations/log/pino'
import {
  parseAnonLineId,
  readAnonCart,
  writeAnonCart,
} from '@foundations/cookies/anon-cart'

const log = loggerFor({ component: 'cart.removeLine' })

export async function removeLineAction(
  raw: FormData | Record<string, unknown>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const obj = raw instanceof FormData ? Object.fromEntries(raw.entries()) : raw
  const parsed = RemoveCartLineInput.safeParse({ cart_item_id: obj.cart_item_id })
  if (!parsed.success) return { ok: false, error: 'Invalid request.' }

  const cartItemId = parsed.data.cart_item_id

  // P4.2 — anon-cookie branch. String ids prefixed with `anon:` are
  // synthetic refs; parse them back to (product_id, license) and
  // remove the matching line from the cookie.
  if (typeof cartItemId === 'string') {
    const ref = parseAnonLineId(cartItemId)
    if (!ref) return { ok: false, error: 'Invalid cart line.' }
    const cookie = await readAnonCart()
    if (!cookie) return { ok: false, error: 'Cart line not found.' }
    const before = cookie.lines.length
    cookie.lines = cookie.lines.filter(
      (l) => !(l.p === ref.productId && l.l === ref.license),
    )
    if (cookie.lines.length === before) {
      return { ok: false, error: 'Cart line not found.' }
    }
    await writeAnonCart(cookie)
    revalidatePath('/cart')
    revalidatePath('/', 'layout')
    log.info(
      { anon: true, product_id: ref.productId, license: ref.license },
      'removeLine anon ok',
    )
    return { ok: true }
  }

  const user = await getSessionUser()
  if (!user) return { ok: false, error: 'Sign in to edit your cart.' }

  const supabase = await getServerSupabase()
  const { error } = await supabase
    .from('cart_items')
    .delete()
    .eq('id', cartItemId)
    .eq('user_id', user.id)
  if (error) {
    log.warn({ code: 'remove_line_failed', msg: error.message }, 'removeLine failed')
    return { ok: false, error: 'Could not remove item.' }
  }
  revalidatePath('/cart')
  revalidatePath('/', 'layout')
  log.info({ user_id: user.id, cart_item_id: cartItemId }, 'removeLine ok')
  return { ok: true }
}
