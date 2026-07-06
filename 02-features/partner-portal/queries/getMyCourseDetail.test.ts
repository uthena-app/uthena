// Unit tests for getMyCourseDetail. Covers the ownership gate,
// null returns, error handling, and the categories join shape.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockGetServerSupabase = vi.fn()

vi.mock('@foundations/data/supabase', () => ({
  getServerSupabase: () => mockGetServerSupabase(),
}))

const { getMyCourseDetail, getMyCourseLastEdit } = await import('./getMyCourseDetail')

function buildMock({
  user = { id: 'user-1', email: '[email protected]' } as { id: string; email: string } | null,
  partnerId = 7,
  partnerRowExists = true,
  productRow = null as Record<string, unknown> | null,
  productError = null as { message: string } | null,
  auditRow = null as Record<string, unknown> | null,
  auditError = null as { message: string } | null,
} = {}) {
  return {
    auth: {
      getUser: async () => ({ data: { user } }),
    },
    from: (table: string) => {
      if (table === 'partners') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () =>
                partnerRowExists ? { data: { id: partnerId }, error: null } : { data: null, error: null },
            }),
          }),
        }
      }
      if (table === 'products') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () =>
                productError
                  ? { data: null, error: productError }
                  : { data: productRow, error: null },
            }),
          }),
        }
      }
      if (table === 'admin_audit_log') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                eq: () => ({
                  order: () => ({
                    limit: () => ({
                      maybeSingle: async () =>
                        auditError
                          ? { data: null, error: auditError }
                          : { data: auditRow, error: null },
                    }),
                  }),
                }),
              }),
            }),
          }),
        }
      }
      throw new Error(`unexpected table ${table}`)
    },
  }
}

const fullProductRow = {
  id: 42,
  slug: 'how-to-ski',
  title: 'How to ski',
  short_description: 'A short desc',
  long_description: { type: 'doc', content: [] },
  kind: 'video_course',
  status: 'published',
  category_id: 5,
  thumbnail_url: null,
  preview_video_url: null,
  total_duration_seconds: 0,
  total_lesson_count: 0,
  partner_id: 7,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-02T00:00:00Z',
  categories: { name: 'Sports', slug: 'sports' },
}

describe('getMyCourseDetail', () => {
  beforeEach(() => {
    mockGetServerSupabase.mockReset()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('returns null when no user is signed in', async () => {
    mockGetServerSupabase.mockResolvedValue(buildMock({ user: null }))
    expect(await getMyCourseDetail(1)).toBeNull()
  })

  it('returns null when no partner row exists for the user', async () => {
    mockGetServerSupabase.mockResolvedValue(buildMock({ partnerRowExists: false }))
    expect(await getMyCourseDetail(1)).toBeNull()
  })

  it('returns null when the product row is missing', async () => {
    mockGetServerSupabase.mockResolvedValue(buildMock({ productRow: null }))
    expect(await getMyCourseDetail(1)).toBeNull()
  })

  it('returns null when DB read errors', async () => {
    mockGetServerSupabase.mockResolvedValue(buildMock({ productError: { message: 'boom' } }))
    expect(await getMyCourseDetail(1)).toBeNull()
  })

  it('returns null when the partner_id mismatches (RLS should have hidden)', async () => {
    mockGetServerSupabase.mockResolvedValue(buildMock({ productRow: { ...fullProductRow, partner_id: 999 } }))
    expect(await getMyCourseDetail(1)).toBeNull()
  })

  it('returns the mapped course detail on the happy path', async () => {
    mockGetServerSupabase.mockResolvedValue(buildMock({ productRow: fullProductRow }))
    const detail = await getMyCourseDetail(42)
    expect(detail).toEqual({
      id: 42,
      slug: 'how-to-ski',
      title: 'How to ski',
      short_description: 'A short desc',
      long_description: { type: 'doc', content: [] },
      kind: 'video_course',
      status: 'published',
      category_id: 5,
      category_name: 'Sports',
      category_slug: 'sports',
      thumbnail_url: null,
      preview_video_url: null,
      total_duration_seconds: 0,
      total_lesson_count: 0,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-02T00:00:00Z',
    })
  })
})

describe('getMyCourseLastEdit', () => {
  beforeEach(() => {
    mockGetServerSupabase.mockReset()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('returns null when there are no audit rows', async () => {
    mockGetServerSupabase.mockResolvedValue(buildMock({ auditRow: null }))
    expect(await getMyCourseLastEdit(1, 'user-1')).toBeNull()
  })

  it('returns null on audit read error', async () => {
    mockGetServerSupabase.mockResolvedValue(buildMock({ auditError: { message: 'oops' } }))
    expect(await getMyCourseLastEdit(1, 'user-1')).toBeNull()
  })

  it('returns the mapped last-edit shape on the happy path', async () => {
    mockGetServerSupabase.mockResolvedValue(
      buildMock({
        auditRow: {
          created_at: '2026-01-05T10:00:00Z',
          action: 'product_settings_self_update',
          metadata: { fields_changed: ['title', 'short_description'] },
        },
      }),
    )
    const edit = await getMyCourseLastEdit(1, 'user-1')
    expect(edit).toEqual({
      at: '2026-01-05T10:00:00Z',
      action: 'product_settings_self_update',
      fieldsChanged: ['title', 'short_description'],
    })
  })

  it('defaults fieldsChanged to [] when the metadata is missing or malformed', async () => {
    mockGetServerSupabase.mockResolvedValue(
      buildMock({
        auditRow: {
          created_at: '2026-01-05T10:00:00Z',
          action: 'product_settings_self_update',
          metadata: null,
        },
      }),
    )
    const edit = await getMyCourseLastEdit(1, 'user-1')
    expect(edit?.fieldsChanged).toEqual([])
  })
})