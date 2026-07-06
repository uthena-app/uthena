// saveStep.test.ts — unit tests for the affiliate-onboarding
// `saveStepAction` server action (P13.1).
//
// Covers:
//   - Auth gate: anon user → `unauthenticated`, no DB calls.
//   - Rate limit: 60/min/user sliding window; 61st call →
//     `rate_limited` with `retryAfterSeconds` echoed back.
//   - Zod validation: unknown step, missing step, malformed payloads,
//     missing required fields per step.
//   - Reserved-handle rejection (admin / partner / library etc.).
//   - Handle reservation race-safety: PG 23505 → `handle_conflict`.
//   - Handle re-reservation: same user editing bio on same handle is
//     idempotent (no spurious 23505).
//   - Already-submitted draft: rejected with friendly error.
//   - Read failure + upsert failure paths.
//   - Per-step column shallow-merge (handle_bio save doesn't clobber
//     payout).
//   - Never regress currentStep.
//   - Audit row written with masked PII (metadata has only
//     {step, next_step}; never the payload body).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Call =
  | { method: 'from'; table: string }
  | { method: 'select'; payload: string | undefined }
  | { method: 'eq'; col: string; val: unknown }
  | { method: 'maybeSingle' }
  | { method: 'single' }
  | { method: 'upsert'; payload: Record<string, unknown>; opts: Record<string, unknown> }
  | { method: 'auth.getUser' }
  | { method: 'revalidatePath'; path: string }
  | { method: 'insert'; payload: Record<string, unknown> }

const calls: Call[] = []
const auditInserts: Array<Record<string, unknown>> = []
const reservationInserts: Array<Record<string, unknown>> = []
const reservationSelects: Array<{ handle: string; user_id: string }> = []

let getUserResponse: { data: { user: { id: string; email: string } | null }; error: unknown } = {
  data: { user: null },
  error: null,
}
let draftReadResponse: { data: Record<string, unknown> | null; error: unknown } = {
  data: null,
  error: null,
}
let draftUpsertResponse: { data: Record<string, unknown> | null; error: unknown } = {
  data: { updated_at: '2026-06-30T00:00:00Z', current_step: 'welcome' },
  error: null,
}
let reservationReadResponse: { data: Record<string, unknown> | null; error: unknown } = {
  data: null,
  error: null,
}
let reservationInsertResponse: { error: unknown } = {
  error: null,
}

function makeDraftChain() {
  const chain: any = {
    select(payload?: string) {
      calls.push({ method: 'select', payload })
      return chain
    },
    eq(col: string, val: unknown) {
      calls.push({ method: 'eq', col, val })
      return chain
    },
    maybeSingle: vi.fn(async () => {
      calls.push({ method: 'maybeSingle' })
      return draftReadResponse
    }),
    upsert(payload: Record<string, unknown>, opts: Record<string, unknown>) {
      calls.push({ method: 'upsert', payload, opts })
      return chain
    },
    single: vi.fn(async () => {
      calls.push({ method: 'single' })
      return draftUpsertResponse
    }),
  }
  return chain
}

function makeReservationReadChain() {
  const chain: any = {
    select() {
      calls.push({ method: 'select', payload: 'handle, user_id' })
      return chain
    },
    eq(col: string, val: unknown) {
      calls.push({ method: 'eq', col, val })
      return chain
    },
    maybeSingle: vi.fn(async () => {
      calls.push({ method: 'maybeSingle' })
      if (reservationReadResponse.data) {
        reservationSelects.push({
          handle: reservationReadResponse.data.handle as string,
          user_id: reservationReadResponse.data.user_id as string,
        })
      }
      return reservationReadResponse
    }),
  }
  return chain
}

