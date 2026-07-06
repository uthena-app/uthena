// updateLicense.ts — change a cart line's license. The cart row's
// identity is (user_id, product_id, license), so a license change
// is implemented atomically via the update_cart_license RPC. The RPC
// takes the FOR UPDATE lock on the source row, checks for a collision
// (another active line for the new (user, product, license)), and
// either merges (delete the old, keep the collision) or
// delete-and-reinserts — all inside a single transaction. The unique
// index on (user_id, product_id, license) is the serialization point
// for concurrent requests.
//
// P4.2 — anon-cookie branch: a license change on an anon line is a
// cookie rewrite (no DB row to update). We delete the old line at
// (product_id, old_license) and append a new line at (product_id,
// new_license). The anon cart is in-memory-only; concurrent requests
// are serialized by the cookie write.

'use server'

import { revalidatePath } from 'next/cache'
import { getServerSupabase } from '@foundations/data/supabase'
import { UpdateCartLineLicenseInput } from '@foundations/data/schemas'
import { getSessionUser } from '@foundations/auth/guards'
import { loggerFor } from '@foundations/log/pino'
import {
  parseAnonLineId,
  readAnonCart,
  writeAnonCart,
} from '@foundations/cookies/anon-cart'

const log = loggerFor({ component: 'cart.updateLicense' })

export type UpdateLicenseResult = { ok: true } | { ok: false; error: string }

export async function updateLicenseAction(
  raw: FormData | Record<string, unknown>,
): Promise<UpdateLicenseResult> {
  const obj =
    raw instanceof FormData ? Object.fromEntries(raw.entries()) : raw
  const parsed = UpdateCartLineLicenseInput.safeParse({
    cart_item_id: obj.cart_item_id,
    license: obj.license,
  })
  if (!parsed.success) return { ok: false, error: 'Invalid request.' }

  const { cart_item_id, license } = parsed.data

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
    // Verify the new license is available for this product.
    const supabase = await getServerSupabase()
    const { data: tier } = await supabase
      .from('product_pricing')
      .select('id')
      .eq('product_id', ref.productId)
      .eq('license', license)
      .eq('is_active', true)
      .maybeSingle()
    if (!tier) {
      return { ok: false, error: 'This license is not available for this product.' }
    }
    // No-op if the new license is the same as the old one.
    if (ref.license === license) {
      return { ok: true }
    }
    // Merge semantics: if the new (product_id, license) already
    // exists, drop the old line + keep the existing new one. This
    // matches the auth RPC's collision-merge behavior.
    const collisionIdx = cookie.lines.findIndex(
      (l) => l.p === ref.productId && l.l === license,
    )
    if (collisionIdx >= 0 && collisionIdx !== idx) {
      cookie.lines.splice(idx, 1)
    } else {
      // Atomic cookie mutation: keep qty + added_at from the source row.
      const source = cookie.lines[idx]
      if (!source) return { ok: false, error: 'Cart line not found.' }
      cookie.lines[idx] = { p: source.p, l: license, q: source.q, a: source.a }
    }
    await writeAnonCart(cookie)
    revalidatePath('/cart')
    log.info(
      { anon: true, product_id: ref.productId, from: ref.license, to: license },
      'updateLicense anon ok',
    )
    return { ok: true }
  }

  const user = await getSessionUser()
  if (!user) return { ok: false, error: 'Sign in to edit your cart.' }

  const supabase = await getServerSupabase()
  // Verify pricing exists for the new license first (fail fast with
  // a clear error). The RPC also handles the not-found case but
  // returns a generic error message.
  const { data: source } = await supabase
    .from('cart_items')
    .select('product_id')
    .eq('id', cart_item_id)
    .eq('user_id', user.id)
    .maybeSingle()
  if (!source) return { ok: false, error: 'Cart line not found.' }
  const { data: tier } = await supabase
    .from('product_pricing')
    .select('id')
    .eq('product_id', source.product_id)
    .eq('license', license)
    .eq('is_active', true)
    .maybeSingle()
  if (!tier) {
    return { ok: false, error: 'This license is not available for this product.' }
  }

  // Atomic license update. The RPC takes FOR UPDATE on the source
  // row and either deletes + reinserts or merges with the existing
  // collision row. Returns the new id (or the original id on no-op).
  const { error: rpcErr } = await supabase.rpc('update_cart_license', {
    p_user_id: user.id,
    p_cart_item_id: cart_item_id,
    p_new_license: license,
  })
  if (rpcErr) {
    log.warn({ code: 'update_license_rpc_failed', msg: rpcErr.message }, 'update_cart_license failed')
    return { ok: false, error: 'Could not change license. Try again.' }
  }
  revalidatePath('/cart')
  log.info(
    { user_id: user.id, cart_item_id, to: license },
    'updateLicense ok',
  )
  return { ok: true }
}
