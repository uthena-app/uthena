// cancelAtPeriodEnd.ts — server action. Sets the user's subscription
// to cancel at the end of the current billing period. Idempotent.
//
// Flow:
//   1. Read the local row (RLS self-read).
//   2. If cancel_at_period_end is already true, no-op (idempotent).
//   3. Call stripe.subscriptions.update(id, { cancel_at_period_end: true }).
//   4. Update the local row to reflect the new state. The webhook will
//      also write the same change when `customer.subscription.updated`
//      fires, but doing it here gives the UI instant feedback.

'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { getServerSupabase, getServiceSupabase } from '@foundations/data/supabase'
import { getSessionUser } from '@foundations/auth/guards'
import {
  isStripeConfigured,
  getStripe,
  withStripeErrorHandling,
  idempotencyKey,
} from '@foundations/money/stripe'
import { loggerFor } from '@foundations/log/pino'

const log = loggerFor({ component: 'subscriptions.cancelAtPeriodEnd' })

const Schema = z.object({}).strict()

export type CancelResult = { ok: true; alreadyCanceled: boolean } | { ok: false; error: string }

export async function cancelAtPeriodEndAction(
  _raw: FormData | Record<string, unknown> = {},
): Promise<CancelResult> {
  const parsed = Schema.safeParse({})
  if (!parsed.success) return { ok: false, error: 'Invalid request.' }

  const user = await getSessionUser()
  if (!user) return { ok: false, error: 'Sign in to manage your subscription.' }

  const supabase = await getServerSupabase()
  const { data: sub } = await supabase
    .from('subscriptions')
    .select('id, stripe_subscription_id, status, cancel_at_period_end')
    .eq('user_id', user.id)
    .maybeSingle()
  if (!sub) return { ok: false, error: 'No subscription found.' }
  if (sub.status !== 'active' && sub.status !== 'trialing' && sub.status !== 'past_due') {
    return { ok: false, error: 'This subscription is not active.' }
  }
  if (sub.cancel_at_period_end) {
    return { ok: true, alreadyCanceled: true }
  }
  if (!sub.stripe_subscription_id || !isStripeConfigured()) {
    // Local-only update path. The webhook will catch up when Stripe is
    // configured; until then, this is the best we can do.
    const service = getServiceSupabase()
    await service
      .from('subscriptions')
      .update({ cancel_at_period_end: true, updated_at: new Date().toISOString() })
      .eq('id', sub.id)
    revalidatePath('/account/subscriptions')
    return { ok: true, alreadyCanceled: false }
  }

  try {
    const stripe = getStripe()
    // Idempotency: stable per (sub.id, action). Two cancel clicks on
    // the same subscription return the cached first response.
    const idempotencyKeyValue = idempotencyKey('sub_cancel', sub.id)
    const result = await withStripeErrorHandling(
      () =>
        stripe.subscriptions.update(
          sub.stripe_subscription_id,
          { cancel_at_period_end: true },
          { idempotencyKey: idempotencyKeyValue },
        ),
      { surface: 'subscriptions.cancelAtPeriodEnd' },
    )
    if (!result.ok) {
      return { ok: false, error: result.message }
    }
  } catch (err) {
    const e = err as Error
    log.warn({ code: 'stripe_cancel_failed', msg: e.message }, 'stripe.subscriptions.update failed')
    return { ok: false, error: 'Could not cancel. Try again or contact support.' }
  }

  // Local mirror — webhook will also write this; either is fine.
  const service = getServiceSupabase()
  await service
    .from('subscriptions')
    .update({ cancel_at_period_end: true, updated_at: new Date().toISOString() })
    .eq('id', sub.id)

  log.info({ user_id: user.id, subscription_id: sub.id }, 'subscription canceled at period end')
  revalidatePath('/account/subscriptions')
  return { ok: true, alreadyCanceled: false }
}
