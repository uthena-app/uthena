// Unit tests for the webhook middleware in 04-platform/webhooks/_middleware.ts.
//
// Covers the P3.4 contract:
//   - claimWebhookEvent: happy path inserts a row, duplicate path returns
//     { claimed: false } on the unique-constraint violation, oversized
//     payload is truncated defensively
//   - finalizeWebhookEvent: writes result + processed_at; error_message
//     capped at 2 KB; missing row is logged and not an error
//   - releaseWebhookEvent: deletes the row; missing row is logged and
//     not an error
//
// Strategy: vi.mock @foundations/data/supabase so the service-role
// client is a chainable fake. Each test sets up the next response
// via `mockResponse` before invoking the middleware.

import { beforeEach, describe, expect, it, vi } from 'vitest'

/** Record of every call made to the fake chain, in order. The test
 *  reads this to assert what the middleware did. */
type CallRecord =
  | { method: 'insert'; payload: unknown }
  | { method: 'update'; payload: unknown }
  | { method: 'delete' }
  | { method: 'eq'; col: string; val: unknown }

/** Build a chainable fake that records every method call into the
 *  provided `calls` array. The terminal await returns
 *  `terminalResponse`. */
function makeChain(
  calls: CallRecord[],
  terminalResponse: { data: unknown; error: unknown },
) {
  const chain: any = {
    insert(payload: unknown) {
      calls.push({ method: 'insert', payload })
      return chain
    },
    update(payload: unknown) {
      calls.push({ method: 'update', payload })
      return chain
    },
    delete() {
      calls.push({ method: 'delete' })
      return chain
    },
    eq(col: string, val: unknown) {
      calls.push({ method: 'eq', col, val })
      return chain
    },
    // PostgREST contract: a query chain is awaitable. The terminal
    // call's result is `{ data, error }`.
    then(resolve: (v: unknown) => void) {
      resolve(terminalResponse)
    },
  }
  return chain
}

// One shared calls array + one shared terminal response. The from()
// mock returns a chain built from these shared values, so the test
// can read what happened after the middleware ran.
const calls: CallRecord[] = []
let terminalResponse: { data: unknown; error: unknown } = { data: null, error: null }

const fakeService = {
  from: vi.fn((_table: string) => makeChain(calls, terminalResponse)),
}

vi.mock('@foundations/data/supabase', () => ({
  getServiceSupabase: vi.fn(() => fakeService),
}))

