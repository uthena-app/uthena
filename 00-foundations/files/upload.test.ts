// Unit tests for the avatar signed-PUT helper in `upload.ts`.
//
// Tests focus on:
//   - Env-gated behavior (missing hostname / access key → typed error)
//   - Mime allowlist enforcement (the spec allowlist is enforced
//     exactly — `image/jpeg`, `image/png`, `image/webp` only)
//   - Size cap (1 byte min, AVATAR_MAX_BYTES max — 5 MiB)
//   - User-id sandbox (UUID validation — no path traversal)
//   - Storage-path layout (`avatars/{userId}/{uuid}.{ext}`)
//   - Public vs upload URL separation
//   - expiresAt math (now + TTL, deterministic via injectable nowMs)
//   - Determinism via nowMs + fileId injection
//   - Signing-key behavior (token present when key set, absent when
//     unset — Bunny's "Token Authentication" feature is optional on
//     the pull zone)
//   - extForAvatarMime behavior
//   - Path-sandbox resistance to userIds that look like path
//     fragments

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { _resetEnvForTests } from '../env'
import {
  AVATAR_MAX_BYTES,
  AVATAR_MIME_TYPES,
  AVATAR_UPLOAD_TTL_SECONDS,
  type AvatarMime,
  UploadNotConfiguredError,
  extForAvatarMime,
  isAvatarUploadConfigured,
  requestAvatarUpload,
} from './upload'

const VALID_USER = '5c8c0c5c-9b6e-4f0e-8a4b-b6b1c2d3e4f5'

// ===========================================================================
// Env management
// ===========================================================================

const BASE_ENV = {
  // Matches the project convention — BUNNY_STORAGE_PUBLIC_HOSTNAME
  // includes the protocol (same as `getPublicCdnUrl`'s expectations
  // and signed-url.test.ts).
  BUNNY_STORAGE_PUBLIC_HOSTNAME: 'https://uthena-test.b-cdn.net',
  BUNNY_STORAGE_ACCESS_KEY: 'storage-access-key-abcdef',
  BUNNY_SIGNING_KEY: 'signing-key-1234567890',
}

