// getMyOnboardingDraft.test.ts — unit tests for the draft-read query.
//
// P13.1 Slice 1 — covers auth gating, RLS-implied row scoping, and
// defensive coercion of every column. Mirrors the patterns from
// partner-onboarding's getMyOnboardingDraft.test.ts.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ----- Supabase chain mock ------------------------------------------------

type ServerCall =
  | { method: 'from'; table: string }
  | { method: 'select'; payload: unknown }
  | { method: 'eq'; col: string; val: unknown }
  | { method: 'maybeSingle' }

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
  ONBOARDING_STEPS,
  TOTAL_STEPS,
  FIRST_STEP,
  STEP_WELCOME,
  ALL_STEPS,
  EMPTY_STEP_PAYLOADS,
} = await import('./getMyOnboardingDraft')

// =====================================================================
// Shape exports — kind of integration "is the API what we expect"
// =====================================================================

describe('Onboarding step constants', () => {
  it('exports 6 steps in the canonical order', () => {
    expect(ONBOARDING_STEPS).toHaveLength(6)
    expect(ONBOARDING_STEPS[0]?.id).toBe('welcome')
    expect(ONBOARDING_STEPS[5]?.id).toBe('submit')
  })

  it('first step is welcome (named enum, not int)', () => {
    expect(FIRST_STEP).toBe('welcome')
    expect(STEP_WELCOME).toBe('welcome')
    expect(TOTAL_STEPS).toBe(6)
  })

  it('ALL_STEPS is a Set containing all 6 named values', () => {
    expect(ALL_STEPS).toBeInstanceOf(Set)
    expect(ALL_STEPS.size).toBe(6)
    expect(ALL_STEPS.has('welcome')).toBe(true)
    expect(ALL_STEPS.has('handle_bio')).toBe(true)
    expect(ALL_STEPS.has('payout')).toBe(true)
    expect(ALL_STEPS.has('promo_methods')).toBe(true)
    expect(ALL_STEPS.has('agreement')).toBe(true)
    expect(ALL_STEPS.has('submit')).toBe(true)
  })

  it('EMPTY_STEP_PAYLOADS exposes the 4 per-step jsonb keys', () => {
    expect(EMPTY_STEP_PAYLOADS).toEqual({
      handle_bio: {},
      payout: {},
      promo_methods: {},
      agreement: {},
    })
  })
})

// =====================================================================
// getMyOnboardingDraft — auth gating
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

    expect(fakeServerSupabase.from).toHaveBeenCalledWith('affiliate_onboarding_drafts')
    expect(
      serverCalls.some((c) => c.method === 'eq' && (c as { col: string }).col === 'user_id'),
    ).toBe(true)
  })

  it('returns `{ exists: false }` when the SELECT errors out', async () => {
    serverQueue.push({ data: null, error: { message: 'permission denied' } })

    const result = await getMyOnboardingDraft()
    expect(result).toEqual({ exists: false })
  })
})

// =====================================================================
// getMyOnboardingDraft — defensive coercion
// =====================================================================

