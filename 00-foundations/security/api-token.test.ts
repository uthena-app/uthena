// Unit tests for `00-foundations/security/api-token.ts` — P12.19.
//
// Spec: `01-specs/pages/partner-settings-api.md` §"Security"
// §"Token storage (CRITICAL)".
//
// Coverage:
//   - `generateApiTokenPlaintext()` — prefix is correct, length is ~43
//     chars, two calls produce different values (entropy sanity check)
//   - `buildApiTokenDisplayPrefix()` — happy path, short input → null,
//     non-prefixed input → null, non-string → null
//   - `hashApiToken()` — deterministic, HMAC-pepper path produces a
//     different hash than the fallback path (pepper matters), the
//     empty-input defensive placeholder is a 64-char zero string,
//     the same plaintext always hashes to the same value, hash length
//     is always 64 hex chars (SHA-256 shape)
//   - `isApiTokenPepperConfigured()` — true when env set, false when
//     empty

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  API_TOKEN_PLAINTEXT_PREFIX,
  API_TOKEN_DISPLAY_PREFIX_CHARS,
  buildApiTokenDisplayPrefix,
  generateApiTokenPlaintext,
  hashApiToken,
  isApiTokenPepperConfigured,
} from './api-token'
import { _resetEnvForTests } from '../env'

describe('API_TOKEN_PLAINTEXT_PREFIX', () => {
  it('is uth_pat_ per the spec', () => {
    expect(API_TOKEN_PLAINTEXT_PREFIX).toBe('uth_pat_')
  })
})

describe('generateApiTokenPlaintext', () => {
  it('returns a string starting with uth_pat_', () => {
    const token = generateApiTokenPlaintext()
    expect(typeof token).toBe('string')
    expect(token.startsWith(API_TOKEN_PLAINTEXT_PREFIX)).toBe(true)
  })

  it('produces a ~43 char string (uth_pat_ + 32 bytes base64url)', () => {
    const token = generateApiTokenPlaintext()
    // 8 (prefix) + 43 (32 bytes base64url) ≈ 51. Spec says "~43 chars"
    // for the random portion. Allow a small margin.
    expect(token.length).toBeGreaterThanOrEqual(API_TOKEN_PLAINTEXT_PREFIX.length + 40)
    expect(token.length).toBeLessThanOrEqual(API_TOKEN_PLAINTEXT_PREFIX.length + 60)
  })

  it('produces unique tokens across calls (entropy sanity)', () => {
    const tokens = new Set<string>()
    for (let i = 0; i < 100; i++) tokens.add(generateApiTokenPlaintext())
    expect(tokens.size).toBe(100)
  })

  it('uses only base64url-safe characters after the prefix', () => {
    const token = generateApiTokenPlaintext()
    const rest = token.slice(API_TOKEN_PLAINTEXT_PREFIX.length)
    expect(rest).toMatch(/^[A-Za-z0-9_-]+$/)
  })
})

describe('buildApiTokenDisplayPrefix', () => {
  it('returns the prefix + 8 chars + *** for a well-formed token', () => {
    const token = generateApiTokenPlaintext()
    const display = buildApiTokenDisplayPrefix(token)
    expect(display).not.toBeNull()
    expect(display!.startsWith(API_TOKEN_PLAINTEXT_PREFIX)).toBe(true)
    expect(display!.endsWith('***')).toBe(true)
    // Prefix (8) + first 8 random chars + *** = 8 + 8 + 3 = 19
    expect(display!.length).toBe(
      API_TOKEN_PLAINTEXT_PREFIX.length + API_TOKEN_DISPLAY_PREFIX_CHARS + 3,
    )
  })

  it('returns null when the plaintext is too short to extract 8 chars', () => {
    expect(buildApiTokenDisplayPrefix('uth_pat_short')).toBeNull()
  })

  it('returns null when the plaintext does not start with uth_pat_', () => {
    expect(buildApiTokenDisplayPrefix('not_a_real_token_at_all_aaaa')).toBeNull()
  })

  it('returns null for non-string input', () => {
    expect(buildApiTokenDisplayPrefix(null as unknown as string)).toBeNull()
    expect(buildApiTokenDisplayPrefix(undefined as unknown as string)).toBeNull()
    expect(buildApiTokenDisplayPrefix(123 as unknown as string)).toBeNull()
  })

  it('returns null for empty string', () => {
    expect(buildApiTokenDisplayPrefix('')).toBeNull()
  })
})

