// Unit tests for the partner-PII encryption helper (P6.5).
//
// Pure-function tests + a single crypto round-trip per test. No
// fixtures, no I/O beyond `crypto.randomBytes` + the in-memory
// Node `crypto` module. Runs in milliseconds.
//
// Coverage:
//   - encryptString produces an envelope matching the strict regex
//   - decryptString reverses encryptString for varied plaintext
//     shapes (ASCII, Unicode, empty, long, special chars, JSON)
//   - Two encryptions of the same plaintext produce different
//     ciphertexts (random IV)
//   - Tampered ciphertext / IV / tag are rejected by the auth tag
//   - decryptString throws on non-string / malformed / wrong-segment-
//     count input
//   - isEncryptedEnvelope: strict accept (exact envelope) + strict
//     reject (plaintext emails, non-strings, numbers, empty)
//   - decryptStringOrPassThrough: encrypted → plaintext, plaintext →
//     passthrough, null/undefined/number/object → null, corrupted
//     envelope → null (best-effort, never throws)
//   - getEncryptionKey (tested via encryptString + a different key):
//     a different key fails decryption with the original key
//   - Production fail-closed: missing key in production throws

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { _resetEnvForTests } from '@foundations/env'

const ORIGINAL_ENV = { ...process.env }

function setEnv(overrides: Record<string, string | undefined>) {
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
}

async function freshImport() {
  _resetEnvForTests()
  // Use a fresh module instance per test so the env reads happen at
  // the right time.
  const mod = await import('./encryption')
  return mod
}

describe('encryption envelope shape', () => {
  beforeEach(() => {
    setEnv({
      NODE_ENV: 'development',
      PARTNER_PAYOUT_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
    })
  })

  afterEach(() => {
    setEnv(ORIGINAL_ENV)
    _resetEnvForTests()
  })

  it('encryptString produces a 3-segment base64url envelope', async () => {
    const { encryptString } = await freshImport()
    const envelope = encryptString('alice@example.com')
    expect(envelope).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/)
    const [iv, tag, ct] = envelope.split('.')
    // 12 bytes → 16 base64url chars (no padding in base64url)
    expect(iv).toHaveLength(16)
    // 16 bytes → 22 base64url chars
    expect(tag).toHaveLength(22)
    // ciphertext length is plaintext-length-derived; just assert non-empty
    expect(ct ?? '').toBeTruthy()
  })

  it('two encryptions of the same plaintext produce different envelopes (random IV)', async () => {
    const { encryptString } = await freshImport()
    const a = encryptString('same-input')
    const b = encryptString('same-input')
    expect(a).not.toBe(b)
    // The IV segments should differ; the ciphertext may also differ
    expect(a.split('.')[0]).not.toBe(b.split('.')[0])
  })
})

describe('encryption round-trip', () => {
  beforeEach(() => {
    setEnv({
      NODE_ENV: 'development',
      PARTNER_PAYOUT_ENCRYPTION_KEY: Buffer.alloc(32, 11).toString('base64'),
    })
  })

  afterEach(() => {
    setEnv(ORIGINAL_ENV)
    _resetEnvForTests()
  })

  it.each([
    ['ASCII email', 'alice@example.com'],
    ['Plain word', 'partner'],
    ['Empty string', ''],
    ['Whitespace', '   spaces   '],
    ['Unicode', 'ünïcödé ✨ partner'],
    ['JSON shape', JSON.stringify({ a: 1, b: ['x', 'y'] })],
    ['Long string', 'x'.repeat(1000)],
    ['Routing-number shape', '123456789'],
    ['Newlines', 'line1\nline2\nline3'],
    ['Special chars', '!@#$%^&*()_+-=[]{}|;:,.<>?/`~'],
  ])('round-trips %s', async (_label, plaintext) => {
    const { encryptString, decryptString } = await freshImport()
    const envelope = encryptString(plaintext)
    expect(decryptString(envelope)).toBe(plaintext)
  })
})