describe('getMyOnboardingDraft — defensive coercion', () => {
  it('falls back to FIRST_STEP when current_step is an unknown enum value', async () => {
    serverQueue.push({
      data: {
        id: 1,
        user_id: 'user-1',
        current_step: 'mystery-step',
        handle_bio: {},
        payout: {},
        promo_methods: {},
        agreement: {},
        submitted_at: null,
        created_at: '2026-06-29T00:00:00Z',
        updated_at: '2026-06-29T00:00:00Z',
      },
      error: null,
    })

    const result = await getMyOnboardingDraft()
    expect(result.exists).toBe(true)
    if (result.exists) {
      expect(result.currentStep).toBe(FIRST_STEP)
    }
  })

  it('falls back to FIRST_STEP when current_step is not a string', async () => {
    serverQueue.push({
      data: {
        id: 1,
        user_id: 'user-1',
        current_step: 99, // wrong shape — was int in old spec
        handle_bio: {},
        payout: {},
        promo_methods: {},
        agreement: {},
        submitted_at: null,
        created_at: '2026-06-29T00:00:00Z',
        updated_at: '2026-06-29T00:00:00Z',
      },
      error: null,
    })

    const result = await getMyOnboardingDraft()
    expect(result.exists).toBe(true)
    if (result.exists) {
      expect(result.currentStep).toBe(FIRST_STEP)
    }
  })

  it('falls back to FIRST_STEP when current_step is null', async () => {
    serverQueue.push({
      data: {
        id: 1,
        user_id: 'user-1',
        current_step: null,
        handle_bio: {},
        payout: {},
        promo_methods: {},
        agreement: {},
        submitted_at: null,
        created_at: '2026-06-29T00:00:00Z',
        updated_at: '2026-06-29T00:00:00Z',
      },
      error: null,
    })

    const result = await getMyOnboardingDraft()
    expect(result.exists).toBe(true)
    if (result.exists) {
      expect(result.currentStep).toBe(FIRST_STEP)
    }
  })

  it('coerces array-valued jsonb columns to `{}`', async () => {
    serverQueue.push({
      data: {
        id: 1,
        user_id: 'user-1',
        current_step: 'handle_bio',
        handle_bio: ['not', 'an', 'object'],
        payout: [],
        promo_methods: ['array', 'of', 'strings'],
        agreement: {},
        submitted_at: null,
        created_at: '2026-06-29T00:00:00Z',
        updated_at: '2026-06-29T00:00:00Z',
      },
      error: null,
    })

    const result = await getMyOnboardingDraft()
    expect(result.exists).toBe(true)
    if (result.exists) {
      expect(result.handleBio).toEqual({})
      expect(result.payout).toEqual({})
      expect(result.promoMethods).toEqual({})
    }
  })

  it('coerces null jsonb columns to `{}`', async () => {
    serverQueue.push({
      data: {
        id: 1,
        user_id: 'user-1',
        current_step: 'handle_bio',
        handle_bio: null,
        payout: null,
        promo_methods: null,
        agreement: null,
        submitted_at: null,
        created_at: '2026-06-29T00:00:00Z',
        updated_at: '2026-06-29T00:00:00Z',
      },
      error: null,
    })

    const result = await getMyOnboardingDraft()
    expect(result.exists).toBe(true)
    if (result.exists) {
      expect(result.handleBio).toEqual({})
      expect(result.payout).toEqual({})
      expect(result.promoMethods).toEqual({})
      expect(result.agreement).toEqual({})
    }
  })

  it('coerces non-string submitted_at to null', async () => {
    serverQueue.push({
      data: {
        id: 1,
        user_id: 'user-1',
        current_step: 'payout',
        handle_bio: {},
        payout: {},
        promo_methods: {},
        agreement: {},
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
        current_step: 'payout',
        handle_bio: {},
        payout: {},
        promo_methods: {},
        agreement: {},
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
        current_step: 'payout',
        handle_bio: { handle: 'alice', bio: 'Cool affiliate' },
        payout: { paypal_email: 'alice@example.com' },
        promo_methods: { methods: ['twitter', 'youtube'] },
        agreement: {},
        submitted_at: null,
        created_at: '2026-06-20T10:00:00Z',
        updated_at: '2026-06-29T14:30:00Z',
      },
      error: null,
    })

    const result = await getMyOnboardingDraft()
    expect(result.exists).toBe(true)
    if (result.exists) {
      expect(result.currentStep).toBe('payout')
      expect(result.submittedAt).toBeNull()
      expect(result.createdAt).toBe('2026-06-20T10:00:00Z')
      expect(result.updatedAt).toBe('2026-06-29T14:30:00Z')
      expect(result.handleBio).toEqual({ handle: 'alice', bio: 'Cool affiliate' })
      expect(result.payout).toEqual({ paypal_email: 'alice@example.com' })
      expect(result.promoMethods).toEqual({ methods: ['twitter', 'youtube'] })
    }
  })

  it('preserves submitted_at when present', async () => {
    serverQueue.push({
      data: {
        id: 7,
        user_id: 'user-1',
        current_step: 'submit',
        handle_bio: { handle: 'alice' },
        payout: { paypal_email: 'alice@example.com' },
        promo_methods: {},
        agreement: {
          affiliate_terms_accepted: true,
          tos_accepted: true,
          accepted_at: '2026-06-29T15:00:00Z',
        },
        submitted_at: '2026-06-29T15:30:00Z',
        created_at: '2026-06-20T10:00:00Z',
        updated_at: '2026-06-29T15:30:00Z',
      },
      error: null,
    })

    const result = await getMyOnboardingDraft()
    expect(result.exists).toBe(true)
    if (result.exists) {
      expect(result.submittedAt).toBe('2026-06-29T15:30:00Z')
      expect(result.agreement).toEqual({
        affiliate_terms_accepted: true,
        tos_accepted: true,
        accepted_at: '2026-06-29T15:00:00Z',
      })
    }
  })
})

// =====================================================================
// getMyOnboardingDraft — PII safety (no PII fields leak into the
// returned shape beyond what the form legitimately needs)
// =====================================================================

describe('getMyOnboardingDraft — PII safety', () => {
  it('does NOT include user_id or email in the returned shape', async () => {
    serverQueue.push({
      data: {
        id: 7,
        user_id: 'user-1',
        // PostgREST sometimes echoes `email` if the column exists on the
        // table. Our select deliberately omits it, so it can never reach
        // the page even if a future migration adds it.
        email: 'should-not-cross-the-wire@example.com',
        current_step: 'payout',
        handle_bio: {},
        payout: { paypal_email: 'alice@example.com' },
        promo_methods: {},
        agreement: {},
        submitted_at: null,
        created_at: '2026-06-20T10:00:00Z',
        updated_at: '2026-06-29T14:30:00Z',
      },
      error: null,
    })

    const result = await getMyOnboardingDraft()
    expect(result.exists).toBe(true)
    if (result.exists) {
      // The returned shape is the AffiliateOnboardingDraft type — has no
      // `email` or `user_id` field. Cast to any for a runtime assertion.
      const shape = result as Record<string, unknown>
      expect(shape.email).toBeUndefined()
      expect(shape.user_id).toBeUndefined()
      expect(shape.userId).toBeUndefined()
    }
  })
})