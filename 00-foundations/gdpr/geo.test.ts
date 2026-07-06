// geo.test.ts — unit tests for the IP-based geographic classification
// helpers used by the P11.2 cookie banner.
//
// These helpers are pure (no I/O, no async, no Next.js imports) so the
// suite runs in single-digit milliseconds. The tests cover:
//   * `isEuCountryCode`  — every EU + EEA member + GB + CH + edge
//                         cases (null, empty, lowercase, garbage,
//                         sentinel values)
//   * `readCountryFromHeaders` — every CDN header + absence +
//                                defensive coercion (lowercase +
//                                whitespace + invalid values)
//   * `isGpcEnabled`     — Sec-GPC: 1 only (per spec); any other
//                         value is treated as "not asserted"
//
// The EU_COUNTRY_CODES constant is asserted to contain the canonical
// 27 EU members + the 3 EEA-only members + the UK + Switzerland so
// we catch any future accidental removal at the type level rather
// than at a regulatory audit.

import { describe, it, expect } from 'vitest'
import {
  COUNTRY_HEADER_CANDIDATES,
  EU_COUNTRY_CODES,
  isEuCountryCode,
  isGpcEnabled,
  readCountryFromHeaders,
} from './geo'

describe('EU_COUNTRY_CODES', () => {
  it('contains all 27 current EU member states', () => {
    const EU_27 = [
      'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR',
      'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL',
      'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE',
    ]
    for (const code of EU_27) {
      expect(EU_COUNTRY_CODES.has(code), `missing EU member ${code}`).toBe(true)
    }
  })

  it('contains the 3 EEA-only members (Iceland, Liechtenstein, Norway)', () => {
    expect(EU_COUNTRY_CODES.has('IS')).toBe(true)
    expect(EU_COUNTRY_CODES.has('LI')).toBe(true)
    expect(EU_COUNTRY_CODES.has('NO')).toBe(true)
  })

  it('contains GB (UK GDPR + PECR) and CH (nFADP)', () => {
    expect(EU_COUNTRY_CODES.has('GB')).toBe(true)
    expect(EU_COUNTRY_CODES.has('CH')).toBe(true)
  })

  it('does NOT contain common non-EU countries', () => {
    expect(EU_COUNTRY_CODES.has('US')).toBe(false)
    expect(EU_COUNTRY_CODES.has('CA')).toBe(false)
    expect(EU_COUNTRY_CODES.has('AU')).toBe(false)
    expect(EU_COUNTRY_CODES.has('BR')).toBe(false)
    expect(EU_COUNTRY_CODES.has('IN')).toBe(false)
    expect(EU_COUNTRY_CODES.has('JP')).toBe(false)
    expect(EU_COUNTRY_CODES.has('CN')).toBe(false)
  })
})

describe('isEuCountryCode', () => {
  it('returns true for every EU/EEA/UK/CH member', () => {
    for (const code of EU_COUNTRY_CODES) {
      expect(isEuCountryCode(code), `expected ${code} to be EU`).toBe(true)
    }
  })

  it('is case-insensitive (lowercase input normalizes to uppercase lookup)', () => {
    expect(isEuCountryCode('de')).toBe(true)
    expect(isEuCountryCode('us')).toBe(false)
    expect(isEuCountryCode('Gb')).toBe(true)
  })

  it('returns false for nullish and empty values', () => {
    expect(isEuCountryCode(null)).toBe(false)
    expect(isEuCountryCode(undefined)).toBe(false)
    expect(isEuCountryCode('')).toBe(false)
  })

  it('returns false for the "unknown" sentinels (XX, T1 — not in the EU set)', () => {
    // These are also collapsed by `readCountryFromHeaders` to null,
    // so the geo gate in `getConsentBannerState` never sees them
    // directly. We still assert the function's direct behavior here.
    expect(isEuCountryCode('XX')).toBe(false)
    expect(isEuCountryCode('T1')).toBe(false)
  })

  it('returns false for empty-string-after-trim and non-2-letter inputs', () => {
    expect(isEuCountryCode('USA')).toBe(false) // 3 letters
    expect(isEuCountryCode('1')).toBe(false)   // 1 char
    expect(isEuCountryCode('  ')).toBe(false) // whitespace only
  })
})

