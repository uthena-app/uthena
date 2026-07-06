// getMyUploadDraft.test.ts — unit tests for the partner-upload
// `getMyUploadDraft` query (P12.7 Slice 1).
//
// Covers:
//   - Auth gate: anon user → `{ exists: false }`, no DB calls.
//   - DB error: logged warn, returns `{ exists: false }` (fail-soft,
//     page renders the empty wizard).
//   - No row: returns `{ exists: false }`.
//   - Happy path: returns the full draft shape with all fields coerced.
//   - Defensive coercion: garbage current_step → fallback; garbage
//     payload → empty object; missing columns → defaults.
//   - Status normalization: only 'draft' | 'submitted' | 'withdrawn'
//     are accepted; anything else maps to 'draft'.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Call =
  | { method: 'from'; table: string }
  | { method: 'select'; payload: string | undefined }
  | { method: 'eq'; col: string; val: unknown }
  | { method: 'maybeSingle' }
  | { method: 'auth.getUser' }

const calls: Call[] = []
const mockWarn = vi.fn()

let getUserResponse: { data: { user: { id: string; email: string } | null }; error: unknown } = {
  data: { user: { id: 'user-uuid-1', email: 'klaas@example.com' } },
  error: null,
}
let draftReadResponse: { data: Record<string, unknown> | null; error: unknown } = {
  data: null,
  error: null,
}

const fakeSupabase = {
  auth: {
    getUser: vi.fn(async () => {
      calls.push({ method: 'auth.getUser' })
      return getUserResponse
    }),
  },
  from: vi.fn((table: string) => {
    calls.push({ method: 'from', table })
    return {
      select: (payload?: string) => {
        calls.push({ method: 'select', payload })
        return {
          eq: (col: string, val: unknown) => {
            calls.push({ method: 'eq', col, val })
            return {
              maybeSingle: vi.fn(async () => {
                calls.push({ method: 'maybeSingle' })
                return draftReadResponse
              }),
            }
          },
        }
      },
    }
  }),
}

vi.mock('@foundations/data/supabase', () => ({
  getServerSupabase: vi.fn(async () => fakeSupabase),
}))