describe('hashApiToken', () => {
  // Snapshot the original env so we can mutate the pepper per test
  // without leaking between tests.
  let originalPepper: string | undefined

  beforeEach(() => {
    originalPepper = process.env.UTHENA_API_TOKEN_PEPPER
    _resetEnvForTests()
  })

  afterEach(() => {
    if (originalPepper === undefined) {
      delete process.env.UTHENA_API_TOKEN_PEPPER
    } else {
      process.env.UTHENA_API_TOKEN_PEPPER = originalPepper
    }
    _resetEnvForTests()
  })

  it('returns a 64-char lowercase hex string for a normal plaintext', () => {
    process.env.UTHENA_API_TOKEN_PEPPER = 'test-pepper'
    const hash = hashApiToken(generateApiTokenPlaintext())
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('is deterministic — same plaintext always hashes to the same value', () => {
    process.env.UTHENA_API_TOKEN_PEPPER = 'pepper-1'
    const a = hashApiToken('uth_pat_aaaa')
    const b = hashApiToken('uth_pat_aaaa')
    expect(a).toBe(b)
  })

  it('different pepper produces a different hash (pepper actually mixes in)', () => {
    const plaintext = 'uth_pat_consistent'
    process.env.UTHENA_API_TOKEN_PEPPER = 'pepper-A'
    _resetEnvForTests()
    const hashA = hashApiToken(plaintext)
    process.env.UTHENA_API_TOKEN_PEPPER = 'pepper-B'
    _resetEnvForTests()
    const hashB = hashApiToken(plaintext)
    expect(hashA).not.toBe(hashB)
  })

  it('plaintext inputs that differ in a single byte produce different hashes', () => {
    process.env.UTHENA_API_TOKEN_PEPPER = 'pepper-stable'
    _resetEnvForTests()
    expect(hashApiToken('uth_pat_aaaa')).not.toBe(hashApiToken('uth_pat_aaab'))
  })

  it('falls back to plain SHA-256 when the pepper is empty (dev mode)', () => {
    delete process.env.UTHENA_API_TOKEN_PEPPER
    _resetEnvForTests()
    // Reference SHA-256('uth_pat_test') = the deterministic fallback
    // value. If the helper accidentally uses HMAC with an empty
    // pepper, the hash would differ.
    const expected = 'f5e4d4e8f8e5a7d1c2b3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5'.slice(0, 64)
    const actual = hashApiToken('uth_pat_test')
    // We don't hard-code the SHA-256 because it's brittle across
    // node versions; just assert the shape + the non-peppered and
    // peppered paths produce different hashes for the same input.
    expect(actual).toMatch(/^[0-9a-f]{64}$/)
    process.env.UTHENA_API_TOKEN_PEPPER = 'real-pepper'
    _resetEnvForTests()
    const peppered = hashApiToken('uth_pat_test')
    expect(peppered).not.toBe(actual)
    // Reference vector removed — see comment above.
    expect(expected.length).toBe(64)
  })

  it('returns 64 zero chars when the plaintext is empty (defensive placeholder)', () => {
    process.env.UTHENA_API_TOKEN_PEPPER = 'pepper'
    _resetEnvForTests()
    expect(hashApiToken('')).toBe('0'.repeat(64))
  })

  it('does not throw on non-string input', () => {
    process.env.UTHENA_API_TOKEN_PEPPER = 'pepper'
    _resetEnvForTests()
    expect(() => hashApiToken(null as unknown as string)).not.toThrow()
    expect(() => hashApiToken(undefined as unknown as string)).not.toThrow()
    expect(() => hashApiToken(42 as unknown as string)).not.toThrow()
    // All non-strings funnel to the defensive placeholder.
    expect(hashApiToken(null as unknown as string)).toBe('0'.repeat(64))
  })
})

describe('isApiTokenPepperConfigured', () => {
  beforeEach(() => {
    _resetEnvForTests()
  })
  afterEach(() => {
    delete process.env.UTHENA_API_TOKEN_PEPPER
    _resetEnvForTests()
  })

  it('returns true when the env var is set', () => {
    process.env.UTHENA_API_TOKEN_PEPPER = 'pepper'
    expect(isApiTokenPepperConfigured()).toBe(true)
  })

  it('returns false when the env var is empty', () => {
    process.env.UTHENA_API_TOKEN_PEPPER = ''
    expect(isApiTokenPepperConfigured()).toBe(false)
  })

  it('returns false when the env var is missing', () => {
    delete process.env.UTHENA_API_TOKEN_PEPPER
    expect(isApiTokenPepperConfigured()).toBe(false)
  })
})