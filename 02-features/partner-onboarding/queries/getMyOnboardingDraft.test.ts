// getMyOnboardingDraft.test.ts — unit tests for the draft-read query.
//
// P12.1 Slice 1 — covers auth gating, RLS-implied row scoping, and
// defensive coercion of every column. Mirrors the patterns established
// in `getMyPartnerProfile.test.ts`.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ----- Supabase chain mock ------------------------------------------------

type ServerCall =
  | { method: 'from'; table: string }
  | { method: 'select'; payload: unknown }
  | { method: 'eq'; col: string; val: unknown }
  | { method: 'maybeSingle' }
  | { method: 'single' }

const serverCalls: ServerCall[] = []
let serverQueue: Array<{ data: unknown; error: unknown }> = []

function makeServerChain() {
  const chain: any = {
    select(payload: unknown) {
      serverCalls.push({ method: 'select', payload })
      return chain
    },
    eq(col: string, val: unknown) {
      serverCalls.push({ method: 'eq', col, val })
      return chain
    },
    maybeSingle: vi.fn(async () => {
      serverCalls.push({ method: 'maybeSingle' })
      return serverQueue.shift() ?? { data: null, error: null }
    }),
  }
  return chain
}

const fakeServerSupabase = {
  from: vi.fn((table: string) => {
    serverCalls.push({ method: 'from', table })
    return makeServerChain()
  }),
  auth: {
    getUser: vi.fn(async () => ({ data: { user: mockUser } })),
  },
}

let mockUser: { id: string } | null = { id: 'user-1' }

vi.mock('@foundations/data/supabase', () => ({
  getServerSupabase: vi.fn(async () => fakeServerSupabase),
}))

vi.mock('@foundations/log/pino', () => ({
  loggerFor: () => ({
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    debug: () => undefined,
  }),
}))

// ----- Lifecycle ----------------------------------------------------------

beforeEach(() => {
  serverCalls.length = 0
  serverQueue = []
  mockUser = { id: 'user-1' }
  fakeServerSupabase.from.mockClear()
  fakeServerSupabase.auth.getUser.mockClear()
  fakeServerSupabase.auth.getUser.mockImplementation(async () => ({
    data: { user: mockUser },
  }))
})

afterEach(() => {
  vi.clearAllMocks()
})

// ----- Import (after mocks) -----------------------------------------------

const { getMyOnboardingDraft } = await import('./getMyOnboardingDraft')
const {
  ONBOARDING_FIRST_STEP,
  ONBOARDING_TOTAL_STEPS,
  ONBOARDING_STEP_WELCOME,
  ONBOARDING_STEPS,
} = await import('./getMyOnboardingDraft')

// =====================================================================
// Shape exports — kind of integration "is the API what we expect"
// =====================================================================

describe('Onboarding step constants', () => {
  it('exports 7 steps in the canonical order', () => {
    expect(ONBOARDING_STEPS).toHaveLength(7)
    expect(ONBOARDING_STEPS[0]?.id).toBe('welcome')
    expect(ONBOARDING_STEPS[6]?.id).toBe('submit')
  })
  it('first step is 1, total is 7', () => {
    expect(ONBOARDING_FIRST_STEP).toBe(1)
    expect(ONBOARDING_TOTAL_STEPS).toBe(7)
    expect(ONBOARDING_STEP_WELCOME).toBe(1)
  })
})

// =====================================================================
// getMyOnboardingDraft — auth + RLS + happy path
// =====================================================================

describe('getMyOnboardingDraft — auth gating', () => {
  it('returns `{ exists: false }` for anonymous callers', async () => {
    mockUser = null
    fakeServerSupabase.auth.getUser.mockResolvedValueOnce({
      data: { user: null },
    })

    const result = await getMyOnboardingDraft()
    expect(result).toEqual({ exists: false })
    // Critically: NO Supabase.from() call happens — we never even
    // attempt to read drafts for an anonymous visitor.
    expect(fakeServerSupabase.from).not.toHaveBeenCalled()
  })

  it('returns `{ exists: false }` when the SELECT returns no row', async () => {
    serverQueue.push({ data: null, error: null })

    const result = await getMyOnboardingDraft()
    expect(result).toEqual({ exists: false })

    expect(fakeServerSupabase.from).toHaveBeenCalledWith('partner_onboarding_drafts')
    expect(serverCalls.some((c) => c.method === 'eq' && (c as { col: string }).col === 'user_id')).toBe(true)
  })

  it('returns `{ exists: false }` when the SELECT errors out', async () => {
    serverQueue.push({ data: null, error: { message: 'permission denied' } })

    const result = await getMyOnboardingDraft()
    expect(result).toEqual({ exists: false })
  })
})

// =====================================================================
// getMyOnboardingDraft — defensive coercion on every column
// =====================================================================