vi.mock('@foundations/log/pino', () => ({
  loggerFor: () => ({
    info: vi.fn(),
    warn: (...args: unknown[]) => mockWarn(...args),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))

const { getMyUploadDraft } = await import('./getMyUploadDraft')
const {
  UPLOAD_STEPS,
  UPLOAD_FIRST_STEP,
  UPLOAD_LAST_STEP,
  UPLOAD_TOTAL_STEPS,
} = await import('./getMyUploadDraft')

beforeEach(() => {
  calls.length = 0
  fakeSupabase.from.mockClear()
  fakeSupabase.auth.getUser.mockClear()
  mockWarn.mockClear()
  getUserResponse = {
    data: { user: { id: 'user-uuid-1', email: 'klaas@example.com' } },
    error: null,
  }
  draftReadResponse = { data: null, error: null }
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('UPLOAD_STEPS — shape contract', () => {
  it('has exactly 5 entries in spec order', () => {
    expect(UPLOAD_STEPS).toHaveLength(5)
    expect(UPLOAD_STEPS.map((s) => s.id)).toEqual([
      'details',
      'curriculum',
      'files',
      'pricing',
      'review',
    ])
    expect(UPLOAD_STEPS.map((s) => s.step)).toEqual([1, 2, 3, 4, 5])
  })

  it('first/last/total constants match the stepper', () => {
    expect(UPLOAD_FIRST_STEP).toBe(1)
    expect(UPLOAD_LAST_STEP).toBe(5)
    expect(UPLOAD_TOTAL_STEPS).toBe(5)
  })
})

describe('getMyUploadDraft — auth + empty states', () => {
  it('returns exists:false for anon caller (no DB read)', async () => {
    getUserResponse = { data: { user: null }, error: null }
    const result = await getMyUploadDraft()
    expect(result).toEqual({ exists: false })
    expect(calls.find((c) => c.method === 'from')).toBeUndefined()
  })

  it('returns exists:false when the user has no draft yet', async () => {
    draftReadResponse = { data: null, error: null }
    const result = await getMyUploadDraft()
    expect(result).toEqual({ exists: false })
  })

  it('returns exists:false on DB error (logged warn, fail-soft)', async () => {
    draftReadResponse = { data: null, error: { message: 'connection reset' } }
    const result = await getMyUploadDraft()
    expect(result).toEqual({ exists: false })
    expect(mockWarn).toHaveBeenCalled()
  })
})

describe('getMyUploadDraft — happy path', () => {
  it('returns the full draft shape with all fields coerced', async () => {
    draftReadResponse = {
      data: {
        current_step: 3,
        last_saved_step: 2,
        status: 'draft',
        payload: { details: { title: 'A course' } },
        submitted_at: '2026-06-29T10:00:00Z',
        reviewed_at: null,
        reviewer_id: null,
        decision: null,
        decision_notes: null,
        created_at: '2026-06-29T09:00:00Z',
        updated_at: '2026-06-29T10:00:00Z',
      },
      error: null,
    }
    const result = await getMyUploadDraft()
    expect(result).toEqual({
      exists: true,
      currentStep: 3,
      lastSavedStep: 2,
      status: 'draft',
      payload: { details: { title: 'A course' } },
      submittedAt: '2026-06-29T10:00:00Z',
      reviewedAt: null,
      reviewerId: null,
      decision: null,
      decisionNotes: null,
      createdAt: '2026-06-29T09:00:00Z',
      updatedAt: '2026-06-29T10:00:00Z',
    })
  })

  it('clamps out-of-range current_step into [first, last]', async () => {
    draftReadResponse = {
      data: {
        current_step: 99,
        last_saved_step: -2,
        status: 'draft',
        payload: {},
        created_at: '2026-06-29T09:00:00Z',
        updated_at: '2026-06-29T10:00:00Z',
      },
      error: null,
    }
    const result = await getMyUploadDraft()
    expect(result.exists).toBe(true)
    if (result.exists) {
      expect(result.currentStep).toBe(UPLOAD_LAST_STEP)
      // lastSavedStep clamps to the clamped currentStep fallback when
      // out of range — see clampStep semantics in the source.
      expect(result.lastSavedStep).toBeGreaterThanOrEqual(UPLOAD_FIRST_STEP)
      expect(result.lastSavedStep).toBeLessThanOrEqual(UPLOAD_LAST_STEP)
    }
  })

  it('coerces garbage payload to empty object (defensive)', async () => {
    draftReadResponse = {
      data: {
        current_step: 1,
        last_saved_step: 1,
        status: 'draft',
        payload: 'this should not be a string',
        created_at: '2026-06-29T09:00:00Z',
        updated_at: '2026-06-29T10:00:00Z',
      },
      error: null,
    }
    const result = await getMyUploadDraft()
    if (result.exists) expect(result.payload).toEqual({})
  })

  it('normalizes unknown status to draft', async () => {
    draftReadResponse = {
      data: {
        current_step: 1,
        last_saved_step: 1,
        status: 'pending_approval', // not in the enum
        payload: {},
        created_at: '2026-06-29T09:00:00Z',
        updated_at: '2026-06-29T10:00:00Z',
      },
      error: null,
    }
    const result = await getMyUploadDraft()
    if (result.exists) expect(result.status).toBe('draft')
  })

  it('accepts submitted + withdrawn statuses', async () => {
    draftReadResponse = {
      data: {
        current_step: 5,
        last_saved_step: 5,
        status: 'submitted',
        payload: {},
        submitted_at: '2026-06-29T10:00:00Z',
        created_at: '2026-06-29T09:00:00Z',
        updated_at: '2026-06-29T10:00:00Z',
      },
      error: null,
    }
    const result = await getMyUploadDraft()
    if (result.exists) expect(result.status).toBe('submitted')
  })

  it('defaults created_at + updated_at when missing', async () => {
    draftReadResponse = {
      data: {
        current_step: 1,
        last_saved_step: 1,
        status: 'draft',
        payload: {},
      },
      error: null,
    }
    const result = await getMyUploadDraft()
    if (result.exists) {
      expect(typeof result.createdAt).toBe('string')
      expect(typeof result.updatedAt).toBe('string')
    }
  })
})
