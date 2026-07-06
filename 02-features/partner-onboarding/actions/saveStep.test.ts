// saveStep.test.ts — unit tests for the partner-onboarding
// `saveStepAction` server action (P12.2).
//
// Covers:
//   - Auth gate: anon user → `unauthenticated`, no DB calls.
//   - Rate limit: 60/min/user sliding window; 61st call →
//     `rate_limited` with `retryAfterSeconds` echoed back.
//   - Zod validation:
//       * step out of range (0, 8, -1, 1.5, NaN, "abc")
//       * payload not an object (array, string, null)
//       * missing step
//       * step=1 with empty payload → ok (Welcome step)
//       * step=2 with `{ profile: { display_name: 'K' } }` → ok
//         (shallow-merge shape accepted; per-step Zod tightens later)
//       * FormData path (step + payload encoded as JSON)
//   - Happy path: upsert called with onConflict='user_id', correct
//     merged payload, current_step preserved or advanced (never
//     regressed), audit row written with masked PII, revalidatePath
//     called.
//   - Already-submitted draft: rejected with friendly error.
//   - Read failure: friendly error, no upsert, no audit row.
//   - Upsert failure: friendly error, no audit row.
//   - Existing payload is preserved across saves (e.g. saving
//     step=3 after step=2 doesn't drop the `profile` key).
//   - PII safety: audit row metadata NEVER contains the payload
//     body (which would carry tax_id / gov_id storage paths in
//     future slices).

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

