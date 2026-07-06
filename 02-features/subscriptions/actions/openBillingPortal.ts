// openBillingPortal.ts — server action that mints a Stripe Billing
// Portal session URL. The URL is short-lived (~5 min) and the user is
// redirected to it. The portal lets them update payment method, see
// full invoice history, and (if Stripe is configured for it) cancel.

'use server'

import { z } from 'zod'
import { headers } from 'next/headers'
import { getServerSupabase } from '@foundations/data/supabase'
import { getSessionUser } from '@foundations/auth/guards'
import {
  isStripeConfigured,
  getStripe,
  withStripeErrorHandling,
  bucketedIdempotencyKey,
} from '@foundations/money/stripe'
import { getEnv } from '@foundations/env'
import { loggerFor } from '@foundations/log/pino'

const log = loggerFor({ component: 'subscriptions.openBillingPortal' })

const Schema = z.object({}).strict()

export type PortalResult =
  | { ok: true; url: string }
  | { ok: false; error: string; code?: 'not_authed' | 'no_customer' | 'stripe_unconfigured' | 'unknown' }

export async function openBillingPortalAction(
  _raw: FormData | Record<string, unknown> = {},
): Promise<PortalResult> {
  const parsed = Schema.safeParse({})
  if (!parsed.success) return { ok: false, error: 'Invalid request.', code: 'unknown' }

  const user = await getSessionUser()
  if (!user) return { ok: false, error: 'Sign in.', code: 'not_authed' }

  if (!isStripeConfigured()) {
    return { ok: false, error: 'Stripe is not configured.', code: 'stripe_unconfigured' }
  }

  const supabase = await getServerSupabase()
  const { data: sub } = await supabase
    .from('subscriptions')
    .select('stripe_customer_id')
    .eq('user_id', user.id)
    .maybeSingle()
  if (!sub?.stripe_customer_id) {
    return { ok: false, error: 'No billing record found. Start a subscription first.', code: 'no_customer' }
  }

  const env = getEnv()
  const origin = (await headers()).get('origin') ?? env.NEXT_PUBLIC_APP_URL
  // Idempotency: 60s bucket keyed on user.id. Double-clicks within 60s
  // dedupe to the same portal URL (which is the safe default — Stripe
  // portal URLs are single-use and ~5min TTL anyway).
  const idempotencyKeyValue = bucketedIdempotencyKey('billing_portal', 60, user.id)
  const stripe = getStripe()
  const portalResult = await withStripeErrorHandling(
    () =>
      stripe.billingPortal.sessions.create(
        {
          customer: sub.stripe_customer_id,
          return_url: `${origin}/account/subscriptions`,
        },
        { idempotencyKey: idempotencyKeyValue },
      ),
    { surface: 'subscriptions.openBillingPortal' },
  )
  if (!portalResult.ok) {
    return { ok: false, error: portalResult.message, code: 'unknown' }
  }
  const portal = portalResult.data
  if (!portal.url) return { ok: false, error: 'Portal URL missing.', code: 'unknown' }
  return { ok: true, url: portal.url }
}
