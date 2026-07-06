// removeCoupon.ts — detach a coupon from every active cart line. The
// "remove" action is a "detach coupon" — it doesn't delete the coupon row
// itself, only the `cart_items.coupon_id` foreign-key reference. Idempotent:
// if no coupon is applied, the UPDATE matches zero rows and returns OK.

'use server'

import { revalidatePath } from 'next/cache'
import { getServerSupabase } from '@foundations/data/supabase'
import { getSessionUser } from '@foundations/auth/guards'
import { loggerFor } from '@foundations/log/pino'

const log = loggerFor({ component: 'cart.removeCoupon' })

export type RemoveCouponResult =
  | { ok: true; removed_lines: number }
  | { ok: false; error: string }

export async function removeCouponAction(): Promise<RemoveCouponResult> {
  const user = await getSessionUser()
  if (!user) return { ok: false, error: 'Sign in to manage coupons.' }

  const supabase = await getServerSupabase()
  // Read first so we can return the "removed N lines" telemetry.
  const { data: lines, error: linesErr } = await supabase
    .from('cart_items')
    .select('id')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .not('coupon_id', 'is', null)
  if (linesErr) {
    log.warn(
      { code: 'remove_coupon_lines_failed', msg: linesErr.message },
      'removeCoupon lines fetch failed',
    )
    return { ok: false, error: 'Could not remove coupon. Try again.' }
  }
  const ids = (lines ?? []).map((r) => r.id as number)
  if (ids.length === 0) {
    // Idempotent — no coupon applied is a no-op success.
    revalidatePath('/cart')
    revalidatePath('/checkout')
    return { ok: true, removed_lines: 0 }
  }
  const { error: updErr } = await supabase
    .from('cart_items')
    .update({ coupon_id: null })
    .in('id', ids)
  if (updErr) {
    log.warn(
      { code: 'remove_coupon_failed', msg: updErr.message },
      'removeCoupon update failed',
    )
    return { ok: false, error: 'Could not remove coupon. Try again.' }
  }
  revalidatePath('/cart')
  revalidatePath('/checkout')
  return { ok: true, removed_lines: ids.length }
}