// Unit tests for the signed-URL helpers in `signed-url.ts`. Pure
// functions, no fixtures needed. Covers:
//
//   - signCdnUrl: TTL enforcement (24h download, 4h stream), IP
//     binding, query params, signature is deterministic, signature
//     changes when path / expires / ip / key changes, throws when
//     Bunny is not configured.
//   - verifyCdnUrl: round-trips sign → verify, rejects expired,
//     rejects tampered, rejects IP mismatch, accepts missing IP
//     when URL is not IP-bound, accepts matching IP when IP-bound.
//   - isBunnyConfigured + getPublicCdnUrl: the env-gated surfaces.
//
// Run: `pnpm test signed-url` (vitest).

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { _resetEnvForTests } from '../env'
import {
  HOUR_MS,
  SIGNED_URL_LIMIT_PER_HOUR,
  SIGNED_URL_TTL_SECONDS,
  getPublicCdnUrl,
  isBunnyConfigured,
  signCdnUrl,
  verifyCdnUrl,
} from './signed-url'

// ===========================================================================
// Env management
// ===========================================================================

const BASE_ENV = {
  BUNNY_SIGNING_KEY: 'test-signing-key-32chars-minimum-pad',
  BUNNY_STORAGE_PUBLIC_HOSTNAME: 'https://cdn.example.test',
}

function setBunnyEnv(overrides: Partial<typeof BASE_ENV> = {}) {
  process.env.BUNNY_SIGNING_KEY = overrides.BUNNY_SIGNING_KEY ?? BASE_ENV.BUNNY_SIGNING_KEY
  process.env.BUNNY_STORAGE_PUBLIC_HOSTNAME =
    overrides.BUNNY_STORAGE_PUBLIC_HOSTNAME ?? BASE_ENV.BUNNY_STORAGE_PUBLIC_HOSTNAME
  _resetEnvForTests()
}

beforeEach(() => {
  setBunnyEnv()
})

afterEach(() => {
  // The env is cached; reset so other tests see a clean slate.
  _resetEnvForTests()
})

// ===========================================================================
// isBunnyConfigured
// ===========================================================================

describe('isBunnyConfigured', () => {
  it('returns true when both signing key + hostname are set', () => {
    setBunnyEnv()
    expect(isBunnyConfigured()).toBe(true)
  })
  it('returns false when signing key is missing', () => {
    setBunnyEnv({ BUNNY_SIGNING_KEY: '' })
    expect(isBunnyConfigured()).toBe(false)
  })
  it('returns false when hostname is missing', () => {
    setBunnyEnv({ BUNNY_STORAGE_PUBLIC_HOSTNAME: '' })
    expect(isBunnyConfigured()).toBe(false)
  })
  it('returns false when both are missing', () => {
    setBunnyEnv({ BUNNY_SIGNING_KEY: '', BUNNY_STORAGE_PUBLIC_HOSTNAME: '' })
    expect(isBunnyConfigured()).toBe(false)
  })
})

// ===========================================================================
// getPublicCdnUrl
// ===========================================================================

describe('getPublicCdnUrl', () => {
  it('builds the full URL from the public hostname + path', () => {
    expect(getPublicCdnUrl('products/123/cover.jpg')).toBe(
      'https://cdn.example.test/products/123/cover.jpg',
    )
  })
  it('does NOT sign (no token / expires query params)', () => {
    const url = getPublicCdnUrl('thumbs/x.png')
    expect(url).not.toMatch(/[?&]token=/)
    expect(url).not.toMatch(/[?&]expires=/)
  })
  it('throws when hostname is missing', () => {
    setBunnyEnv({ BUNNY_STORAGE_PUBLIC_HOSTNAME: '' })
    expect(() => getPublicCdnUrl('x.png')).toThrow(/BUNNY_STORAGE_PUBLIC_HOSTNAME/)
  })
})

// ===========================================================================
// signCdnUrl — TTL enforcement
// ===========================================================================

