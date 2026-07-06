// getAppliedCoupon.ts — read the coupon currently attached to the
// buyer's cart, plus the per-line coupon_ids so the UI can render a
// "Coupon: 25% off (applied to N items)" row.
//
// Returns null when no coupon is attached. Idempotent and read-only.
// Uses the `coupons_public_read_active` RLS policy (read-only on the
// active coupons in the public schema).

import 'server-only'
import { cache } from 'react'
import { getServerSupabase } from '@foundations/data/supabase'
import { getSessionUser } from '@foundations/auth/guards'

export type AppliedCoupon = {
  /** `coupons.id` — the canonical key for the active coupon row. */
  id: number
  /** `coupons.code` — what the buyer typed. */
  code: string
  /** "25% off" — the user-facing label (matches `applyCouponAction`'s
   *  `discount_label` shape so the UI doesn't need to recompute). */
  discount_label: string
  /** `coupons.discount_bps` (0..10000) — raw basis points for the
   *  checkout math (P4.7) to consume. */
  discount_bps: number
  /** Number of cart_lines currently attached to this coupon. */
  applied_to_lines: number
}

type CartCouponRow = { coupon_id: number | null }
type CouponRow = {
  id: number
  code: string
  discount_bps: number
}

function formatDiscountLabel(bps: number): string {
  return `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 2)}% off`
}

export const getAppliedCoupon = cache(async (): Promise<AppliedCoupon | null> => {
  const user = await getSessionUser()
  if (!user) return null
  const supabase = await getServerSupabase()

  // Step 1: read every active cart line's coupon_id.
  const { data: lines } = await supabase
    .from('cart_items')
    .select('coupon_id')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .not('coupon_id', 'is', null)

  const ids = Array.from(
    new Set((lines ?? []).map((l) => (l as CartCouponRow).coupon_id).filter((x): x is number => typeof x === 'number')),
  )
  if (ids.length === 0) return null

  // Step 2: fetch the coupon row(s). In v1 we only support one coupon at
  // a time across the cart (the apply action REPLACES prior coupons on
  // every eligible line) — but the data layer stores coupon_id per line,
  // so a defensive distinct above prevents any inconsistent state from
  // surfacing as a runtime crash. If somehow multiple distinct coupon
  // ids show up, we surface the first one + count how many lines use it.
  const { data: coupons } = await supabase
    .from('coupons')
    .select('id, code, discount_bps')
    .in('id', ids)

  const first = (coupons ?? [])[0] as CouponRow | undefined
  if (!first) return null

  const appliedToLines = (lines ?? []).filter(
    (l) => (l as CartCouponRow).coupon_id === first.id,
  ).length

  return {
    id: first.id,
    code: first.code,
    discount_label: formatDiscountLabel(first.discount_bps),
    discount_bps: first.discount_bps,
    applied_to_lines: appliedToLines,
  }
})