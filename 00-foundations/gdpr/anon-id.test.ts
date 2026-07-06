// anon-id.test.ts — unit tests for the visitor-stable pseudonymous
// ID helper used to attribute cookie banner decisions to a browser.
//
// Pure tests cover:
//   * mintAnonId — UUID v4 grammar + crypto-backed randomness
//                  (we inject a deterministic random fn in some
//                  cases so the test asserts behavior without
//                  relying on the system RNG)
//   * isValidAnonId — accepts canonical UUID v4, rejects everything
//                     else
//   * writeAnonId / readAnonId — round-trip via the Next.js cookies
//                                 store (we mock the store so the
//                                 test runs in plain vitest)
//
// We avoid testing `ensureAnonId` directly because it composes both
// helpers + the cookies store; the read/write round-trip below
// covers the same surface with a tighter shape.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  ANON_ID_COOKIE,
  ANON_ID_MAX_AGE_DAYS,
  ANON_ID_MAX_AGE_SECONDS,
  isValidAnonId,
  mintAnonId,
  readAnonId,
  writeAnonId,
} from './anon-id'

// Capture the in-memory cookie store so the test can read + write
// across calls without depending on Next.js runtime.
let cookieStore: Map<string, string> = new Map()
let cookiesThrew = false

vi.mock('next/headers', () => ({
  cookies: async () => {
    if (cookiesThrew) throw new Error('cookies() unavailable')
    return {
      get: (name: string) => {
        const value = cookieStore.get(name)
        return value === undefined ? undefined : { value }
      },
      set: (input: { name: string; value: string }) => {
        cookieStore.set(input.name, input.value)
      },
    }
  },
}))

beforeEach(() => {
  cookieStore = new Map()
  cookiesThrew = false
  vi.clearAllMocks()
})

describe('constants', () => {
  it('uses the canonical cookie name', () => {
    expect(ANON_ID_COOKIE).toBe('uthena_anon_id')
  })

  it('exposes a 400-day max-age in seconds', () => {
    expect(ANON_ID_MAX_AGE_DAYS).toBe(400)
    expect(ANON_ID_MAX_AGE_SECONDS).toBe(400 * 24 * 60 * 60)
  })
})

describe('mintAnonId', () => {
  it('returns a canonical UUID (matches the regex)', () => {
    const id = mintAnonId()
    expect(isValidAnonId(id)).toBe(true)
  })

  it('uses crypto.randomUUID by default (RFC 4122 v4 format)', () => {
    const id = mintAnonId()
    // crypto.randomUUID always returns the v4 bit pattern ('4' in
    // the first group of the time_hi_and_version field).
    expect(id.charAt(14)).toBe('4')
  })

  it('accepts a custom random function (deterministic in tests)', () => {
    const id = mintAnonId(() => '12345678-1234-4abc-9def-123456789012')
    expect(id).toBe('12345678-1234-4abc-9def-123456789012')
  })

  it('throws when the custom function returns a non-UUID string', () => {
    expect(() => mintAnonId(() => 'not-a-uuid')).toThrow()
  })

  it('lowercases the output (matching the UUID regex)', () => {
    const id = mintAnonId(() => 'ABCDEF12-3456-4789-9ABC-DEF123456789')
    expect(id).toBe('abcdef12-3456-4789-9abc-def123456789')
  })
})

describe('isValidAnonId', () => {
  it('accepts a canonical lowercase UUID', () => {
    expect(isValidAnonId('12345678-1234-4567-89ab-cdef01234567')).toBe(true)
  })

  it('accepts uppercase UUIDs (case-insensitive)', () => {
    expect(isValidAnonId('ABCDEF12-3456-4567-89AB-CDEF01234567')).toBe(true)
  })

  it('accepts mixed-case UUIDs', () => {
    expect(isValidAnonId('12345678-abcd-4AbC-9aB9-CdEf01234567')).toBe(true)
  })

  it('rejects nullish values', () => {
    expect(isValidAnonId(null)).toBe(false)
    expect(isValidAnonId(undefined)).toBe(false)
    expect(isValidAnonId('')).toBe(false)
  })

  it('rejects empty strings + pure whitespace', () => {
    expect(isValidAnonId('   ')).toBe(false)
  })

  it('rejects UUIDs with the wrong character class', () => {
    expect(isValidAnonId('12345678-1234-4567-89ab-cdef0123456z')).toBe(false) // z
  })

  it('rejects UUIDs with the wrong segment lengths', () => {
    expect(isValidAnonId('1234567-1234-4567-89ab-cdef01234567')).toBe(false) // 7 chars not 8
    expect(isValidAnonId('12345678-123-4567-89ab-cdef01234567')).toBe(false) // 3 chars not 4
  })

  it('rejects non-UUID strings masquerading as UUIDs', () => {
    expect(isValidAnonId('not-a-uuid-at-all')).toBe(false)
    expect(isValidAnonId("'; DROP TABLE users--")).toBe(false) // SQLi-shaped
    expect(isValidAnonId('<script>alert(1)</script>')).toBe(false) // XSS-shaped
  })
})

describe('writeAnonId + readAnonId', () => {
  it('round-trips a freshly-minted UUID', async () => {
    const id = mintAnonId()
    await writeAnonId(id)
    const read = await readAnonId()
    expect(read).toBe(id)
  })

  it('lowercases the stored value (uppercase input normalizes)', async () => {
    const id = 'ABCDEF12-3456-4567-89AB-CDEF01234567'
    await writeAnonId(id)
    const read = await readAnonId()
    expect(read).toBe('abcdef12-3456-4567-89ab-cdef01234567')
  })

  it('sets the canonical cookie name', async () => {
    await writeAnonId(mintAnonId())
    expect(cookieStore.has(ANON_ID_COOKIE)).toBe(true)
  })

  it('refuses to write a non-UUID value (no cookie set)', async () => {
    await writeAnonId('not-a-uuid')
    expect(cookieStore.has(ANON_ID_COOKIE)).toBe(false)
  })

  it('reads null when the cookie is missing', async () => {
    expect(await readAnonId()).toBe(null)
  })

  it('reads null when the cookie value is a tampered non-UUID', async () => {
    cookieStore.set(ANON_ID_COOKIE, 'definitely-not-a-uuid')
    expect(await readAnonId()).toBe(null)
  })

  it('reads the value when it is a valid (lowercase) UUID', async () => {
    cookieStore.set(ANON_ID_COOKIE, '12345678-1234-4567-89ab-cdef01234567')
    expect(await readAnonId()).toBe('12345678-1234-4567-89ab-cdef01234567')
  })

  it('returns null when the cookies() store throws', async () => {
    cookiesThrew = true
    expect(await readAnonId()).toBe(null)
  })

  it('writeAnonId swallows the cookies() store error (no throw)', async () => {
    cookiesThrew = true
    await expect(writeAnonId(mintAnonId())).resolves.toBeUndefined()
  })
})
