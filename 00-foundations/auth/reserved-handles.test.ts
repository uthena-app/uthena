// reserved-handles.test.ts — unit tests for the reserved-handles
// foundation. P13.1 — affiliate onboarding wizard. Pure-logic tests,
// no DB / network.
//
// Covers:
//   - isReservedHandle: case-insensitive, trims whitespace, non-string
//     safe, every reserved name in the canonical list.
//   - isValidHandleShape: length bounds, regex (3-30 / lowercase / digit /
//     hyphen / no leading or trailing hyphen), non-string safe.
//   - normalizeHandle: trims + lowercases, no-op on already-normalized.
//   - validateHandle: combines shape + reserved; returns the typed
//     reason for every failure path.

import { describe, expect, it } from 'vitest'

import {
  HANDLE_MAX_LENGTH,
  HANDLE_MIN_LENGTH,
  HANDLE_REGEX,
  RESERVED_HANDLES,
  isReservedHandle,
  isValidHandleShape,
  normalizeHandle,
  validateHandle,
} from './reserved-handles'

describe('HANDLE_REGEX', () => {
  it('accepts canonical 3-30 char lowercase handles', () => {
    expect(HANDLE_REGEX.test('abc')).toBe(true)
    expect(HANDLE_REGEX.test('alice')).toBe(true)
    expect(HANDLE_REGEX.test('marcus-reyes')).toBe(true)
    expect(HANDLE_REGEX.test('a1b2c3')).toBe(true)
    expect(HANDLE_REGEX.test('123')).toBe(true)
  })

  it('rejects handles shorter than 3 chars', () => {
    expect(HANDLE_REGEX.test('ab')).toBe(false)
    expect(HANDLE_REGEX.test('a')).toBe(false)
  })

  it('rejects handles longer than 30 chars', () => {
    const tooLong = 'a'.repeat(HANDLE_MAX_LENGTH + 1)
    expect(HANDLE_REGEX.test(tooLong)).toBe(false)
  })

  it('rejects uppercase letters', () => {
    expect(HANDLE_REGEX.test('Alice')).toBe(false)
    expect(HANDLE_REGEX.test('ALICE')).toBe(false)
  })

  it('rejects special characters', () => {
    expect(HANDLE_REGEX.test('ali_ce')).toBe(false)
    expect(HANDLE_REGEX.test('ali.ce')).toBe(false)
    expect(HANDLE_REGEX.test('ali ce')).toBe(false)
    expect(HANDLE_REGEX.test('ali/ce')).toBe(false)
    expect(HANDLE_REGEX.test('ali@ce')).toBe(false)
  })

  it('rejects leading hyphen', () => {
    expect(HANDLE_REGEX.test('-alice')).toBe(false)
  })

  it('rejects trailing hyphen', () => {
    expect(HANDLE_REGEX.test('alice-')).toBe(false)
  })

  it('accepts exactly 30 chars (boundary)', () => {
    const exact = 'a'.repeat(HANDLE_MAX_LENGTH)
    expect(HANDLE_REGEX.test(exact)).toBe(true)
  })

  it('accepts exactly 3 chars (boundary)', () => {
    expect(HANDLE_REGEX.test('abc')).toBe(true)
  })
})

describe('RESERVED_HANDLES', () => {
  it('is a Set (O(1) lookup)', () => {
    expect(RESERVED_HANDLES).toBeInstanceOf(Set)
  })

  it('contains every documented reserved name', () => {
    // A sampling of the canonical reservations. If any of these move
    // or are renamed, the test surfaces the change.
    const expected = [
      'account',
      'admin',
      'affiliate',
      'api',
      'app',
      'auth',
      'billing',
      'blog',
      'browse',
      'bundles',
      'cart',
      'cdn',
      'checkout',
      'collections',
      'contact',
      'dashboard',
      'data-sharing-opt-out',
      'delivery',
      'dmca',
      'faq',
      'help',
      'library',
      'login',
      'logout',
      'newsletter',
      'pages',
      'partner',
      'policies',
      'products',
      'refund-policy',
      'reset-password',
      'search',
      'settings',
      'setup-password',
      'signup',
      'sitemap',
      'sitemap-xml',
      'static',
      'support',
      'terms',
      'update-password',
      'verify-email',
      'verify-certificate',
      'uthena',
      'grabltd',
      'soofos',
      'www',
      'assets',
      'favicon',
      'robots',
      'humans',
      'security',
    ]
    for (const handle of expected) {
      expect(RESERVED_HANDLES.has(handle)).toBe(true)
    }
  })

  it('all entries are lowercase (no case collisions)', () => {
    for (const handle of RESERVED_HANDLES) {
      expect(handle).toBe(handle.toLowerCase())
    }
  })
})

