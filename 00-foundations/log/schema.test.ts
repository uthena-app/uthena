// Unit tests for `00-foundations/log/schema.ts`.
//
// Covers:
//   - `LOG_EVENTS` is the canonical event catalog (lowercase, dot-namespaced).
//   - `LogActorSchema` validates all four actor shapes (user / admin /
//     anon / system) and rejects malformed inputs.
//   - `LogSubjectSchema` validates every subject kind.
//   - `LogContextSchema` requires `component` and accepts the optional
//     `req_id` / `surface` / `duration_ms` + pass-through extras.
//   - `LogEntrySchema` accepts a full entry with all four keys + an
//     entry with `context` only (the minimum viable shape).
//
// Most assertions target Zod parse behavior (the runtime contract);
// the TypeScript types are inferred from the schemas via `z.infer`,
// so a test that round-trips a value through the schema confirms
// both the runtime contract and that the TS types match.

import { describe, expect, it } from 'vitest'
import {
  LOG_EVENTS,
  LogActorSchema,
  LogContextSchema,
  LogEntrySchema,
  LogSubjectSchema,
} from './schema'

describe('LOG_EVENTS', () => {
  it('contains at least one entry per documented surface', () => {
    expect(LOG_EVENTS.length).toBeGreaterThan(20)
  })

  it('every name is lowercase', () => {
    for (const name of LOG_EVENTS) {
      expect(name).toBe(name.toLowerCase())
    }
  })

  it('every name is dot-namespaced (surface.verb)', () => {
    for (const name of LOG_EVENTS) {
      expect(name).toMatch(/^[a-z][a-z0-9_]*\.[a-z][a-z0-9_.]*$/)
    }
  })

  it('has no duplicates', () => {
    expect(new Set(LOG_EVENTS).size).toBe(LOG_EVENTS.length)
  })
})

describe('LogActorSchema', () => {
  it('accepts user actor', () => {
    const r = LogActorSchema.safeParse({ kind: 'user', user_id: '11111111-2222-3333-4444-555555555555' })
    expect(r.success).toBe(true)
  })

  it('accepts admin actor', () => {
    const r = LogActorSchema.safeParse({
      kind: 'admin',
      user_id: '11111111-2222-3333-4444-555555555555',
      admin_id: '22222222-3333-4444-5555-666666666666',
    })
    expect(r.success).toBe(true)
  })

  it('accepts anon actor (ip_hash 64 hex)', () => {
    const r = LogActorSchema.safeParse({
      kind: 'anon',
      ip_hash: 'a'.repeat(64),
    })
    expect(r.success).toBe(true)
  })

  it('accepts system actor', () => {
    const r = LogActorSchema.safeParse({ kind: 'system' })
    expect(r.success).toBe(true)
  })

  it('rejects user actor with non-uuid user_id', () => {
    const r = LogActorSchema.safeParse({ kind: 'user', user_id: 'not-a-uuid' })
    expect(r.success).toBe(false)
  })

  it('rejects anon actor with wrong-length ip_hash', () => {
    const r = LogActorSchema.safeParse({ kind: 'anon', ip_hash: 'short' })
    expect(r.success).toBe(false)
  })

  it('rejects unknown actor kind', () => {
    const r = LogActorSchema.safeParse({ kind: 'guest', user_id: 'x' })
    expect(r.success).toBe(false)
  })
})

