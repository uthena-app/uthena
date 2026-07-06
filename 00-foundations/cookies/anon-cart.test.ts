// Unit tests for the anon-cart cookie module. Pure logic — no Next.js
// or DB needed. The read/write/clear functions that touch `cookies()`
// are exercised by the integration tests in `02-features/cart/tests/`
// (deferred to a later tick when the test DB is wired).
//
// Covers:
//  - serialize/deserialize round-trip preserves all fields
//  - schema validation: rejects tampered payload, bad signature,
//    wrong version, missing fields, bad enum, qty out of range,
//    > max lines
//  - anonLineId / parseAnonLineId round-trip + parse failure cases
//  - isAnonLineId type guard

import { describe, expect, it } from 'vitest'
import {
  anonLineId,
  ANON_CART_COOKIE,
  ANON_CART_MAX_LINES,
  ANON_CART_TTL_SECONDS,
  deserializeAnonCart,
  EMPTY_ANON_CART,
  isAnonLineId,
  parseAnonLineId,
  serializeAnonCart,
  type AnonCart,
} from './anon-cart'

const sampleCart: AnonCart = {
  v: 1,
  c: '2026-06-25T12:00:00.000Z',
  lines: [
    { p: 101, l: 'plr', q: 1, a: '2026-06-25T12:00:00.000Z' },
    { p: 202, l: 'mrr', q: 2, a: '2026-06-25T12:01:00.000Z' },
    { p: 303, l: 'rr', q: 1, a: '2026-06-25T12:02:00.000Z' },
    { p: 404, l: 'personal', q: 99, a: '2026-06-25T12:03:00.000Z' },
  ],
}

describe('serializeAnonCart + deserializeAnonCart', () => {
  it('round-trips a populated cart', () => {
    const wire = serializeAnonCart(sampleCart)
    const back = deserializeAnonCart(wire)
    expect(back).toEqual(sampleCart)
  })

  it('round-trips an empty cart', () => {
    const cart: AnonCart = { v: 1, c: '2026-06-25T00:00:00.000Z', lines: [] }
    const wire = serializeAnonCart(cart)
    const back = deserializeAnonCart(wire)
    expect(back).toEqual(cart)
  })

  it('returns null on empty / undefined / null input', () => {
    expect(deserializeAnonCart(undefined)).toBeNull()
    expect(deserializeAnonCart(null)).toBeNull()
    expect(deserializeAnonCart('')).toBeNull()
  })

  it('returns null when the dot separator is missing', () => {
    expect(deserializeAnonCart('nodot')).toBeNull()
  })

  it('returns null when the dot is the last character (no signature)', () => {
    expect(deserializeAnonCart('payload.')).toBeNull()
  })

  it('returns null when the signature is wrong', () => {
    const wire = serializeAnonCart(sampleCart)
    const dot = wire.lastIndexOf('.')
    // Swap in a different valid base64url signature of the same length.
    const tampered = wire.slice(0, dot + 1) + 'A'.repeat(wire.length - dot - 1)
    expect(deserializeAnonCart(tampered)).toBeNull()
  })

  it('returns null when the payload is tampered', () => {
    const wire = serializeAnonCart(sampleCart)
    const dot = wire.lastIndexOf('.')
    // Flip a character in the payload.
    const tampered =
      wire.slice(0, dot - 1) + (wire[dot - 1] === 'A' ? 'B' : 'A') + wire.slice(dot)
    expect(deserializeAnonCart(tampered)).toBeNull()
  })

  it('returns null when the payload is not valid base64url', () => {
    expect(deserializeAnonCart('!!!not-base64!!!.signature')).toBeNull()
  })

  it('returns null when the payload is not valid JSON', () => {
    const badJson = Buffer.from('this is not json').toString('base64url')
    // Sign with the same key so signature passes; the JSON parse is what should fail.
    const signature = require('node:crypto')
      .createHmac('sha256', process.env.ANON_CART_SECRET ?? `dev-anon-cart-${process.pid}`)
      .update(badJson)
      .digest('base64url')
    expect(deserializeAnonCart(`${badJson}.${signature}`)).toBeNull()
  })

  it('returns null when the schema version is wrong', () => {
    const wrongVersion = { ...sampleCart, v: 2 as unknown as 1 }
    const wire = serializeAnonCart(wrongVersion as AnonCart)
    expect(deserializeAnonCart(wire)).toBeNull()
  })

  it('returns null when a line has an unknown license', () => {
    const bad = {
      ...sampleCart,
      lines: [{ p: 1, l: 'evil' as unknown as 'plr', q: 1, a: '2026-06-25T00:00:00.000Z' }],
    }
    const wire = serializeAnonCart(bad as AnonCart)
    expect(deserializeAnonCart(wire)).toBeNull()
  })

  it('returns null when quantity is out of range', () => {
    const tooSmall = {
      ...sampleCart,
      lines: [{ p: 1, l: 'plr' as const, q: 0, a: '2026-06-25T00:00:00.000Z' }],
    }
    const tooBig = {
      ...sampleCart,
      lines: [{ p: 1, l: 'plr' as const, q: 100, a: '2026-06-25T00:00:00.000Z' }],
    }
    expect(deserializeAnonCart(serializeAnonCart(tooSmall as AnonCart))).toBeNull()
    expect(deserializeAnonCart(serializeAnonCart(tooBig as AnonCart))).toBeNull()
  })

  it('returns null when product_id is not a positive integer', () => {
    const bad = {
      ...sampleCart,
      lines: [{ p: 0, l: 'plr' as const, q: 1, a: '2026-06-25T00:00:00.000Z' }],
    }
    expect(deserializeAnonCart(serializeAnonCart(bad as AnonCart))).toBeNull()
  })

  it('returns null when added_at is not a valid ISO date', () => {
    const bad = {
      ...sampleCart,
      lines: [{ p: 1, l: 'plr' as const, q: 1, a: 'not-a-date' }],
    }
    expect(deserializeAnonCart(serializeAnonCart(bad as AnonCart))).toBeNull()
  })

  it('returns null when the cart exceeds the max-lines cap', () => {
    const lines = Array.from({ length: ANON_CART_MAX_LINES + 1 }, (_, i) => ({
      p: i + 1,
      l: 'plr' as const,
      q: 1,
      a: '2026-06-25T00:00:00.000Z',
    }))
    const tooMany: AnonCart = { v: 1, c: '2026-06-25T00:00:00.000Z', lines }
    // We can serialize (the schema caps on parse), but deserialize must refuse it.
    const wire = serializeAnonCart(tooMany)
    expect(deserializeAnonCart(wire)).toBeNull()
  })
})

