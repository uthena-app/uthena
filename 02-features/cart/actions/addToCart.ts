// addToCart.ts — upsert (user, product, license) into cart_items.
//
// Idempotent on (user, product, license) thanks to the unique index
// in migration 0001. If the line exists, the existing row's quantity
// is preserved (we don't auto-bump — the user can change qty in /cart).
// If a product has no active pricing for the requested license, the
// call fails closed with a typed error.
//
// P4.2 — anon-cookie cart: for unauthenticated callers we read +
// write the HMAC-signed cookie instead of the DB. The auth branch
// is unchanged. The result returns a synthesized `anon:<product_id>:
// <license>` string id (the action knows which branch it took).

'use server'

import { revalidatePath } from 'next/cache'
import { getServerSupabase } from '@foundations/data/supabase'
import { AddToCartInput } from '@foundations/data/schemas'
import { getSessionUser } from '@foundations/auth/guards'
import { loggerFor } from '@foundations/log/pino'
import {
  ANON_CART_MAX_LINES,
  anonLineId,
  readAnonCart,
  writeAnonCart,
  type AnonCart,
} from '@foundations/cookies/anon-cart'

const log = loggerFor({ component: 'cart.addToCart' })

export type AddToCartResult =
  | { ok: true; cart_item_id: number | string; source: 'auth' | 'anon' }
  | { ok: false; error: string; requireAuth?: boolean; subscriberOnly?: boolean }

export async function addToCartAction(
  raw: FormData | Record<string, unknown>,
): Promise<AddToCartResult> {
  const obj: Record<string, unknown> =
    raw instanceof FormData
      ? Object.fromEntries(
          [...raw.entries()].map(([k, v]) => [k, typeof v === 'string' ? v : v.name]),
        )
      : raw

  const parsed = AddToCartInput.safeParse(obj)
  if (!parsed.success) {
    return { ok: false, error: 'Invalid product, license, or quantity.' }
  }
  const { product_id, license, quantity } = parsed.data

  const user = await getSessionUser()
  if (!user) return anonAddToCart(product_id, license, quantity)

  const supabase = await getServerSupabase()

  // Verify the product is published and has active pricing for this license.
  // P8.3 — also pull `subscriber_only` so we can gate the auth branch on
  // the user's subscription status. The product_pricing row only exists
  // for published products (RLS via the embedded select keeps it anon-safe
  // for the active-pricing filter, and the pricing row itself only exists
  // on published products per migration 0001's
  // `product_pricing_public_read_active` policy). We use the pricing
  // lookup as the single roundtrip that confirms (a) the license exists
  // and (b) the product is still purchasable; the subscriber_only check
  // is layered on top.
  const { data: pricing, error: pricingErr } = await supabase
    .from('product_pricing')
    .select(
      'id, product:products!inner ( id, status, subscriber_only )',
    )
    .eq('product_id', product_id)
    .eq('license', license)
    .eq('is_active', true)
    .maybeSingle()
  if (pricingErr || !pricing) {
    return { ok: false, error: 'This license is not available for this product.' }
  }

  // P8.3 — subscriber-only gate. If the product is subscriber-only, only
  // users with an active Personal Access subscription can add it to
  // their cart. Defense in depth: the PDP hides the LicenseSelector for
  // non-subscribers (UI), and this server action refuses the request if
  // a stale UI bypasses that gate. The `has_active_subscription` RPC is
  // SECURITY DEFINER (per migration 0002) so it can't be subverted via
  // RLS-aware tricks; calling it via the request client is the canonical
  // path. Fail-closed on RPC error: a transient RPC outage refuses the
  // purchase (we don't want to grant access we can't verify).
  const productJoin = (pricing as unknown as {
    product: { id: number; status: string; subscriber_only: boolean } | null
  }).product
  if (productJoin?.subscriber_only === true) {
    const { data: isSubscriber, error: subErr } = await supabase.rpc(
      'has_active_subscription',
      { p_user_id: user.id },
    )
    if (subErr) {
      log.warn(
        { code: 'add_to_cart_subscriber_check_failed', msg: subErr.message, product_id, user_id: user.id },
        'subscriber status check failed — refusing subscriber-only add',
      )
      return {
        ok: false,
        error:
          'This course is for Personal Access subscribers. Please try again or subscribe.',
        subscriberOnly: true,
      }
    }
    if (isSubscriber !== true) {
      log.info(
        { code: 'add_to_cart_subscriber_only_denied', product_id, user_id: user.id },
        'addToCart refused: product is subscriber-only and user has no active subscription',
      )
      return {
        ok: false,
        error:
          'This course is available with Personal Access. Subscribe to add it to your cart.',
        subscriberOnly: true,
      }
    }
  }

  // Upsert via the unique (user_id, product_id, license) index.
  // On conflict we leave quantity alone — quantity is set explicitly
  // via updateQuantity, not by re-adding. updated_at is bumped via
  // the trigger.
  const { data, error } = await supabase
    .from('cart_items')
    .upsert(
      {
        user_id: user.id,
        product_id,
        license,
        quantity,
        status: 'active',
      },
      { onConflict: 'user_id,product_id,license', ignoreDuplicates: true },
    )
    .select('id')
    .single()

  if (error || !data) {
    // If we hit a unique-violation on the ignoreDuplicates path, the row
    // already exists — fetch it so we can return the id.
    if (error?.code === 'PGRST116' || /duplicate key/i.test(error?.message ?? '')) {
      const { data: existing } = await supabase
        .from('cart_items')
        .select('id')
        .eq('user_id', user.id)
        .eq('product_id', product_id)
        .eq('license', license)
        .eq('status', 'active')
        .maybeSingle()
      if (existing) {
        revalidatePath('/cart')
        revalidatePath('/', 'layout')
        log.info({ user_id: user.id, product_id, license }, 'addToCart: existing line kept')
        return { ok: true, cart_item_id: existing.id, source: 'auth' }
      }
    }
    log.warn(
      { code: 'add_to_cart_failed', msg: error?.message, product_id, license },
      'addToCart failed',
    )
    return { ok: false, error: 'Could not add to cart. Try again.' }
  }

  revalidatePath('/cart')
  revalidatePath('/', 'layout')
  log.info({ user_id: user.id, product_id, license, cart_item_id: data.id }, 'addToCart ok')
  return { ok: true, cart_item_id: data.id, source: 'auth' }
}

