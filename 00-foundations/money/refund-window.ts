// Single source of truth for the refund window. Imported by:
//   - account/orders/[id]/refund (eligibility check + banner copy)
//   - account/orders/[id] (help text: "within the 14-day window")
//   - admin/refunds (gate on approval)
//   - 04-platform/webhooks/stripe/onRefund (deny after the window)
//   - 02-features/checkout/actions/onPaymentSucceeded.ts (writes
//     `locked_until = now() + window_days`)
//
// The constant `REFUND_WINDOW_DAYS = 14` is the v1 default + the
// hard-coded fallback when the DB read fails. P14.12 wires a
// `platform_settings.default_refund_window_days` read so admin can
// change the window without a code deploy (resolves STUB-011).

import 'server-only'
import { cache } from 'react'
import { getServerSupabase } from '@foundations/data/supabase'
import { loggerFor } from '@foundations/log/pino'

export const REFUND_WINDOW_DAYS = 14
export const REFUND_WINDOW_DAYS_MIN = 1
export const REFUND_WINDOW_DAYS_MAX = 365

const log = loggerFor({ component: 'foundations.money.refundWindow' })

/** Read the live `default_refund_window_days` from platform_settings.
 *
 * - Uses the request-scoped Supabase client (RLS: public_read — the
 *   single row in `platform_settings` is world-readable per the
 *   `platform_settings_public_read` policy from migration 0001).
 * - Returns `REFUND_WINDOW_DAYS` (14) when the row is missing or the
 *   read fails — fail-soft to the historical default so a transient DB
 *   blip doesn't break the checkout webhook.
 * - Wrapped in `cache()` so repeated calls within one request hit the
 *   same memoized result.
 * - Defensively coerces: out-of-range / non-integer / NaN / null
 *   values fall back to the constant.
 */
export const getEffectiveRefundWindowDays = cache(
  async function getEffectiveRefundWindowDays(): Promise<number> {
    try {
      const supabase = await getServerSupabase()
      const { data, error } = await supabase
        .from('platform_settings')
        .select('default_refund_window_days')
        .eq('id', 1)
        .maybeSingle()
      if (error) {
        log.warn(
          { code: 'refund_window_read_failed', msg: error.message },
          'getEffectiveRefundWindowDays: read failed, falling back to constant',
        )
        return REFUND_WINDOW_DAYS
      }
      const v = data?.default_refund_window_days
      if (
        typeof v !== 'number' ||
        !Number.isInteger(v) ||
        v < REFUND_WINDOW_DAYS_MIN ||
        v > REFUND_WINDOW_DAYS_MAX
      ) {
        return REFUND_WINDOW_DAYS
      }
      return v
    } catch (err) {
      log.warn(
        { code: 'refund_window_threw', msg: err instanceof Error ? err.message : String(err) },
        'getEffectiveRefundWindowDays: threw, falling back to constant',
      )
      return REFUND_WINDOW_DAYS
    }
  },
)