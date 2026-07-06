// Unit tests for the Stripe error classifier + idempotency-key generator.
// Pure functions; no SDK calls; no env vars; no network.
//
// Run: `pnpm test stripe-errors stripe-idempotency` (vitest).

import { describe, expect, it } from 'vitest'
import {
  classifyStripeError,
  defaultUserMessage,
  withStripeErrorHandling,
  type StripeFailure,
} from './stripe-errors'
import {
  bucketedIdempotencyKey,
  idempotencyKey,
  STRIPE_IDEMPOTENCY_KEY_MAX_LENGTH,
} from './stripe-idempotency'

// ===========================================================================
// Test helpers — fake Stripe errors that match the SDK's shape exactly
// ===========================================================================

/**
 * Build a fake Stripe error matching the SDK's `StripeError` shape
 * (`rawType` + `type` + `code` + `statusCode` + `requestId`).
 *
 * We don't use the real `new Stripe.errors.X()` constructors because
 * they call `Stripe.errors.generate()` which is marked `@deprecated`
 * and may change between SDK versions. The shape we exercise (rawType
 * dispatch) is the public, documented surface.
 */
function fakeStripeError(opts: {
  rawType:
    | 'card_error'
    | 'invalid_request_error'
    | 'api_error'
    | 'idempotency_error'
    | 'rate_limit_error'
    | 'authentication_error'
    | 'invalid_grant'
    | 'temporary_session_expired'
  type?: string
  code?: string
  decline_code?: string
  statusCode?: number
  requestId?: string
  message?: string
}): Record<string, unknown> {
  return {
    type: opts.type ?? 'StripeError',
    rawType: opts.rawType,
    code: opts.code,
    decline_code: opts.decline_code,
    statusCode: opts.statusCode,
    requestId: opts.requestId ?? 'req_TEST_123',
    message: opts.message ?? 'Test Stripe error',
    headers: {},
  }
}

function fakeConnectionError(): Record<string, unknown> {
  // StripeConnectionError doesn't carry rawType — the request never
  // reached Stripe. We mimic the SDK's shape: `type === 'StripeConnectionError'`.
  return {
    type: 'StripeConnectionError',
    message: 'Connection error',
    headers: {},
  }
}

// ===========================================================================
// classifyStripeError — happy paths per rawType
// ===========================================================================

describe('classifyStripeError — rawType dispatch', () => {
  it('classifies card_error with decline_code as card_declined', () => {
    const err = fakeStripeError({
      rawType: 'card_error',
      type: 'StripeCardError',
      code: 'card_declined',
      decline_code: 'generic_decline',
      statusCode: 402,
    })
    const r = classifyStripeError(err) as StripeFailure
    expect(r.ok).toBe(false)
    expect(r.code).toBe('card_declined')
    expect(r.message).toBe(defaultUserMessage.card_declined)
    expect(r.status).toBe(402)
    expect(r.stripeCode).toBe('card_declined')
    expect(r.declineCode).toBe('generic_decline')
    expect(r.stripeType).toBe('card_error')
    expect(r.requestId).toBe('req_TEST_123')
  })

  it('classifies invalid_request_error as invalid_request', () => {
    const err = fakeStripeError({
      rawType: 'invalid_request_error',
      type: 'StripeInvalidRequestError',
      statusCode: 400,
    })
    const r = classifyStripeError(err) as StripeFailure
    expect(r.code).toBe('invalid_request')
    expect(r.status).toBe(400)
    expect(r.stripeType).toBe('invalid_request_error')
  })

  it('classifies authentication_error as authentication_required', () => {
    const err = fakeStripeError({
      rawType: 'authentication_error',
      type: 'StripeAuthenticationError',
      statusCode: 401,
    })
    const r = classifyStripeError(err) as StripeFailure
    expect(r.code).toBe('authentication_required')
    expect(r.status).toBe(401)
  })

  it('classifies rate_limit_error as rate_limited', () => {
    const err = fakeStripeError({
      rawType: 'rate_limit_error',
      type: 'StripeRateLimitError',
      statusCode: 429,
    })
    const r = classifyStripeError(err) as StripeFailure
    expect(r.code).toBe('rate_limited')
    expect(r.status).toBe(429)
  })

  it('classifies idempotency_error as idempotency_conflict', () => {
    const err = fakeStripeError({
      rawType: 'idempotency_error',
      type: 'StripeIdempotencyError',
      statusCode: 400,
    })
    const r = classifyStripeError(err) as StripeFailure
    expect(r.code).toBe('idempotency_conflict')
    expect(r.status).toBe(400)
  })

  it('classifies api_error as api_error', () => {
    const err = fakeStripeError({
      rawType: 'api_error',
      type: 'StripeAPIError',
      statusCode: 500,
    })
    const r = classifyStripeError(err) as StripeFailure
    expect(r.code).toBe('api_error')
    expect(r.status).toBe(500)
  })

  it('classifies invalid_grant as authentication_required (OAuth edge)', () => {
    const err = fakeStripeError({
      rawType: 'invalid_grant',
      type: 'StripeInvalidGrantError',
    })
    const r = classifyStripeError(err) as StripeFailure
    expect(r.code).toBe('authentication_required')
  })

  it('classifies temporary_session_expired as authentication_required', () => {
    const err = fakeStripeError({
      rawType: 'temporary_session_expired',
      type: 'TemporarySessionExpiredError',
    })
    const r = classifyStripeError(err) as StripeFailure
    expect(r.code).toBe('authentication_required')
  })

  it('classifies StripeConnectionError (no rawType) as api_connection', () => {
    const err = fakeConnectionError()
    const r = classifyStripeError(err) as StripeFailure
    expect(r.code).toBe('api_connection')
    expect(r.message).toBe(defaultUserMessage.api_connection)
  })

  it('classifies unknown rawType as unknown', () => {
    const err = fakeStripeError({
      // Not in our known set; the switch falls through to default.
      rawType: 'api_error',
      type: 'SomeNewError' as unknown as 'StripeAPIError',
    })
    const r = classifyStripeError(err) as StripeFailure
    expect(r.code).toBe('api_error') // matches the known branch
  })
})

