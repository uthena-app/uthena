// Stripe wrapper. Env-gated: returns a "fail-closed" sentinel if
// STRIPE_SECRET_KEY is empty, so the rest of the app can import this
// without breaking the build. Call sites must check `isStripeConfigured()`
// before issuing a real call.
//
// This file is the canonical entry point for Stripe access. The error
// classifier + idempotency-key helpers live in sibling files
// (`stripe-errors.ts`, `stripe-idempotency.ts`) and are re-exported
// here so call sites only need one import.

import Stripe from 'stripe'
import { getEnv } from '@foundations/env'

let _client: Stripe | null = null

export function isStripeConfigured(): boolean {
  return Boolean(getEnv().STRIPE_SECRET_KEY)
}

/** Returns a configured Stripe client. Throws if not configured. */
export function getStripe(): Stripe {
  if (_client) return _client
  const env = getEnv()
  if (!env.STRIPE_SECRET_KEY) {
    throw new Error(
      '[stripe] STRIPE_SECRET_KEY is empty. Add it to .env.local or Doppler.',
    )
  }
  _client = new Stripe(env.STRIPE_SECRET_KEY, {
    apiVersion: '2025-02-24.acacia',
    typescript: true,
    appInfo: {
      name: 'Uthena',
      version: '0.1.0',
    },
  })
  return _client
}

/** Webhook signature verification helper. */
export function verifyWebhook(rawBody: string, signature: string): Stripe.Event {
  const env = getEnv()
  if (!env.STRIPE_WEBHOOK_SECRET) {
    throw new Error('[stripe] STRIPE_WEBHOOK_SECRET is empty.')
  }
  return getStripe().webhooks.constructEvent(rawBody, signature, env.STRIPE_WEBHOOK_SECRET)
}

// ---------------------------------------------------------------------------
// Re-exports — call sites only need to import from `@foundations/money/stripe`
// ---------------------------------------------------------------------------

export {
  withStripeErrorHandling,
  classifyStripeError,
  defaultUserMessage,
} from './stripe-errors'
export type {
  StripeErrorCode,
  StripeFailure,
  StripeSuccess,
  StripeResult,
} from './stripe-errors'

export {
  idempotencyKey,
  bucketedIdempotencyKey,
  STRIPE_IDEMPOTENCY_KEY_MAX_LENGTH,
} from './stripe-idempotency'