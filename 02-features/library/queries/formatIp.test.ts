// formatIp.test.ts — unit tests for the IP-mask + UA-shorten helpers.

import { describe, expect, it } from 'vitest'
import { maskIp, shortUserAgent } from './formatIp'

describe('maskIp', () => {
  it('masks the last octet of a normal IPv4', () => {
    expect(maskIp('192.168.1.42')).toBe('192.168.1.***')
  })

  it('masks even small private ranges', () => {
    expect(maskIp('10.0.0.1')).toBe('10.0.0.***')
    expect(maskIp('127.0.0.1')).toBe('127.0.0.***')
  })

  it('returns em-dash for null', () => {
    expect(maskIp(null)).toBe('—')
  })

  it('returns em-dash for undefined', () => {
    expect(maskIp(undefined)).toBe('—')
  })

  it('returns em-dash for empty string', () => {
    expect(maskIp('')).toBe('—')
  })

  it('passes through IPv6 unchanged', () => {
    expect(maskIp('::1')).toBe('::1')
    expect(maskIp('2001:db8::1')).toBe('2001:db8::1')
  })

  it('passes through garbage strings unchanged', () => {
    expect(maskIp('not-an-ip')).toBe('not-an-ip')
    expect(maskIp('localhost')).toBe('localhost')
  })

  it('passes through non-numeric octets unchanged', () => {
    // "192.168.1.foo" — last part isn't a number → no mask
    expect(maskIp('192.168.1.foo')).toBe('192.168.1.foo')
  })

  it('handles 3-digit octets', () => {
    expect(maskIp('255.255.255.255')).toBe('255.255.255.***')
    expect(maskIp('1.2.3.4')).toBe('1.2.3.***')
  })

  it('rejects IPv4-shaped strings with 5 parts', () => {
    expect(maskIp('1.2.3.4.5')).toBe('1.2.3.4.5')
  })

  it('rejects IPv4-shaped strings with 3 parts', () => {
    expect(maskIp('1.2.3')).toBe('1.2.3')
  })
})

describe('shortUserAgent', () => {
  it('returns em-dash for null / undefined / empty', () => {
    expect(shortUserAgent(null)).toBe('—')
    expect(shortUserAgent(undefined)).toBe('—')
    expect(shortUserAgent('')).toBe('—')
  })

  it('detects Chrome on macOS with major version', () => {
    const ua =
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
    expect(shortUserAgent(ua)).toBe('Chrome 124 · macOS')
  })

  it('detects Edge (Edge UA contains "Chrome" — must match Edge first)', () => {
    const ua =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0'
    expect(shortUserAgent(ua)).toMatch(/^Edge 124 · Windows$/)
  })

  it('detects Firefox on Windows', () => {
    const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0'
    expect(shortUserAgent(ua)).toMatch(/^Firefox 125 · Windows$/)
  })

  it('detects Safari on macOS (no Chrome token)', () => {
    const ua =
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15'
    expect(shortUserAgent(ua)).toMatch(/^Safari 17 · macOS$/)
  })

  it('detects Mobile Safari on iOS', () => {
    const ua =
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
    expect(shortUserAgent(ua)).toMatch(/^Mobile Safari 17 · iOS$/)
  })

  it('detects curl', () => {
    expect(shortUserAgent('curl/8.4.0')).toBe('curl 8')
  })

  it('detects Postman', () => {
    expect(shortUserAgent('PostmanRuntime/7.36.0')).toBe('Postman 7')
  })

  it('detects Android Chrome', () => {
    const ua =
      'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36'
    expect(shortUserAgent(ua)).toMatch(/^Chrome 124 · Android$/)
  })

  it('detects Opera', () => {
    const ua =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 OPR/109.0.0.0'
    expect(shortUserAgent(ua)).toMatch(/^Opera 109 · Windows$/)
  })

  it('detects Linux OS', () => {
    const ua = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
    expect(shortUserAgent(ua)).toMatch(/^Chrome 124 · Linux$/)
  })

  it('truncates unknown long UAs', () => {
    const long = 'x'.repeat(200)
    const result = shortUserAgent(long)
    expect(result.length).toBeLessThanOrEqual(60)
    expect(result.endsWith('...')).toBe(true)
  })

  it('keeps unknown short UAs verbatim', () => {
    expect(shortUserAgent('SomeUnknown/1.0')).toBe('SomeUnknown/1.0')
  })
})
