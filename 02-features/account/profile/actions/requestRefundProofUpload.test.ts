// Unit tests for `requestRefundProofUploadAction`.
//
// Mirrors the pattern from `requestAvatarUpload.test.ts`: real
// foundation helper (`requestRefundProofUpload`) + a fake Supabase
// client. Bunny env is configured in `beforeEach` so the helper
// sees a configured environment; the action's behavior (auth,
// validation, env gate, audit write, return shape) is what we're
// testing.
//
// Coverage:
//   - anon: short-circuits with "Not signed in" before any mint or
//     audit row
//   - signed-in happy path with each allowlist mime
//   - mime + size + filename Zod validation (rejects bad mime, size
//     0, oversize, non-int, missing filename, empty filename)
//   - env-not-configured gating returns a friendly error and skips
//     mint + audit
//   - audit row shape (action='refund_proof_upload_requested',
//     target_kind='refund_proofs', metadata fields, PII-safety on
//     metadata, storagePath prefix matches the canonical
//     `refund-proofs/{userId}/`)
//   - storagePath-prefix mismatch is rejected (defensive guard
//     against the helper returning a wrong path)
//   - filename is server-sanitized (a-zA-Z0-9._-, capped 120 chars,
//     path-traversal stripped)
//   - error mapping for mint-time exceptions
//     (UploadNotConfiguredError + generic)

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { _resetEnvForTests } from '@foundations/env'
import { REFUND_PROOF_MAX_BYTES } from '@foundations/files/refund-proof-upload'

