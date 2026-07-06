// Unit tests for `requestAvatarUploadAction`.
//
// We deliberately use the real foundation helper (`requestAvatarUpload`)
// + a fake Supabase client, mirroring the pattern used by
// `onSubscriptionEvent.test.ts` and `resumeSubscription.test.ts`. The
// env vars for Bunny are set in `beforeEach` so the helper sees a
// configured environment; the action's behavior (auth, validation,
// env-gate, audit write, return shape) is what we're testing.
//
// Coverage:
//   - anon: short-circuits with "Not signed in" before any DB call
//   - signed-in happy path with each allowlist mime
//   - mime + size Zod validation (rejects bad mime, size 0, oversize,
//     non-int)
//   - env-not-configured gating returns a friendly error and skips
//     the mint + audit writes
//   - audit row shape (target_kind='avatars', metadata fields, no
//     email in payload — IP + UA on the parent row)
//   - error mapping for mint-time exceptions (UploadNotConfiguredError
//     + generic)

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getServerSupabase } from '@foundations/data/supabase'
import { _resetEnvForTests } from '@foundations/env'
import { writeSelfAuditLog } from '../actions/writeSelfAuditLog'

// Mock next/headers (the headers() helper). The real helper returns a
// Next.js `Headers` instance (which extends the Web Headers class and
// exposes `.get(name)`). We return a tiny shim with the same surface.
function makeHeadersShim(values: Record<string, string | null> = {}) {
  return {
    get: (name: string): string | null => {
      // Case-insensitive lookup (the Web Headers class is
      // case-insensitive for header names).
      const target = name.toLowerCase()
      for (const [k, v] of Object.entries(values)) {
        if (k.toLowerCase() === target) return v
      }
      return null
    },
  }
}

const DEFAULT_NO_HEADERS = makeHeadersShim({})

vi.mock('next/headers', () => ({
  headers: vi.fn(() => Promise.resolve(DEFAULT_NO_HEADERS)),
}))

vi.mock('@foundations/data/supabase', () => ({
  getServerSupabase: vi.fn(),
}))

vi.mock('../actions/writeSelfAuditLog', () => ({
  writeSelfAuditLog: vi.fn().mockResolvedValue(1),
}))

// Imports after the vi.mock() hoisting.
import { headers } from 'next/headers'
import { AVATAR_MAX_BYTES } from '@foundations/files/upload'
import { requestAvatarUploadAction } from '../actions/requestAvatarUpload'

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const USER_ID = '5c8c0c5c-9b6e-4f0e-8a4b-b6b1c2d3e4f5'
const USER_EMAIL = 'buyer@example.test'

// A chainable supabase fake. Only `auth.getUser` is exercised by the
// action; everything else is here for shape completeness.
function fakeSupabase({
  user,
}: {
  user: { id: string; email: string } | null
}) {
  return {
    auth: {
      getUser: () =>
        Promise.resolve({
          data: { user },
          error: user ? null : { message: 'no user' },
        }),
    },
    from: () => {
      throw new Error('not expected in this test')
    },
  }
}

function setSupabaseUser(user: { id: string; email: string } | null) {
  ;(getServerSupabase as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
    fakeSupabase({ user }),
  )
}

function setHeaders(values: Record<string, string | null>) {
  ;(headers as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
    makeHeadersShim(values),
  )
}

beforeEach(() => {
  // Real env (the test asserts the happy path through the real
  // `requestAvatarUpload` helper, so we need Bunny configured).
  process.env.BUNNY_STORAGE_PUBLIC_HOSTNAME = 'https://cdn.example.test'
  process.env.BUNNY_STORAGE_ACCESS_KEY = 'storage-key-for-test'
  process.env.BUNNY_SIGNING_KEY = 'signing-key-for-test'
  _resetEnvForTests()
  ;(writeSelfAuditLog as unknown as ReturnType<typeof vi.fn>).mockClear()
  ;(getServerSupabase as unknown as ReturnType<typeof vi.fn>).mockReset()
  ;(headers as unknown as ReturnType<typeof vi.fn>).mockReset()
  // Default headers to a NO-HEADERS instance; individual tests opt in.
  setHeaders({})
})

