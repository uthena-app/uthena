// getSubscriberDiscountContext.ts — the discount engine.
//
// Returns { isActive, discountBps }. The checkout action calls this
// for every order-create and applies the per-row or default discount
// to each PLR line item.
//
// Hot path. Single PK lookup on subscriptions(user_id) + optional
// platform_settings read for the default discount bps. No caching
// in v1 — see 02-features/subscriptions/README.md "Discount engine —
// load profile" for the trade-off discussion.
//
// Resolution order for `discountBps` (P14.12 wires platform_settings;
// resolves STUB-008):
//   1. If the user has an active subscription: read
//      `platform_settings.plr_subscriber_discount_pct_bps` (fail-soft
//      to env default if the row is missing or the read fails).
//   2. Env override (`PLR_SUBSCRIBER_DISCOUNT_PCT_BPS`, default 1500).
//
// Per-line override via `product_pricing.subscriber_discount_bps` is
// applied downstream in `calculateCartSubscriberDiscount` and is NOT
// this function's concern.

import 'server-only'
import { cache } from 'react'
import { getServerSupabase } from '@foundations/data/supabase'
import { getSessionUser } from '@foundations/auth/guards'
import { getEnv } from '@foundations/env'
import { loggerFor } from '@foundations/log/pino'

export type DiscountContext = {
  /** True iff the user has an active or trialing subscription with current_period_end > now(). */
  isActive: boolean
  /** Discount basis points to apply (e.g. 1500 = 15%). 0 when not active. */
  discountBps: number
}

const log = loggerFor({ component: 'subscriptions.getSubscriberDiscountContext' })

/** Read the live `plr_subscriber_discount_pct_bps` from platform_settings.
 *  Fail-soft to env default. Wrapped in `cache()` so repeated calls
 *  within one request hit the same memoized result. */
const getPlatformDefaultDiscountBps = cache(
  async function getPlatformDefaultDiscountBps(): Promise<number> {
    try {
      const supabase = await getServerSupabase()
      const { data, error } = await supabase
        .from('platform_settings')
        .select('plr_subscriber_discount_pct_bps')
        .eq('id', 1)
        .maybeSingle()
      if (error) {
        log.warn(
          { code: 'subscriber_discount_read_failed', msg: error.message },
          'getSubscriberDiscountContext: read failed, falling back to env',
        )
        return getEnv().PLR_SUBSCRIBER_DISCOUNT_PCT_BPS
      }
      const v = data?.plr_subscriber_discount_pct_bps
      if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > 10000) {
        return getEnv().PLR_SUBSCRIBER_DISCOUNT_PCT_BPS
      }
      return v
    } catch (err) {
      log.warn(
        {
          code: 'subscriber_discount_threw',
          msg: err instanceof Error ? err.message : String(err),
        },
        'getSubscriberDiscountContext: threw, falling back to env',
      )
      return getEnv().PLR_SUBSCRIBER_DISCOUNT_PCT_BPS
    }
  },
)

export async function getSubscriberDiscountContext(
  userId?: string,
): Promise<DiscountContext> {
  const user = userId ? { id: userId } : await getSessionUser()
  if (!user) return { isActive: false, discountBps: 0 }
  const supabase = await getServerSupabase()
  const { data } = await supabase
    .from('subscriptions')
    .select('status, current_period_end')
    .eq('user_id', user.id)
    .maybeSingle()
  if (!data) return { isActive: false, discountBps: 0 }
  const isActive =
    (data.status === 'active' || data.status === 'trialing') &&
    (data.current_period_end == null ||
      new Date(data.current_period_end).getTime() > Date.now())
  if (!isActive) return { isActive: false, discountBps: 0 }
  // P14.12 (resolves STUB-008): read the platform default. Env still
  // backs the fallback when the DB row is missing or the read fails.
  const discountBps = await getPlatformDefaultDiscountBps()
  return { isActive: true, discountBps }
}