describe('decryptString — auth-tag failures', () => {
  beforeEach(() => {
    setEnv({
      NODE_ENV: 'development',
      PARTNER_PAYOUT_ENCRYPTION_KEY: Buffer.alloc(32, 13).toString('base64'),
    })
  })

  afterEach(() => {
    setEnv(ORIGINAL_ENV)
    _resetEnvForTests()
  })

  it('rejects tampered ciphertext', async () => {
    const { encryptString, decryptString } = await freshImport()
    const envelope = encryptString('partner data')
    const [iv, tag, ct] = envelope.split('.')
    // Flip a bit in the ciphertext by replacing the last char
    const flipped = ct!.slice(0, -1) + (ct!.endsWith('A') ? 'B' : 'A')
    const tampered = `${iv}.${tag}.${flipped}`
    expect(() => decryptString(tampered)).toThrow()
  })

  it('rejects tampered IV', async () => {
    const { encryptString, decryptString } = await freshImport()
    const envelope = encryptString('partner data')
    const [iv, tag, ct] = envelope.split('.')
    const flipped = iv!.slice(0, -1) + (iv!.endsWith('A') ? 'B' : 'A')
    const tampered = `${flipped}.${tag}.${ct}`
    expect(() => decryptString(tampered)).toThrow()
  })

  it('rejects tampered auth tag', async () => {
    const { encryptString, decryptString } = await freshImport()
    const envelope = encryptString('partner data')
    const [iv, tag, ct] = envelope.split('.')
    // Tamper at the BYTE level, not the base64url char level. The 16-byte
    // tag encodes to 22 base64url chars whose final char carries 4 unused
    // low bits — flipping that char can decode to the identical 16 bytes
    // (no real tamper), which made this test flaky. XOR-ing a decoded byte
    // guarantees a genuinely different tag so GCM auth always rejects it.
    const tagBytes = Buffer.from(tag!, 'base64url')
    tagBytes[0] = tagBytes[0]! ^ 0xff
    const tampered = `${iv}.${tagBytes.toString('base64url')}.${ct}`
    expect(() => decryptString(tampered)).toThrow()
  })

  it('rejects wrong-key decryption', async () => {
    // Encrypt with key A.
    setEnv({ PARTNER_PAYOUT_ENCRYPTION_KEY: Buffer.alloc(32, 17).toString('base64') })
    _resetEnvForTests()
    const { encryptString } = await freshImport()
    const envelope = encryptString('partner data')

    // Re-import with key B and try to decrypt.
    setEnv({ PARTNER_PAYOUT_ENCRYPTION_KEY: Buffer.alloc(32, 19).toString('base64') })
    const { decryptString } = await freshImport()
    expect(() => decryptString(envelope)).toThrow()
  })
})

describe('decryptString — input validation', () => {
  beforeEach(() => {
    setEnv({
      NODE_ENV: 'development',
      PARTNER_PAYOUT_ENCRYPTION_KEY: Buffer.alloc(32, 23).toString('base64'),
    })
  })

  afterEach(() => {
    setEnv(ORIGINAL_ENV)
    _resetEnvForTests()
  })

  it.each([
    ['not a string (number)', 12345],
    ['not a string (object)', {}],
    ['not a string (null)', null],
    ['not a string (undefined)', undefined],
    ['empty string', ''],
    ['plaintext email', 'alice@example.com'],
    ['plaintext with one dot', 'a.b@example.com'],
    ['two-segment input', 'abc.def'],
    ['four-segment input', 'a.b.c.d'],
    ['non-base64url chars in iv', '!@#$%^&*().tag.ct'],
  ])('rejects %s', async (_label, value) => {
    const { decryptString } = await freshImport()
    // @ts-expect-error testing runtime guard against bad input
    expect(() => decryptString(value)).toThrow()
  })
})

describe('isEncryptedEnvelope', () => {
  beforeEach(() => {
    setEnv({
      NODE_ENV: 'development',
      PARTNER_PAYOUT_ENCRYPTION_KEY: Buffer.alloc(32, 29).toString('base64'),
    })
  })

  afterEach(() => {
    setEnv(ORIGINAL_ENV)
    _resetEnvForTests()
  })

  it('accepts a freshly produced envelope', async () => {
    const { encryptString, isEncryptedEnvelope } = await freshImport()
    expect(isEncryptedEnvelope(encryptString('test'))).toBe(true)
  })

  it.each([
    ['plaintext email', 'alice@example.com'],
    ['plain word', 'partner'],
    ['empty string', ''],
    ['one dot', 'a.b'],
    ['two dots but short segments', 'a.b.c'],
    ['two dots but too long', 'a'.repeat(20) + '.b'.repeat(20) + '.c'.repeat(20)],
    ['whitespace', '   '],
    ['newlines', 'a\nb\nc'],
    ['number 0', 0],
    ['null', null],
    ['undefined', undefined],
    ['empty object', {}],
    ['empty array', []],
  ])('rejects %s', (_label, value) => {
    // Sync import so the test reads naturally without the await dance
    // (the encryption helper has no module-scope state that depends
    // on env-gated code paths beyond getEncryptionKey, which is
    // lazy).
    return import('./encryption').then(({ isEncryptedEnvelope }) => {
      expect(isEncryptedEnvelope(value)).toBe(false)
    })
  })
})

