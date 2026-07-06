// Unit tests for updateProductSettingsAction. Covers Zod validation,
// ownership enforcement (via RLS-shaped "0 rows updated" path),
// category existence check, audit-log trigger, and the
// buildLongDescriptionDoc helper behavior.
//
// We mock `getServerSupabase` + `writeSelfAuditLog` + `revalidatePath`
// so the tests run as pure logic (no DB, no Next cache writes).
// Mocks are reset between tests.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockGetServerSupabase = vi.fn()
const mockWriteSelfAuditLog = vi.fn()
const mockRevalidatePath = vi.fn()

vi.mock('@foundations/data/supabase', () => ({
  getServerSupabase: () => mockGetServerSupabase(),
}))
vi.mock('@features/account/profile/actions/writeSelfAuditLog', () => ({
  writeSelfAuditLog: (input: unknown) => mockWriteSelfAuditLog(input),
}))
vi.mock('next/cache', () => ({
  revalidatePath: (p: string) => mockRevalidatePath(p),
}))

// Re-import after mocks so the action module picks up the mocked deps.
const { updateProductSettingsAction } = await import(
  './updateProductSettings'
)

type SupabaseShape = {
  auth: { getUser: () => Promise<{ data: { user: { id: string; email: string } | null } }> }
  from: (table: string) => Record<string, unknown>
}

function buildSupabaseMock({
  user = { id: 'user-1', email: '[email protected]' },
  productExists = true,
  categoryExists = true,
  updateError = null as { message: string } | null,
  updateRows = [{ id: 1 }],
}: {
  user?: { id: string; email: string } | null
  productExists?: boolean
  categoryExists?: boolean
  updateError?: { message: string } | null
  updateRows?: unknown[]
} = {}): SupabaseShape {
  const updateChain: Record<string, unknown> = {
    eq: vi.fn(() => ({
      select: vi.fn(() => Promise.resolve({ data: updateRows, error: updateError })),
    })),
  }
  return {
    auth: {
      getUser: async () => ({ data: { user } }),
    },
    from: (table: string) => {
      if (table === 'products') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi
                .fn()
                .mockResolvedValueOnce(
                  productExists
                    ? {
                        data: {
                          id: 1,
                          title: 'Old title',
                          short_description: 'Old short',
                          long_description: { type: 'doc', content: [] },
                          kind: 'video_course',
                          category_id: 5,
                        },
                        error: null,
                      }
                    : { data: null, error: null }
              ),
            })),
          })),
          update: vi.fn(() => updateChain),
        }
      }
      if (table === 'categories') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn().mockResolvedValueOnce(
                categoryExists
                  ? { data: { id: 5 }, error: null }
                  : { data: null, error: null }
              ),
            })),
          })),
        }
      }
      throw new Error(`unexpected table ${table}`)
    },
  }
}

const validInput = {
  productId: 1,
  title: 'New title',
  shortDescription: 'New short',
  longDescription: 'Paragraph one.\n\nParagraph two.',
  categoryId: 5,
  kind: 'video_course' as const,
}