/**
 * P4.2 — anon-cookie add. Validates the product + license against
 * the live DB (the cookie can't tell us whether the product is
 * still published or the license is still active), upserts the
 * line into the signed cookie, and returns the synthesized anon
 * line id. Idempotent on (product_id, license) — re-adding the
 * same pair leaves the existing row alone (matches the auth
 * upsert semantics).
 *
 * P8.3 — also gates subscriber-only products in the anon branch.
 * Anon users can't have a subscription, so any subscriber-only
 * product is refused at this layer (defense in depth — the PDP
 * UI also hides the LicenseSelector for non-subscribers). The
 * `subscriberOnly: true` flag on the result lets the UI render
 * a tailored "subscribe to access" message instead of the generic
 * "this license is not available" copy.
 */
async function anonAddToCart(
  product_id: number,
  license: 'plr' | 'mrr' | 'rr' | 'personal',
  quantity: number,
): Promise<AddToCartResult> {
  const supabase = await getServerSupabase()
  const { data: pricing, error: pricingErr } = await supabase
    .from('product_pricing')
    .select('id, product:products!inner ( id, status, subscriber_only )')
    .eq('product_id', product_id)
    .eq('license', license)
    .eq('is_active', true)
    .maybeSingle()
  if (pricingErr || !pricing) {
    return { ok: false, error: 'This license is not available for this product.' }
  }
  const productJoin = (pricing as unknown as {
    product: { id: number; status: string; subscriber_only: boolean } | null
  }).product
  const productStatus = productJoin?.status
  if (productStatus !== 'published') {
    return { ok: false, error: 'This product is not currently available.' }
  }
  if (productJoin?.subscriber_only === true) {
    log.info(
      { code: 'add_to_cart_subscriber_only_denied_anon', product_id },
      'addToCart anon refused: product is subscriber-only',
    )
    return {
      ok: false,
      error:
        'This course is available with Personal Access. Subscribe to add it to your cart.',
      subscriberOnly: true,
    }
  }

  const cookie = (await readAnonCart()) ?? freshAnonCart()
  // Idempotent upsert on (product_id, license).
  const existingIdx = cookie.lines.findIndex(
    (l) => l.p === product_id && l.l === license,
  )
  if (existingIdx >= 0) {
    // Existing line — leave qty alone (matches auth upsert semantics).
    // Caller can updateQuantity explicitly if they want a bump.
  } else {
    if (cookie.lines.length >= ANON_CART_MAX_LINES) {
      return { ok: false, error: 'Your cart is full. Sign in to add more items.' }
    }
    cookie.lines.push({
      p: product_id,
      l: license,
      q: quantity,
      a: new Date().toISOString(),
    })
  }
  // Touch created_at only on first line (so we don't reset the
  // cookie TTL by accident — TTL is set by maxAge, not by c).
  if (!cookie.c) cookie.c = new Date().toISOString()
  await writeAnonCart(cookie)
  revalidatePath('/cart')
  revalidatePath('/', 'layout')
  log.info(
    { product_id, license, anon: true, lines: cookie.lines.length },
    'addToCart anon ok',
  )
  return {
    ok: true,
    cart_item_id: anonLineId(product_id, license),
    source: 'anon',
  }
}

/** Build a fresh anon-cart object. */
function freshAnonCart(): AnonCart {
  return { v: 1, c: new Date().toISOString(), lines: [] }
}