// Pino's loggerFor() pulls in env() which pulls in process.env. Mock
// the logger to a no-op so the test doesn't depend on env wiring.
vi.mock('@foundations/log/pino', () => ({
  loggerFor: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))

// Import AFTER mocks so the module binds to the mocked deps.
const { claimWebhookEvent, finalizeWebhookEvent, releaseWebhookEvent } =
  await import('./_middleware')

beforeEach(() => {
  calls.length = 0
  terminalResponse = { data: null, error: null }
  fakeService.from.mockClear()
})

describe('claimWebhookEvent', () => {
  it('returns { claimed: true, payload } on the first call', async () => {
    const payload = { id: 'evt_123', type: 'payment_intent.succeeded' }
    const result = await claimWebhookEvent('stripe', 'evt_123', 'payment_intent.succeeded', payload)

    expect(result.claimed).toBe(true)
    if (result.claimed) {
      expect(result.payload).toEqual(payload)
    }
    // The insert carried source + event_id + event_type + payload.
    // result is intentionally omitted (column is nullable in 0025).
    const insertCall = calls.find((c) => c.method === 'insert')
    expect(insertCall).toBeDefined()
    if (insertCall && insertCall.method === 'insert') {
      expect(insertCall.payload).toMatchObject({
        source: 'stripe',
        event_id: 'evt_123',
        event_type: 'payment_intent.succeeded',
        payload,
      })
      // The insert payload should NOT carry `result` — column is nullable.
      expect(insertCall.payload).not.toHaveProperty('result')
    }
  })

  it('returns { claimed: false } on the unique-constraint duplicate (Postgres 23505)', async () => {
    terminalResponse = {
      data: null,
      error: { code: '23505', message: 'duplicate key value violates unique constraint' },
    }

    const result = await claimWebhookEvent('stripe', 'evt_dup', 'payment_intent.succeeded', {})

    expect(result.claimed).toBe(false)
  })

  it('returns { claimed: false } when the error message matches /duplicate key/i (text fallback)', async () => {
    // Some PostgREST paths return 409 with a different code but the
    // message still contains "duplicate key". Defensive fallback.
    terminalResponse = {
      data: null,
      error: { code: 'PGRST409', message: 'duplicate key value violates unique constraint' },
    }

    const result = await claimWebhookEvent('stripe', 'evt_dup', 'payment_intent.succeeded', {})

    expect(result.claimed).toBe(false)
  })

  it('throws on non-duplicate errors (lets the caller 500 the webhook)', async () => {
    terminalResponse = { data: null, error: { code: 'PGRST500', message: 'connection reset' } }

    await expect(
      claimWebhookEvent('stripe', 'evt_x', 'payment_intent.succeeded', {}),
    ).rejects.toThrow('connection reset')
  })

  it('truncates oversized payloads to a truncation marker under the 64 KB cap', async () => {
    // Build a 100 KB string payload.
    const bigString = 'x'.repeat(100 * 1024)
    const bigPayload = { data: bigString }

    await claimWebhookEvent('stripe', 'evt_big', 'payment_intent.succeeded', bigPayload)

    const insertCall = calls.find((c) => c.method === 'insert')
    expect(insertCall).toBeDefined()
    if (insertCall && insertCall.method === 'insert') {
      const stored = insertCall.payload as {
        payload: {
          __uthena_truncated: boolean
          event_id: string
          event_type: string
          original_bytes: number
        }
      }
      // Stored as a marker, not the body. Marker carries the
      // correlation metadata for support to find the event in
      // the source's dashboard.
      expect(stored.payload.__uthena_truncated).toBe(true)
      expect(stored.payload.event_id).toBe('evt_big')
      expect(stored.payload.event_type).toBe('payment_intent.succeeded')
      expect(stored.payload.original_bytes).toBeGreaterThan(64 * 1024)
      // The marker itself is small.
      expect(JSON.stringify(stored.payload).length).toBeLessThan(64 * 1024)
    }
  })

  it('keeps small payloads untouched', async () => {
    const small = { id: 'evt_1', amount: 1000 }
    await claimWebhookEvent('stripe', 'evt_1', 'payment_intent.succeeded', small)

    const insertCall = calls.find((c) => c.method === 'insert')
    expect(insertCall).toBeDefined()
    if (insertCall && insertCall.method === 'insert') {
      expect(insertCall.payload).toMatchObject({ payload: small })
    }
  })

  it('coerces null/undefined payload to an empty object', async () => {
    await claimWebhookEvent('stripe', 'evt_null', 'ping', null as unknown as object)

    const insertCall = calls.find((c) => c.method === 'insert')
    expect(insertCall).toBeDefined()
    if (insertCall && insertCall.method === 'insert') {
      expect((insertCall.payload as { payload: unknown }).payload).toEqual({})
    }
  })
})

describe('finalizeWebhookEvent', () => {
  it('writes result + processed_at on success', async () => {
    await finalizeWebhookEvent('stripe', 'evt_1', 'processed')

    const updateCall = calls.find((c) => c.method === 'update')
    expect(updateCall).toBeDefined()
    if (updateCall && updateCall.method === 'update') {
      expect(updateCall.payload).toMatchObject({ result: 'processed' })
      const updatePayload = updateCall.payload as { result: string; processed_at: string }
      expect(updatePayload.processed_at).toMatch(/^\d{4}-\d{2}-\d{2}T/) // ISO timestamp
      expect(updateCall.payload).not.toHaveProperty('error_message')
    }

    // The chain filters by source + event_id.
    const eqCalls = calls.filter((c) => c.method === 'eq')
    expect(eqCalls).toEqual([
      { method: 'eq', col: 'source', val: 'stripe' },
      { method: 'eq', col: 'event_id', val: 'evt_1' },
    ])
  })

  it('writes result + processed_at + error_message on failure', async () => {
    await finalizeWebhookEvent('bunny', 'vid_42', 'failed', 'encoding timed out')

    const updateCall = calls.find((c) => c.method === 'update')
    expect(updateCall).toBeDefined()
    if (updateCall && updateCall.method === 'update') {
      const updatePayload = updateCall.payload as {
        result: string
        processed_at: string
        error_message: string
      }
      expect(updatePayload.result).toBe('failed')
      expect(updatePayload.processed_at).toBeDefined()
      expect(updatePayload.error_message).toBe('encoding timed out')
    }
  })

  it('caps error_message at 2 KB defensively', async () => {
    const longError = 'E'.repeat(5 * 1024)
    await finalizeWebhookEvent('stripe', 'evt_x', 'failed', longError)

    const updateCall = calls.find((c) => c.method === 'update')
    expect(updateCall).toBeDefined()
    if (updateCall && updateCall.method === 'update') {
      const updatePayload = updateCall.payload as { error_message: string }
      expect(updatePayload.error_message.length).toBe(2048)
    }
  })

  it('does not throw when the row is missing (UPDATE returns 0 rows, RLS-aware)', async () => {
    // UPDATE on a non-existent row is not an error in Postgres; the
    // PostgREST response is `{ data: [], error: null }`. The middleware
    // should treat that as a no-op.
    terminalResponse = { data: [], error: null }

    await expect(
      finalizeWebhookEvent('stripe', 'evt_missing', 'processed'),
    ).resolves.toBeUndefined()
  })

  it('swallows RLS/PostgREST errors (logs and moves on)', async () => {
    // The middleware logs finalize failures as warnings but does NOT
    // throw — the webhook source has already seen a successful
    // response from us; we can't unwind that. An UPDATE failure here
    // means the audit log is incomplete, not that the event was lost.
    terminalResponse = { data: null, error: { code: 'PGRST403', message: 'permission denied' } }

    await expect(
      finalizeWebhookEvent('stripe', 'evt_x', 'processed'),
    ).resolves.toBeUndefined()
  })

  it('accepts all three WebhookOutcome values', async () => {
    for (const outcome of ['processed', 'skipped', 'failed'] as const) {
      calls.length = 0
      await finalizeWebhookEvent('stripe', `evt_${outcome}`, outcome)
      const updateCall = calls.find((c) => c.method === 'update')
      expect(updateCall).toBeDefined()
      if (updateCall && updateCall.method === 'update') {
        expect((updateCall.payload as { result: string }).result).toBe(outcome)
      }
    }
  })
})

describe('releaseWebhookEvent', () => {
  it('deletes the row by source + event_id', async () => {
    await releaseWebhookEvent('stripe', 'evt_1')

    expect(calls.some((c) => c.method === 'delete')).toBe(true)
    const eqCalls = calls.filter((c) => c.method === 'eq')
    expect(eqCalls).toEqual([
      { method: 'eq', col: 'source', val: 'stripe' },
      { method: 'eq', col: 'event_id', val: 'evt_1' },
    ])
  })

  it('does not throw when the row is already gone', async () => {
    // DELETE on a non-existent row is `{ data: [], error: null }` in
    // PostgREST. The middleware should treat that as success (the row
    // is gone, which is the intended state).
    terminalResponse = { data: [], error: null }

    await expect(
      releaseWebhookEvent('stripe', 'evt_missing'),
    ).resolves.toBeUndefined()
  })

  it('swallows PostgREST errors (logs warn, does not throw)', async () => {
    terminalResponse = { data: null, error: { code: 'PGRST500', message: 'connection reset' } }

    await expect(releaseWebhookEvent('stripe', 'evt_x')).resolves.toBeUndefined()
  })
})