describe('signCdnUrl — TTL enforcement', () => {
  it('download TTL is exactly 24h (86400s)', () => {
    expect(SIGNED_URL_TTL_SECONDS.download).toBe(24 * 60 * 60)
  })
  it('stream TTL is exactly 4h (14400s)', () => {
    expect(SIGNED_URL_TTL_SECONDS.stream).toBe(4 * 60 * 60)
  })

  it('download URL expires 24h after `now`', () => {
    const now = Date.parse('2026-06-25T00:00:00.000Z')
    const { expiresAt } = signCdnUrl({
      storagePath: 'products/1/file.pdf',
      kind: 'download',
      nowMs: now,
    })
    expect(expiresAt.getTime()).toBe(now + 24 * 60 * 60 * 1000)
  })
  it('stream URL expires 4h after `now`', () => {
    const now = Date.parse('2026-06-25T00:00:00.000Z')
    const { expiresAt } = signCdnUrl({
      storagePath: 'products/1/playlist.m3u8',
      kind: 'stream',
      ip: '203.0.113.5',
      nowMs: now,
    })
    expect(expiresAt.getTime()).toBe(now + 4 * 60 * 60 * 1000)
  })
})

// ===========================================================================
// signCdnUrl — query string shape
// ===========================================================================

describe('signCdnUrl — query string shape', () => {
  it('always sets token + expires', () => {
    const { url } = signCdnUrl({ storagePath: 'a/b.pdf', kind: 'download' })
    const u = new URL(url)
    expect(u.searchParams.get('token')).toMatch(/^[0-9a-f]{64}$/)
    expect(Number(u.searchParams.get('expires'))).toBeGreaterThan(0)
  })
  it('does not set `ip` query param when no IP is passed (download)', () => {
    const { url } = signCdnUrl({ storagePath: 'a/b.pdf', kind: 'download' })
    const u = new URL(url)
    expect(u.searchParams.has('ip')).toBe(false)
  })
  it('sets `ip` query param when IP is passed (stream)', () => {
    const { url } = signCdnUrl({ storagePath: 'a/playlist.m3u8', kind: 'stream', ip: '198.51.100.7' })
    const u = new URL(url)
    expect(u.searchParams.get('ip')).toBe('198.51.100.7')
  })
  it('appends extraQuery params verbatim', () => {
    const { url } = signCdnUrl({
      storagePath: 'a/playlist.m3u8',
      kind: 'stream',
      ip: '198.51.100.7',
      extraQuery: { token_path: 'true', preload: 'auto' },
    })
    const u = new URL(url)
    expect(u.searchParams.get('token_path')).toBe('true')
    expect(u.searchParams.get('preload')).toBe('auto')
  })
  it('builds the base from BUNNY_STORAGE_PUBLIC_HOSTNAME + path', () => {
    const { url } = signCdnUrl({ storagePath: 'products/42/source.zip', kind: 'download' })
    expect(url.startsWith('https://cdn.example.test/products/42/source.zip?')).toBe(true)
  })
})

// ===========================================================================
// signCdnUrl — signature determinism + sensitivity
// ===========================================================================

