// stripe-errors.ts — canonical Stripe error classifier + wrapper.
//
// Every Stripe API call in the codebase goes through `withStripeErrorHandling`.
// The wrapper catches errors thrown by the Stripe SDK, classifies them by
// Stripe's typed error hierarchy, and returns a discriminated `StripeResult<T>`.
// The caller then maps the typed `code` to a user-facing message and the
// appropriate action result.
//
// Why a wrapper and not just try/catch at each call site?
//  1. Stripe SDK has 12+ error subclasses (card_error, idempotency_error,
//     rate_limit_error, ...). Classifying them correctly at every call site
//     is repetitive and easy to get wrong.
//  2. We want one place that decides which errors log at warn vs error,
//     which include the request ID (for Stripe support), and which
//     fields are safe to surface to the user.
//  3. The pino redactor only sees known paths. A free-form `err.message`
//     from Stripe can leak user-facing copy into our logs — wrapping
//     extracts just the safe fields (code, type, statusCode) instead of
//     the full message.
//
// Per AGENTS.md: "No PII in logs. Ever. Mask emails, redact tokens, hash IDs."
// Stripe error messages never contain PII we care about, but we still log
// only the typed fields — never `err.message` — so we have a single,
// auditable log shape.
//
// Per PHASES.md P2.5: "All operations wrapped with `withStripeErrorHandling`."

import Stripe from 'stripe'
import { loggerFor } from '../log/pino'

/**
 * Typed Stripe failure codes. These are the codes we surface to callers;
 * they map 1:1 to the action-result codes the UI already shows.
 *
 * `unknown` is the catch-all. Most call sites map `unknown` to a generic
 * "Try again or contact support." — that's the right default for a 5xx
 * or a malformed Stripe error.
 */
export type StripeErrorCode =
  /** STRIPE_SECRET_KEY is empty / env not configured. */
  | 'stripe_unconfigured'
  /** The user's card was declined (StripeCardError with decline_code). */
  | 'card_declined'
  /** Stripe API key invalid / revoked / missing scopes. */
  | 'authentication_required'
  /** Bad params (StripeInvalidRequestError — 4xx other than auth/card). */
  | 'invalid_request'
  /** Too many requests (StripeRateLimitError — 429). */
  | 'rate_limited'
  /** Network / DNS / TLS error reaching Stripe (StripeConnectionError). */
  | 'api_connection'
  /** Stripe 5xx (StripeAPIError). */
  | 'api_error'
  /** Reused idempotency key with different params (StripeIdempotencyError). */
  | 'idempotency_conflict'
  /** Anything else — malformed error, network blip, etc. */
  | 'unknown'

/**
 * The failure half of `StripeResult<T>`. Carries only PII-safe fields.
 *
 * `message` is the user-facing copy the caller should surface. It's
 * chosen from a small static lookup (see `defaultUserMessage`) so we
 * never echo Stripe's raw error messages to end users — those can be
 * misleading or include internal terminology.
 *
 * `status`, `stripeCode`, `declineCode`, `stripeType`, `requestId`
 * are for server-side logging only. The pino redactor already covers
 * the well-known secret paths; we still keep this surface explicit so
 * a future maintainer adding a new log field doesn't accidentally log
 * something user-facing.
 */
export type StripeFailure = {
  ok: false
  code: StripeErrorCode
  message: string
  status?: number
  stripeCode?: string
  declineCode?: string
  stripeType?: string
  requestId?: string
}

export type StripeSuccess<T> = { ok: true; data: T }
export type StripeResult<T> = StripeSuccess<T> | StripeFailure

/**
 * Default user-facing messages keyed by `StripeErrorCode`. Callers may
 * override per-surface (e.g. "Could not start your subscription." for
 * the subscription flow vs "Could not process payment." for checkout),
 * but the default is always safe to surface.
 */
export const defaultUserMessage: Record<StripeErrorCode, string> = {
  stripe_unconfigured: 'Payments are temporarily disabled. Try again later.',
  card_declined: 'Your card was declined. Try a different payment method.',
  authentication_required: 'Payment service is misconfigured. Contact support.',
  invalid_request: 'Invalid payment request. Refresh and try again.',
  rate_limited: 'Too many requests. Wait a moment and try again.',
  api_connection: 'Could not reach the payment service. Try again.',
  api_error: 'The payment service had an error. Try again or contact support.',
  idempotency_conflict: 'This payment is already in progress. Refresh and try again.',
  unknown: 'Could not complete the request. Try again or contact support.',
}

/**
 * Build a `StripeFailure` with only the fields that have a value.
 * Required because `exactOptionalPropertyTypes: true` rejects assigning
 * `undefined` to an optional field — we have to omit the key entirely.
 */
