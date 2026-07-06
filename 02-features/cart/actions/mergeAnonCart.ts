// mergeAnonCart.ts — P4.2 anon-to-auth cart merge.
//
// When a user signs in or signs up with a non-empty anon-cookie cart,
// we merge those lines into their auth cart. The merge policy is
// "union respecting (product_id, license)":
//
//   - If the user already has an auth line for (product_id, license),
//     the anon line is silently dropped (the auth line wins; this
//     prevents accidental duplicates from the unique constraint).
//   - If the user has NO auth line for that pair, the anon line is
//     upserted into `cart_items` with the anon qty (the user's
//     explicit add — not a forced bump).
//   - Products that are no longer published or whose license is no
//     longer active are dropped silently (the user's cart should
//     not gain items they can't actually buy).
//
// On success the anon cookie is cleared (the source cart is now
// empty). On any failure we leave the cookie intact — the user can
// retry from /cart without losing their items.
//
// This module is `server-only` + reads cookies + writes the DB.
// Callers: `signInAction` and `signUpAction` in
// `02-features/auth/actions.ts` invoke this AFTER successful auth
// but BEFORE the post-auth redirect.

import 'server-only'
import { getServerSupabase } from '@foundations/data/supabase'
import {
  clearAnonCart,
  readAnonCart,
  type AnonCart,
} from '@foundations/cookies/anon-cart'
import { loggerFor } from '@foundations/log/pino'

const log = loggerFor({ component: 'cart.mergeAnonCart' })

export type MergeResult = {
  /** Total anon lines read from the cookie. */
  sourceCount: number
  /** Anon lines successfully upserted into the user's auth cart. */
  mergedCount: number
  /** Anon lines dropped because the auth cart already had them. */
  skippedExisting: number
  /** Anon lines dropped because the product/license is no longer available. */
  skippedUnavailable: number
}

/**
 * Merge the anon-cookie cart into the given user's auth cart.
 * Best-effort: returns the outcome counts without throwing.
 */
export async function mergeAnonCartIntoAuth(userId: string): Promise<MergeResult> {
  const cookie = await readAnonCart()
  if (!cookie || cookie.lines.length === 0) {
    return { sourceCount: 0, mergedCount: 0, skippedExisting: 0, skippedUnavailable: 0 }
  }
  const result: MergeResult = {
    sourceCount: cookie.lines.length,
    mergedCount: 0,
    skippedExisting: 0,
    skippedUnavailable: 0,
  }

  const supabase = await getServerSupabase()

  // 1. Snapshot the user's existing auth-cart lines for (product_id, license)
  //    so we can dedup in one query instead of N. The (user_id, status) index
  //    covers the predicate.
  const { data: existingLines } = await supabase
    .from('cart_items')
    .select('product_id, license')
    .eq('user_id', userId)
    .eq('status', 'active')
  const existingKeys = new Set<string>()
  for (const row of existingLines ?? []) {
    existingKeys.add(`${row.product_id}::${row.license}`)
  }

  // 2. Filter the anon lines to those we should attempt to insert —
  //    skip pairs that already exist in the auth cart. Validate
  //    (product published + license active) by querying once per
  //    distinct product_id (PostgREST round-trip cost).
  const productIds = [...new Set(cookie.lines.map((l) => l.p))]
  const { data: pricingRows } = await supabase
    .from('product_pricing')
    .select(
      'product_id, license, product:products!inner ( status )',
    )
    .in('product_id', productIds)
    .eq('is_active', true)
  const availableKeys = new Set<string>()
  for (const row of pricingRows ?? []) {
    const product = (row as unknown as { product: { status: string } | null }).product
    if (product?.status === 'published') {
      availableKeys.add(`${row.product_id}::${row.license}`)
    }
  }

  // 3. Insert the surviving lines. We use `upsert` with `ignoreDuplicates`
  //    for race safety (the user might be opening the page in two tabs
  //    and both trigger a merge). The unique index on
  //    (user_id, product_id, license) is the serialization point.
  const toInsert = cookie.lines.filter((line) => {
    const key = `${line.p}::${line.l}`
    if (existingKeys.has(key)) {
      result.skippedExisting++
      return false
    }
    if (!availableKeys.has(key)) {
      result.skippedUnavailable++
      return false
    }
    return true
  })

  if (toInsert.length > 0) {
    const rows = toInsert.map((l) => ({
      user_id: userId,
      product_id: l.p,
      license: l.l,
      quantity: l.q,
      status: 'active' as const,
    }))
    const { error } = await supabase
      .from('cart_items')
      .upsert(rows, {
        onConflict: 'user_id,product_id,license',
        ignoreDuplicates: true,
      })
    if (error) {
      log.warn(
        { code: 'merge_anon_failed', msg: error.message, attempted: toInsert.length },
        'mergeAnonCart failed; leaving cookie intact for retry',
      )
      // Don't clear the cookie — user can retry. Don't throw — the
      // auth flow must not 500 just because the merge couldn't
      // complete. The user's auth cart still works (auth-only adds
      // continue normally).
      return result
    }
    result.mergedCount = toInsert.length
  }

  // 4. Clear the anon cookie now that the merge succeeded. The
  //    user's source cart is now empty.
  await clearAnonCart()
  log.info(
    {
      user_id: userId,
      ...result,
    },
    'mergeAnonCart ok',
  )
  return result
}

/**
 * Re-export the anon-cart type so the auth actions can read it
 * without a direct dep on the cookie module.
 */
export type { AnonCart }