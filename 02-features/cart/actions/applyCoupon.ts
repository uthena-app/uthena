// applyCoupon.ts — validate a coupon code and attach coupon_id to the
// eligible lines of the user's active cart.
//
// Coupon shapes (per PHASES.md P4.5 + cart spec):
//   1. Percentage      — `coupons.discount_bps` (0..10000). The action
//                        attaches the coupon to every eligible cart line.
//   2. Partner-restricted — `coupons.partner_id` is non-null. The coupon
//                        only attaches to cart lines whose product's
//                        `partner_id` matches. Lines from other partners
//                        are left untouched.
//   3. Product-restricted — `coupons.product_id` is non-null. The coupon
//                        only attaches to the matching cart line. Other
//                        lines are left untouched.
//   4. Subscriber-only — `coupons.subscriber_only` is true. The user must
//                        have `has_active_subscription(user_id) = true`
//                        (migration 0002). DB CHECK enforces exclusivity
//                        with partner_id / product_id; the action doesn't
//                        need to re-validate the exclusivity rule.
//
// "Fixed" amount (a non-bps currency discount) is out of scope for v1
// and documented in STUBS as a Phase 5+ follow-up.
//
// In v1 we attach the coupon to the cart (cart_items.coupon_id) so the
// checkout flow knows which coupon to use. The discount math itself
// runs in the checkout feature when the Stripe session is built — that
// is the final authority, this is the user-facing accept.

'use server'

import { revalidatePath } from 'next/cache'
import { getServerSupabase } from '@foundations/data/supabase'
import { ApplyCouponInput } from '@foundations/data/schemas'
import { getSessionUser } from '@foundations/auth/guards'
import { loggerFor } from '@foundations/log/pino'

const log = loggerFor({ component: 'cart.applyCoupon' })

export type ApplyCouponResult =
  | {
      ok: true
      coupon_id: number
      discount_label: string
      /** How many cart lines the coupon was attached to. */
      applied_to_lines: number
    }
  | { ok: false; error: string }

type CouponRow = {
  id: number
  code: string
  discount_bps: number
  partner_id: number | null
  product_id: number | null
  subscriber_only: boolean
  starts_at: string | null
  ends_at: string | null
  max_redemptions: number | null
  redemptions_count: number
  is_active: boolean
}

type EligibleLineRow = { id: number }