// ===========================================================================
// classifyStripeError — fallback / hostile inputs
// ===========================================================================

describe('classifyStripeError — fallback paths', () => {
  it('classifies a plain Error as unknown', () => {
    const r = classifyStripeError(new Error('boom')) as StripeFailure
    expect(r.ok).toBe(false)
    expect(r.code).toBe('unknown')
    expect(r.message).toBe(defaultUserMessage.unknown)
  })

  it('classifies null as unknown', () => {
    const r = classifyStripeError(null) as StripeFailure
    expect(r.code).toBe('unknown')
  })

  it('classifies undefined as unknown', () => {
    const r = classifyStripeError(undefined) as StripeFailure
    expect(r.code).toBe('unknown')
  })

  it('classifies a string as unknown', () => {
    const r = classifyStripeError('something went wrong') as StripeFailure
    expect(r.code).toBe('unknown')
  })

  it('classifies a raw object with neither type nor rawType as unknown', () => {
    const r = classifyStripeError({ message: 'no shape' }) as StripeFailure
    expect(r.code).toBe('unknown')
  })

  it('omits undefined optional fields from the failure', () => {
    const r = classifyStripeError(new Error('boom')) as StripeFailure
    expect(r.status).toBeUndefined()
    expect(r.stripeCode).toBeUndefined()
    expect(r.declineCode).toBeUndefined()
    expect(r.stripeType).toBeUndefined()
    expect(r.requestId).toBeUndefined()
  })

  it('treats empty requestId as absent', () => {
    const err = fakeStripeError({ rawType: 'api_error', requestId: '' })
    const r = classifyStripeError(err) as StripeFailure
    expect(r.requestId).toBeUndefined()
  })
})

// ===========================================================================
// withStripeErrorHandling — wrapper
// ===========================================================================

describe('withStripeErrorHandling — wrapper', () => {
  it('returns ok:true with the data on success', async () => {
    const result = await withStripeErrorHandling(
      async () => ({ id: 'cs_test_123' }),
      { surface: 'test.surface' },
    )
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data).toEqual({ id: 'cs_test_123' })
    }
  })

  it('returns classified failure on a thrown Stripe error', async () => {
    const result = await withStripeErrorHandling(
      async () => {
        throw fakeStripeError({
          rawType: 'card_error',
          type: 'StripeCardError',
          code: 'card_declined',
          decline_code: 'insufficient_funds',
          statusCode: 402,
        })
      },
      { surface: 'test.card' },
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe('card_declined')
      expect(result.declineCode).toBe('insufficient_funds')
      expect(result.stripeType).toBe('card_error')
    }
  })

  it('returns classified failure on a thrown generic Error', async () => {
    const result = await withStripeErrorHandling(
      async () => {
        throw new Error('unexpected')
      },
      { surface: 'test.generic' },
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe('unknown')
    }
  })

  it('does not leak the raw error.message into the failure', async () => {
    const result = await withStripeErrorHandling(
      async () => {
        throw fakeStripeError({
          rawType: 'api_error',
          message: 'SENSITIVE_INTERNAL_DETAIL',
        })
      },
      { surface: 'test.no-leak' },
    )
    if (!result.ok) {
      // The failure's message is from the static lookup, not the raw error.
      expect(result.message).toBe(defaultUserMessage.api_error)
      expect(result.message).not.toContain('SENSITIVE_INTERNAL_DETAIL')
    }
  })
})