function setBunnyEnv(overrides: Partial<typeof BASE_ENV> = {}) {
  for (const k of Object.keys(BASE_ENV) as (keyof typeof BASE_ENV)[]) {
    process.env[k] = overrides[k] !== undefined ? overrides[k]! : BASE_ENV[k]
  }
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
// isAvatarUploadConfigured
// ===========================================================================

describe('isAvatarUploadConfigured', () => {
  it('returns true when both env vars are set', () => {
    setBunnyEnv()
    expect(isAvatarUploadConfigured()).toBe(true)
  })
  it('returns false when BUNNY_STORAGE_PUBLIC_HOSTNAME is empty', () => {
    setBunnyEnv({ BUNNY_STORAGE_PUBLIC_HOSTNAME: '' })
    expect(isAvatarUploadConfigured()).toBe(false)
  })
  it('returns false when BUNNY_STORAGE_ACCESS_KEY is empty', () => {
    setBunnyEnv({ BUNNY_STORAGE_ACCESS_KEY: '' })
    expect(isAvatarUploadConfigured()).toBe(false)
  })
  it('returns false when both env vars are missing', () => {
    setBunnyEnv({ BUNNY_STORAGE_PUBLIC_HOSTNAME: '', BUNNY_STORAGE_ACCESS_KEY: '' })
    expect(isAvatarUploadConfigured()).toBe(false)
  })
})

// ===========================================================================
// extForAvatarMime
// ===========================================================================

describe('extForAvatarMime', () => {
  it('maps jpeg → jpg', () => {
    expect(extForAvatarMime('image/jpeg')).toBe('jpg')
  })
  it('maps png → png', () => {
    expect(extForAvatarMime('image/png')).toBe('png')
  })
  it('maps webp → webp', () => {
    expect(extForAvatarMime('image/webp')).toBe('webp')
  })
  it('returns null for unknown mimes', () => {
    expect(extForAvatarMime('image/gif')).toBeNull()
    expect(extForAvatarMime('application/pdf')).toBeNull()
    expect(extForAvatarMime('')).toBeNull()
    expect(extForAvatarMime('IMAGE/JPEG')).toBeNull()
  })
  it('rejects known attack shapes (svg, html)', () => {
    expect(extForAvatarMime('image/svg+xml')).toBeNull()
    expect(extForAvatarMime('text/html')).toBeNull()
    expect(extForAvatarMime('image/bmp')).toBeNull()
  })
})

// ===========================================================================
// requestAvatarUpload — env gating
// ===========================================================================

describe('requestAvatarUpload — env gating', () => {
  it('throws UploadNotConfiguredError when hostname missing', () => {
    setBunnyEnv({ BUNNY_STORAGE_PUBLIC_HOSTNAME: '' })
    expect(() =>
      requestAvatarUpload({ userId: VALID_USER, mime: 'image/png', size: 1024 }),
    ).toThrow(UploadNotConfiguredError)
  })
  it('throws UploadNotConfiguredError when access key missing', () => {
    setBunnyEnv({ BUNNY_STORAGE_ACCESS_KEY: '' })
    expect(() =>
      requestAvatarUpload({ userId: VALID_USER, mime: 'image/png', size: 1024 }),
    ).toThrow(UploadNotConfiguredError)
  })
  it('throws UploadNotConfiguredError when both missing', () => {
    setBunnyEnv({ BUNNY_STORAGE_PUBLIC_HOSTNAME: '', BUNNY_STORAGE_ACCESS_KEY: '' })
    expect(() =>
      requestAvatarUpload({ userId: VALID_USER, mime: 'image/png', size: 1024 }),
    ).toThrow(UploadNotConfiguredError)
  })
  it('error type is exactly UploadNotConfiguredError (not a generic Error)', () => {
    setBunnyEnv({ BUNNY_STORAGE_PUBLIC_HOSTNAME: '' })
    let captured: unknown = null
    try {
      requestAvatarUpload({ userId: VALID_USER, mime: 'image/png', size: 1024 })
    } catch (e) {
      captured = e
    }
    expect(captured).toBeInstanceOf(UploadNotConfiguredError)
    expect((captured as Error).name).toBe('UploadNotConfiguredError')
  })
})

// ===========================================================================
// requestAvatarUpload — input validation
// ===========================================================================

describe('requestAvatarUpload — input validation', () => {
  it('rejects empty userId', () => {
    expect(() =>
      requestAvatarUpload({ userId: '', mime: 'image/png', size: 1024 }),
    ).toThrow(/userId/)
  })
  it('rejects userId that is not a UUID', () => {
    expect(() =>
      requestAvatarUpload({ userId: 'not-a-uuid', mime: 'image/png', size: 1024 }),
    ).toThrow(/userId/)
    expect(() =>
      requestAvatarUpload({ userId: '12', mime: 'image/png', size: 1024 }),
    ).toThrow(/userId/)
  })
  it('rejects userId that looks like a path fragment (defense in depth)', () => {
    // Malicious userId attempting to escape the avatars namespace.
    expect(() =>
      requestAvatarUpload({
        userId: `../../../etc/passwd`,
        mime: 'image/png',
        size: 1024,
      }),
    ).toThrow(/userId/)
    expect(() =>
      requestAvatarUpload({
        userId: 'avatars/abc/x.png',
        mime: 'image/png',
        size: 1024,
      }),
    ).toThrow(/userId/)
    expect(() =>
      requestAvatarUpload({
        userId: VALID_USER + '/something',
        mime: 'image/png',
        size: 1024,
      }),
    ).toThrow(/userId/)
  })
  it('rejects size 0', () => {
    expect(() =>
      requestAvatarUpload({ userId: VALID_USER, mime: 'image/png', size: 0 }),
    ).toThrow(/size/)
  })
  it('rejects negative size', () => {
    expect(() =>
      requestAvatarUpload({ userId: VALID_USER, mime: 'image/png', size: -10 }),
    ).toThrow(/size/)
  })
  it(`rejects size > ${AVATAR_MAX_BYTES} (5MB cap)`, () => {
    expect(() =>
      requestAvatarUpload({
        userId: VALID_USER,
        mime: 'image/png',
        size: AVATAR_MAX_BYTES + 1,
      }),
    ).toThrow(/size/)
  })
  it('accepts size exactly at the cap', () => {
    expect(() =>
      requestAvatarUpload({
        userId: VALID_USER,
        mime: 'image/png',
        size: AVATAR_MAX_BYTES,
      }),
    ).not.toThrow()
  })
  it('rejects all mimes outside the allowlist (defense in depth)', () => {
    const banned = [
      'image/gif',
      'image/svg+xml',
      'image/bmp',
      'image/tiff',
      'application/pdf',
      'application/zip',
      'video/mp4',
      'text/html',
      '',
      'IMAGE/PNG',
      'image/jpg',
      'image/pjpeg',
    ]
    for (const mime of banned) {
      expect(() =>
        requestAvatarUpload({ userId: VALID_USER, mime, size: 1024 }),
      ).toThrow(/not in the allowlist/)
    }
  })
  it('accepts every mime in the allowlist', () => {
    for (const mime of AVATAR_MIME_TYPES) {
      expect(() =>
        requestAvatarUpload({ userId: VALID_USER, mime, size: 1024 }),
      ).not.toThrow()
    }
  })
})

// ===========================================================================
// requestAvatarUpload — output shape
// ===========================================================================

describe('requestAvatarUpload — output shape', () => {
  it('returns the canonical 4-tuple (uploadUrl, publicUrl, storagePath, expiresAt)', () => {
    const r = requestAvatarUpload({
      userId: VALID_USER,
      mime: 'image/png',
      size: 4096,
      fileId: 'fixed-uuid',
    })
    expect(r).toMatchObject({
      uploadUrl: expect.any(String),
      publicUrl: expect.any(String),
      storagePath: expect.any(String),
      expiresAt: expect.any(Date),
    })
  })
  it('publicUrl has NO query string (the read URL is clean)', () => {
    const r = requestAvatarUpload({
      userId: VALID_USER,
      mime: 'image/png',
      size: 4096,
      fileId: 'fixed-uuid',
    })
    expect(r.publicUrl).toBe('https://uthena-test.b-cdn.net/avatars/' + VALID_USER + '/fixed-uuid.png')
    expect(new URL(r.publicUrl).search).toBe('')
  })
  it('uploadUrl contains the storage access key as a query param', () => {
    const r = requestAvatarUpload({
      userId: VALID_USER,
      mime: 'image/webp',
      size: 4096,
      fileId: 'fixed-uuid',
    })
    const parsed = new URL(r.uploadUrl)
    expect(parsed.searchParams.get('AccessKey')).toBe('storage-access-key-abcdef')
  })
  it('uploadUrl base equals publicUrl (same path; auth added on PUT only)', () => {
    const r = requestAvatarUpload({
      userId: VALID_USER,
      mime: 'image/jpeg',
      size: 4096,
      fileId: 'fixed-uuid',
    })
    const uploadBase = r.uploadUrl.split('?')[0]
    expect(uploadBase).toBe(r.publicUrl)
  })
  it('storagePath is `avatars/{userId}/{fileId}.{ext}` and matches both URLs', () => {
    const r = requestAvatarUpload({
      userId: VALID_USER,
      mime: 'image/png',
      size: 4096,
      fileId: 'aabbccdd-1111-2222-3333-444455556666',
    })
    expect(r.storagePath).toBe(
      'avatars/' + VALID_USER + '/aabbccdd-1111-2222-3333-444455556666.png',
    )
    expect(r.publicUrl).toContain(r.storagePath)
  })
  it('extension derives from mime (jpg, png, webp)', () => {
    expect(
      requestAvatarUpload({
        userId: VALID_USER,
        mime: 'image/jpeg',
        size: 1,
        fileId: 'a',
      }).storagePath.endsWith('.jpg'),
    ).toBe(true)
    expect(
      requestAvatarUpload({
        userId: VALID_USER,
        mime: 'image/png',
        size: 1,
        fileId: 'a',
      }).storagePath.endsWith('.png'),
    ).toBe(true)
    expect(
      requestAvatarUpload({
        userId: VALID_USER,
        mime: 'image/webp',
        size: 1,
        fileId: 'a',
      }).storagePath.endsWith('.webp'),
    ).toBe(true)
  })
  it('two minting calls produce different fileIds (uuid collision resistance)', () => {
    const a = requestAvatarUpload({ userId: VALID_USER, mime: 'image/png', size: 1 })
    const b = requestAvatarUpload({ userId: VALID_USER, mime: 'image/png', size: 1 })
    expect(a.storagePath).not.toBe(b.storagePath)
  })
  it('explicit fileId override is respected verbatim', () => {
    const r = requestAvatarUpload({
      userId: VALID_USER,
      mime: 'image/png',
      size: 1,
      fileId: 'forced-id',
    })
    expect(r.storagePath).toBe(`avatars/${VALID_USER}/forced-id.png`)
  })
})

// ===========================================================================
// requestAvatarUpload — expiresAt math
// ===========================================================================

describe('requestAvatarUpload — expiresAt math', () => {
  it('expiresAt = floor(nowMs/1000) + TTL, expressed as a Date', () => {
    const nowMs = 1_700_000_000_123
    const r = requestAvatarUpload({
      userId: VALID_USER,
      mime: 'image/png',
      size: 1,
      nowMs,
    })
    const expectedSec = Math.floor(nowMs / 1000) + AVATAR_UPLOAD_TTL_SECONDS
    expect(Math.floor(r.expiresAt.getTime() / 1000)).toBe(expectedSec)
  })
  it('two minting calls in the same second produce the same expiresAt', () => {
    const a = requestAvatarUpload({
      userId: VALID_USER,
      mime: 'image/png',
      size: 1,
      nowMs: 1_700_000_000_500,
    })
    const b = requestAvatarUpload({
      userId: VALID_USER,
      mime: 'image/png',
      size: 1,
      nowMs: 1_700_000_000_999,
    })
    expect(a.expiresAt.getTime()).toBe(b.expiresAt.getTime())
  })
  it('nowMs differing by 1+ seconds produces a different expiresAt (+1s)', () => {
    const a = requestAvatarUpload({
      userId: VALID_USER,
      mime: 'image/png',
      size: 1,
      nowMs: 1_700_000_000_000,
    })
    const b = requestAvatarUpload({
      userId: VALID_USER,
      mime: 'image/png',
      size: 1,
      nowMs: 1_700_000_001_000,
    })
    expect(b.expiresAt.getTime() - a.expiresAt.getTime()).toBe(1_000)
  })
  it('expiresAt default (no nowMs) is in the future (sanity)', () => {
    const before = Math.floor(Date.now() / 1000)
    const r = requestAvatarUpload({
      userId: VALID_USER,
      mime: 'image/png',
      size: 1,
    })
    const rSec = Math.floor(r.expiresAt.getTime() / 1000)
    expect(rSec).toBeGreaterThanOrEqual(before + AVATAR_UPLOAD_TTL_SECONDS - 1)
    expect(rSec).toBeLessThanOrEqual(before + AVATAR_UPLOAD_TTL_SECONDS + 1)
  })
})

// ===========================================================================
// requestAvatarUpload — signing-key behavior
// ===========================================================================

describe('requestAvatarUpload — signing-key behavior', () => {
  it('when BUNNY_SIGNING_KEY is set, uploadUrl contains a token + expires query', () => {
    setBunnyEnv()
    const r = requestAvatarUpload({
      userId: VALID_USER,
      mime: 'image/png',
      size: 4096,
      fileId: 'fixed-uuid',
    })
    const parsed = new URL(r.uploadUrl)
    expect(parsed.searchParams.get('token')).toMatch(/^[0-9a-f]{64}$/)
    expect(parsed.searchParams.get('expires')).toBeTruthy()
    expect(Number(parsed.searchParams.get('expires'))).toBeGreaterThan(0)
  })
  it('when BUNNY_SIGNING_KEY is unset, uploadUrl has no token or expires (key-only auth)', () => {
    setBunnyEnv({ BUNNY_SIGNING_KEY: '' })
    const r = requestAvatarUpload({
      userId: VALID_USER,
      mime: 'image/png',
      size: 4096,
      fileId: 'fixed-uuid',
    })
    const parsed = new URL(r.uploadUrl)
    expect(parsed.searchParams.get('token')).toBeNull()
    expect(parsed.searchParams.get('expires')).toBeNull()
    // But AccessKey is always present
    expect(parsed.searchParams.get('AccessKey')).toBe('storage-access-key-abcdef')
  })
  it('token signature is deterministic for the same (path, expiresAt) pair', () => {
    const nowMs = 1_700_000_000_000
    const a = requestAvatarUpload({
      userId: VALID_USER,
      mime: 'image/png',
      size: 4096,
      nowMs,
      fileId: 'fixed-uuid',
    })
    const b = requestAvatarUpload({
      userId: VALID_USER,
      mime: 'image/png',
      size: 4096,
      nowMs,
      fileId: 'fixed-uuid',
    })
    const tokenA = new URL(a.uploadUrl).searchParams.get('token')
    const tokenB = new URL(b.uploadUrl).searchParams.get('token')
    expect(tokenA).toBe(tokenB)
  })
  it('changing the fileId changes the token (path-bound signature)', () => {
    const nowMs = 1_700_000_000_000
    const a = requestAvatarUpload({
      userId: VALID_USER,
      mime: 'image/png',
      size: 4096,
      nowMs,
      fileId: 'id-a',
    })
    const b = requestAvatarUpload({
      userId: VALID_USER,
      mime: 'image/png',
      size: 4096,
      nowMs,
      fileId: 'id-b',
    })
    const tokenA = new URL(a.uploadUrl).searchParams.get('token')
    const tokenB = new URL(b.uploadUrl).searchParams.get('token')
    expect(tokenA).not.toBe(tokenB)
  })
  it('changing the signing key changes the token (key-bound signature)', () => {
    const nowMs = 1_700_000_000_000
    const a = requestAvatarUpload({
      userId: VALID_USER,
      mime: 'image/png',
      size: 4096,
      nowMs,
      fileId: 'fixed-uuid',
    })
    setBunnyEnv({ BUNNY_SIGNING_KEY: 'different-signing-key' })
    const b = requestAvatarUpload({
      userId: VALID_USER,
      mime: 'image/png',
      size: 4096,
      nowMs,
      fileId: 'fixed-uuid',
    })
    const tokenA = new URL(a.uploadUrl).searchParams.get('token')
    const tokenB = new URL(b.uploadUrl).searchParams.get('token')
    expect(tokenA).not.toBe(tokenB)
  })
})

// ===========================================================================
// Constants
// ===========================================================================

describe('constants', () => {
  it('AVATAR_UPLOAD_TTL_SECONDS is exactly 5 minutes', () => {
    expect(AVATAR_UPLOAD_TTL_SECONDS).toBe(300)
  })
  it('AVATAR_MAX_BYTES is exactly 5 MiB', () => {
    expect(AVATAR_MAX_BYTES).toBe(5 * 1024 * 1024)
  })
  it('AVATAR_MIME_TYPES has exactly the spec allowlist', () => {
    expect(AVATAR_MIME_TYPES).toEqual(['image/jpeg', 'image/png', 'image/webp'])
  })
  it('AvatarMime type narrows to the constants', () => {
    const sample: AvatarMime = 'image/png'
    expect(AVATAR_MIME_TYPES).toContain(sample)
  })
})