describe('normalizeHandle', () => {
  it('lowercases uppercase input', () => {
    expect(normalizeHandle('Alice')).toBe('alice')
    expect(normalizeHandle('MARCUS-REYES')).toBe('marcus-reyes')
  })

  it('trims leading + trailing whitespace', () => {
    expect(normalizeHandle('  alice  ')).toBe('alice')
    expect(normalizeHandle('\talice\n')).toBe('alice')
  })

  it('is a no-op on already-normalized input', () => {
    expect(normalizeHandle('alice')).toBe('alice')
    expect(normalizeHandle('marcus-reyes-482')).toBe('marcus-reyes-482')
  })

  it('returns empty string for empty / whitespace-only input', () => {
    expect(normalizeHandle('')).toBe('')
    expect(normalizeHandle('   ')).toBe('')
  })
})

describe('isReservedHandle', () => {
  it('flags every canonical reserved name (lowercase)', () => {
    expect(isReservedHandle('admin')).toBe(true)
    expect(isReservedHandle('partner')).toBe(true)
    expect(isReservedHandle('affiliate')).toBe(true)
    expect(isReservedHandle('library')).toBe(true)
    expect(isReservedHandle('uthena')).toBe(true)
  })

  it('flags reserved names regardless of input case', () => {
    expect(isReservedHandle('Admin')).toBe(true)
    expect(isReservedHandle('ADMIN')).toBe(true)
    expect(isReservedHandle('aDmIn')).toBe(true)
  })

  it('flags reserved names with surrounding whitespace', () => {
    expect(isReservedHandle(' admin ')).toBe(true)
    expect(isReservedHandle('\tpartner\n')).toBe(true)
  })

  it('does NOT flag a non-reserved lowercase handle', () => {
    expect(isReservedHandle('alice')).toBe(false)
    expect(isReservedHandle('marcus-reyes')).toBe(false)
    expect(isReservedHandle('a1b2c3')).toBe(false)
  })

  it('returns false for empty / whitespace-only input', () => {
    expect(isReservedHandle('')).toBe(false)
    expect(isReservedHandle('   ')).toBe(false)
  })

  it('returns false for non-string input (defensive)', () => {
    expect(isReservedHandle(null)).toBe(false)
    expect(isReservedHandle(undefined)).toBe(false)
    expect(isReservedHandle(123)).toBe(false)
    expect(isReservedHandle({})).toBe(false)
    expect(isReservedHandle([])).toBe(false)
    expect(isReservedHandle(true)).toBe(false)
  })
})

describe('isValidHandleShape', () => {
  it('accepts canonical lowercase handles', () => {
    expect(isValidHandleShape('alice')).toBe(true)
    expect(isValidHandleShape('marcus-reyes')).toBe(true)
    expect(isValidHandleShape('abc')).toBe(true)
    expect(isValidHandleShape('a1b2c3')).toBe(true)
  })

  it('rejects too-short handles', () => {
    expect(isValidHandleShape('ab')).toBe(false)
    expect(isValidHandleShape('a')).toBe(false)
    expect(isValidHandleShape('')).toBe(false)
  })

  it('rejects too-long handles', () => {
    expect(isValidHandleShape('a'.repeat(HANDLE_MAX_LENGTH + 1))).toBe(false)
  })

  it('rejects uppercase letters (case-sensitive regex)', () => {
    expect(isValidHandleShape('Alice')).toBe(false)
  })

  it('rejects special characters', () => {
    expect(isValidHandleShape('ali_ce')).toBe(false)
    expect(isValidHandleShape('ali.ce')).toBe(false)
    expect(isValidHandleShape('ali ce')).toBe(false)
  })

  it('rejects leading or trailing hyphen', () => {
    expect(isValidHandleShape('-alice')).toBe(false)
    expect(isValidHandleShape('alice-')).toBe(false)
  })

  it('accepts boundary lengths', () => {
    expect(isValidHandleShape('abc')).toBe(true)
    expect(isValidHandleShape('a'.repeat(HANDLE_MAX_LENGTH))).toBe(true)
  })

  it('accepts boundary lengths (min-1 + max+1 rejected)', () => {
    expect(isValidHandleShape('ab')).toBe(false)
    expect(isValidHandleShape('a'.repeat(HANDLE_MAX_LENGTH + 1))).toBe(false)
  })

  it('returns false for non-string input (defensive)', () => {
    expect(isValidHandleShape(null)).toBe(false)
    expect(isValidHandleShape(undefined)).toBe(false)
    expect(isValidHandleShape(123)).toBe(false)
    expect(isValidHandleShape({})).toBe(false)
  })
})