export async function applyCouponAction(
  raw: FormData | Record<string, unknown>,
): Promise<ApplyCouponResult> {
  const obj = raw instanceof FormData ? Object.fromEntries(raw.entries()) : raw
  const parsed = ApplyCouponInput.safeParse({ code: obj.code })
  if (!parsed.success) {
    // Include the path of the first failing field so the user knows
    // what to fix (e.g. "Coupon code is required" vs a generic
    // "Invalid request."). Zod's default message is just "Required"
    // for missing fields — we humanize it here.
    const issue = parsed.error.issues[0]
    const field = issue?.path[0]
    if (field === 'code') {
      const code = issue?.code
      if (code === 'too_small') return { ok: false, error: 'Coupon code must be at least 2 characters.' }
      if (code === 'too_big') return { ok: false, error: 'Coupon code is too long.' }
      if (code === 'invalid_string') return { ok: false, error: 'Coupon codes are letters, digits, underscores, and hyphens only.' }
      return { ok: false, error: 'Coupon code is required.' }
    }
    return { ok: false, error: 'Invalid coupon.' }
  }
  const user = await getSessionUser()
  if (!user) return { ok: false, error: 'Sign in to apply a coupon.' }

  const supabase = await getServerSupabase()
  const now = new Date().toISOString()
  const { data: coupon, error } = await supabase
    .from('coupons')
    .select(
      'id, code, discount_bps, partner_id, product_id, subscriber_only, starts_at, ends_at, max_redemptions, redemptions_count, is_active',
    )
    .eq('code', parsed.data.code)
    .eq('is_active', true)
    .maybeSingle<CouponRow>()
  if (error || !coupon) {
    return { ok: false, error: 'Coupon code not found.' }
  }
  if (coupon.starts_at && coupon.starts_at > now) {
    return { ok: false, error: 'This coupon is not active yet.' }
  }
  if (coupon.ends_at && coupon.ends_at < now) {
    return { ok: false, error: 'This coupon has expired.' }
  }
  if (coupon.max_redemptions && coupon.redemptions_count >= coupon.max_redemptions) {
    return { ok: false, error: 'This coupon has been fully redeemed.' }
  }

  // Subscriber-only gate — the SECURITY DEFINER helper
  // `has_active_subscription(uuid)` (defined in migration 0002) returns
  // true only for active + trialing subscriptions whose period hasn't
  // ended. Calling it via rpc() instead of inlining the SELECT is
  // intentional — the helper is the single source of truth for "is this
  // user a subscriber" across the codebase (used by
  // user_accessible_products too).
  if (coupon.subscriber_only) {
    const { data: isActive } = await supabase.rpc('has_active_subscription', {
      p_user_id: user.id,
    })
    if (!isActive) {
      return { ok: false, error: 'This coupon is for subscribers only.' }
    }
  }

  // Resolve the set of eligible cart line IDs. Three scopes:
  //   - Global coupon (no partner_id, no product_id): every active line
  //   - Partner-restricted: lines whose product.partner_id matches
  //   - Product-restricted: lines whose product_id matches
  //
  // We fetch the cart_lines with a small product join, filter in JS,
  // then UPDATE only the eligible subset. PostgREST's auto-join doesn't
  // support nested `eq + in` filters cleanly; the two-step read+update
  // is the canonical pattern. Cost: one tiny query + one tiny update,
  // both bounded by the cart size (<= 50 lines per ANON_CART_MAX_LINES).
  const { data: cartLines, error: linesErr } = await supabase
    .from('cart_items')
    .select(
      'id, product:products!inner ( id, partner_id )',
    )
    .eq('user_id', user.id)
    .eq('status', 'active')

  if (linesErr) {
    log.warn({ code: 'apply_coupon_lines_failed', msg: linesErr.message }, 'applyCoupon lines fetch failed')
    return { ok: false, error: 'Could not apply coupon. Try again.' }
  }

  const eligibleIds = ((cartLines ?? []) as unknown as Array<{
    id: number
    product: { id: number; partner_id: number | null } | null
  }>)
    .map((row) => {
      return row.product ? { lineId: row.id, product: row.product } : null
    })
    .filter((x): x is { lineId: number; product: { id: number; partner_id: number | null } } => x !== null)
    .filter(({ product }) => {
      if (coupon.partner_id !== null && product.partner_id !== coupon.partner_id) return false
      if (coupon.product_id !== null && product.id !== coupon.product_id) return false
      return true
    })
    .map((x) => x.lineId)

  if (eligibleIds.length === 0) {
    if (coupon.partner_id !== null) {
      return { ok: false, error: 'This coupon does not apply to anything in your cart.' }
    }
    if (coupon.product_id !== null) {
      return { ok: false, error: 'This coupon is for a different product.' }
    }
    return { ok: false, error: 'Your cart is empty.' }
  }

  // Attach the coupon to every eligible line. `cart_items.coupon_id`
  // overrides any prior coupon on those lines — applying a second coupon
  // replaces the first. We don't stack coupons in v1.
  const { error: attachErr } = await supabase
    .from('cart_items')
    .update({ coupon_id: coupon.id })
    .in('id', eligibleIds)
  if (attachErr) {
    log.warn({ code: 'apply_coupon_failed', msg: attachErr.message }, 'applyCoupon update failed')
    return { ok: false, error: 'Could not apply coupon. Try again.' }
  }

  revalidatePath('/cart')
  revalidatePath('/checkout')
  const label = `${(coupon.discount_bps / 100).toFixed(coupon.discount_bps % 100 === 0 ? 0 : 2)}% off`
  return {
    ok: true,
    coupon_id: coupon.id,
    discount_label: label,
    applied_to_lines: eligibleIds.length,
  }
}