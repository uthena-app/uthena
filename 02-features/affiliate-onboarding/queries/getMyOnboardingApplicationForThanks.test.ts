// getMyOnboardingApplicationForThanks.test.ts — unit tests for the
// affiliate thanks-page state query.
//
// P13.2 — covers the dispatch matrix (mirrors the partner onboarding
// thanks-page query test):
//   - anon → { kind: 'none' } (no DB calls)
//   - no affiliate row → { kind: 'none' }
//   - pending + submitted_at → { kind: 'pending', affiliateId, submittedAt }
//   - pending WITHOUT submitted_at → { kind: 'none' } (stuck-state guard)
//   - approved → { kind: 'approved', affiliateId }
//   - suspended → { kind: 'suspended', affiliateId }
//   - unknown status → { kind: 'none' }
//   - DB error on affiliate read → { kind: 'none' }
//   - defensive coercion: affiliateId not a number → { kind: 'none' }
//
// Mirrors the patterns established in `getMyOnboardingDraft.test.ts`
// + the partner onboarding `getMyOnboardingApplicationForThanks.test.ts`.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ----- Supabase chain mock ------------------------------------------------

type ServerCall =
  | { method: 'from'; table: string }
  | { method: 'select'; payload: unknown }
  | { method: 'eq'; col: string; val: unknown }
  | { method: 'maybeSingle' }

const serverCalls: ServerCall[] = []

function makeServerChain(
  queue: Array<{ data: unknown; error: unknown }>,
  label: string,
) {
  const chain: {
    select: (payload: unknown) => typeof chain
    eq: (col: string, val: unknown) => typeof chain
    maybeSingle: () => Promise<{ data: unknown; error: unknown }>
  } = {
    select(payload: unknown) {
      serverCalls.push({ method: 'select', payload })
      return chain
    },
    eq(col: string, val: unknown) {
      serverCalls.push({ method: 'eq', col, val })
      return chain
    },
    maybeSingle: async () => {
      serverCalls.push({ method: 'maybeSingle' })
      const next = queue.shift() ?? { data: null, error: null }
      // Surface the resolution for any future debug assertion.
      void label
      return next
    },
  }
  return chain
}

// The thanks-page query makes TWO parallel reads — each via its own
// `from(...)` chain. The mock below lets us queue a separate response
// per read by tracking which `from` call is which.
const affiliateQueue: Array<{ data: unknown; error: unknown }> = []
const draftQueue: Array<{ data: unknown; error: unknown }> = []

