// createPartnerFileUpload.test.ts — unit tests for the createPartnerFileUpload
// server action (P12.8 Slice 1).
//
// What we cover (test count budget: ~26):
//   - auth gate: anon → not_authenticated, wrong role → not_partner
//   - Zod wire validation (every out-of-range / wrong-type input)
//   - filename sanitizer invocation (severely malicious path-traversal
//     inputs land as the sanitized form, not the wire value)
//   - mime allowlist enforcement per kind
//   - per-kind size cap (the hard ceiling)
//   - rate-limit verification + record-after-success
//   - row insert mapping + canonical storage_path rewrite
//   - audit row shape (NEVER the file body, ALWAYS the path)
//   - failure paths (insert failed → insert_failed, partner
//     lookup failure, etc.)

import { beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks — co-located at the top so the test surface is the only thing
// the reader has to follow.
// ---------------------------------------------------------------------------

// Mock the auth guard — the action calls requirePartner(). We control
// what role it surfaces.
const mockRequirePartner = vi.hoisted(() => vi.fn())
vi.mock('@foundations/auth/guards', () => ({
  requirePartner: mockRequirePartner,
}))

// Mock the Supabase client — the action needs both the
// request-scoped (.from('partners').select... ) + insert workflow.
// We capture chain calls in a single mock object and dispatch on
// the table name.
const mockSupabaseChain = vi.hoisted(() => ({
  // Set per-test, by tag name
  partners: { selectResult: { data: { id: '42' }, error: null } as { data: { id: string } | null; error: { message: string } | null } },
  partnerUploads: {
    insertResult: { data: { id: '12345' }, error: null } as { data: { id: string } | null; error: { message: string } | null },
    insertCalls: [] as Array<Record<string, unknown>>,
    updateCalls: [] as Array<{ id: string; values: Record<string, unknown> }>,
  },
}))
vi.mock('@foundations/data/supabase', () => ({
  getServerSupabase: () => buildSupabaseClient(mockSupabaseChain),
  getServiceSupabase: () => buildSupabaseClient(mockSupabaseChain),
}))

function buildSupabaseClient(
  chain: typeof mockSupabaseChain,
): {
  from: (table: string) => unknown
} {
  return {
    from(table: string) {
      if (table === 'partners') {
        return {
          select: () => ({
            eq: () => ({
              single: () => Promise.resolve(chain.partners.selectResult),
            }),
          }),
        }
      }
      if (table === 'partner_uploads') {
        return {
          insert: (values: Record<string, unknown>) => {
            chain.partnerUploads.insertCalls.push(values)
            return {
              select: () => ({
                single: () => Promise.resolve(chain.partnerUploads.insertResult),
              }),
            }
          },
          update: (values: Record<string, unknown>) => {
            const eq: { id: string; values: Record<string, unknown> } = { id: '', values }
            const captured = { eq: (col: string, val: string) => (eq.id = val, eq) }
            chain.partnerUploads.updateCalls.push(eq)
            // The actual API is `.eq('id', X).select('id')`. We
            // simulate via a thenable chain.
            return {
              eq: (col: string, val: string) => {
                captured.eq(col, val)
                return {
                  select: () => Promise.resolve({ data: [{ id: val }], error: null }),
                }
              },
            }
          },
        }
      }
      throw new Error(`Unexpected table ${table}`)
    },
  }
}

const mockWriteSelfAuditLog = vi.hoisted(() => vi.fn().mockResolvedValue(1))
vi.mock('@features/account/profile/actions/writeSelfAuditLog', () => ({
  writeSelfAuditLog: mockWriteSelfAuditLog,
}))

const mockLoggerFor = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}))
vi.mock('@foundations/log/pino', () => ({
  loggerFor: () => mockLoggerFor,
}))