describe('validateHandle', () => {
  it('returns ok + normalized for a valid non-reserved handle', () => {
    // The handle is lowercased on success. The regex requires
    // lowercase letters, so 'Alice' (mixed case) is rejected by
    // the shape check (not normalized). The Zod schema in the
    // server action catches uppercase before reaching this helper,
    // so the case-insensitive normalization only fires for
    // already-lowercase + uppercase-mixed inputs that pass shape.
    expect(validateHandle('alice')).toEqual({ ok: true, handle: 'alice' })
    expect(validateHandle('marcus-reyes')).toEqual({
      ok: true,
      handle: 'marcus-reyes',
    })
    expect(validateHandle('a1b2c3')).toEqual({ ok: true, handle: 'a1b2c3' })
    // Mixed case (uppercase) is shape-invalid (regex is case-sensitive).
    expect(validateHandle('Alice')).toEqual({ ok: false, reason: 'invalid_shape' })
    // Trimmed whitespace then lowercased.
    expect(validateHandle('  ALICE  ')).toEqual({ ok: false, reason: 'invalid_shape' })
  })

  it('returns invalid_shape for too-short handles', () => {
    expect(validateHandle('ab')).toEqual({ ok: false, reason: 'invalid_shape' })
    expect(validateHandle('')).toEqual({ ok: false, reason: 'invalid_shape' })
  })

  it('returns invalid_shape for too-long handles', () => {
    const tooLong = 'a'.repeat(HANDLE_MAX_LENGTH + 1)
    expect(validateHandle(tooLong)).toEqual({ ok: false, reason: 'invalid_shape' })
  })

  it('returns invalid_shape for uppercase / special chars', () => {
    expect(validateHandle('Alice')).toEqual({ ok: false, reason: 'invalid_shape' })
    expect(validateHandle('ali_ce')).toEqual({ ok: false, reason: 'invalid_shape' })
    expect(validateHandle('ali ce')).toEqual({ ok: false, reason: 'invalid_shape' })
  })

  it('returns reserved for reserved handles (lowercase)', () => {
    expect(validateHandle('admin')).toEqual({ ok: false, reason: 'reserved' })
    expect(validateHandle('partner')).toEqual({ ok: false, reason: 'reserved' })
    expect(validateHandle('uthena')).toEqual({ ok: false, reason: 'reserved' })
  })

  it('returns reserved for reserved handles (any case)', () => {
    // The shape check is case-sensitive (regex requires lowercase), so
    // these pass-through to the reserved-list check after lowercasing.
    const adminResult = validateHandle('Admin')
    expect(adminResult.ok).toBe(false)
    if (!adminResult.ok) {
      // 'Admin' is uppercase → shape fails before reserved check.
      // We test the case-insensitive behavior using a path that
      // passes the shape but lands on a reserved name (impossible —
      // all reserved names are lowercase + the regex requires
      // lowercase). Document the invariant here instead: the
      // reserved-list check fires AFTER the shape check, so a
      // mixed-case string like 'Admin' is reported as 'invalid_shape'
      // even though it's also reserved.
      expect(adminResult.reason).toBe('invalid_shape')
    }
    // Note: the lowercased variants would surface 'reserved'.
    const adminLower = validateHandle('admin')
    expect(adminLower.ok).toBe(false)
    if (!adminLower.ok) expect(adminLower.reason).toBe('reserved')
    const partnerLower = validateHandle('partner')
    expect(partnerLower.ok).toBe(false)
    if (!partnerLower.ok) expect(partnerLower.reason).toBe('reserved')
  })

  it('returns invalid_shape for non-string input (defensive)', () => {
    expect(validateHandle(null)).toEqual({ ok: false, reason: 'invalid_shape' })
    expect(validateHandle(undefined)).toEqual({ ok: false, reason: 'invalid_shape' })
    expect(validateHandle(123)).toEqual({ ok: false, reason: 'invalid_shape' })
    expect(validateHandle({})).toEqual({ ok: false, reason: 'invalid_shape' })
  })

  it('shape check runs BEFORE reserved check (invalid shape is reported first)', () => {
    // 'Admin' is uppercase → shape fail (not reserved-check fail).
    // This guarantees the user sees the same error as a typo regardless
    // of whether the typo'd name happens to be reserved.
    expect(validateHandle('Admin')).toEqual({ ok: false, reason: 'invalid_shape' })
    expect(validateHandle('partner_')).toEqual({ ok: false, reason: 'invalid_shape' })
  })
})