describe('signCdnUrl — signature', () => {
  it('is deterministic for the same inputs (same `now` override)', () => {
    const now = Date.parse('2026-06-25T00:00:00.000Z')
    const a = signCdnUrl({ storagePath: 'a/b.pdf', kind: 'download', nowMs: now })
    const b = signCdnUrl({ storagePath: 'a/b.pdf', kind: 'download', nowMs: now })
    expect(a.url).toBe(b.url)
  })
  it('changes when the storage path changes', () => {
    const now = Date.parse('2026-06-25T00:00:00.000Z')
    const a = signCdnUrl({ storagePath: 'a/b.pdf', kind: 'download', nowMs: now })
    const b = signCdnUrl({ storagePath: 'a/c.pdf', kind: 'download', nowMs: now })
    const tokA = new URL(a.url).searchParams.get('token')!
    const tokB = new URL(b.url).searchParams.get('token')!
    expect(tokA).not.toBe(tokB)
  })
  it('changes when the IP changes (IP-bound stream)', () => {
    const now = Date.parse('2026-06-25T00:00:00.000Z')
    const a = signCdnUrl({ storagePath: 'a/m.m3u8', kind: 'stream', ip: '198.51.100.1', nowMs: now })
    const b = signCdnUrl({ storagePath: 'a/m.m3u8', kind: 'stream', ip: '198.51.100.2', nowMs: now })
    const tokA = new URL(a.url).searchParams.get('token')!
    const tokB = new URL(b.url).searchParams.get('token')!
    expect(tokA).not.toBe(tokB)
  })
  it('changes when the signing key changes', () => {
    const now = Date.parse('2026-06-25T00:00:00.000Z')
    setBunnyEnv()
    const a = signCdnUrl({ storagePath: 'a/b.pdf', kind: 'download', nowMs: now })
    setBunnyEnv({ BUNNY_SIGNING_KEY: 'different-key-32chars-minimum-pad' })
    const b = signCdnUrl({ storagePath: 'a/b.pdf', kind: 'download', nowMs: now })
    const tokA = new URL(a.url).searchParams.get('token')!
    const tokB = new URL(b.url).searchParams.get('token')!
    expect(tokA).not.toBe(tokB)
  })
  it('changes when the `now` changes (different expires timestamp)', () => {
    const a = signCdnUrl({
      storagePath: 'a/b.pdf',
      kind: 'download',
      nowMs: Date.parse('2026-06-25T00:00:00.000Z'),
    })
    const b = signCdnUrl({
      storagePath: 'a/b.pdf',
      kind: 'download',
      nowMs: Date.parse('2026-06-25T00:01:00.000Z'),
    })
    const tokA = new URL(a.url).searchParams.get('token')!
    const tokB = new URL(b.url).searchParams.get('token')!
    expect(tokA).not.toBe(tokB)
  })
})

// ===========================================================================
// signCdnUrl — failure modes
// ===========================================================================

describe('signCdnUrl — failure modes', () => {
  it('throws when signing key is missing', () => {
    setBunnyEnv({ BUNNY_SIGNING_KEY: '' })
    expect(() => signCdnUrl({ storagePath: 'a/b.pdf', kind: 'download' })).toThrow(/BUNNY_SIGNING_KEY/)
  })
  it('throws when hostname is missing', () => {
    setBunnyEnv({ BUNNY_STORAGE_PUBLIC_HOSTNAME: '' })
    expect(() => signCdnUrl({ storagePath: 'a/b.pdf', kind: 'download' })).toThrow(
      /BUNNY_STORAGE_PUBLIC_HOSTNAME/,
    )
  })
})

// ===========================================================================
// verifyCdnUrl — happy path
// ===========================================================================

describe('verifyCdnUrl — happy path (download, not IP-bound)', () => {
  it('round-trips a download URL', () => {
    const now = Date.parse('2026-06-25T00:00:00.000Z')
    const { url } = signCdnUrl({ storagePath: 'products/1/file.pdf', kind: 'download', nowMs: now })
    const result = verifyCdnUrl({ url, nowMs: now + 60_000 })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.kind).toBe('download')
      expect(result.storagePath).toBe('products/1/file.pdf')
    }
  })
  it('accepts the verify call with no requestIp (URL is not IP-bound)', () => {
    const now = Date.parse('2026-06-25T00:00:00.000Z')
    const { url } = signCdnUrl({ storagePath: 'a/b.pdf', kind: 'download', nowMs: now })
    const result = verifyCdnUrl({ url, nowMs: now + 1000 })
    expect(result.ok).toBe(true)
  })
})

// ===========================================================================
// verifyCdnUrl — happy path (stream, IP-bound)
// ===========================================================================

describe('verifyCdnUrl — happy path (stream, IP-bound)', () => {
  it('round-trips when the verifier passes the same IP', () => {
    const now = Date.parse('2026-06-25T00:00:00.000Z')
    const { url } = signCdnUrl({
      storagePath: 'a/playlist.m3u8',
      kind: 'stream',
      ip: '203.0.113.10',
      nowMs: now,
    })
    const result = verifyCdnUrl({ url, nowMs: now + 1000, requestIp: '203.0.113.10' })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.kind).toBe('stream')
      expect(result.storagePath).toBe('a/playlist.m3u8')
    }
  })
  it('accepts the verify call when the URL is bound but no requestIp is given — treated as IP mismatch', () => {
    // Spec: if the URL is IP-bound, the verifier MUST know the IP.
    // We treat a missing requestIp as ip_mismatch (safer default).
    const now = Date.parse('2026-06-25T00:00:00.000Z')
    const { url } = signCdnUrl({
      storagePath: 'a/playlist.m3u8',
      kind: 'stream',
      ip: '203.0.113.10',
      nowMs: now,
    })
    const result = verifyCdnUrl({ url, nowMs: now + 1000 })
    expect(result).toEqual({ ok: false, reason: 'ip_mismatch' })
  })
})