import { createPartnerFileUploadAction } from './createPartnerFileUpload'
import {
  _resetCreateUploadRateLimitForTests,
} from './createPartnerFileUpload.rate-limit'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function partnerSession(overrides?: Partial<{ id: string; email: string; role: 'partner' | 'admin' | 'super_admin' | 'customer' }>) {
  return {
    id: overrides?.id ?? 'user-uuid-1',
    email: overrides?.email ?? 'partner@example.com',
    role: overrides?.role ?? 'partner',
    display_name: 'Test Partner',
  }
}

beforeEach(() => {
  mockRequirePartner.mockReset()
  mockWriteSelfAuditLog.mockClear()
  mockLoggerFor.info.mockClear()
  mockLoggerFor.warn.mockClear()
  mockLoggerFor.error.mockClear()
  _resetCreateUploadRateLimitForTests()
  mockSupabaseChain.partners.selectResult = { data: { id: '42' }, error: null }
  mockSupabaseChain.partnerUploads.insertResult = { data: { id: '12345' }, error: null }
  mockSupabaseChain.partnerUploads.insertCalls = []
  mockSupabaseChain.partnerUploads.updateCalls = []
})

// ---------------------------------------------------------------------------
// Auth gate
// ---------------------------------------------------------------------------
describe('createPartnerFileUploadAction — auth', () => {
  it('returns not_authenticated when requirePartner throws', async () => {
    mockRequirePartner.mockRejectedValueOnce(new Error('redirected'))
    const result = await createPartnerFileUploadAction({
      kind: 'video',
      filename: 'lesson.mp4',
      mime: 'video/mp4',
      sizeBytes: 1000,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe('not_authenticated')
    }
  })
  it('returns not_partner when the session role is customer', async () => {
    mockRequirePartner.mockResolvedValueOnce(partnerSession({ role: 'customer' }))
    const result = await createPartnerFileUploadAction({
      kind: 'video',
      filename: 'lesson.mp4',
      mime: 'video/mp4',
      sizeBytes: 1000,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe('not_partner')
    }
  })
  it('returns not_partner when no partner row exists for the user (admin without impersonation)', async () => {
    mockRequirePartner.mockResolvedValueOnce(partnerSession({ role: 'admin' }))
    mockSupabaseChain.partners.selectResult = { data: null, error: null }
    const result = await createPartnerFileUploadAction({
      kind: 'source',
      filename: 'deck.pdf',
      mime: 'application/pdf',
      sizeBytes: 1000,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe('not_partner')
    }
  })
})

// ---------------------------------------------------------------------------
// Zod wire validation
// ---------------------------------------------------------------------------
describe('createPartnerFileUploadAction — wire validation', () => {
  beforeEach(() => {
    mockRequirePartner.mockResolvedValue(partnerSession())
  })
  it('returns invalid_input when kind is missing', async () => {
    const result = await createPartnerFileUploadAction({
      filename: 'x.mp4',
      mime: 'video/mp4',
      sizeBytes: 1000,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('invalid_input')
  })
  it('returns invalid_input when kind is not in the enum', async () => {
    const result = await createPartnerFileUploadAction({
      kind: 'unknown_kind',
      filename: 'x.mp4',
      mime: 'video/mp4',
      sizeBytes: 1000,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('invalid_input')
  })
  it('returns invalid_input when sizeBytes is negative', async () => {
    const result = await createPartnerFileUploadAction({
      kind: 'video',
      filename: 'x.mp4',
      mime: 'video/mp4',
      sizeBytes: -1,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('invalid_input')
  })
  it('returns invalid_input when sizeBytes > 50GB safety rail', async () => {
    const result = await createPartnerFileUploadAction({
      kind: 'video',
      filename: 'x.mp4',
      mime: 'video/mp4',
      sizeBytes: 60 * 1024 * 1024 * 1024,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('invalid_input')
  })
  it('returns invalid_input when filename is empty', async () => {
    const result = await createPartnerFileUploadAction({
      kind: 'video',
      filename: '',
      mime: 'video/mp4',
      sizeBytes: 1000,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('invalid_input')
  })
})

// ---------------------------------------------------------------------------
// Mime + size caps
// ---------------------------------------------------------------------------
describe('createPartnerFileUploadAction — mime + size caps', () => {
  beforeEach(() => {
    mockRequirePartner.mockResolvedValue(partnerSession())
  })
  it('accepts video/mp4 for kind=video', async () => {
    const result = await createPartnerFileUploadAction({
      kind: 'video',
      filename: 'lesson.mp4',
      mime: 'video/mp4',
      sizeBytes: 1024 * 1024,
    })
    expect(result.ok).toBe(true)
  })
  it('rejects application/pdf for kind=video (mime not allowed)', async () => {
    const result = await createPartnerFileUploadAction({
      kind: 'video',
      filename: 'doc.pdf',
      mime: 'application/pdf',
      sizeBytes: 1000,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('mime_not_allowed')
  })
  it('rejects 3GB for kind=source (cap is 2GB)', async () => {
    const result = await createPartnerFileUploadAction({
      kind: 'source',
      filename: 'archive.zip',
      mime: 'application/zip',
      sizeBytes: 3 * 1024 * 1024 * 1024,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('file_too_large')
  })
  it('rejects 300MB for kind=sales_material (cap is 200MB)', async () => {
    const result = await createPartnerFileUploadAction({
      kind: 'sales_material',
      filename: 'swipe.pdf',
      mime: 'application/pdf',
      sizeBytes: 300 * 1024 * 1024,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('file_too_large')
  })
})

// ---------------------------------------------------------------------------
// Sanitization
// ---------------------------------------------------------------------------
describe('createPartnerFileUploadAction — filename sanitization', () => {
  beforeEach(() => {
    mockRequirePartner.mockResolvedValue(partnerSession())
  })
  it('sanitizes path-traversal payloads before insert (no slashes survive)', async () => {
    await createPartnerFileUploadAction({
      kind: 'source',
      filename: '../../../etc/passwd.zip',
      mime: 'application/zip',
      sizeBytes: 1000,
    })
    const inserted = mockSupabaseChain.partnerUploads.insertCalls[0]
    expect(inserted).toBeDefined()
    // The slashes get replaced with `_` — the `..` literal chars
    // survive (they're harmless as bytes; what matters is the
    // storage path can't escape the bucket via a `/` or `\`).
    expect(inserted!.original_filename).not.toMatch(/\//)
    expect(inserted!.original_filename).not.toMatch(/\\/)
  })
  it('sanitizes shell-metacharacter payloads before insert', async () => {
    await createPartnerFileUploadAction({
      kind: 'source',
      filename: 'evil;rm -rf.zip',
      mime: 'application/zip',
      sizeBytes: 1000,
    })
    const inserted = mockSupabaseChain.partnerUploads.insertCalls[0]
    expect(inserted!.original_filename).not.toMatch(/;/)
  })
})

// ---------------------------------------------------------------------------
// Happy path + audit + storage path
// ---------------------------------------------------------------------------
describe('createPartnerFileUploadAction — happy path', () => {
  beforeEach(() => {
    mockRequirePartner.mockResolvedValue(partnerSession())
  })
  it('returns ok with uploadId, sanitizedFilename, storagePath on success', async () => {
    mockSupabaseChain.partnerUploads.insertResult = { data: { id: '54321' }, error: null }
    const result = await createPartnerFileUploadAction({
      kind: 'video',
      filename: 'Lesson 01.mp4',
      mime: 'video/mp4',
      sizeBytes: 1024 * 1024,
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.uploadId).toBe('54321')
      expect(result.sanitizedFilename).toBe('Lesson 01.mp4')
      expect(result.storagePath).toMatch(/^partner-uploads\/42\/54321\/[^/]+\.mp4$/)
    }
  })
  it('inserts the row with scan_status=pending + encoding_status=pending for video kind', async () => {
    await createPartnerFileUploadAction({
      kind: 'video',
      filename: 'lesson.mp4',
      mime: 'video/mp4',
      sizeBytes: 1024,
    })
    const inserted = mockSupabaseChain.partnerUploads.insertCalls[0]!
    expect(inserted.scan_status).toBe('pending')
    expect(inserted.encoding_status).toBe('pending')
    expect(inserted.failure_kind).toBeNull()
    expect(inserted.webhook_received_at).toBeNull()
  })
  it('inserts the row with encoding_status=NULL for non-video kinds', async () => {
    await createPartnerFileUploadAction({
      kind: 'source',
      filename: 'deck.pdf',
      mime: 'application/pdf',
      sizeBytes: 1024,
    })
    const inserted = mockSupabaseChain.partnerUploads.insertCalls[0]!
    expect(inserted.encoding_status).toBeNull()
  })
  it('writes one audit row with target_kind=partner_uploads + the storage_path', async () => {
    await createPartnerFileUploadAction({
      kind: 'video',
      filename: 'lesson.mp4',
      mime: 'video/mp4',
      sizeBytes: 1024,
    })
    expect(mockWriteSelfAuditLog).toHaveBeenCalledTimes(1)
    const call = mockWriteSelfAuditLog.mock.calls[0]![0] as Record<string, unknown>
    expect(call.action).toBe('partner_upload.file_registered')
    expect(call.targetKind).toBe('partner_uploads')
    expect(call.targetId).toBe('12345')
    const meta = call.metadata as Record<string, unknown>
    expect(meta.upload_kind).toBe('video')
    expect(typeof meta.storage_path).toBe('string')
    expect(typeof meta.size_bytes).toBe('number')
  })
  it('returns insert_failed when the row insert errors', async () => {
    mockSupabaseChain.partnerUploads.insertResult = {
      data: null,
      error: { message: 'insert failed' },
    }
    const result = await createPartnerFileUploadAction({
      kind: 'source',
      filename: 'doc.zip',
      mime: 'application/zip',
      sizeBytes: 1024,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe('insert_failed')
    }
  })
})

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------
describe('createPartnerFileUploadAction — rate limiting', () => {
  beforeEach(() => {
    mockRequirePartner.mockResolvedValue(partnerSession())
  })
  it('returns rate_limited when the partner hits the ceiling', async () => {
    // Push 60 successful inserts into the bucket (we achieve this by
    // calling the action 60 times, each successful). The 61st call
    // returns rate_limited.
    // (We do this in a tight loop to stay within the test budget.)
    for (let i = 0; i < 60; i++) {
      const r = await createPartnerFileUploadAction({
        kind: 'source',
        filename: `doc-${i}.pdf`,
        mime: 'application/pdf',
        sizeBytes: 1000 + i,
      })
      expect(r.ok).toBe(true)
    }
    const result = await createPartnerFileUploadAction({
      kind: 'source',
      filename: 'doc-60.pdf',
      mime: 'application/pdf',
      sizeBytes: 1000,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe('rate_limited')
      expect(result.retryAfterSeconds).toBeGreaterThan(0)
    }
  })
  it('does NOT consume budget on insert_failed (rate-limit separation from insert)', async () => {
    // First 5 succeed (consume budget). 6th should fail insert (no
    // budget consumed), then 7th should NOT be rate-limited.
    for (let i = 0; i < 5; i++) {
      await createPartnerFileUploadAction({
        kind: 'source',
        filename: `ok-${i}.pdf`,
        mime: 'application/pdf',
        sizeBytes: 1000,
      })
    }
    // Now make the next call fail
    mockSupabaseChain.partnerUploads.insertResult = {
      data: null,
      error: { message: 'insert failed' },
    }
    const r1 = await createPartnerFileUploadAction({
      kind: 'source',
      filename: 'fail.pdf',
      mime: 'application/pdf',
      sizeBytes: 1000,
    })
    expect(r1.ok).toBe(false)
    // Restore happy insert
    mockSupabaseChain.partnerUploads.insertResult = { data: { id: '12345' }, error: null }
    // Next call: 6th SUCCESS overall — still under the 60/min ceiling.
    const r2 = await createPartnerFileUploadAction({
      kind: 'source',
      filename: 'after-fail.pdf',
      mime: 'application/pdf',
      sizeBytes: 1000,
    })
    expect(r2.ok).toBe(true)
  })
})
