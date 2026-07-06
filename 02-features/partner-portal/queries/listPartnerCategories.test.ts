// Unit tests for listPartnerCategories. Covers the happy path,
// empty result, and DB-error fallback.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockGetServerSupabase = vi.fn()

vi.mock('@foundations/data/supabase', () => ({
  getServerSupabase: () => mockGetServerSupabase(),
}))

const { listPartnerCategories } = await import('./listPartnerCategories')

function buildMock({
  data = [] as Array<Record<string, unknown>>,
  error = null as { message: string } | null,
}) {
  return {
    from: () => ({
      select: () => ({
        order: () => ({
          order: async () => (error ? { data: null, error } : { data, error: null }),
        }),
      }),
    }),
  }
}

describe('listPartnerCategories', () => {
  beforeEach(() => {
    mockGetServerSupabase.mockReset()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('returns the categories list on the happy path', async () => {
    mockGetServerSupabase.mockResolvedValue(
      buildMock({
        data: [
          { id: 1, name: 'AI', slug: 'ai', display_order: 1 },
          { id: 2, name: 'Business', slug: 'business', display_order: 2 },
        ],
      }),
    )
    const result = await listPartnerCategories()
    expect(result).toHaveLength(2)
    expect(result[0]).toEqual({ id: 1, name: 'AI', slug: 'ai', display_order: 1 })
  })

  it('returns an empty array when the table is empty', async () => {
    mockGetServerSupabase.mockResolvedValue(buildMock({ data: [] }))
    expect(await listPartnerCategories()).toEqual([])
  })

  it('returns an empty array when the DB errors', async () => {
    mockGetServerSupabase.mockResolvedValue(buildMock({ error: { message: 'boom' } }))
    expect(await listPartnerCategories()).toEqual([])
  })
})