describe('getMyOnboardingDraft — defensive coercion', () => {
  it('clamps out-of-range current_step to ONBOARDING_TOTAL_STEPS', async () => {
    serverQueue.push({
      data: {
        id: 1,
        user_id: 'user-1',
        payload: {},
        current_step: 99,
        submitted_at: null,
        created_at: '2026-06-29T00:00:00Z',
        updated_at: '2026-06-29T00:00:00Z',
      },
      error: null,
    })

    const result = await getMyOnboardingDraft()
    expect(result.exists).toBe(true)
    if (result.exists) {
      expect(result.currentStep).toBe(ONBOARDING_TOTAL_STEPS)
    }
  })

  it('clamps negative current_step up to ONBOARDING_FIRST_STEP', async () => {
    serverQueue.push({
      data: {
        id: 1,
        user_id: 'user-1',
        payload: {},
        current_step: -3,
        submitted_at: null,
        created_at: '2026-06-29T00:00:00Z',
        updated_at: '2026-06-29T00:00:00Z',
      },
      error: null,
    })

    const result = await getMyOnboardingDraft()
    expect(result.exists).toBe(true)
    if (result.exists) {
      expect(result.currentStep).toBe(ONBOARDING_FIRST_STEP)
    }
  })

  it('falls back to step 1 when current_step is not an integer', async () => {
    serverQueue.push({
      data: {
        id: 1,
        user_id: 'user-1',
        payload: {},
        current_step: 'three',
        submitted_at: null,
        created_at: '2026-06-29T00:00:00Z',
        updated_at: '2026-06-29T00:00:00Z',
      },
      error: null,
    })

    const result = await getMyOnboardingDraft()
    expect(result.exists).toBe(true)
    if (result.exists) {
      expect(result.currentStep).toBe(ONBOARDING_FIRST_STEP)
    }
  })

  it('coerces non-object payload to `{}`', async () => {
    serverQueue.push({
      data: {
        id: 1,
        user_id: 'user-1',
        payload: ['not', 'an', 'object'],
        current_step: 3,
        submitted_at: null,
        created_at: '2026-06-29T00:00:00Z',
        updated_at: '2026-06-29T00:00:00Z',
      },
      error: null,
    })

    const result = await getMyOnboardingDraft()
    expect(result.exists).toBe(true)
    if (result.exists) {
      expect(result.payload).toEqual({})
    }
  })

  it('coerces null payload to `{}`', async () => {
    serverQueue.push({
      data: {
        id: 1,
        user_id: 'user-1',
        payload: null,
        current_step: 3,
        submitted_at: null,
        created_at: '2026-06-29T00:00:00Z',
        updated_at: '2026-06-29T00:00:00Z',
      },
      error: null,
    })

    const result = await getMyOnboardingDraft()
    expect(result.exists).toBe(true)
    if (result.exists) {
      expect(result.payload).toEqual({})
    }
  })

  it('coerces non-string submitted_at to null', async () => {
    serverQueue.push({
      data: {
        id: 1,
        user_id: 'user-1',
        payload: {},
        current_step: 3,
        submitted_at: 1234567890, // numeric — wrong shape
        created_at: '2026-06-29T00:00:00Z',
        updated_at: '2026-06-29T00:00:00Z',
      },
      error: null,
    })

    const result = await getMyOnboardingDraft()
    expect(result.exists).toBe(true)
    if (result.exists) {
      expect(result.submittedAt).toBeNull()
    }
  })

  it('falls back to the epoch when created_at is missing', async () => {
    serverQueue.push({
      data: {
        id: 1,
        user_id: 'user-1',
        payload: {},
        current_step: 3,
        submitted_at: null,
        // created_at missing entirely — defensive guard
        updated_at: '2026-06-29T00:00:00Z',
      },
      error: null,
    })

    const result = await getMyOnboardingDraft()
    expect(result.exists).toBe(true)
    if (result.exists) {
      // The doc comment promises "a fallback to new Date(0).toISOString()"
      // when created_at is missing. Verify the shape, not the exact value.
      expect(result.createdAt).toBe('1970-01-01T00:00:00.000Z')
    }
  })
})

// =====================================================================
// getMyOnboardingDraft — happy path
// =====================================================================

describe('getMyOnboardingDraft — happy path', () => {
  it('returns the full draft shape', async () => {
    serverQueue.push({
      data: {
        id: 7,
        user_id: 'user-1',
        payload: { profile: { display_name: 'Cool Partner' }, payout: { paypal_email: 'cool@example.com' } },
        current_step: 3,
        submitted_at: null,
        created_at: '2026-06-20T10:00:00Z',
        updated_at: '2026-06-29T14:30:00Z',
      },
      error: null,
    })

    const result = await getMyOnboardingDraft()
    expect(result.exists).toBe(true)
    if (result.exists) {
      expect(result.currentStep).toBe(3)
      expect(result.submittedAt).toBeNull()
      expect(result.createdAt).toBe('2026-06-20T10:00:00Z')
      expect(result.updatedAt).toBe('2026-06-29T14:30:00Z')
      expect(result.payload).toEqual({
        profile: { display_name: 'Cool Partner' },
        payout: { paypal_email: 'cool@example.com' },
      })
    }
  })
})