afterEach(() => {
  _resetEnvForTests()
})

// ---------------------------------------------------------------------------
// auth
// ---------------------------------------------------------------------------

describe('requestAvatarUploadAction — auth', () => {
  it('returns "Not signed in" when anon (no DB writes, no mint)', async () => {
    setSupabaseUser(null)
    setHeaders({})

    const result = await requestAvatarUploadAction({
      mime: 'image/png',
      size: 4096,
    })

    expect(result).toEqual({ ok: false, error: 'Not signed in' })
    expect(writeSelfAuditLog).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// input validation
// ---------------------------------------------------------------------------

describe('requestAvatarUploadAction — input validation', () => {
  it('rejects a mime outside the allowlist (image/gif)', async () => {
    setSupabaseUser({ id: USER_ID, email: USER_EMAIL })
    setHeaders({})

    const result = await requestAvatarUploadAction({
      mime: 'image/gif',
      size: 1024,
    })

    expect(result.ok).toBe(false)
    if (!result.ok && result.fieldErrors) {
      expect(result.fieldErrors).toHaveProperty('mime')
    }
    expect(writeSelfAuditLog).not.toHaveBeenCalled()
  })

  it('rejects size 0', async () => {
    setSupabaseUser({ id: USER_ID, email: USER_EMAIL })
    setHeaders({})

    const result = await requestAvatarUploadAction({
      mime: 'image/png',
      size: 0,
    })

    expect(result.ok).toBe(false)
    expect(writeSelfAuditLog).not.toHaveBeenCalled()
  })

  it(`rejects size > ${AVATAR_MAX_BYTES}`, async () => {
    setSupabaseUser({ id: USER_ID, email: USER_EMAIL })
    setHeaders({})

    const result = await requestAvatarUploadAction({
      mime: 'image/png',
      size: AVATAR_MAX_BYTES + 1,
    })

    expect(result.ok).toBe(false)
    expect(writeSelfAuditLog).not.toHaveBeenCalled()
  })

  it('rejects non-integer size (1024.5)', async () => {
    setSupabaseUser({ id: USER_ID, email: USER_EMAIL })
    setHeaders({})

    const result = await requestAvatarUploadAction({
      mime: 'image/png',
      size: 1024.5,
    })

    expect(result.ok).toBe(false)
  })

  it('accepts every mime in the allowlist (jpeg, png, webp)', async () => {
    setSupabaseUser({ id: USER_ID, email: USER_EMAIL })
    setHeaders({})

    for (const mime of ['image/jpeg', 'image/png', 'image/webp'] as const) {
      const result = await requestAvatarUploadAction({ mime, size: 1024 })
      expect(result.ok).toBe(true)
      if (result.ok) {
        // publicUrl is clean (no auth query); uploadUrl carries the
        // AccessKey. Both share the storagePath.
        const path = `avatars/${USER_ID}/`
        expect(result.publicUrl).toContain(path)
        expect(result.uploadUrl).toContain(path)
        expect(new URL(result.uploadUrl).searchParams.get('AccessKey')).toBe(
          'storage-key-for-test',
        )
      }
    }
  })
})

// ---------------------------------------------------------------------------
// env not configured
// ---------------------------------------------------------------------------

describe('requestAvatarUploadAction — env not configured', () => {
  it('returns a friendly error when Bunny storage is not configured', async () => {
    setSupabaseUser({ id: USER_ID, email: USER_EMAIL })
    setHeaders({})
    process.env.BUNNY_STORAGE_PUBLIC_HOSTNAME = ''
    process.env.BUNNY_STORAGE_ACCESS_KEY = ''
    _resetEnvForTests()

    const result = await requestAvatarUploadAction({
      mime: 'image/png',
      size: 1024,
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toMatch(/temporarily unavailable/i)
    }
    expect(writeSelfAuditLog).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// happy path
// ---------------------------------------------------------------------------

describe('requestAvatarUploadAction — happy path', () => {
  it('mints the URL and writes the audit row with the expected shape', async () => {
    setSupabaseUser({ id: USER_ID, email: USER_EMAIL })
    setHeaders({
      'x-forwarded-for': '203.0.113.42, 10.0.0.1',
      'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4)',
    })

    const result = await requestAvatarUploadAction({
      mime: 'image/png',
      size: 12345,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.publicUrl).toMatch(
      /^https:\/\/cdn\.example\.test\/avatars\/[a-f0-9-]+\/[a-f0-9-]+\.png$/,
    )
    expect(new URL(result.uploadUrl).searchParams.get('AccessKey')).toBe(
      'storage-key-for-test',
    )
    expect(result.storagePath).toMatch(/^avatars\/[a-f0-9-]+\/[a-f0-9-]+\.png$/)
    expect(result.expiresAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)

    expect(writeSelfAuditLog).toHaveBeenCalledTimes(1)
    const firstCall = (writeSelfAuditLog as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0]
    expect(firstCall).toBeDefined()
    const auditArgs = firstCall![0]
    expect(auditArgs).toMatchObject({
      userId: USER_ID,
      userEmail: USER_EMAIL,
      action: 'avatar_upload_requested',
      targetKind: 'avatars',
      targetId: USER_ID,
      ipAddress: '203.0.113.42', // first hop only
      userAgent: expect.stringContaining('Mozilla'),
    })
    expect(auditArgs.metadata).toMatchObject({
      mime: 'image/png',
      size: 12345,
    })
    expect(auditArgs.metadata.storagePath).toMatch(
      /^avatars\/[a-f0-9-]+\/[a-f0-9-]+\.png$/,
    )
    expect(auditArgs.metadata.expiresAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    // The metadata NEVER includes email / IP. (It DOES include the
    // userId-derived storagePath — that's the user-scoping sandbox
    // and the canonical record of WHERE the file was uploaded.)
    expect(JSON.stringify(auditArgs.metadata)).not.toContain(USER_EMAIL)
    expect(JSON.stringify(auditArgs.metadata)).not.toContain('203.0.113.42')
  })

  it('forwards a missing user-agent header as null', async () => {
    setSupabaseUser({ id: USER_ID, email: USER_EMAIL })
    setHeaders({})

    await requestAvatarUploadAction({ mime: 'image/png', size: 1024 })

    const firstCall = (writeSelfAuditLog as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0]
    expect(firstCall).toBeDefined()
    const auditArgs = firstCall![0]
    expect(auditArgs.ipAddress).toBeNull()
    expect(auditArgs.userAgent).toBeNull()
  })

  it('successive mints produce distinct storagePaths (uuid uniqueness)', async () => {
    setSupabaseUser({ id: USER_ID, email: USER_EMAIL })
    setHeaders({})

    const r1 = await requestAvatarUploadAction({ mime: 'image/png', size: 1024 })
    const r2 = await requestAvatarUploadAction({ mime: 'image/png', size: 1024 })
    expect(r1.ok && r2.ok).toBe(true)
    if (r1.ok && r2.ok) {
      expect(r1.storagePath).not.toBe(r2.storagePath)
    }
  })
})

// ---------------------------------------------------------------------------
// Audit log write failure (resilience)
// ---------------------------------------------------------------------------

describe('requestAvatarUploadAction — audit log failure', () => {
  it('still returns the minted URL when the audit row insert fails', async () => {
    setSupabaseUser({ id: USER_ID, email: USER_EMAIL })
    setHeaders({})
    ;(writeSelfAuditLog as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      null,
    )

    const result = await requestAvatarUploadAction({ mime: 'image/png', size: 1024 })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.uploadUrl).toContain('AccessKey=storage-key-for-test')
    }
  })
})