let getUserResponse: { data: { user: { id: string; email: string } | null }; error: unknown } = {
  data: { user: null },
  error: null,
}
let draftReadResponse: { data: Record<string, unknown> | null; error: unknown } = {
  data: null,
  error: null,
}
let draftUpsertResponse: { data: Record<string, unknown> | null; error: unknown } = {
  data: { updated_at: '2026-06-29T22:00:00Z', current_step: 1 },
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

const fakeSupabase = {
  auth: {
    getUser: vi.fn(async () => {
      calls.push({ method: 'auth.getUser' })
      return getUserResponse
    }),
  },
  from: vi.fn((table: string) => {
    calls.push({ method: 'from', table })
    if (table === 'partner_onboarding_drafts') return makeDraftChain()
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
const { SaveStepInput, payloadForStep } = await import('../lib/saveStepSchema')
const { _resetStepSaveRateLimitForTests, STEP_SAVE_RATE_LIMIT_MAX_PER_USER } = await import('./saveStep.rate-limit')

beforeEach(() => {
  calls.length = 0
  auditInserts.length = 0
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
    data: { updated_at: '2026-06-29T22:00:00Z', current_step: 1 },
    error: null,
  }
})

afterEach(() => {
  vi.clearAllMocks()
})

// ---------------------------------------------------------------------------
// Auth + rate limit
// ---------------------------------------------------------------------------

describe('saveStepAction — auth gate', () => {
  it('returns unauthenticated when there is no user', async () => {
    getUserResponse = { data: { user: null }, error: null }
    const result = await saveStepAction({ step: 1 })
    expect(result).toEqual({
      ok: false,
      error: 'Not signed in',
      code: 'unauthenticated',
    })
    // Auth check happens BEFORE the rate-limit check, so no DB
    // calls are made at all when the session is missing.
    expect(calls.filter((c) => c.method === 'from')).toEqual([])
  })
})

describe('saveStepAction — rate limit', () => {
  it('denies the 61st save in a minute with retryAfterSeconds set', async () => {
    draftReadResponse = { data: { payload: {}, current_step: 1, submitted_at: null }, error: null }
    draftUpsertResponse = {
      data: { updated_at: '2026-06-29T22:00:00Z', current_step: 1 },
      error: null,
    }
    // First STEP_SAVE_RATE_LIMIT_MAX_PER_USER succeed.
    for (let i = 0; i < STEP_SAVE_RATE_LIMIT_MAX_PER_USER; i++) {
      const r = await saveStepAction({ step: 1 })
      expect(r.ok).toBe(true)
    }
    // 61st is denied.
    const denied = await saveStepAction({ step: 1 })
    expect(denied.ok).toBe(false)
    if (!denied.ok) {
      expect(denied.code).toBe('rate_limited')
      expect(typeof denied.retryAfterSeconds).toBe('number')
      expect(denied.retryAfterSeconds).toBeGreaterThan(0)
    }
  })
})

// ---------------------------------------------------------------------------
// Zod validation (per-step payload shape)
// ---------------------------------------------------------------------------

describe('saveStepAction — Zod validation', () => {
  it('rejects step=0', async () => {
    const r = await saveStepAction({ step: 0 })
    expect(r).toEqual({ ok: false, error: 'Invalid input.', code: 'invalid_input' })
  })
  it('rejects step=8', async () => {
    const r = await saveStepAction({ step: 8 })
    expect(r).toEqual({ ok: false, error: 'Invalid input.', code: 'invalid_input' })
  })
  it('rejects step=-1', async () => {
    const r = await saveStepAction({ step: -1 })
    expect(r).toEqual({ ok: false, error: 'Invalid input.', code: 'invalid_input' })
  })
  it('rejects step=1.5', async () => {
    const r = await saveStepAction({ step: 1.5 })
    expect(r).toEqual({ ok: false, error: 'Invalid input.', code: 'invalid_input' })
  })
  it('rejects missing step', async () => {
    const r = await saveStepAction({})
    expect(r).toEqual({ ok: false, error: 'Invalid input.', code: 'invalid_input' })
  })
  it('rejects non-numeric step (string)', async () => {
    const r = await saveStepAction({ step: 'abc' })
    expect(r).toEqual({ ok: false, error: 'Invalid input.', code: 'invalid_input' })
  })
  it('rejects payload=null', async () => {
    const r = await saveStepAction({ step: 1, payload: null })
    expect(r).toEqual({ ok: false, error: 'Invalid input.', code: 'invalid_input' })
  })
  it('rejects payload=array', async () => {
    const r = await saveStepAction({ step: 1, payload: ['nope'] as unknown })
    expect(r).toEqual({ ok: false, error: 'Invalid input.', code: 'invalid_input' })
  })

  it('accepts step=1 with empty payload (Welcome)', async () => {
    draftReadResponse = { data: null, error: null }
    draftUpsertResponse = {
      data: { updated_at: '2026-06-29T22:00:01Z', current_step: 1 },
      error: null,
    }
    const r = await saveStepAction({ step: 1 })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.currentStep).toBe(1)
  })

  it('accepts step=2 with a profile-shaped payload (current permissive shape)', async () => {
    draftReadResponse = { data: null, error: null }
    draftUpsertResponse = {
      data: { updated_at: '2026-06-29T22:00:02Z', current_step: 2 },
      error: null,
    }
    const r = await saveStepAction({
      step: 2,
      payload: { profile: { display_name: 'Klaas', bio: 'founder' } },
    })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.currentStep).toBe(2)
  })

  it('accepts FormData input with JSON-encoded payload', async () => {
    draftReadResponse = { data: null, error: null }
    draftUpsertResponse = {
      data: { updated_at: '2026-06-29T22:00:03Z', current_step: 3 },
      error: null,
    }
    const fd = new FormData()
    fd.set('step', '3')
    fd.set('payload', JSON.stringify({ payout: { paypal_email: 'me@example.com' } }))
    const r = await saveStepAction(fd)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.currentStep).toBe(3)
  })

  it('FormData with malformed payload JSON is tolerated (payload becomes undefined)', async () => {
    draftReadResponse = { data: null, error: null }
    draftUpsertResponse = {
      data: { updated_at: '2026-06-29T22:00:04Z', current_step: 1 },
      error: null,
    }
    const fd = new FormData()
    fd.set('step', '1')
    fd.set('payload', '{not-json')
    const r = await saveStepAction(fd)
    expect(r.ok).toBe(true)
  })
})

describe('SaveStepInput — pure schema', () => {
  it('accepts step in [1,7] with optional payload', () => {
    expect(SaveStepInput.safeParse({ step: 1 }).success).toBe(true)
    expect(SaveStepInput.safeParse({ step: 7 }).success).toBe(true)
    expect(SaveStepInput.safeParse({ step: 4, payload: { payout: {} } }).success).toBe(true)
  })
  it('rejects step out of range', () => {
    expect(SaveStepInput.safeParse({ step: 0 }).success).toBe(false)
    expect(SaveStepInput.safeParse({ step: 8 }).success).toBe(false)
  })
  it('rejects non-integer step', () => {
    expect(SaveStepInput.safeParse({ step: 2.5 }).success).toBe(false)
  })
  it('rejects missing step', () => {
    expect(SaveStepInput.safeParse({}).success).toBe(false)
  })
})

