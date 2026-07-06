// resumeSubscription.ts — reverse of cancelAtPeriodEnd. Resumes the
// subscription before the period ends. Idempotent.

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

const log = loggerFor({ component: 'subscriptions.resumeSubscription' })

const Schema = z.object({}).strict()

export type ResumeResult = { ok: true; wasScheduled: boolean } | { ok: false; error: string }

export async function resumeSubscriptionAction(
  _raw: FormData | Record<string, unknown> = {},
): Promise<ResumeResult> {
  const parsed = Schema.safeParse({})
  if (!parsed.success) return { ok: false, error: 'Invalid request.' }

  const user = await getSessionUser()
  if (!user) return { ok: false, error: 'Sign in to manage your subscription.' }

  const supabase = await getServerSupabase()
  const { data: sub } = await supabase
    .from('subscriptions')
    .select('id, stripe_subscription_id, cancel_at_period_end, current_period_end, status')
    .eq('user_id', user.id)
    .maybeSingle()
  if (!sub) return { ok: false, error: 'No subscription found.' }
  if (!sub.cancel_at_period_end) return { ok: true, wasScheduled: false }
  // If the period has already ended, you can't resume — must re-subscribe.
  if (sub.current_period_end && new Date(sub.current_period_end).getTime() < Date.now()) {
    return { ok: false, error: 'This subscription has ended. Start a new one instead.' }
  }
  if (!sub.stripe_subscription_id || !isStripeConfigured()) {
    const service = getServiceSupabase()
    await service
      .from('subscriptions')
      .update({ cancel_at_period_end: false, updated_at: new Date().toISOString() })
      .eq('id', sub.id)
    revalidatePath('/account/subscriptions')
    return { ok: true, wasScheduled: true }
  }

  try {
    const stripe = getStripe()
    // Idempotency: stable per (sub.id, action). Two resume clicks on
    // the same subscription return the cached first response.
    const idempotencyKeyValue = idempotencyKey('sub_resume', sub.id)
    const result = await withStripeErrorHandling(
      () =>
        stripe.subscriptions.update(
          sub.stripe_subscription_id,
          { cancel_at_period_end: false },
          { idempotencyKey: idempotencyKeyValue },
        ),
      { surface: 'subscriptions.resumeSubscription' },
    )
    if (!result.ok) {
      return { ok: false, error: result.message }
    }
  } catch (err) {
    const e = err as Error
    log.warn({ code: 'stripe_resume_failed', msg: e.message }, 'stripe.subscriptions.update failed')
    return { ok: false, error: 'Could not resume. Try again or contact support.' }
  }

  const service = getServiceSupabase()
  await service
    .from('subscriptions')
    .update({ cancel_at_period_end: false, updated_at: new Date().toISOString() })
    .eq('id', sub.id)

  log.info({ user_id: user.id, subscription_id: sub.id }, 'subscription resumed')
  revalidatePath('/account/subscriptions')
  return { ok: true, wasScheduled: true }
}
