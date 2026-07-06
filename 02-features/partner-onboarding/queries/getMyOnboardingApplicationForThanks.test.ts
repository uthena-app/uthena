// getMyOnboardingApplicationForThanks.test.ts — unit tests for the
// thanks-page state query.
//
// P12.3 — covers the dispatch matrix:
//   - anon → { kind: 'none' } (no DB calls)
//   - no partner row → { kind: 'none' }
//   - pending + submitted_at → { kind: 'pending', partnerId, submittedAt }
//   - pending WITHOUT submitted_at → { kind: 'none' } (stuck-state guard)
//   - approved → { kind: 'approved', partnerId }
//   - suspended → { kind: 'suspended', partnerId }
//   - unknown status → { kind: 'none' }
//   - DB error on partner read → { kind: 'none' }
//   - DB error on draft read → still resolves with null submitted_at
//   - defensive coercion: partnerId not a number → { kind: 'none' }
//
// Mirrors the patterns established in `getMyOnboardingDraft.test.ts`.

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

// The thanks-page query makes TWO parallel reads — each via its own
// `from(...)` chain. The mock below lets us queue a separate response
// per read by tracking which `from` call is which.
const partnerQueue: Array<{ data: unknown; error: unknown }> = []
const draftQueue: Array<{ data: unknown; error: unknown }> = []

