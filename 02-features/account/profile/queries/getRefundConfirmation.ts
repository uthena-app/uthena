// getRefundConfirmation — server-only query for the
// `/account/orders/[id]/refund/sent?refundId=<id>` confirmation page.
//
// Returns the single refund row the user just submitted, scoped to
// the order in the URL and the signed-in user. Three security gates
// run in this order (cheapest first):
//
//   1. Caller MUST be authenticated. `getSessionUser()` returns null
//      for anon → we return null without touching the DB.
//   2. RLS: the `refunds` table's `refunds_self_read` policy lets
//      a row through ONLY when the order's `user_id` matches the
//      caller. We also filter on `order_id` and `requested_by` to
//      cover the case where RLS is misconfigured (defense in depth —
//      the test asserts the explicit `requested_by` predicate).
//   3. Result MUST exist. A wrong refundId or a mismatch (someone
//      else's refundId) returns null → page renders 404.
//
// The page composes this with the parsed URL params. See
// `formatRefundUrlParams.ts` for the parse helpers.
//
// Spec: 01-specs/pages/account-refund.md §P9.13. Companion test:
// getRefundConfirmation.test.ts.

import 'server-only'

import { getServerSupabase } from '@foundations/data/supabase'
import { getSessionUser } from '@foundations/auth/guards'
import { loggerFor } from '@foundations/log/pino'

const log = loggerFor({ component: 'account.profile.getRefundConfirmation' })

/** Shape of a refund row, narrowed to the columns the page actually
 *  needs. PII is minimal — `requested_by` is a uuid we never surface
 *  to the page; only `id`, `status`, and `created_at` flow out. */
export type RefundConfirmation = {
  id: number
  status: 'pending' | 'succeeded' | 'failed' | 'canceled'
  created_at: string
}

export async function getRefundConfirmation(opts: {
  orderId: number
  refundId: number
}): Promise<RefundConfirmation | null> {
  const user = await getSessionUser()
  if (!user) return null

  const supabase = await getServerSupabase()
  // PII-safe select — no `requested_by` / `approved_by` / `notes`
  // (notes can contain user-supplied PII) / `stripe_refund_id` (an
  // external system id the user doesn't need to see).
  const { data, error } = await supabase
    .from('refunds')
    .select('id, status, created_at')
    .eq('id', opts.refundId)
    .eq('order_id', opts.orderId)
    .eq('requested_by', user.id)
    .maybeSingle()

  if (error) {
    log.warn(
      { code: 'refund_confirm_read_failed', msg: error.message },
      'refund confirmation read failed',
    )
    return null
  }
  if (!data) return null

  // Defensive — `status` is a typed enum in the schema, but a
  // tampered row or a future enum extension could surface an
  // unexpected value. We coerce to the literal union (or null on
  // mismatch — fail closed so the page never renders bogus state).
  const status = data.status as RefundConfirmation['status']
  if (
    status !== 'pending' &&
    status !== 'succeeded' &&
    status !== 'failed' &&
    status !== 'canceled'
  ) {
    log.warn(
      { code: 'refund_confirm_unexpected_status', status: data.status },
      'refund confirmation row has unexpected status',
    )
    return null
  }

  return {
    id: data.id as number,
    status,
    created_at: data.created_at as string,
  }
}
