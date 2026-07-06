// startSubscription.ts — server action: opens a Stripe Checkout Session
// in 'subscription' mode for STRIPE_PRICE_PERSONAL_ACCESS_MONTHLY.
// Returns the URL for the client to redirect to.
//
// Idempotency: we don't have a way to make the redirect itself
// idempotent — the URL is single-use. The server action is safe to
// call multiple times: each call creates a new session (Stripe allows
// this), and the user ends up at the same place.
//
// P4.10 — Payment method picker:
//   - `payment_method_types` is intentionally not set; the Stripe
//     Dashboard's "Payment methods" config decides (Card / Apple Pay /
//     Google Pay / Link). Hard-coding `['card']` would block Apple Pay
//     on Safari/iOS even when the Dashboard has it enabled.
//   - For subscriptions, saved-payment-method UX is handled by the
//     Dashboard's Customer portal (`openBillingPortal.ts` already wires
//     it). On subscribe, we attach via `customer` when the user has a
//     prior `stripe_customer_id` so the new subscription lives on the
//     same Customer as any prior one-time purchases — keeps all of the
//     buyer's payment methods in one place.

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

const log = loggerFor({ component: 'subscriptions.startSubscription' })

const StartSchema = z.object({
  // Future: plan tier, trial flag, etc. v1: no inputs.
}).strict()

export type StartSubscriptionResult =
  | { ok: true; url: string }
  | { ok: false; error: string; code?: 'not_authed' | 'stripe_unconfigured' | 'price_unconfigured' | 'unknown' }

export async function startSubscriptionAction(
  _raw: FormData | Record<string, unknown> = {},
): Promise<StartSubscriptionResult> {
  // _raw kept for API symmetry with the other actions; v1 takes no input.
  const parsed = StartSchema.safeParse({})
  if (!parsed.success) return { ok: false, error: 'Invalid request.', code: 'unknown' }

  const user = await getSessionUser()
  if (!user) return { ok: false, error: 'Sign in to start a subscription.', code: 'not_authed' }

  if (!isStripeConfigured()) {
    return {
      ok: false,
      error: 'Subscriptions are temporarily disabled. Add STRIPE_SECRET_KEY to enable.',
      code: 'stripe_unconfigured',
    }
  }

  const env = getEnv()
  const priceId = env.STRIPE_PRICE_PERSONAL_ACCESS_MONTHLY
  if (!priceId) {
    return {
      ok: false,
      error:
        'STRIPE_PRICE_PERSONAL_ACCESS_MONTHLY is not configured. Add it to .env.local to enable subscriptions.',
      code: 'price_unconfigured',
    }
  }

  const stripe = getStripe()
  const origin = (await headers()).get('origin') ?? env.NEXT_PUBLIC_APP_URL

  // P4.10 — saved payment methods. Look up the buyer's prior
  // `stripe_customer_id` so the new Subscription attaches to the same
  // Customer as any prior one-time purchases. Fail-soft: a missing row
  // means a first-time subscriber, which is fine — Stripe will create
  // a Customer on payment success and `onSubscriptionChange` writes the
  // ID back to the subscription row for next time.
  const supabase = await getServerSupabase()
  const { data: priorOrder } = await supabase
    .from('orders')
    .select('stripe_customer_id')
    .eq('user_id', user.id)
    .not('stripe_customer_id', 'is', null)
    .order('id', { ascending: false })
    .limit(1)
    .maybeSingle()
  const stripeCustomerId: string | null = priorOrder?.stripe_customer_id ?? null

  // Idempotency: 30s bucket keyed on (user, price). Retries within 30s
  // return the cached session; clicking Subscribe again after 30s gets a
  // fresh session. This matches the prompt the user sees after clicking.
  const idempotencyKeyValue = bucketedIdempotencyKey(
    'sub_session',
    30,
    user.id,
    priceId,
  )
  const sessionResult = await withStripeErrorHandling(
    () =>
      stripe.checkout.sessions.create(
        {
          mode: 'subscription',
          // P4.10 — payment_method_types intentionally omitted so the
          // Dashboard's Payment-methods config decides what's offered.
          line_items: [{ price: priceId, quantity: 1 }],
          // P4.10 — `customer` first (returning buyer → saved methods);
          // fall back to `customer_email` for first-time subscribers.
          ...(stripeCustomerId
            ? { customer: stripeCustomerId }
            : user.email
              ? { customer_email: user.email }
              : {}),
          // Subscription metadata — webhook reads these to populate the row.
          metadata: { user_id: user.id, plan: 'personal_access' },
          subscription_data: {
            metadata: { user_id: user.id, plan: 'personal_access' },
          },
          success_url: `${origin}/account/subscriptions?welcome=1`,
          cancel_url: `${origin}/account/subscriptions?canceled=1`,
          // Allow promo codes at the Stripe Checkout (user-typed).
          allow_promotion_codes: true,
        },
        { idempotencyKey: idempotencyKeyValue },
      ),
    { surface: 'subscriptions.startSubscription' },
  )
  if (!sessionResult.ok) {
    return { ok: false, error: sessionResult.message, code: 'unknown' }
  }
  const session = sessionResult.data
  log.info(
    {
      user_id: user.id,
      session_id: session.id,
      attached_to_prior_customer: Boolean(stripeCustomerId),
    },
    'subscription checkout session created',
  )
  if (!session.url) {
    return { ok: false, error: 'Stripe did not return a redirect URL.', code: 'unknown' }
  }
  return { ok: true, url: session.url }
}