const fakeServerSupabase = {
  from: vi.fn((table: string) => {
    serverCalls.push({ method: 'from', table })
    const isPartner = table === 'partners'
    const queue = isPartner ? partnerQueue : draftQueue
    const chain = makeServerChain()
    chain.maybeSingle = vi.fn(async () => {
      serverCalls.push({ method: 'maybeSingle' })
      return queue.shift() ?? serverQueue.shift() ?? { data: null, error: null }
    })
    return chain
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
  partnerQueue.length = 0
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
  it('returns `{ kind: "none" }` when no partner row exists', async () => {
    partnerQueue.push({ data: null, error: null })
    draftQueue.push({ data: null, error: null })

    const result = await getMyOnboardingApplicationForThanks()
    expect(result).toEqual({ kind: 'none' })
    expect(fakeServerSupabase.from).toHaveBeenCalledWith('partners')
    expect(fakeServerSupabase.from).toHaveBeenCalledWith('partner_onboarding_drafts')
  })

  it('returns `{ kind: "pending" }` when partner row is pending + draft submitted', async () => {
    partnerQueue.push({
      data: { id: 12345, user_id: 'user-1', status: 'pending', created_at: '2026-06-29T00:00:00Z' },
      error: null,
    })
    draftQueue.push({
      data: { user_id: 'user-1', submitted_at: '2026-06-29T01:23:45Z' },
      error: null,
    })

    const result = await getMyOnboardingApplicationForThanks()
    expect(result).toEqual({
      kind: 'pending',
      partnerId: 12345,
      submittedAt: '2026-06-29T01:23:45Z',
    })
  })

  it('returns `{ kind: "none" }` when pending partner row exists but draft NOT submitted (stuck-state guard)', async () => {
    partnerQueue.push({
      data: { id: 12345, user_id: 'user-1', status: 'pending', created_at: '2026-06-29T00:00:00Z' },
      error: null,
    })
    draftQueue.push({
      data: { user_id: 'user-1', submitted_at: null },
      error: null,
    })

    const result = await getMyOnboardingApplicationForThanks()
    expect(result).toEqual({ kind: 'none' })
  })

  it('returns `{ kind: "none" }` when pending partner row exists but draft row is missing', async () => {
    partnerQueue.push({
      data: { id: 12345, user_id: 'user-1', status: 'pending', created_at: '2026-06-29T00:00:00Z' },
      error: null,
    })
    draftQueue.push({ data: null, error: null })

    const result = await getMyOnboardingApplicationForThanks()
    expect(result).toEqual({ kind: 'none' })
  })

  it('returns `{ kind: "approved" }` for approved partners', async () => {
    partnerQueue.push({
      data: { id: 12345, user_id: 'user-1', status: 'approved', created_at: '2026-06-29T00:00:00Z' },
      error: null,
    })
    draftQueue.push({ data: null, error: null })

    const result = await getMyOnboardingApplicationForThanks()
    expect(result).toEqual({ kind: 'approved', partnerId: 12345 })
  })

  it('returns `{ kind: "suspended" }` for suspended partners', async () => {
    partnerQueue.push({
      data: { id: 12345, user_id: 'user-1', status: 'suspended', created_at: '2026-06-29T00:00:00Z' },
      error: null,
    })
    draftQueue.push({ data: null, error: null })

    const result = await getMyOnboardingApplicationForThanks()
    expect(result).toEqual({ kind: 'suspended', partnerId: 12345 })
  })

  it('returns `{ kind: "none" }` for unknown partner_status strings', async () => {
    partnerQueue.push({
      data: { id: 12345, user_id: 'user-1', status: 'rejected', created_at: '2026-06-29T00:00:00Z' },
      error: null,
    })
    draftQueue.push({ data: null, error: null })

    const result = await getMyOnboardingApplicationForThanks()
    expect(result).toEqual({ kind: 'none' })
  })

  it('returns `{ kind: "none" }` when partner_id is missing or non-numeric', async () => {
    partnerQueue.push({
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

  it('returns `{ kind: "none" }` when partner query errors out', async () => {
    partnerQueue.push({ data: null, error: { message: 'permission denied' } })
    draftQueue.push({ data: null, error: null })

    const result = await getMyOnboardingApplicationForThanks()
    expect(result).toEqual({ kind: 'none' })
  })

  it('treats draft query error as null submitted_at (pending partner still resolves)', async () => {
    partnerQueue.push({
      data: { id: 12345, user_id: 'user-1', status: 'pending', created_at: '2026-06-29T00:00:00Z' },
      error: null,
    })
    draftQueue.push({ data: null, error: { message: 'connection timeout' } })

    // When the draft read fails and submitted_at is null, a pending
    // partner falls through to `{ kind: 'none' }` — fail-closed is
    // safer than rendering a thanks page for a partner whose submit
    // we cannot prove.
    const result = await getMyOnboardingApplicationForThanks()
    expect(result).toEqual({ kind: 'none' })
  })
})

// =====================================================================
// Query shape
// =====================================================================

describe('getMyOnboardingApplicationForThanks — query shape', () => {
  it('scopes both queries by user_id', async () => {
    partnerQueue.push({ data: null, error: null })
    draftQueue.push({ data: null, error: null })

    await getMyOnboardingApplicationForThanks()

    const partnerEq = serverCalls.filter(
      (c) => c.method === 'eq' && (c as { col: string }).col === 'user_id',
    )
    expect(partnerEq.length).toBeGreaterThanOrEqual(2) // one per table
    for (const c of partnerEq) {
      expect((c as { val: unknown }).val).toBe('user-1')
    }
  })

  it('selects only the PII-safe columns from partners', async () => {
    partnerQueue.push({ data: null, error: null })
    draftQueue.push({ data: null, error: null })

    await getMyOnboardingApplicationForThanks()

    const partnerSelect = serverCalls.find(
      (c) =>
        c.method === 'select' &&
        // The order is: from(partners) -> select -> eq -> maybeSingle
        // We can't tell which `from` produced which `select` from
        // serverCalls alone, but we can assert that the partners
        // select payload never includes payout_method or bio.
        typeof (c as { payload: unknown }).payload === 'string',
    )
    expect(partnerSelect).toBeDefined()
    const payload = (partnerSelect as { payload: string }).payload
    expect(payload).not.toContain('payout_method')
    expect(payload).not.toContain('bio')
    expect(payload).not.toContain('tax_form_status')
    expect(payload).not.toContain('royalty_pct_bps')
  })

  it('selects only `user_id, submitted_at` from partner_onboarding_drafts', async () => {
    partnerQueue.push({ data: null, error: null })
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