describe('decryptStringOrPassThrough', () => {
  beforeEach(() => {
    setEnv({
      NODE_ENV: 'development',
      PARTNER_PAYOUT_ENCRYPTION_KEY: Buffer.alloc(32, 31).toString('base64'),
    })
  })

  afterEach(() => {
    setEnv(ORIGINAL_ENV)
    _resetEnvForTests()
  })

  it('decrypts a real envelope to its plaintext', async () => {
    const { encryptString, decryptStringOrPassThrough } = await freshImport()
    const plaintext = 'legacy-becomes-encrypted@uthena.com'
    expect(decryptStringOrPassThrough(encryptString(plaintext))).toBe(plaintext)
  })

  it.each([
    ['plaintext email', 'alice@example.com', 'alice@example.com'],
    ['plain word', 'partner', 'partner'],
    ['empty string', '', null],
    ['null', null, null],
    ['undefined', undefined, null],
    ['number', 42, null],
    ['empty object', {}, null],
    ['empty array', [], null],
  ])('%s → %s', async (_label, input, expected) => {
    const { decryptStringOrPassThrough } = await freshImport()
    // Testing runtime guards — input type widened intentionally.
    expect(decryptStringOrPassThrough(input as never)).toBe(expected)
  })

  it('returns null for a corrupted envelope (does not throw)', async () => {
    const { decryptStringOrPassThrough } = await freshImport()
    // A string that LOOKS like an envelope by length but has
    // invalid base64url content → regex matches but decrypt fails.
    const corrupted = 'A'.repeat(16) + '.' + 'B'.repeat(22) + '.' + 'C'.repeat(20)
    expect(decryptStringOrPassThrough(corrupted)).toBeNull()
  })
})

describe('getEncryptionKey — production fail-closed', () => {
  afterEach(() => {
    setEnv(ORIGINAL_ENV)
    _resetEnvForTests()
  })

  // The env validator requires a few other vars in production
  // mode (NEXT_PUBLIC_APP_URL, NEXT_PUBLIC_SUPABASE_URL, etc.). The
  // encryption helper doesn't read those — we're only asserting the
  // PARTNER_PAYOUT_ENCRYPTION_KEY branch — but the validator runs
  // first, so we satisfy it with placeholder values to reach the
  // encryption-helper code path.
  const PROD_ENV_BASE = {
    NODE_ENV: 'production',
    NEXT_PUBLIC_APP_URL: 'https://uthena.com',
    NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-placeholder-key-12345',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-placeholder-key-12345',
    AUTH_SECRET: 'x'.repeat(32),
    ALLOWED_ORIGINS: 'https://uthena.com',
  }

  it('throws in production when PARTNER_PAYOUT_ENCRYPTION_KEY is missing', async () => {
    setEnv({ ...PROD_ENV_BASE, PARTNER_PAYOUT_ENCRYPTION_KEY: undefined })
    const { encryptString } = await freshImport()
    expect(() => encryptString('test')).toThrow(/PARTNER_PAYOUT_ENCRYPTION_KEY/)
  })

  it('throws in production when the key decodes to the wrong length', async () => {
    setEnv({
      ...PROD_ENV_BASE,
      PARTNER_PAYOUT_ENCRYPTION_KEY: Buffer.alloc(16, 1).toString('base64'), // 16 bytes, not 32
    })
    const { encryptString } = await freshImport()
    expect(() => encryptString('test')).toThrow(/must decode to 32 bytes/)
  })

  it('works in production when the key is present and correctly sized', async () => {
    setEnv({
      ...PROD_ENV_BASE,
      PARTNER_PAYOUT_ENCRYPTION_KEY: Buffer.alloc(32, 41).toString('base64'),
    })
    const { encryptString, decryptString } = await freshImport()
    const plaintext = 'production-roundtrip@partner.io'
    const envelope = encryptString(plaintext)
    expect(decryptString(envelope)).toBe(plaintext)
  })

  it('falls back to AUTH_SECRET-derived key in dev (works without explicit env var)', async () => {
    setEnv({ NODE_ENV: 'development', PARTNER_PAYOUT_ENCRYPTION_KEY: undefined })
    const { encryptString, decryptString } = await freshImport()
    const plaintext = 'dev-only@partner.io'
    expect(decryptString(encryptString(plaintext))).toBe(plaintext)
  })
})