describe('constants', () => {
  it('exports a stable cookie name', () => {
    expect(ANON_CART_COOKIE).toBe('uthena_anon_cart')
  })

  it('exports a 30-day TTL in seconds', () => {
    expect(ANON_CART_TTL_SECONDS).toBe(30 * 24 * 60 * 60)
  })

  it('exports a sensible max-lines cap', () => {
    expect(ANON_CART_MAX_LINES).toBe(50)
  })

  it('exports the EMPTY_ANON_CART sentinel', () => {
    expect(EMPTY_ANON_CART.v).toBe(1)
    expect(EMPTY_ANON_CART.lines).toEqual([])
  })
})

describe('anonLineId / parseAnonLineId', () => {
  it('round-trips product_id + license', () => {
    const id = anonLineId(101, 'plr')
    expect(parseAnonLineId(id)).toEqual({ productId: 101, license: 'plr' })
  })

  it('round-trips every license enum value', () => {
    for (const l of ['plr', 'mrr', 'rr', 'personal'] as const) {
      const id = anonLineId(42, l)
      expect(parseAnonLineId(id)).toEqual({ productId: 42, license: l })
    }
  })

  it('returns null for an auth-DB numeric id', () => {
    expect(parseAnonLineId(12345)).toBeNull()
  })

  it('returns null for a string that does not start with the prefix', () => {
    expect(parseAnonLineId('cart_item:12345')).toBeNull()
    expect(parseAnonLineId('12345')).toBeNull()
  })

  it('returns null when the product_id is not an integer', () => {
    expect(parseAnonLineId('anon:not-a-number:plr')).toBeNull()
  })

  it('returns null when the product_id is zero or negative', () => {
    expect(parseAnonLineId('anon:0:plr')).toBeNull()
    expect(parseAnonLineId('anon:-1:plr')).toBeNull()
  })

  it('returns null when the license is unknown', () => {
    expect(parseAnonLineId('anon:1:evil')).toBeNull()
  })

  it('returns null when the inner separator is missing', () => {
    expect(parseAnonLineId('anon:1')).toBeNull()
    expect(parseAnonLineId('anon:plr')).toBeNull()
  })
})

describe('isAnonLineId', () => {
  it('returns true for anon-prefixed strings', () => {
    expect(isAnonLineId('anon:1:plr')).toBe(true)
  })

  it('returns false for numeric ids', () => {
    expect(isAnonLineId(12345)).toBe(false)
    expect(isAnonLineId(0)).toBe(false)
  })

  it('returns false for non-anon strings', () => {
    expect(isAnonLineId('cart_item:1')).toBe(false)
    expect(isAnonLineId('')).toBe(false)
  })
})