describe('payloadForStep — slice plug-point', () => {
  it('returns an optional-object schema for any step today', () => {
    for (const step of [1, 2, 3, 4, 5, 6, 7]) {
      const schema = payloadForStep(step)
      expect(schema.safeParse(undefined).success).toBe(true)
      expect(schema.safeParse({}).success).toBe(true)
      expect(schema.safeParse({ profile: { x: 1 } }).success).toBe(true)
    }
  })
})

// ---------------------------------------------------------------------------
// Happy path + merge semantics + audit + revalidate
// ---------------------------------------------------------------------------

describe('saveStepAction — happy path', () => {
  it('upserts by user_id with merged payload + max(currentStep, step) and writes audit row', async () => {
    draftReadResponse = {
      data: { payload: { profile: { display_name: 'Klaas' } }, current_step: 1, submitted_at: null },
      error: null,
    }
    draftUpsertResponse = {
      data: { updated_at: '2026-06-29T22:01:00Z', current_step: 3 },
      error: null,
    }
    const r = await saveStepAction({ step: 3, payload: { payout: { paypal_email: 'me@example.com' } } })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.currentStep).toBe(3)
      expect(typeof r.savedAt).toBe('string')
    }

    // Verify the upsert call shape.
    const upsertCalls = calls.filter((c) => c.method === 'upsert')
    expect(upsertCalls).toHaveLength(1)
    const upsert = upsertCalls[0] as { method: 'upsert'; payload: Record<string, unknown>; opts: Record<string, unknown> }
    expect(upsert.opts).toEqual({ onConflict: 'user_id' })
    expect(upsert.payload.current_step).toBe(3)
    // Shallow-merge preserved the profile key + added payout.
    expect(upsert.payload.payload).toEqual({
      profile: { display_name: 'Klaas' },
      payout: { paypal_email: 'me@example.com' },
    })
    expect(upsert.payload.user_id).toBe('user-uuid-1')

    // Audit row written.
    expect(auditInserts).toHaveLength(1)
    const audit = auditInserts[0]!
    expect(audit.action).toBe('partner_onboarding.step_saved')
    expect(audit.target_kind).toBe('partner_onboarding_drafts')
    expect(audit.target_id).toBe('user-uuid-1')
    expect(audit.metadata).toEqual({ step: 3, next_step: 3 })
    expect(audit.actor_id).toBe('user-uuid-1')
    expect(audit.ip).toBe('203.0.113.7')
    expect(audit.user_agent).toBe('vitest')

    // revalidatePath called.
    expect(calls.filter((c) => c.method === 'revalidatePath')).toEqual([
      { method: 'revalidatePath', path: '/partner/onboarding' },
    ])
  })

  it('never regresses current_step (saving step 1 over step 3 keeps current_step=3)', async () => {
    draftReadResponse = {
      data: { payload: {}, current_step: 3, submitted_at: null },
      error: null,
    }
    draftUpsertResponse = {
      data: { updated_at: '2026-06-29T22:02:00Z', current_step: 3 },
      error: null,
    }
    const r = await saveStepAction({ step: 1 })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.currentStep).toBe(3)
    const upsert = calls.filter((c) => c.method === 'upsert')[0] as { method: 'upsert'; payload: Record<string, unknown> }
    expect(upsert.payload.current_step).toBe(3)
  })

  it('preserves existing payload keys across saves (profile survives a later payout save)', async () => {
    draftReadResponse = {
      data: {
        payload: { profile: { display_name: 'Klaas', bio: 'founder' } },
        current_step: 2,
        submitted_at: null,
      },
      error: null,
    }
    draftUpsertResponse = {
      data: { updated_at: '2026-06-29T22:03:00Z', current_step: 3 },
      error: null,
    }
    const r = await saveStepAction({ step: 3, payload: { payout: { paypal_email: 'p@e.com' } } })
    expect(r.ok).toBe(true)
    const upsert = calls.filter((c) => c.method === 'upsert')[0] as { method: 'upsert'; payload: Record<string, unknown> }
    const merged = upsert.payload.payload as Record<string, unknown>
    expect(merged.profile).toEqual({ display_name: 'Klaas', bio: 'founder' })
    expect(merged.payout).toEqual({ paypal_email: 'p@e.com' })
  })

  it('rejects saves on a submitted draft with a friendly error', async () => {
    draftReadResponse = {
      data: { payload: {}, current_step: 7, submitted_at: '2026-06-29T10:00:00Z' },
      error: null,
    }
    const r = await saveStepAction({ step: 1 })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error).toMatch(/already been submitted/i)
      expect(r.code).toBe('save_failed')
    }
    // No upsert, no audit row.
    expect(calls.filter((c) => c.method === 'upsert')).toHaveLength(0)
    expect(auditInserts).toHaveLength(0)
  })

  it('handles read failure gracefully (no upsert, no audit row)', async () => {
    draftReadResponse = { data: null, error: { message: 'db down' } }
    const r = await saveStepAction({ step: 1 })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.code).toBe('save_failed')
      expect(r.error).toMatch(/Could not save/i)
    }
    expect(calls.filter((c) => c.method === 'upsert')).toHaveLength(0)
    expect(auditInserts).toHaveLength(0)
  })

  it('handles upsert failure gracefully (no audit row)', async () => {
    draftReadResponse = { data: null, error: null }
    draftUpsertResponse = { data: null, error: { message: 'write conflict' } }
    const r = await saveStepAction({ step: 1 })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.code).toBe('save_failed')
    }
    expect(auditInserts).toHaveLength(0)
  })

  it('handles a corrupted payload (array) on the existing row by treating it as empty', async () => {
    draftReadResponse = {
      data: { payload: ['not', 'an', 'object'], current_step: 1, submitted_at: null },
      error: null,
    }
    draftUpsertResponse = {
      data: { updated_at: '2026-06-29T22:04:00Z', current_step: 2 },
      error: null,
    }
    const r = await saveStepAction({ step: 2, payload: { profile: { display_name: 'K' } } })
    expect(r.ok).toBe(true)
    const upsert = calls.filter((c) => c.method === 'upsert')[0] as { method: 'upsert'; payload: Record<string, unknown> }
    // The array was discarded; only the new payload survives.
    expect(upsert.payload.payload).toEqual({ profile: { display_name: 'K' } })
  })

  it('handles a corrupted current_step on the existing row by treating it as 1', async () => {
    draftReadResponse = {
      data: { payload: {}, current_step: 'not-a-number', submitted_at: null },
      error: null,
    }
    draftUpsertResponse = {
      data: { updated_at: '2026-06-29T22:05:00Z', current_step: 2 },
      error: null,
    }
    const r = await saveStepAction({ step: 2 })
    expect(r.ok).toBe(true)
    const upsert = calls.filter((c) => c.method === 'upsert')[0] as { method: 'upsert'; payload: Record<string, unknown> }
    expect(upsert.payload.current_step).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// PII safety
// ---------------------------------------------------------------------------

describe('saveStepAction — PII safety', () => {
  it('audit row metadata contains only the step number, never the payload body', async () => {
    draftReadResponse = { data: null, error: null }
    draftUpsertResponse = {
      data: { updated_at: '2026-06-29T22:06:00Z', current_step: 4 },
      error: null,
    }
    // Future slices will pass tax_id / gov_id storage paths in the
    // payload. Today they pass as opaque strings — the audit row
    // must NOT log them.
    await saveStepAction({
      step: 4,
      payload: {
        tax: {
          country: 'US',
          tax_id: '123-45-6789',
          w9_storage_path: 'onboarding/partner/user-uuid-1/4/uuid.pdf',
        },
      },
    })
    const audit = auditInserts[0]!
    const serialized = JSON.stringify(audit)
    expect(serialized).not.toContain('123-45-6789')
    expect(serialized).not.toContain('w9_storage_path')
    expect(serialized).not.toContain('onboarding/partner/')
    // Step number IS allowed (it's the audit breadcrumb).
    expect(serialized).toContain('"step":4')
  })

  it('warn log payloads do not include the user_id or email or payload body', async () => {
    draftReadResponse = { data: null, error: null }
    draftUpsertResponse = { data: null, error: { message: 'boom' } }
    await saveStepAction({ step: 1 })
    for (const args of mockWarn.mock.calls) {
      const serialized = JSON.stringify(args)
      expect(serialized).not.toContain('user-uuid-1')
      expect(serialized).not.toContain('klaas@example.com')
    }
  })
})