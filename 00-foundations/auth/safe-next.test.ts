// Unit tests for `safeNext` — the open-redirect guard.
//
// Pure function, no fixtures needed. Covers:
//   - happy paths (relative path is allowed)
//   - protocol-relative URLs rejected
//   - absolute URLs (http/https/javascript/data/vbscript/file:) rejected
//   - backslash tricks rejected
//   - encoded slash bypass rejected
//   - non-string / nullish / empty inputs handled
//   - whitespace trimmed
//
// Run: `pnpm test guards` (vitest).

import { describe, expect, it } from 'vitest'
import { safeNext } from './safe-next'

describe('safeNext', () => {
  describe('happy paths', () => {
    it.each([
      ['/'],
      ['/library'],
      ['/account/orders/123'],
      ['/products/some-slug?ref=winter-sale'],
      ['/cart#items'],
      ['/library?from=sale&campaign=2026'],
      ['/a/b/c/d/e/f/g/h/i/j/k/l/m/n/o/p/q/r/s/t/u/v/w/x/y/z'],
    ])('returns the input unchanged for safe path %s', (input) => {
      expect(safeNext(input)).toBe(input)
    })
  })

  describe('rejects protocol-relative URLs', () => {
    it.each([
      '//evil.com',
      '//evil.com/login',
      '////evil.com',
      '//',
    ])('returns null for %s', (input) => {
      expect(safeNext(input)).toBeNull()
    })
  })

  describe('rejects absolute URLs', () => {
    it.each([
      'http://evil.com',
      'https://evil.com/login',
      'HTTPS://evil.com',
      'ftp://files.example.com',
    ])('returns null for %s', (input) => {
      expect(safeNext(input)).toBeNull()
    })
  })

  describe('rejects dangerous schemes even when wrapped in a leading /', () => {
    it.each([
      '/javascript:alert(1)',
      '/data:text/html,<script>alert(1)</script>',
      '/vbscript:msgbox(1)',
      '/file:///etc/passwd',
      '/mailto:attacker@evil.com',
      '/tel:+15555555555',
    ])('returns null for %s', (input) => {
      expect(safeNext(input)).toBeNull()
    })
  })

  describe('rejects backslash tricks', () => {
    // Some browsers normalize \ to / in the URL parser. An attacker
    // can craft "/\\evil.com" which a naïve startsWith('/') check
    // passes, but the browser follows it as `//evil.com`.
    it.each([
      '/\\evil.com',
      '/\\\\evil.com/path',
      '/foo\\bar',
      '\\evil.com',
    ])('returns null for %s', (input) => {
      expect(safeNext(input)).toBeNull()
    })
  })

  describe('rejects encoded-slash bypass attempts', () => {
    // %2f%2f is "//" URL-encoded. A naïve check passes because the
    // decoded string isn't in the input.
    it.each([
      '/%2f%2fevil.com',
      '/path%2f%2fevil.com',
      '/%2F%2FEVIL.COM',
    ])('returns null for %s', (input) => {
      expect(safeNext(input)).toBeNull()
    })
  })

  describe('rejects non-string input', () => {
    it.each([
      { label: 'null', input: null as unknown },
      { label: 'undefined', input: undefined as unknown },
      { label: 'number', input: 42 as unknown },
      { label: 'boolean', input: true as unknown },
      { label: 'object', input: {} as unknown },
      { label: 'array', input: [] as unknown },
      { label: 'array-of-strings', input: ['a', 'b'] as unknown },
    ])('returns null for $label', ({ input }) => {
      expect(safeNext(input)).toBeNull()
    })
  })

  describe('rejects empty / whitespace input', () => {
    it.each([[''], [' '], ['\t'], ['\n'], ['   ']])('returns null for %j', (input) => {
      expect(safeNext(input)).toBeNull()
    })
  })

  describe('trims surrounding whitespace', () => {
    it('returns trimmed value for a safe path with surrounding spaces', () => {
      expect(safeNext('  /library  ')).toBe('/library')
    })

    it('returns null when only whitespace', () => {
      expect(safeNext('   ')).toBeNull()
    })
  })

  describe('rejects paths missing the leading slash', () => {
    it.each([
      'library',
      'account/orders',
      'products/some-slug',
    ])('returns null for %s', (input) => {
      expect(safeNext(input)).toBeNull()
    })
  })
})
