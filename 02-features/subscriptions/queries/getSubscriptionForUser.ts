// getSubscriptionForUser.ts — read the current user's subscription row.
// RLS is the primary gate (self_read). Returns null when no row.

import 'server-only'
import { getServerSupabase } from '@foundations/data/supabase'
import { getSessionUser } from '@foundations/auth/guards'

export type SubscriptionRow = {
  id: number
  user_id: string
  stripe_customer_id: string | null
  stripe_subscription_id: string | null
  stripe_price_id: string
  status: 'incomplete' | 'incomplete_expired' | 'trialing' | 'active' | 'past_due' | 'canceled' | 'unpaid' | 'paused'
  current_period_start: string | null
  current_period_end: string | null
  cancel_at_period_end: boolean
  canceled_at: string | null
  cancel_reason: string | null
  trial_start: string | null
  trial_end: string | null
  created_at: string
  updated_at: string
}

export async function getSubscriptionForUser(userId: string): Promise<SubscriptionRow | null> {
  const supabase = await getServerSupabase()
  const { data, error } = await supabase
    .from('subscriptions')
    .select(
      'id, user_id, stripe_customer_id, stripe_subscription_id, stripe_price_id, status, current_period_start, current_period_end, cancel_at_period_end, canceled_at, cancel_reason, trial_start, trial_end, created_at, updated_at',
    )
    .eq('user_id', userId)
    .maybeSingle()
  if (error || !data) return null
  return data as SubscriptionRow
}

/** Convenience: returns the subscription for the currently signed-in user. */
export async function getCurrentSubscription(): Promise<SubscriptionRow | null> {
  const user = await getSessionUser()
  if (!user) return null
  return getSubscriptionForUser(user.id)
}