function buildFailure(
  code: StripeErrorCode,
  status?: number,
  stripeCode?: string,
  declineCode?: string,
  stripeType?: string,
  requestId?: string,
): StripeFailure {
  const failure: StripeFailure = {
    ok: false,
    code,
    message: defaultUserMessage[code],
  }
  if (status !== undefined) failure.status = status
  if (stripeCode !== undefined) failure.stripeCode = stripeCode
  if (declineCode !== undefined) failure.declineCode = declineCode
  if (stripeType !== undefined) failure.stripeType = stripeType
  if (requestId !== undefined) failure.requestId = requestId
  return failure
}

/**
 * Classify any thrown value into a `StripeFailure`. Pure function —
 * no side effects, no logging. The wrapper logs after classifying.
 *
 * Recognises:
 *  - Stripe SDK errors (`StripeError` and its 11 subclasses)
 *  - Generic `Error` with `name === 'StripeError'` (older SDK shapes)
 *  - Anything else → `unknown`
 */
export function classifyStripeError(err: unknown): StripeFailure {
  // Stripe SDK throws errors with `type` discriminator. The base class
  // `StripeError` has `rawType` (the API-level type) and `type` (the SDK
  // class name). We prefer `rawType` because it matches the docs.
  if (err && typeof err === 'object' && 'rawType' in err && 'type' in err) {
    const e = err as Stripe.errors.StripeError
    const rawType = e.rawType
    const status = typeof e.statusCode === 'number' ? e.statusCode : undefined
    const requestId = e.requestId || undefined

    switch (rawType) {
      case 'card_error': {
        // CardError carries a `decline_code` and `code`. The decline_code
        // is the most specific — it's the reason the card was rejected.
        // `code` is the high-level error code (card_declined, etc.).
        const cardErr = err as Stripe.errors.StripeCardError
        return buildFailure(
          'card_declined',
          status,
          cardErr.code,
          cardErr.decline_code,
          rawType,
          requestId,
        )
      }
      case 'invalid_request_error':
        return buildFailure(
          'invalid_request',
          status,
          e.code,
          undefined,
          rawType,
          requestId,
        )
      case 'authentication_error':
        return buildFailure(
          'authentication_required',
          status,
          undefined,
          undefined,
          rawType,
          requestId,
        )
      case 'rate_limit_error':
        return buildFailure('rate_limited', status, undefined, undefined, rawType, requestId)
      case 'idempotency_error':
        // Reused idempotency key with different params. Stripe's docs
        // explicitly recommend retrying the request with a fresh key.
        return buildFailure(
          'idempotency_conflict',
          status,
          undefined,
          undefined,
          rawType,
          requestId,
        )
      case 'api_error':
        return buildFailure('api_error', status, undefined, undefined, rawType, requestId)
      case 'invalid_grant':
        // OAuth grant — not used in our flow, but classified for safety.
        return buildFailure(
          'authentication_required',
          status,
          undefined,
          undefined,
          rawType,
          requestId,
        )
      case 'temporary_session_expired':
        return buildFailure(
          'authentication_required',
          status,
          undefined,
          undefined,
          rawType,
          requestId,
        )
      default:
        return buildFailure('unknown', status, undefined, undefined, rawType, requestId)
    }
  }

  // StripeConnectionError doesn't carry `rawType` (it's not an API
  // response — the request never made it). Classify by SDK class name.
  if (err && typeof err === 'object' && 'type' in err) {
    const e = err as { type?: string }
    if (e.type === 'StripeConnectionError') {
      return buildFailure('api_connection')
    }
  }

  // Last resort: legacy SDK or unknown throw.
  return buildFailure('unknown')
}

/**
 * Wrap a Stripe SDK call so its errors become a `StripeFailure` we can
 * inspect. Logs PII-safe context (code, type, status, requestId) via pino
 * — never the raw Stripe error message, which can include user-facing
 * copy or product details.
 *
 * Usage:
 * ```ts
 * const res = await withStripeErrorHandling(
 *   () => stripe.checkout.sessions.create(params, { idempotencyKey }),
 *   { surface: 'checkout.createCheckoutSession' },
 * )
 * if (!res.ok) return { ok: false, error: res.message, code: 'payment_failed' }
 * const session = res.data
 * ```
 *
 * `surface` is the pino logger child component (e.g. `'checkout.create'`).
 * It's also stamped onto the failure for downstream tracing.
 */
export async function withStripeErrorHandling<T>(
  op: () => Promise<T>,
  context: { surface: string },
): Promise<StripeResult<T>> {
  const log = loggerFor({ component: `stripe.${context.surface}` })
  try {
    const data = await op()
    return { ok: true, data }
  } catch (err) {
    const failure = classifyStripeError(err)
    // PII-safe log shape. We deliberately omit `failure.message` from the
    // log entry — it's user-facing copy that pino would not redact, and
    // it's already chosen from `defaultUserMessage` (a static lookup).
    log.warn(
      {
        code: failure.code,
        stripe_code: failure.stripeCode,
        decline_code: failure.declineCode,
        stripe_type: failure.stripeType,
        status: failure.status,
        request_id: failure.requestId,
      },
      `stripe call failed: ${failure.code}`,
    )
    return failure
  }
}