describe('readCountryFromHeaders', () => {
  it('returns null when the headers object is null or undefined', () => {
    expect(readCountryFromHeaders(null)).toBe(null)
    expect(readCountryFromHeaders(undefined)).toBe(null)
  })

  it('returns null when no recognized country header is present', () => {
    const headers = makeHeaders({ 'x-some-other': 'value' })
    expect(readCountryFromHeaders(headers)).toBe(null)
  })

  it('reads cf-ipcountry (Cloudflare)', () => {
    const headers = makeHeaders({ 'cf-ipcountry': 'DE' })
    expect(readCountryFromHeaders(headers)).toBe('DE')
  })

  it('reads x-vercel-ip-country (Vercel)', () => {
    const headers = makeHeaders({ 'x-vercel-ip-country': 'FR' })
    expect(readCountryFromHeaders(headers)).toBe('FR')
  })

  it('reads x-country (generic)', () => {
    const headers = makeHeaders({ 'x-country': 'US' })
    expect(readCountryFromHeaders(headers)).toBe('US')
  })

  it('reads x-appengine-country (App Engine)', () => {
    const headers = makeHeaders({ 'x-appengine-country': 'JP' })
    expect(readCountryFromHeaders(headers)).toBe('JP')
  })

  it('uppercases a lowercase value', () => {
    const headers = makeHeaders({ 'cf-ipcountry': 'de' })
    expect(readCountryFromHeaders(headers)).toBe('DE')
  })

  it('trims surrounding whitespace', () => {
    const headers = makeHeaders({ 'cf-ipcountry': '  DE  ' })
    expect(readCountryFromHeaders(headers)).toBe('DE')
  })

  it('prefers the first candidate header when multiple are present', () => {
    const headers = makeHeaders({
      'cf-ipcountry': 'DE',
      'x-vercel-ip-country': 'FR',
    })
    expect(readCountryFromHeaders(headers)).toBe('DE')
  })

  it('falls through to the next candidate when the first is empty', () => {
    const headers = makeHeaders({
      'cf-ipcountry': '',
      'x-vercel-ip-country': 'FR',
    })
    expect(readCountryFromHeaders(headers)).toBe('FR')
  })

  it('returns null when the first non-empty candidate has invalid shape', () => {
    const headers = makeHeaders({ 'cf-ipcountry': 'xx-us' })
    expect(readCountryFromHeaders(headers)).toBe(null)
  })

  it('falls through invalid first candidate to a valid second candidate', () => {
    const headers = makeHeaders({
      'cf-ipcountry': 'xx-us',
      'x-vercel-ip-country': 'CA',
    })
    expect(readCountryFromHeaders(headers)).toBe('CA')
  })

  it('skips fly-region (region code is not a country code)', () => {
    const headers = makeHeaders({ 'fly-region': 'nrt' })
    expect(readCountryFromHeaders(headers)).toBe(null)
  })

  it('skips fly-region even when it is the only present header', () => {
    const headers = makeHeaders({ 'fly-region': 'ams' })
    expect(readCountryFromHeaders(headers)).toBe(null)
  })

  it('collapses the "unknown country" sentinels (XX, T1) to null', () => {
    expect(readCountryFromHeaders(makeHeaders({ 'cf-ipcountry': 'XX' }))).toBe(null)
    expect(readCountryFromHeaders(makeHeaders({ 'cf-ipcountry': 'T1' }))).toBe(null)
    expect(readCountryFromHeaders(makeHeaders({ 'x-vercel-ip-country': 'XX' }))).toBe(null)
  })

  it('collapses case-variant sentinels (xx lower-case)', () => {
    expect(readCountryFromHeaders(makeHeaders({ 'cf-ipcountry': 'xx' }))).toBe(null)
  })

  it('exposes the candidate list so callers can enumerate it', () => {
    expect(COUNTRY_HEADER_CANDIDATES).toContain('cf-ipcountry')
    expect(COUNTRY_HEADER_CANDIDATES).toContain('x-vercel-ip-country')
    expect(COUNTRY_HEADER_CANDIDATES).toContain('x-country')
    expect(COUNTRY_HEADER_CANDIDATES).toContain('x-appengine-country')
    expect(COUNTRY_HEADER_CANDIDATES).toContain('fly-region')
  })
})

describe('isGpcEnabled', () => {
  it('returns true when the header is exactly "1"', () => {
    const headers = makeHeaders({ 'sec-gpc': '1' })
    expect(isGpcEnabled(headers)).toBe(true)
  })

  it('returns false when the header is absent', () => {
    const headers = makeHeaders({})
    expect(isGpcEnabled(headers)).toBe(false)
  })

  it('returns false when the header is any value other than "1"', () => {
    expect(isGpcEnabled(makeHeaders({ 'sec-gpc': '0' }))).toBe(false)
    expect(isGpcEnabled(makeHeaders({ 'sec-gpc': 'true' }))).toBe(false)
    expect(isGpcEnabled(makeHeaders({ 'sec-gpc': 'yes' }))).toBe(false)
    expect(isGpcEnabled(makeHeaders({ 'sec-gpc': '2' }))).toBe(false)
  })

  it('trims whitespace around the value', () => {
    const headers = makeHeaders({ 'sec-gpc': '  1  ' })
    expect(isGpcEnabled(headers)).toBe(true)
  })

  it('returns false for nullish headers', () => {
    expect(isGpcEnabled(null)).toBe(false)
    expect(isGpcEnabled(undefined)).toBe(false)
  })
})

/** Test-only fake. Real Next.js `headers()` returns the full
 *  request-headers object; we only need `get(name)` so a Map-backed
 *  shim is sufficient. */
function makeHeaders(values: Record<string, string>): Headers {
  const map = new Map<string, string>()
  for (const [k, v] of Object.entries(values)) {
    map.set(k.toLowerCase(), v)
  }
  return {
    get(name: string): string | null {
      return map.get(name.toLowerCase()) ?? null
    },
  } as unknown as Headers
}