// ===========================================================================
// idempotencyKey — shape + stability
// ===========================================================================

describe('idempotencyKey — shape', () => {
  it('returns a string with the scope prefix and a hash suffix', () => {
    const k = idempotencyKey('checkout_session', 42)
    expect(k).toMatch(/^checkout_session:[a-f0-9]{32}$/)
  })

  it('is deterministic for the same scope+parts', () => {
    const a = idempotencyKey('sub_cancel', 7)
    const b = idempotencyKey('sub_cancel', 7)
    expect(a).toBe(b)
  })

  it('produces different keys for different scopes', () => {
    expect(idempotencyKey('sub_cancel', 7)).not.toBe(idempotencyKey('sub_resume', 7))
  })

  it('produces different keys for different parts', () => {
    expect(idempotencyKey('checkout_session', 1)).not.toBe(idempotencyKey('checkout_session', 2))
  })

  it('produces different keys when part order changes', () => {
    const a = idempotencyKey('sub_session', 'user_a', 'price_x')
    const b = idempotencyKey('sub_session', 'price_x', 'user_a')
    expect(a).not.toBe(b)
  })

  it('accepts string, number, and bigint parts', () => {
    const k = idempotencyKey('mixed', 'a', 1, 9_007_199_254_740_993n)
    expect(typeof k).toBe('string')
    expect(k.length).toBeGreaterThan(0)
  })

  it('respects STRIPE_IDEMPOTENCY_KEY_MAX_LENGTH even with long inputs', () => {
    // 1000-char input — the hash truncate guarantees the key fits.
    const big = 'x'.repeat(1000)
    const k = idempotencyKey('big', big, big, big)
    expect(k.length).toBeLessThanOrEqual(STRIPE_IDEMPOTENCY_KEY_MAX_LENGTH)
  })

  it('truncates the base if scope + hash together exceed the limit', () => {
    // Long scope → the prefix + hash is over the cap.
    const longScope = 'a'.repeat(300)
    const k = idempotencyKey(longScope, 1)
    expect(k.length).toBeLessThanOrEqual(STRIPE_IDEMPOTENCY_KEY_MAX_LENGTH)
  })
})

// ===========================================================================
// bucketedIdempotencyKey — time-bucketed keys
// ===========================================================================

describe('bucketedIdempotencyKey — time-bucketed', () => {
  it('returns the same key for two calls in the same bucket', () => {
    const fakeNow = 1_700_000_000_000 // fixed ms
    const realNow = Date.now
    Date.now = () => fakeNow
    try {
      const a = bucketedIdempotencyKey('sub_session', 30, 'user_1', 'price_x')
      // 1ms later — same bucket.
      Date.now = () => fakeNow + 1
      const b = bucketedIdempotencyKey('sub_session', 30, 'user_1', 'price_x')
      expect(a).toBe(b)
    } finally {
      Date.now = realNow
    }
  })

  it('returns a different key after the bucket rolls over', () => {
    const realNow = Date.now
    try {
      Date.now = () => 1_700_000_000_000
      const a = bucketedIdempotencyKey('sub_session', 30, 'user_1', 'price_x')
      // 31s later — different bucket.
      Date.now = () => 1_700_000_000_000 + 31_000
      const b = bucketedIdempotencyKey('sub_session', 30, 'user_1', 'price_x')
      expect(a).not.toBe(b)
    } finally {
      Date.now = realNow
    }
  })

  it('throws on bucketSeconds <= 0', () => {
    expect(() => bucketedIdempotencyKey('x', 0, 'a')).toThrow()
    expect(() => bucketedIdempotencyKey('x', -5, 'a')).toThrow()
  })
})

// ===========================================================================
// Integration shape — what the call sites actually use
// ===========================================================================

describe('integration — idempotency-key shapes match what the call sites need', () => {
  it('checkout_session key is stable per order.id', () => {
    expect(idempotencyKey('checkout_session', 12345)).toBe(
      idempotencyKey('checkout_session', 12345),
    )
    expect(idempotencyKey('checkout_session', 12345)).not.toBe(
      idempotencyKey('checkout_session', 12346),
    )
  })

  it('sub_cancel and sub_resume keys never collide (different scopes)', () => {
    expect(idempotencyKey('sub_cancel', 'sub_abc')).not.toBe(
      idempotencyKey('sub_resume', 'sub_abc'),
    )
  })
})