const fakeServerSupabase = {
  from: vi.fn((table: string) => {
    serverCalls.push({ method: 'from', table })
    const isAffiliate = table === 'affiliates'
    const queue = isAffiliate ? affiliateQueue : draftQueue
    return makeServerChain(queue, table)
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
  affiliateQueue.length = 0
  draftQueue.length = 0
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

const { getMyOnboardingApplicationForThanks } = await import(
  './getMyOnboardingApplicationForThanks'
)

// =====================================================================
// Auth gating
// =====================================================================

describe('getMyOnboardingApplicationForThanks — auth gating', () => {
  it('returns `{ kind: "none" }` for anonymous callers (no DB calls)', async () => {
    mockUser = null
    fakeServerSupabase.auth.getUser.mockResolvedValueOnce({
      data: { user: null },
    })

    const result = await getMyOnboardingApplicationForThanks()
    expect(result).toEqual({ kind: 'none' })
    // Critically: NO Supabase.from() call happens for anon.
    expect(fakeServerSupabase.from).not.toHaveBeenCalled()
  })
})

// =====================================================================
// Dispatch matrix
// =====================================================================

describe('getMyOnboardingApplicationForThanks — dispatch matrix', () => {
  it('returns `{ kind: "none" }` when no affiliate row exists', async () => {
    affiliateQueue.push({ data: null, error: null })
    draftQueue.push({ data: null, error: null })

    const result = await getMyOnboardingApplicationForThanks()
    expect(result).toEqual({ kind: 'none' })
    expect(fakeServerSupabase.from).toHaveBeenCalledWith('affiliates')
    expect(fakeServerSupabase.from).toHaveBeenCalledWith('affiliate_onboarding_drafts')
  })

  it('returns `{ kind: "pending" }` when affiliate row is pending + draft submitted', async () => {
    affiliateQueue.push({
      data: { id: 67890, user_id: 'user-1', status: 'pending', created_at: '2026-06-29T00:00:00Z' },
      error: null,
    })
    draftQueue.push({
      data: { user_id: 'user-1', submitted_at: '2026-06-29T01:23:45Z' },
      error: null,
    })

    const result = await getMyOnboardingApplicationForThanks()
    expect(result).toEqual({
      kind: 'pending',
      affiliateId: 67890,
      submittedAt: '2026-06-29T01:23:45Z',
    })
  })

  it('returns `{ kind: "none" }` when pending affiliate row exists but draft NOT submitted (stuck-state guard)', async () => {
    affiliateQueue.push({
      data: { id: 67890, user_id: 'user-1', status: 'pending', created_at: '2026-06-29T00:00:00Z' },
      error: null,
    })
    draftQueue.push({
      data: { user_id: 'user-1', submitted_at: null },
      error: null,
    })

    const result = await getMyOnboardingApplicationForThanks()
    expect(result).toEqual({ kind: 'none' })
  })

  it('returns `{ kind: "none" }` when pending affiliate row exists but draft row is missing', async () => {
    affiliateQueue.push({
      data: { id: 67890, user_id: 'user-1', status: 'pending', created_at: '2026-06-29T00:00:00Z' },
      error: null,
    })
    draftQueue.push({ data: null, error: null })

    const result = await getMyOnboardingApplicationForThanks()
    expect(result).toEqual({ kind: 'none' })
  })

  it('returns `{ kind: "approved" }` for approved affiliates', async () => {
    affiliateQueue.push({
      data: { id: 67890, user_id: 'user-1', status: 'approved', created_at: '2026-06-29T00:00:00Z' },
      error: null,
    })
    draftQueue.push({ data: null, error: null })

    const result = await getMyOnboardingApplicationForThanks()
    expect(result).toEqual({ kind: 'approved', affiliateId: 67890 })
  })

  it('returns `{ kind: "suspended" }` for suspended affiliates', async () => {
    affiliateQueue.push({
      data: { id: 67890, user_id: 'user-1', status: 'suspended', created_at: '2026-06-29T00:00:00Z' },
      error: null,
    })
    draftQueue.push({ data: null, error: null })

    const result = await getMyOnboardingApplicationForThanks()
    expect(result).toEqual({ kind: 'suspended', affiliateId: 67890 })
  })

  it('returns `{ kind: "none" }` for unknown affiliate_status strings', async () => {
    affiliateQueue.push({
      data: { id: 67890, user_id: 'user-1', status: 'banned', created_at: '2026-06-29T00:00:00Z' },
      error: null,
    })
    draftQueue.push({ data: null, error: null })

    const result = await getMyOnboardingApplicationForThanks()
    expect(result).toEqual({ kind: 'none' })
  })

  it('returns `{ kind: "none" }` when affiliate_id is missing or non-numeric', async () => {
    affiliateQueue.push({
      data: { id: null, user_id: 'user-1', status: 'pending', created_at: '2026-06-29T00:00:00Z' },
      error: null,
    })
    draftQueue.push({
      data: { user_id: 'user-1', submitted_at: '2026-06-29T01:23:45Z' },
      error: null,
    })

    const result = await getMyOnboardingApplicationForThanks()
    expect(result).toEqual({ kind: 'none' })
  })

  it('returns `{ kind: "none" }` when affiliate query errors out', async () => {
    affiliateQueue.push({ data: null, error: { message: 'permission denied' } })
    draftQueue.push({ data: null, error: null })

    const result = await getMyOnboardingApplicationForThanks()
    expect(result).toEqual({ kind: 'none' })
  })

  it('treats draft query error as null submitted_at (pending affiliate still resolves to none)', async () => {
    affiliateQueue.push({
      data: { id: 67890, user_id: 'user-1', status: 'pending', created_at: '2026-06-29T00:00:00Z' },
      error: null,
    })
    draftQueue.push({ data: null, error: { message: 'connection timeout' } })

    // When the draft read fails and submitted_at is null, a pending
    // affiliate falls through to `{ kind: 'none' }` — fail-closed is
    // safer than rendering a thanks page for an affiliate whose
    // submit we cannot prove.
    const result = await getMyOnboardingApplicationForThanks()
    expect(result).toEqual({ kind: 'none' })
  })
})

// =====================================================================
// Query shape
// =====================================================================

describe('getMyOnboardingApplicationForThanks — query shape', () => {
  it('scopes both queries by user_id', async () => {
    affiliateQueue.push({ data: null, error: null })
    draftQueue.push({ data: null, error: null })

    await getMyOnboardingApplicationForThanks()

    const userIdEqs = serverCalls.filter(
      (c) => c.method === 'eq' && (c as { col: string }).col === 'user_id',
    )
    expect(userIdEqs.length).toBeGreaterThanOrEqual(2) // one per table
    for (const c of userIdEqs) {
      expect((c as { val: unknown }).val).toBe('user-1')
    }
  })

  it('selects only the PII-safe columns from affiliates', async () => {
    affiliateQueue.push({ data: null, error: null })
    draftQueue.push({ data: null, error: null })

    await getMyOnboardingApplicationForThanks()

    const affiliateSelect = serverCalls.find(
      (c) =>
        c.method === 'select' &&
        typeof (c as { payload: unknown }).payload === 'string' &&
        (c as { payload: string }).payload.startsWith('id,'),
    )
    expect(affiliateSelect).toBeDefined()
    const payload = (affiliateSelect as { payload: string }).payload
    expect(payload).not.toContain('payout_email')
    expect(payload).not.toContain('bio')
    expect(payload).not.toContain('handle')
  })

  it('selects only `user_id, submitted_at` from affiliate_onboarding_drafts', async () => {
    affiliateQueue.push({ data: null, error: null })
    draftQueue.push({ data: null, error: null })

    await getMyOnboardingApplicationForThanks()

    // Two `select` calls happened — one per table.
    const selects = serverCalls.filter((c) => c.method === 'select')
    expect(selects).toHaveLength(2)
    const payloads = selects.map((c) => (c as { payload: string }).payload)
    // The draft select must not include the jsonb payload.
    expect(payloads.some((p) => p === 'user_id, submitted_at')).toBe(true)
    expect(payloads.every((p) => !p.includes('payload'))).toBe(true)
  })
})