describe('LogSubjectSchema', () => {
  it('accepts product', () => {
    expect(LogSubjectSchema.safeParse({ kind: 'product', product_id: 1 }).success).toBe(true)
  })

  it('accepts order (uuid)', () => {
    expect(
      LogSubjectSchema.safeParse({ kind: 'order', order_id: '11111111-2222-3333-4444-555555555555' })
        .success,
    ).toBe(true)
  })

  it('accepts cart_line', () => {
    expect(
      LogSubjectSchema.safeParse({
        kind: 'cart_line',
        cart_id: '11111111-2222-3333-4444-555555555555',
        product_id: 1,
        license: 'plr',
      }).success,
    ).toBe(true)
  })

  it('accepts payout (uuid + partner_slug)', () => {
    expect(
      LogSubjectSchema.safeParse({
        kind: 'payout',
        payout_id: '11111111-2222-3333-4444-555555555555',
        partner_slug: 'cool-partner',
      }).success,
    ).toBe(true)
  })

  it('accepts webhook (provider + event_id)', () => {
    expect(
      LogSubjectSchema.safeParse({
        kind: 'webhook',
        provider: 'stripe',
        event_id: 'evt_123',
      }).success,
    ).toBe(true)
  })

  it('rejects product with non-positive id', () => {
    expect(LogSubjectSchema.safeParse({ kind: 'product', product_id: 0 }).success).toBe(false)
    expect(LogSubjectSchema.safeParse({ kind: 'product', product_id: -1 }).success).toBe(false)
  })

  it('rejects order with non-uuid id', () => {
    expect(LogSubjectSchema.safeParse({ kind: 'order', order_id: 'not-uuid' }).success).toBe(false)
  })

  it('rejects unknown subject kind', () => {
    expect(LogSubjectSchema.safeParse({ kind: 'banana', id: 1 }).success).toBe(false)
  })
})

describe('LogContextSchema', () => {
  it('requires component', () => {
    expect(LogContextSchema.safeParse({ component: 'cart.addToCart' }).success).toBe(true)
    expect(LogContextSchema.safeParse({}).success).toBe(false)
  })

  it('accepts req_id + surface + duration_ms', () => {
    const r = LogContextSchema.safeParse({
      component: 'library.mintDownloadUrl',
      req_id: '11111111-2222-3333-4444-555555555555',
      surface: 'library',
      duration_ms: 12,
    })
    expect(r.success).toBe(true)
  })

  it('rejects negative duration_ms', () => {
    expect(
      LogContextSchema.safeParse({ component: 'x', duration_ms: -1 }).success,
    ).toBe(false)
  })

  it('allows pass-through extras (anything not in the strict shape)', () => {
    const r = LogContextSchema.safeParse({
      component: 'cart.addToCart',
      order_id: '11111111-2222-3333-4444-555555555555',
      custom_metric: 42,
    })
    expect(r.success).toBe(true)
    if (r.success) {
      // The extras pass through the .passthrough() hook.
      expect(r.data.order_id).toBe('11111111-2222-3333-4444-555555555555')
      expect(r.data.custom_metric).toBe(42)
    }
  })
})

describe('LogEntrySchema', () => {
  it('accepts a minimal entry (event + context only)', () => {
    const r = LogEntrySchema.safeParse({
      event: 'cart.added',
      context: { component: 'cart.addToCart' },
    })
    expect(r.success).toBe(true)
  })

  it('accepts a full entry with actor + subject', () => {
    const r = LogEntrySchema.safeParse({
      event: 'cart.added',
      actor: { kind: 'user', user_id: '11111111-2222-3333-4444-555555555555' },
      subject: { kind: 'cart_line', cart_id: '22222222-3333-4444-5555-666666666666', product_id: 1, license: 'plr' },
      context: {
        component: 'cart.addToCart',
        req_id: '33333333-4444-5555-6666-777777777777',
        duration_ms: 7,
      },
    })
    expect(r.success).toBe(true)
  })

  it('rejects an unknown event name', () => {
    const r = LogEntrySchema.safeParse({
      event: 'banana.smoothie',
      context: { component: 'x' },
    })
    expect(r.success).toBe(false)
  })

  it('rejects when event is missing', () => {
    const r = LogEntrySchema.safeParse({
      context: { component: 'x' },
    })
    expect(r.success).toBe(false)
  })

  it('rejects when context is missing', () => {
    const r = LogEntrySchema.safeParse({ event: 'cart.added' })
    expect(r.success).toBe(false)
  })
})