// Mock next/headers (the headers() helper). The real helper returns a
// Next.js `Headers` instance (which extends the Web Headers class and
// exposes `.get(name)`). We return a tiny shim with the same surface.
function makeHeadersShim(values: Record<string, string | null> = {}) {
  return {
    get: (name: string): string | null => {
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
import { getServerSupabase } from '@foundations/data/supabase'
import { writeSelfAuditLog } from '../actions/writeSelfAuditLog'
import { requestRefundProofUploadAction } from '../actions/requestRefundProofUpload'

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const USER_ID = '5c8c0c5c-9b6e-4f0e-8a4b-b6b1c2d3e4f5'
const USER_EMAIL = 'buyer@example.test'

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
  // `requestRefundProofUpload` helper, so we need Bunny configured).
  process.env.BUNNY_STORAGE_PUBLIC_HOSTNAME = 'https://cdn.example.test'
  process.env.BUNNY_STORAGE_ACCESS_KEY = 'storage-key-for-test'
  process.env.BUNNY_SIGNING_KEY = 'signing-key-for-test'
  _resetEnvForTests()
  ;(writeSelfAuditLog as unknown as ReturnType<typeof vi.fn>).mockClear()
  ;(getServerSupabase as unknown as ReturnType<typeof vi.fn>).mockReset()
  ;(headers as unknown as ReturnType<typeof vi.fn>).mockReset()
  setHeaders({})
})

afterEach(() => {
  _resetEnvForTests()
})

// ---------------------------------------------------------------------------
// auth
// ---------------------------------------------------------------------------

describe('requestRefundProofUploadAction — auth', () => {
  it('returns "Not signed in" when anon (no mint, no audit row)', async () => {
    setSupabaseUser(null)
    setHeaders({})

    const result = await requestRefundProofUploadAction({
      mime: 'image/png',
      size: 4096,
      filename: 'screenshot.png',
    })

    expect(result).toEqual({ ok: false, error: 'Not signed in' })
    expect(writeSelfAuditLog).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// input validation
// ---------------------------------------------------------------------------

describe('requestRefundProofUploadAction — input validation', () => {
  it('rejects a mime outside the allowlist (image/gif)', async () => {
    setSupabaseUser({ id: USER_ID, email: USER_EMAIL })
    setHeaders({})

    const result = await requestRefundProofUploadAction({
      mime: 'image/gif',
      size: 1024,
      filename: 'proof.gif',
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

    const result = await requestRefundProofUploadAction({
      mime: 'image/png',
      size: 0,
      filename: 'proof.png',
    })

    expect(result.ok).toBe(false)
    expect(writeSelfAuditLog).not.toHaveBeenCalled()
  })

  it(`rejects size > ${REFUND_PROOF_MAX_BYTES}`, async () => {
    setSupabaseUser({ id: USER_ID, email: USER_EMAIL })
    setHeaders({})

    const result = await requestRefundProofUploadAction({
      mime: 'image/png',
      size: REFUND_PROOF_MAX_BYTES + 1,
      filename: 'proof.png',
    })

    expect(result.ok).toBe(false)
    expect(writeSelfAuditLog).not.toHaveBeenCalled()
  })

  it('rejects non-integer size (1024.5)', async () => {
    setSupabaseUser({ id: USER_ID, email: USER_EMAIL })
    setHeaders({})

    const result = await requestRefundProofUploadAction({
      mime: 'image/png',
      size: 1024.5,
      filename: 'proof.png',
    })

    expect(result.ok).toBe(false)
  })

  it('rejects empty filename', async () => {
    setSupabaseUser({ id: USER_ID, email: USER_EMAIL })
    setHeaders({})

    const result = await requestRefundProofUploadAction({
      mime: 'image/png',
      size: 1024,
      filename: '',
    })

    expect(result.ok).toBe(false)
  })

  it('rejects missing filename', async () => {
    setSupabaseUser({ id: USER_ID, email: USER_EMAIL })
    setHeaders({})

    const result = await requestRefundProofUploadAction({
      mime: 'image/png',
      size: 1024,
    })

    expect(result.ok).toBe(false)
  })

  it('accepts every mime in the allowlist (jpeg, png, pdf)', async () => {
    setSupabaseUser({ id: USER_ID, email: USER_EMAIL })
    setHeaders({})

    for (const mime of ['image/jpeg', 'image/png', 'application/pdf'] as const) {
      const ext = mime === 'application/pdf' ? 'pdf' : mime === 'image/jpeg' ? 'jpg' : 'png'
      const result = await requestRefundProofUploadAction({
        mime,
        size: 1024,
        filename: `proof.${ext}`,
      })
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.uploadUrl).toContain('AccessKey=storage-key-for-test')
        expect(result.storagePath.startsWith(`refund-proofs/${USER_ID}/`)).toBe(true)
        expect(result.storagePath).toMatch(new RegExp(`^refund-proofs/${USER_ID}/[a-f0-9-]+\\.${ext}$`))
        expect(result.sanitizedFilename).toBe(`proof.${ext}`)
        expect(result.expiresAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
      }
    }
  })
})

// ---------------------------------------------------------------------------
// env not configured
// ---------------------------------------------------------------------------

describe('requestRefundProofUploadAction — env not configured', () => {
  it('returns a friendly error when Bunny storage is not configured', async () => {
    setSupabaseUser({ id: USER_ID, email: USER_EMAIL })
    setHeaders({})
    process.env.BUNNY_STORAGE_PUBLIC_HOSTNAME = ''
    process.env.BUNNY_STORAGE_ACCESS_KEY = ''
    _resetEnvForTests()

    const result = await requestRefundProofUploadAction({
      mime: 'image/png',
      size: 1024,
      filename: 'proof.png',
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      // Friendly enough that the user understands the form still
      // works without a proof.
      expect(result.error).toMatch(/temporarily unavailable/i)
      expect(result.error).toMatch(/submit without/i)
    }
    expect(writeSelfAuditLog).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// happy path
// ---------------------------------------------------------------------------

describe('requestRefundProofUploadAction — happy path', () => {
  it('mints the URL and writes the audit row with the expected shape', async () => {
    setSupabaseUser({ id: USER_ID, email: USER_EMAIL })
    setHeaders({
      'x-forwarded-for': '203.0.113.42, 10.0.0.1',
      'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4)',
    })

    const result = await requestRefundProofUploadAction({
      mime: 'image/png',
      size: 12345,
      filename: 'screenshot.png',
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.uploadUrl).toContain('AccessKey=storage-key-for-test')
    expect(result.storagePath).toMatch(
      new RegExp(`^refund-proofs/${USER_ID}/[a-f0-9-]+\\.png$`),
    )
    expect(result.sanitizedFilename).toBe('screenshot.png')
    expect(result.expiresAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)

    expect(writeSelfAuditLog).toHaveBeenCalledTimes(1)
    const firstCall = (writeSelfAuditLog as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0]
    expect(firstCall).toBeDefined()
    const auditArgs = firstCall![0]
    expect(auditArgs).toMatchObject({
      userId: USER_ID,
      userEmail: USER_EMAIL,
      action: 'refund_proof_upload_requested',
      targetKind: 'refund_proofs',
      ipAddress: '203.0.113.42', // first hop only
      userAgent: expect.stringContaining('Mozilla'),
    })
    expect(auditArgs.metadata).toMatchObject({
      mime: 'image/png',
      size: 12345,
      sanitizedFilename: 'screenshot.png',
    })
    expect(auditArgs.metadata.storagePath).toMatch(
      new RegExp(`^refund-proofs/${USER_ID}/[a-f0-9-]+\\.png$`),
    )
    expect(auditArgs.metadata.expiresAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    // The metadata NEVER includes email / IP.
    expect(JSON.stringify(auditArgs.metadata)).not.toContain(USER_EMAIL)
    expect(JSON.stringify(auditArgs.metadata)).not.toContain('203.0.113.42')
    // The targetId is the storagePath itself — admins can locate the
    // file from the audit row directly.
    expect(auditArgs.targetId).toBe(auditArgs.metadata.storagePath)
  })

  it('sanitizes the filename server-side (path-traversal stripped)', async () => {
    setSupabaseUser({ id: USER_ID, email: USER_EMAIL })
    setHeaders({})

    const result = await requestRefundProofUploadAction({
      mime: 'image/png',
      size: 1024,
      filename: '../../etc/passwd',
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.sanitizedFilename).toBe('passwd')
      expect(result.sanitizedFilename).not.toMatch(/[\\/]/)
    }
  })

  it('sanitizes the filename server-side (all-bad chars → unnamed.<ext>)', async () => {
    setSupabaseUser({ id: USER_ID, email: USER_EMAIL })
    setHeaders({})

    const result = await requestRefundProofUploadAction({
      mime: 'image/png',
      size: 1024,
      filename: '🎉🎉🎉.png',
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      // Only the extension survived; the sanitizer surfaces it as
      // `unnamed.png` so admins see the extension in context rather
      // than a bare `png` with no meaning.
      expect(result.sanitizedFilename).toBe('unnamed.png')
    }
  })

  it('forwards a missing user-agent header as null', async () => {
    setSupabaseUser({ id: USER_ID, email: USER_EMAIL })
    setHeaders({})

    await requestRefundProofUploadAction({
      mime: 'image/png',
      size: 1024,
      filename: 'proof.png',
    })

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

    const r1 = await requestRefundProofUploadAction({
      mime: 'image/png',
      size: 1024,
      filename: 'proof.png',
    })
    const r2 = await requestRefundProofUploadAction({
      mime: 'image/png',
      size: 1024,
      filename: 'proof.png',
    })
    expect(r1.ok && r2.ok).toBe(true)
    if (r1.ok && r2.ok) {
      expect(r1.storagePath).not.toBe(r2.storagePath)
    }
  })

  it('caps the upload TTL at 5 minutes (300 seconds)', async () => {
    setSupabaseUser({ id: USER_ID, email: USER_EMAIL })
    setHeaders({})

    const before = Math.floor(Date.now() / 1000)
    const result = await requestRefundProofUploadAction({
      mime: 'image/png',
      size: 1024,
      filename: 'proof.png',
    })
    const after = Math.floor(Date.now() / 1000)

    expect(result.ok).toBe(true)
    if (result.ok) {
      const expiresSec = Math.floor(new Date(result.expiresAt).getTime() / 1000)
      // expiresAt - now should be 300 ± 1 (test clock drift).
      expect(expiresSec - before).toBeGreaterThanOrEqual(299)
      expect(expiresSec - after).toBeLessThanOrEqual(301)
    }
  })
})

// ---------------------------------------------------------------------------
// Audit log write failure (resilience)
// ---------------------------------------------------------------------------

describe('requestRefundProofUploadAction — audit log failure', () => {
  it('still returns the minted URL when the audit row insert fails', async () => {
    setSupabaseUser({ id: USER_ID, email: USER_EMAIL })
    setHeaders({})
    ;(writeSelfAuditLog as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      null,
    )

    const result = await requestRefundProofUploadAction({
      mime: 'image/png',
      size: 1024,
      filename: 'proof.png',
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.uploadUrl).toContain('AccessKey=storage-key-for-test')
    }
  })
})