function makeReservationInsertChain() {
  const chain: any = {
    insert(payload: Record<string, unknown>) {
      calls.push({ method: 'insert', payload })
      reservationInserts.push(payload)
      return {
        // Make the chain thenable so `await supabase.from(...).insert(...)`
        // resolves to the configured response.
        then: (resolve: (v: unknown) => void) => {
          resolve(reservationInsertResponse)
        },
      }
    },
  }
  return chain
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
    if (table === 'affiliate_onboarding_drafts') return makeDraftChain()
    if (table === 'handle_reservations') {
      // Two distinct operations: read vs insert. We dispatch on which
      // method is called first.
      // Default to the read chain; insert() swaps to the insert chain.
      let dispatch: any = makeReservationReadChain()
      return new Proxy(
        {},
        {
          get(_t, prop) {
            if (prop === 'insert') {
              dispatch = makeReservationInsertChain()
              return dispatch.insert
            }
            return dispatch[prop]
          },
        },
      )
    }
    // admin_audit_log (service-role) — collect inserts.
    if (table === 'admin_audit_log') {
      return {
        insert: vi.fn((payload: Record<string, unknown>) => {
          calls.push({ method: 'insert', payload })
          auditInserts.push(payload)
          return {
            select: vi.fn(() => ({
              single: vi.fn(async () => ({ data: { id: 99 }, error: null })),
            })),
          }
        }),
      }
    }
    return makeDraftChain()
  }),
}

vi.mock('@foundations/data/supabase', () => ({
  getServerSupabase: vi.fn(async () => fakeSupabase),
  getServiceSupabase: vi.fn(() => fakeSupabase),
}))

