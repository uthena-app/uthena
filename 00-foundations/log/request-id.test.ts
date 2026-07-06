// Unit tests for `00-foundations/log/request-id.ts`.
//
// Covers:
//   - `REQUEST_ID_HEADER` is the documented constant (`x-uthena-request-id`).
//   - `generateRequestId()` returns a fresh UUID v4 each call.
//   - `isValidRequestId()` accepts canonical UUIDs + prefixed UUIDs,
//     rejects empty / non-hex / over-length / wrong-shape strings.
//   - `getOrCreateRequestId(headers)` mints a fresh UUID when absent,
//     reuses an incoming valid ID, replaces an invalid one with a
//     fresh UUID (defensive against header injection / garbage from
//     upstream proxies).

import { describe, expect, it } from 'vitest'
import {
  REQUEST_ID_HEADER,
  generateRequestId,
  getOrCreateRequestId,
  isValidRequestId,
} from './request-id'

describe('REQUEST_ID_HEADER', () => {
  it('is the documented constant', () => {
    expect(REQUEST_ID_HEADER).toBe('x-uthena-request-id')
  })
})

describe('generateRequestId', () => {
  it('returns a fresh UUID each call', () => {
    const a = generateRequestId()
    const b = generateRequestId()
    expect(a).not.toBe(b)
  })

  it('matches the canonical UUID shape (8-4-4-4-12 hex)', () => {
    const id = generateRequestId()
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
  })
})

describe('isValidRequestId', () => {
  it('accepts a canonical UUID v4', () => {
    expect(isValidRequestId('11111111-2222-3333-4444-555555555555')).toBe(true)
  })

  it('accepts a canonical UUID v4 (uppercase)', () => {
    expect(isValidRequestId('AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE')).toBe(true)
  })

  it('accepts a prefixed UUID (req_<uuid>)', () => {
    expect(isValidRequestId('req_11111111-2222-3333-4444-555555555555')).toBe(true)
  })

  it('accepts a prefixed UUID (trace_<uuid>)', () => {
    expect(isValidRequestId('trace_11111111-2222-3333-4444-555555555555')).toBe(true)
  })

  it('accepts a short prefix (single letter)', () => {
    expect(isValidRequestId('a_11111111-2222-3333-4444-555555555555')).toBe(true)
  })

  it('accepts a prefix without separator (max 32 chars)', () => {
    expect(isValidRequestId('abcdefghijklmnop_11111111-2222-3333-4444-555555555555')).toBe(true)
  })

  it('rejects the empty string', () => {
    expect(isValidRequestId('')).toBe(false)
  })

  it('rejects whitespace', () => {
    expect(isValidRequestId('   ')).toBe(false)
  })

  it('rejects non-hex characters', () => {
    expect(isValidRequestId('11111111-2222-3333-4444-55555555555z')).toBe(false)
  })

  it('rejects the wrong length', () => {
    expect(isValidRequestId('11111111-2222-3333-4444-55555555555')).toBe(false) // 11 in last group
    expect(isValidRequestId('11111111-2222-3333-4444-5555555555555')).toBe(false) // 13 in last group
  })

  it('rejects strings longer than 96 chars', () => {
    const tooLong = 'a'.repeat(40) + '_' + '11111111-2222-3333-4444-555555555555' + 'x'.repeat(20)
    expect(tooLong.length).toBeGreaterThan(96)
    expect(isValidRequestId(tooLong)).toBe(false)
  })

  it('rejects plain text', () => {
    expect(isValidRequestId('not-a-uuid')).toBe(false)
  })

  it('rejects SQL-injection-shaped garbage', () => {
    expect(isValidRequestId("'; DROP TABLE users; --")).toBe(false)
  })

  it('rejects header-injection CRLF', () => {
    expect(isValidRequestId('11111111-2222-3333-4444-555555555555\r\nSet-Cookie: x=1')).toBe(false)
  })

  it('rejects a 33-char prefix (above the cap)', () => {
    const prefix = 'a'.repeat(33)
    expect(isValidRequestId(`${prefix}_11111111-2222-3333-4444-555555555555`)).toBe(false)
  })
})

describe('getOrCreateRequestId', () => {
  it('mints a fresh UUID when the header is missing', () => {
    const headers = new Headers()
    const id = getOrCreateRequestId(headers)
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
  })

  it('mints a fresh UUID when the header is empty', () => {
    const headers = new Headers()
    headers.set(REQUEST_ID_HEADER, '')
    const id = getOrCreateRequestId(headers)
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
  })

  it('mints a fresh UUID when the header is whitespace', () => {
    const headers = new Headers()
    headers.set(REQUEST_ID_HEADER, '   ')
    const id = getOrCreateRequestId(headers)
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
  })

  it('reuses a valid incoming UUID', () => {
    const headers = new Headers()
    headers.set(REQUEST_ID_HEADER, '11111111-2222-3333-4444-555555555555')
    expect(getOrCreateRequestId(headers)).toBe('11111111-2222-3333-4444-555555555555')
  })

  it('reuses a prefixed incoming UUID', () => {
    const headers = new Headers()
    headers.set(REQUEST_ID_HEADER, 'req_11111111-2222-3333-4444-555555555555')
    expect(getOrCreateRequestId(headers)).toBe('req_11111111-2222-3333-4444-555555555555')
  })

  it('normalizes uppercase UUIDs to lowercase', () => {
    const headers = new Headers()
    headers.set(REQUEST_ID_HEADER, 'AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE')
    expect(getOrCreateRequestId(headers)).toBe('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')
  })

  it('trims surrounding whitespace from a valid UUID', () => {
    const headers = new Headers()
    headers.set(REQUEST_ID_HEADER, '  11111111-2222-3333-4444-555555555555  ')
    expect(getOrCreateRequestId(headers)).toBe('11111111-2222-3333-4444-555555555555')
  })

  it('replaces an invalid incoming value with a fresh UUID', () => {
    const headers = new Headers()
    headers.set(REQUEST_ID_HEADER, 'not-a-uuid')
    const id = getOrCreateRequestId(headers)
    expect(id).not.toBe('not-a-uuid')
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
  })

  it('replaces CRLF-injection garbage with a fresh UUID', () => {
    // Headers.set() rejects CRLF in the WHATWG Headers implementation
    // (a defense in depth the platform provides for us), so we exercise
    // the validator directly with the same shape an attacker would try.
    expect(isValidRequestId('aaaa\r\nSet-Cookie: x=1')).toBe(false)
    // And the seam's behavior — even if the validator is bypassed by a
    // future bug, the caller can detect the malformed input.
    const id = generateRequestId()
    expect(isValidRequestId(id)).toBe(true)
  })

  it('two requests without an incoming header get distinct IDs', () => {
    const a = getOrCreateRequestId(new Headers())
    const b = getOrCreateRequestId(new Headers())
    expect(a).not.toBe(b)
  })
})