// ===========================================================================
// verifyCdnUrl — reject paths
// ===========================================================================

describe('verifyCdnUrl — rejects', () => {
  it('rejects an expired URL', () => {
    const now = Date.parse('2026-06-25T00:00:00.000Z')
    const { url } = signCdnUrl({ storagePath: 'a/b.pdf', kind: 'download', nowMs: now })
    const result = verifyCdnUrl({ url, nowMs: now + SIGNED_URL_TTL_SECONDS.download * 1000 + 1 })
    expect(result).toEqual({ ok: false, reason: 'expired' })
  })

  it('rejects a tampered token', () => {
    const now = Date.parse('2026-06-25T00:00:00.000Z')
    const { url } = signCdnUrl({ storagePath: 'a/b.pdf', kind: 'download', nowMs: now })
    // Flip the last hex char
    const tampered = url.replace(/.$/, (c) => (c === '0' ? '1' : '0'))
    const result = verifyCdnUrl({ url: tampered, nowMs: now + 1000 })
    expect(result).toEqual({ ok: false, reason: 'bad_signature' })
  })

  it('rejects a tampered storage path', () => {
    const now = Date.parse('2026-06-25T00:00:00.000Z')
    const { url } = signCdnUrl({ storagePath: 'a/b.pdf', kind: 'download', nowMs: now })
    const tampered = url.replace('/a/b.pdf', '/a/c.pdf')
    const result = verifyCdnUrl({ url: tampered, nowMs: now + 1000 })
    expect(result).toEqual({ ok: false, reason: 'bad_signature' })
  })

  it('rejects an IP mismatch on a bound URL', () => {
    const now = Date.parse('2026-06-25T00:00:00.000Z')
    const { url } = signCdnUrl({
      storagePath: 'a/playlist.m3u8',
      kind: 'stream',
      ip: '203.0.113.10',
      nowMs: now,
    })
    const result = verifyCdnUrl({ url, nowMs: now + 1000, requestIp: '198.51.100.99' })
    expect(result).toEqual({ ok: false, reason: 'ip_mismatch' })
  })

  it('rejects a wrong host', () => {
    const now = Date.parse('2026-06-25T00:00:00.000Z')
    const { url } = signCdnUrl({ storagePath: 'a/b.pdf', kind: 'download', nowMs: now })
    // Swap the host to a different one
    const tampered = url.replace('https://cdn.example.test', 'https://evil.test')
    const result = verifyCdnUrl({ url: tampered, nowMs: now + 1000 })
    expect(result).toEqual({ ok: false, reason: 'wrong_host' })
  })

  it('rejects a malformed URL', () => {
    const result = verifyCdnUrl({ url: 'not a url' })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe('parse_error')
    }
  })

  it('rejects a URL with no token', () => {
    const result = verifyCdnUrl({ url: 'https://cdn.example.test/a/b.pdf?expires=9999999999' })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe('parse_error')
    }
  })

  it('rejects a URL with no expires', () => {
    const result = verifyCdnUrl({ url: 'https://cdn.example.test/a/b.pdf?token=deadbeef' })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe('parse_error')
    }
  })

  it('returns misconfigured when Bunny env is missing', () => {
    setBunnyEnv({ BUNNY_SIGNING_KEY: '' })
    const result = verifyCdnUrl({ url: 'https://cdn.example.test/a/b.pdf?token=x&expires=9999999999' })
    expect(result).toEqual({ ok: false, reason: 'misconfigured' })
  })
})

// ===========================================================================
// Exports sanity
// ===========================================================================

describe('exports', () => {
  it('HOUR_MS is one hour in milliseconds', () => {
    expect(HOUR_MS).toBe(60 * 60 * 1000)
  })
  it('SIGNED_URL_LIMIT_PER_HOUR is 60', () => {
    expect(SIGNED_URL_LIMIT_PER_HOUR).toBe(60)
  })
})