const mockWarn = vi.fn()
vi.mock('@foundations/log/pino', () => ({
  loggerFor: () => ({
    info: vi.fn(),
    warn: (...args: unknown[]) => mockWarn(...args),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn((path: string) => {
    calls.push({ method: 'revalidatePath', path })
  }),
}))

vi.mock('next/headers', () => ({
  headers: vi.fn(async () => ({
    get: (k: string) => (k === 'x-forwarded-for' ? '203.0.113.7' : k === 'user-agent' ? 'vitest' : null),
  })),
}))

const { saveStepAction } = await import('./saveStep')
const { _resetStepSaveRateLimitForTests, STEP_SAVE_RATE_LIMIT_MAX_PER_USER } = await import(
  './saveStep.rate-limit'
)

beforeEach(() => {
  calls.length = 0
  auditInserts.length = 0
  reservationInserts.length = 0
  reservationSelects.length = 0
  fakeSupabase.from.mockClear()
  fakeSupabase.auth.getUser.mockClear()
  mockWarn.mockClear()
  _resetStepSaveRateLimitForTests()
  getUserResponse = {
    data: { user: { id: 'user-uuid-1', email: 'klaas@example.com' } },
    error: null,
  }
  draftReadResponse = { data: null, error: null }
  draftUpsertResponse = {
    data: { updated_at: '2026-06-30T00:00:00Z', current_step: 'welcome' },
    error: null,
  }
  reservationReadResponse = { data: null, error: null }
  reservationInsertResponse = { error: null }
})

afterEach(() => {
  vi.clearAllMocks()
})

// ============================================================================
// Auth + rate limit
// ============================================================================

describe('saveStepAction — auth gate', () => {
  it('returns unauthenticated when there is no user', async () => {
    getUserResponse = { data: { user: null }, error: null }
    const result = await saveStepAction({ step: 'welcome' })
    expect(result).toEqual({
      ok: false,
      error: 'Not signed in',
      code: 'unauthenticated',
    })
    expect(calls.filter((c) => c.method === 'from')).toEqual([])
  })
})

describe('saveStepAction — rate limit', () => {
  it('denies the 61st save in a minute with retryAfterSeconds set', async () => {
    draftReadResponse = {
      data: {
        id: 1,
        current_step: 'welcome',
        handle_bio: {},
        payout: {},
        promo_methods: {},
        agreement: {},
        submitted_at: null,
      },
      error: null,
    }
    draftUpsertResponse = {
      data: { updated_at: '2026-06-30T00:00:00Z', current_step: 'welcome' },
      error: null,
    }
    for (let i = 0; i < STEP_SAVE_RATE_LIMIT_MAX_PER_USER; i++) {
      const r = await saveStepAction({ step: 'welcome' })
      expect(r.ok).toBe(true)
    }
    const denied = await saveStepAction({ step: 'welcome' })
    expect(denied.ok).toBe(false)
    if (!denied.ok) {
      expect(denied.code).toBe('rate_limited')
      expect(typeof denied.retryAfterSeconds).toBe('number')
      expect(denied.retryAfterSeconds).toBeGreaterThan(0)
    }
  })
})

// ============================================================================
// Zod validation — step name + per-step payload shape
// ============================================================================

describe('saveStepAction — Zod validation', () => {
  it('rejects an unknown step name', async () => {
    const r = await saveStepAction({ step: 'unknown-step' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('invalid_input')
  })

  it('rejects a missing step', async () => {
    const r = await saveStepAction({})
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('invalid_input')
  })

  it('rejects a non-string step', async () => {
    const r = await saveStepAction({ step: 1 })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('invalid_input')
  })

  it('accepts step=welcome with no payload (step 1 has no form data)', async () => {
    const r = await saveStepAction({ step: 'welcome' })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.currentStep).toBe('welcome')
  })

  it('rejects step=handle_bio with missing handle', async () => {
    const r = await saveStepAction({ step: 'handle_bio', payload: { bio: 'cool' } })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('invalid_input')
  })

  it('rejects step=handle_bio with reserved handle (admin)', async () => {
    const r = await saveStepAction({ step: 'handle_bio', payload: { handle: 'admin' } })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.code).toBe('handle_reserved')
      expect(r.error).toMatch(/reserved/i)
    }
  })

  it('rejects step=handle_bio with reserved handle (partner, library, uthena)', async () => {
    for (const reserved of ['partner', 'library', 'uthena', 'affiliate', 'www', 'help']) {
      const r = await saveStepAction({ step: 'handle_bio', payload: { handle: reserved } })
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.code).toBe('handle_reserved')
    }
  })

  it('rejects step=handle_bio with uppercase handle (shape check)', async () => {
    const r = await saveStepAction({ step: 'handle_bio', payload: { handle: 'Alice' } })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      // Shape failure surfaces as invalid_input, not handle_reserved.
      expect(r.code).toBe('invalid_input')
    }
  })

  it('rejects step=payout with mismatched emails', async () => {
    const r = await saveStepAction({
      step: 'payout',
      payload: {
        paypal_email: 'a@example.com',
        paypal_email_confirm: 'b@example.com',
      },
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('invalid_input')
  })

  it('rejects step=agreement when affiliate_terms_accepted is false', async () => {
    const r = await saveStepAction({
      step: 'agreement',
      payload: { affiliate_terms_accepted: false, tos_accepted: true },
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('invalid_input')
  })

  it('rejects FormData with malformed JSON payload (tolerated → invalid step payload)', async () => {
    const fd = new FormData()
    fd.set('step', 'handle_bio')
    fd.set('payload', '{not json')
    const r = await saveStepAction(fd)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('invalid_input')
  })
})

// ============================================================================
// Handle reservation race-safety
// ============================================================================

describe('saveStepAction — handle reservation', () => {
  it('reserves the handle at step 2 (handle_bio) on first save', async () => {
    draftReadResponse = {
      data: {
        id: 7,
        current_step: 'handle_bio',
        handle_bio: {},
        payout: {},
        promo_methods: {},
        agreement: {},
        submitted_at: null,
      },
      error: null,
    }
    draftUpsertResponse = {
      data: { updated_at: '2026-06-30T00:00:00Z', current_step: 'handle_bio' },
      error: null,
    }
    const r = await saveStepAction({
      step: 'handle_bio',
      payload: { handle: 'alice', bio: 'cool' },
    })
    expect(r.ok).toBe(true)
    expect(reservationInserts).toHaveLength(1)
    expect(reservationInserts[0]).toMatchObject({
      handle: 'alice',
      user_id: 'user-uuid-1',
      draft_id: 7,
    })
  })

  it('does NOT reserve the handle on non-handle steps (e.g. payout)', async () => {
    const r = await saveStepAction({
      step: 'payout',
      payload: {
        paypal_email: 'a@example.com',
        paypal_email_confirm: 'a@example.com',
      },
    })
    expect(r.ok).toBe(true)
    expect(reservationInserts).toHaveLength(0)
  })

  it('maps PG 23505 (unique violation) to handle_conflict', async () => {
    draftReadResponse = {
      data: {
        id: 7,
        current_step: 'handle_bio',
        handle_bio: {},
        payout: {},
        promo_methods: {},
        agreement: {},
        submitted_at: null,
      },
      error: null,
    }
    reservationInsertResponse = {
      error: { code: '23505', message: 'duplicate key value violates unique constraint' },
    }
    const r = await saveStepAction({
      step: 'handle_bio',
      payload: { handle: 'alice' },
    })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.code).toBe('handle_conflict')
      expect(r.handleConflict).toBe(true)
      expect(r.error).toMatch(/taken/i)
    }
  })

  it('does NOT upsert the draft when the reservation collides (user can re-pick cleanly)', async () => {
    draftReadResponse = {
      data: {
        id: 7,
        current_step: 'welcome',
        handle_bio: {},
        payout: {},
        promo_methods: {},
        agreement: {},
        submitted_at: null,
      },
      error: null,
    }
    reservationInsertResponse = { error: { code: '23505', message: 'duplicate' } }
    const r = await saveStepAction({
      step: 'handle_bio',
      payload: { handle: 'alice' },
    })
    expect(r.ok).toBe(false)
    // No draft upsert attempted (the upsert call would push a 'upsert'
    // entry into `calls`).
    expect(calls.some((c) => c.method === 'upsert')).toBe(false)
  })

  it('idempotent re-save on same handle skips the reservation insert', async () => {
    // Pre-existing reservation for the same (handle, user_id) pair.
    reservationReadResponse = {
      data: { handle: 'alice', user_id: 'user-uuid-1' },
      error: null,
    }
    draftReadResponse = {
      data: {
        id: 7,
        current_step: 'handle_bio',
        handle_bio: { handle: 'alice', bio: 'old bio' },
        payout: {},
        promo_methods: {},
        agreement: {},
        submitted_at: null,
      },
      error: null,
    }
    const r = await saveStepAction({
      step: 'handle_bio',
      payload: { handle: 'alice', bio: 'updated bio' },
    })
    expect(r.ok).toBe(true)
    expect(reservationInserts).toHaveLength(0)
  })
})

// ============================================================================
// Submitted-draft freeze
// ============================================================================

describe('saveStepAction — submitted-draft freeze', () => {
  it('refuses to save on a submitted draft', async () => {
    draftReadResponse = {
      data: {
        id: 7,
        current_step: 'submit',
        handle_bio: { handle: 'alice' },
        payout: { paypal_email: 'a@example.com' },
        promo_methods: {},
        agreement: {},
        submitted_at: '2026-06-29T15:00:00Z',
      },
      error: null,
    }
    const r = await saveStepAction({
      step: 'handle_bio',
      payload: { handle: 'alice', bio: 'edit after submit' },
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('submitted')
    // No upsert attempted.
    expect(calls.some((c) => c.method === 'upsert')).toBe(false)
  })
})

// ============================================================================
// Per-step column shallow-merge
// ============================================================================

describe('saveStepAction — per-step column merge', () => {
  it('does NOT clobber payout when saving handle_bio', async () => {
    draftReadResponse = {
      data: {
        id: 7,
        current_step: 'handle_bio',
        handle_bio: {},
        payout: { paypal_email: 'alice@example.com' },
        promo_methods: {},
        agreement: {},
        submitted_at: null,
      },
      error: null,
    }
    const r = await saveStepAction({
      step: 'handle_bio',
      payload: { handle: 'alice', bio: 'new bio' },
    })
    expect(r.ok).toBe(true)
    const upsertCall = calls.find((c) => c.method === 'upsert') as
      | { method: 'upsert'; payload: Record<string, unknown> }
      | undefined
    expect(upsertCall).toBeDefined()
    expect(upsertCall?.payload.payout).toEqual({ paypal_email: 'alice@example.com' })
    expect(upsertCall?.payload.handle_bio).toEqual({ handle: 'alice', bio: 'new bio' })
  })

  it('does NOT clobber handle_bio when saving payout', async () => {
    draftReadResponse = {
      data: {
        id: 7,
        current_step: 'payout',
        handle_bio: { handle: 'alice', bio: 'cool' },
        payout: {},
        promo_methods: {},
        agreement: {},
        submitted_at: null,
      },
      error: null,
    }
    const r = await saveStepAction({
      step: 'payout',
      payload: {
        paypal_email: 'alice@example.com',
        paypal_email_confirm: 'alice@example.com',
      },
    })
    expect(r.ok).toBe(true)
    const upsertCall = calls.find((c) => c.method === 'upsert') as
      | { method: 'upsert'; payload: Record<string, unknown> }
      | undefined
    expect(upsertCall?.payload.handle_bio).toEqual({ handle: 'alice', bio: 'cool' })
    expect(upsertCall?.payload.payout).toEqual({
      paypal_email: 'alice@example.com',
      paypal_email_confirm: 'alice@example.com',
    })
  })

  it('never regresses current_step (saving earlier step does not push back)', async () => {
    draftReadResponse = {
      data: {
        id: 7,
        current_step: 'agreement', // user is further along
        handle_bio: { handle: 'alice' },
        payout: { paypal_email: 'alice@example.com' },
        promo_methods: {},
        agreement: {},
        submitted_at: null,
      },
      error: null,
    }
    const r = await saveStepAction({
      step: 'welcome', // earlier step
    })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.currentStep).toBe('agreement')
  })

  it('advances current_step when saving a later step', async () => {
    draftReadResponse = {
      data: {
        id: 7,
        current_step: 'welcome',
        handle_bio: {},
        payout: {},
        promo_methods: {},
        agreement: {},
        submitted_at: null,
      },
      error: null,
    }
    const r = await saveStepAction({
      step: 'handle_bio',
      payload: { handle: 'alice' },
    })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.currentStep).toBe('handle_bio')
  })
})

// ============================================================================
// Audit log + revalidatePath
// ============================================================================

describe('saveStepAction — audit + revalidate', () => {
  it('writes one audit row with target_kind=affiliate_onboarding_drafts', async () => {
    draftReadResponse = {
      data: {
        id: 7,
        current_step: 'welcome',
        handle_bio: {},
        payout: {},
        promo_methods: {},
        agreement: {},
        submitted_at: null,
      },
      error: null,
    }
    const r = await saveStepAction({ step: 'welcome' })
    expect(r.ok).toBe(true)
    expect(auditInserts).toHaveLength(1)
    expect(auditInserts[0]).toMatchObject({
      actor_id: 'user-uuid-1',
      target_kind: 'affiliate_onboarding_drafts',
      target_id: 'user-uuid-1',
    })
  })

  it('NEVER includes the payload body in audit metadata (PII safety)', async () => {
    draftReadResponse = {
      data: {
        id: 7,
        current_step: 'handle_bio',
        handle_bio: {},
        payout: {},
        promo_methods: {},
        agreement: {},
        submitted_at: null,
      },
      error: null,
    }
    const r = await saveStepAction({
      step: 'handle_bio',
      payload: {
        handle: 'alice',
        bio: 'My super-private bio that must never reach the audit log',
      },
    })
    expect(r.ok).toBe(true)
    expect(auditInserts).toHaveLength(1)
    const metadata = auditInserts[0]!.metadata as Record<string, unknown>
    // The audit metadata must contain ONLY step + next_step.
    expect(Object.keys(metadata).sort()).toEqual(['next_step', 'step'])
    // The bio / handle / paypal_email must NEVER appear in metadata.
    expect(JSON.stringify(metadata)).not.toMatch(/super-private/)
    expect(JSON.stringify(metadata)).not.toMatch(/alice/)
  })

  it('revalidates /affiliate/onboarding', async () => {
    draftReadResponse = {
      data: {
        id: 7,
        current_step: 'welcome',
        handle_bio: {},
        payout: {},
        promo_methods: {},
        agreement: {},
        submitted_at: null,
      },
      error: null,
    }
    await saveStepAction({ step: 'welcome' })
    expect(calls.some((c) => c.method === 'revalidatePath' && c.path === '/affiliate/onboarding')).toBe(true)
  })
})

// ============================================================================
// Failure paths
// ============================================================================

describe('saveStepAction — failure paths', () => {
  it('returns save_failed when the draft read errors', async () => {
    draftReadResponse = { data: null, error: { message: 'permission denied' } }
    const r = await saveStepAction({ step: 'welcome' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('save_failed')
  })

  it('returns save_failed when the draft upsert errors (no audit row written)', async () => {
    draftReadResponse = {
      data: {
        id: 7,
        current_step: 'welcome',
        handle_bio: {},
        payout: {},
        promo_methods: {},
        agreement: {},
        submitted_at: null,
      },
      error: null,
    }
    draftUpsertResponse = { data: null, error: { message: 'constraint violation' } }
    const r = await saveStepAction({ step: 'welcome' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('save_failed')
    // No audit row written.
    expect(auditInserts).toHaveLength(0)
  })
})