describe('updateProductSettingsAction', () => {
  beforeEach(() => {
    mockGetServerSupabase.mockReset()
    mockWriteSelfAuditLog.mockReset()
    mockRevalidatePath.mockReset()
    mockWriteSelfAuditLog.mockResolvedValue(42)
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('rejects when not signed in', async () => {
    mockGetServerSupabase.mockResolvedValue(buildSupabaseMock({ user: null }))
    const result = await updateProductSettingsAction(validInput)
    expect(result).toEqual({ ok: false, error: 'Not signed in.' })
  })

  it('rejects when Zod validation fails (empty title)', async () => {
    mockGetServerSupabase.mockResolvedValue(buildSupabaseMock())
    const result = await updateProductSettingsAction({ ...validInput, title: '' })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toMatch(/fix the errors/i)
      expect(result.fieldErrors?.title).toBeTruthy()
    }
  })

  it('rejects when Zod validation fails (title too long)', async () => {
    mockGetServerSupabase.mockResolvedValue(buildSupabaseMock())
    const result = await updateProductSettingsAction({
      ...validInput,
      title: 'x'.repeat(201),
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.fieldErrors?.title).toMatch(/200/)
    }
  })

  it('rejects when short_description is too long', async () => {
    mockGetServerSupabase.mockResolvedValue(buildSupabaseMock())
    const result = await updateProductSettingsAction({
      ...validInput,
      shortDescription: 'x'.repeat(281),
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.fieldErrors?.shortDescription).toMatch(/280/)
    }
  })

  it('rejects when kind is not a valid enum value', async () => {
    mockGetServerSupabase.mockResolvedValue(buildSupabaseMock())
    const result = await updateProductSettingsAction({
      ...validInput,
      kind: 'not_a_kind',
    })
    expect(result.ok).toBe(false)
  })

  it('returns "Course not found." when the product does not exist', async () => {
    mockGetServerSupabase.mockResolvedValue(buildSupabaseMock({ productExists: false }))
    const result = await updateProductSettingsAction(validInput)
    expect(result).toEqual({ ok: false, error: 'Course not found.' })
  })

  it('returns field error when category no longer exists', async () => {
    mockGetServerSupabase.mockResolvedValue(buildSupabaseMock({ categoryExists: false }))
    const result = await updateProductSettingsAction(validInput)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.fieldErrors?.categoryId).toMatch(/no longer exists/)
    }
  })

  it('returns "Course not found." when update returns 0 rows (RLS-blocked)', async () => {
    mockGetServerSupabase.mockResolvedValue(buildSupabaseMock({ updateRows: [] }))
    const result = await updateProductSettingsAction(validInput)
    expect(result).toEqual({ ok: false, error: 'Course not found.' })
  })

  it('returns generic error when update errors at the DB layer', async () => {
    mockGetServerSupabase.mockResolvedValue(
      buildSupabaseMock({ updateError: { message: 'connection reset' } }),
    )
    const result = await updateProductSettingsAction(validInput)
    expect(result).toEqual({ ok: false, error: 'Could not save. Please try again.' })
  })

  it('saves successfully on the happy path and writes one audit row', async () => {
    mockGetServerSupabase.mockResolvedValue(buildSupabaseMock())
    const result = await updateProductSettingsAction(validInput)
    expect(result).toEqual({ ok: true })

    expect(mockWriteSelfAuditLog).toHaveBeenCalledTimes(1)
    const auditArg = mockWriteSelfAuditLog.mock.calls[0]![0] as {
      action: string
      targetKind: string
      targetId: string
      metadata: { fields_changed: string[]; diff: Record<string, unknown> }
    }
    expect(auditArg.action).toBe('product_settings_self_update')
    expect(auditArg.targetKind).toBe('products')
    expect(auditArg.targetId).toBe('1')
    expect(auditArg.metadata.fields_changed).toEqual(
      expect.arrayContaining(['title', 'short_description', 'long_description']),
    )
    expect(auditArg.metadata.diff.title).toEqual({
      before: 'Old title',
      after: 'New title',
    })
    expect(auditArg.metadata.diff.short_description).toEqual({
      before: 'Old short',
      after: 'New short',
    })

    expect(mockRevalidatePath).toHaveBeenCalledWith('/partner/courses/1')
  })

  it('does NOT write an audit row when no fields changed', async () => {
    // Snapshot mirrors the input exactly so no diff → no audit row.
    // We build a tailored mock with matching title / short_description /
    // long_description / kind / category_id so the action's diff
    // detector produces an empty diff.
    const noChangeMock = buildSupabaseMock({ productExists: true })
    const originalFrom = noChangeMock.from as (t: string) => Record<string, unknown>
    noChangeMock.from = (table: string) => {
      if (table !== 'products') return originalFrom(table)
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: {
                id: 1,
                title: 'New title',
                short_description: 'New short',
                long_description: {
                  type: 'doc',
                  content: [
                    {
                      type: 'paragraph',
                      content: [{ type: 'text', text: 'Paragraph one.' }],
                    },
                    {
                      type: 'paragraph',
                      content: [{ type: 'text', text: 'Paragraph two.' }],
                    },
                  ],
                },
                kind: 'video_course',
                category_id: 5,
              },
              error: null,
            }),
          }),
        }),
        update: vi.fn(() => ({
          eq: vi.fn(() => ({
            select: vi.fn(() => Promise.resolve({ data: [{ id: 1 }], error: null })),
          })),
        })),
      }
    }
    mockGetServerSupabase.mockResolvedValue(noChangeMock)
    const result = await updateProductSettingsAction(validInput)
    expect(result).toEqual({ ok: true })
    expect(mockWriteSelfAuditLog).not.toHaveBeenCalled()
  })

  it('audit write failure does NOT abort the save', async () => {
    mockWriteSelfAuditLog.mockRejectedValue(new Error('audit down'))
    mockGetServerSupabase.mockResolvedValue(buildSupabaseMock())
    const result = await updateProductSettingsAction(validInput)
    expect(result).toEqual({ ok: true })
  })

  it('buildLongDescriptionDoc splits paragraphs on blank lines and emits a doc shape', async () => {
    // Reach the helper via the happy-path mock: the action builds the
    // doc and writes it via .update(...). Inspect the call args.
    let capturedUpdate: Record<string, unknown> | null = null
    mockGetServerSupabase.mockImplementation(() => {
      const update = vi.fn((arg: Record<string, unknown>) => {
        capturedUpdate = arg
        return {
          eq: () => ({
            select: () => Promise.resolve({ data: [{ id: 1 }], error: null }),
          }),
        }
      })
      return {
        auth: {
          getUser: async () => ({ data: { user: { id: 'user-1', email: '[email protected]' } } }),
        },
        from: (table: string) => {
          if (table === 'products') {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: async () => ({
                    data: {
                      id: 1,
                      title: 'Old title',
                      short_description: 'Old short',
                      long_description: { type: 'doc', content: [] },
                      kind: 'video_course',
                      category_id: 5,
                    },
                    error: null,
                  }),
                }),
              }),
              update,
            }
          }
          if (table === 'categories') {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: async () => ({ data: { id: 5 }, error: null }),
                }),
              }),
            }
          }
          throw new Error(`unexpected table ${table}`)
        },
      }
    })

    const result = await updateProductSettingsAction(validInput)
    expect(result).toEqual({ ok: true })
    expect(capturedUpdate).not.toBeNull()
    const doc = (capturedUpdate as unknown as { long_description: { type: string; content: unknown[] } })
      .long_description
    expect(doc.type).toBe('doc')
    expect(Array.isArray(doc.content)).toBe(true)
    expect((doc.content as unknown[]).length).toBe(2)
  })

  it('buildLongDescriptionDoc emits an empty doc when longDescription is blank', async () => {
    let capturedUpdate: Record<string, unknown> | null = null
    mockGetServerSupabase.mockImplementation(() => {
      const update = vi.fn((arg: Record<string, unknown>) => {
        capturedUpdate = arg
        return {
          eq: () => ({
            select: () => Promise.resolve({ data: [{ id: 1 }], error: null }),
          }),
        }
      }
      )
      return {
        auth: {
          getUser: async () => ({ data: { user: { id: 'user-1', email: '[email protected]' } } }),
        },
        from: (table: string) => {
          if (table === 'products') {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: async () => ({
                    data: {
                      id: 1,
                      title: 'Old title',
                      short_description: 'Old short',
                      long_description: { type: 'doc', content: [] },
                      kind: 'video_course',
                      category_id: 5,
                    },
                    error: null,
                  }),
                }),
              }),
              update,
            }
          }
          if (table === 'categories') {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: async () => ({ data: { id: 5 }, error: null }),
                }),
              }),
            }
          }
          throw new Error(`unexpected table ${table}`)
        },
      }
    })

    const result = await updateProductSettingsAction({ ...validInput, longDescription: '   ' })
    expect(result).toEqual({ ok: true })
    const doc = (capturedUpdate as unknown as { long_description: { type: string; content: unknown[] } })
      .long_description
    expect(doc.type).toBe('doc')
    expect(doc.content).toEqual([])
  })
})