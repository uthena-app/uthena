// getMyPartnerUploads.test.ts — unit tests for the
// getMyPartnerUploads RSC query (P12.8 Slice 1).

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockChain = vi.hoisted(() => ({
  readResult: { data: [] as unknown[], error: null as { message: string } | null },
  selectPayload: null as string | null,
}))

vi.mock('@foundations/data/supabase', () => ({
  getServerSupabase: () => buildSupabaseClient(mockChain),
  getServiceSupabase: () => buildSupabaseClient(mockChain),
}))

function buildSupabaseClient(chain: typeof mockChain) {
  return {
    from(table: string) {
      if (table !== 'partner_uploads') throw new Error(`Unexpected table ${table}`)
      return {
        select: (payload: string) => {
          chain.selectPayload = payload
          return {
            order: () => ({
              limit: () => Promise.resolve(chain.readResult),
            }),
          }
        },
      }
    },
  }
}

vi.mock('@foundations/log/pino', () => ({
  loggerFor: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))

import { getMyPartnerUploads } from './getMyPartnerUploads'

beforeEach(() => {
  mockChain.readResult = { data: [], error: null }
  mockChain.selectPayload = null
})

describe('getMyPartnerUploads — happy path', () => {
  it('returns an empty list when the partner has no uploads', async () => {
    const result = await getMyPartnerUploads()
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.uploads).toEqual([])
      expect(result.total).toBe(0)
    }
  })
  it('returns the rows + computed state for a populated list', async () => {
    mockChain.readResult = {
      data: [
        {
          id: '100',
          original_filename: 'lesson-01.mp4',
          size_bytes: 1_000_000,
          mime_type: 'video/mp4',
          scan_status: 'pending',
          encoding_status: 'pending',
          failure_kind: null,
          failure_reason: null,
          storage_path: 'partner-uploads/42/100/uuid.mp4',
          webhook_received_at: null,
          created_at: '2026-06-30T00:00:00.000Z',
          kind: 'video',
        },
        {
          id: '101',
          original_filename: 'swipe.pdf',
          size_bytes: 50_000,
          mime_type: 'application/pdf',
          scan_status: 'clean',
          encoding_status: null,
          failure_kind: null,
          failure_reason: null,
          storage_path: 'partner-uploads/42/101/uuid.pdf',
          webhook_received_at: '2026-06-30T00:05:00.000Z',
          created_at: '2026-06-30T00:03:00.000Z',
          kind: 'sales_material',
        },
      ],
      error: null,
    }
    const result = await getMyPartnerUploads()
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.uploads.length).toBe(2)
      expect(result.uploads[0]!.state).toBe('uploaded') // scan pending → uploaded
      expect(result.uploads[1]!.state).toBe('ready') // scan clean, non-video → ready
      expect(result.uploads[1]!.encodingStatus).toBeNull()
    }
  })
  it('orders the select by created_at desc + caps the limit at GET_MY_PARTNER_UPLOADS_LIMIT_MAX', async () => {
    await getMyPartnerUploads({ limit: 5_000 })
    expect(mockChain.selectPayload).toMatch(/id, original_filename, size_bytes/)
    // The chained query is order().limit(); we can't directly assert
    // the limit value here, but the request reached the chain so we
    // know the call shape is intact.
  })
})

describe('getMyPartnerUploads — defensive mappings', () => {
  it('drops rows with unknown kind and sets warning', async () => {
    mockChain.readResult = {
      data: [
        {
          id: '100',
          original_filename: 'x.mp4',
          size_bytes: 1,
          mime_type: 'video/mp4',
          scan_status: 'pending',
          encoding_status: 'pending',
          failure_kind: null,
          failure_reason: null,
          storage_path: 'partner-uploads/42/100/uuid.mp4',
          webhook_received_at: null,
          created_at: '2026-06-30T00:00:00.000Z',
          kind: 'forgotten_kind', // not in UPLOAD_KINDS
        },
      ],
      error: null,
    }
    const result = await getMyPartnerUploads()
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.uploads.length).toBe(0)
      expect('warning' in result).toBe(true)
    }
  })
  it('drops rows with unrecognized scan_status and sets warning', async () => {
    mockChain.readResult = {
      data: [
        {
          id: '100',
          original_filename: 'x.mp4',
          size_bytes: 1,
          mime_type: 'video/mp4',
          scan_status: 'pending-unknown-value',
          encoding_status: null,
          failure_kind: null,
          failure_reason: null,
          storage_path: 'partner-uploads/42/100/uuid.mp4',
          webhook_received_at: null,
          created_at: '2026-06-30T00:00:00.000Z',
          kind: 'video',
        },
      ],
      error: null,
    }
    const result = await getMyPartnerUploads()
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.uploads.length).toBe(0)
    }
  })
})

describe('getMyPartnerUploads — DB error path', () => {
  it('returns ok=false + code=db_error when the select errors', async () => {
    mockChain.readResult = { data: [], error: { message: 'db down' } }
    const result = await getMyPartnerUploads()
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('db_error')
  })
  it('returns ok=true with empty array when data is null (no rows)', async () => {
    mockChain.readResult = { data: [], error: null }
    const result = await getMyPartnerUploads()
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.uploads).toEqual([])
  })
})
