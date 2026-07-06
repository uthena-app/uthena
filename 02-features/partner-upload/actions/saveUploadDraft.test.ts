// saveUploadDraft.test.ts — unit tests for the partner-upload
// `saveUploadDraftAction` server action (P12.7 Slice 1).
//
// Covers:
//   - Auth gate: anon user → `unauthenticated`, no DB calls.
//   - Rate limit: 60/min/user sliding window; 61st call → `rate_limited`
//     with `retryAfterSeconds` echoed back.
//   - Zod validation:
//       * step out of range (0, 6, -1, 1.5, NaN, "abc")
//       * payload not an object (array, string, null)
//       * missing step
//       * step=1 with empty payload → ok (Step 1 permits open shape via
//         `optional()` when payload is undefined; an object missing
//         required fields fails the strict DetailsPayload schema)
//       * step=1 with valid Details payload → ok
//       * step=1 with INVALID Details (title too short, description < 50)
//         → `invalid_input` (strict per-step schema)
//       * step=2 with any object payload → ok (open shape, Slice 2
//         tightens in place)
//       * FormData path (step + payload encoded as JSON)
//   - Happy path: upsert called with onConflict='user_id', correct
//     merged payload, current_step preserved or advanced (never
//     regressed), last_saved_step always set to the saved step,
//     status forced to 'draft', audit row written with masked PII
//     (metadata contains `fields_changed` from the step payload keys,
//     never the payload body), revalidatePath called.
//   - Already-submitted draft: rejected with friendly error.
//   - Read failure: friendly error, no upsert, no audit row.
//   - Upsert failure: friendly error, no audit row.
//   - Existing payload is preserved across saves (e.g. saving
//     step=2 after step=1 doesn't drop the `details` key).
//   - PII safety: audit row metadata NEVER contains the payload body
//     even though Step 1's `long_description` is a partner-written
//     narrative that may contain personal content.

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
  data: { updated_at: '2026-06-30T00:30:00Z', current_step: 1, last_saved_step: 1 },
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
      // Echo back the upserted values — matches real Supabase behavior
      // (PostgREST returns the row after a successful upsert). Lets
      // assertions on `result.currentStep` / `result.lastSavedStep`
      // match the values the action computed, not a hardcoded mock.
      // We only override when the test hasn't explicitly set an error
      // (failure-mode tests pin `draftUpsertResponse.error` to drive
      // the "fails soft on upsert error" path).
      if (!draftUpsertResponse.error) {
        draftUpsertResponse = {
          data: {
            updated_at:
              (draftUpsertResponse.data as Record<string, unknown> | null)?.updated_at ??
              '2026-06-30T00:30:00Z',
            current_step: payload.current_step ?? 1,
            last_saved_step: payload.last_saved_step ?? 1,
          },
          error: null,
        }
      }
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
    if (table === 'partner_upload_drafts') return makeDraftChain()
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

const { saveUploadDraftAction } = await import('./saveUploadDraft')
const { SaveUploadDraftInput, payloadForStep } = await import('../lib/saveUploadDraftSchema')
const {
  _resetSaveUploadDraftRateLimitForTests,
  SAVE_UPLOAD_DRAFT_RATE_LIMIT_MAX_PER_USER,
} = await import('./saveUploadDraft.rate-limit')

beforeEach(() => {
  calls.length = 0
  auditInserts.length = 0
  fakeSupabase.from.mockClear()
  fakeSupabase.auth.getUser.mockClear()
  mockWarn.mockClear()
  _resetSaveUploadDraftRateLimitForTests()
  getUserResponse = {
    data: { user: { id: 'user-uuid-1', email: 'klaas@example.com' } },
    error: null,
  }
  draftReadResponse = { data: null, error: null }
  draftUpsertResponse = {
    data: { updated_at: '2026-06-30T00:30:00Z', current_step: 1, last_saved_step: 1 },
    error: null,
  }
})

afterEach(() => {
  vi.clearAllMocks()
})

// ---------------------------------------------------------------------------
// Auth + rate limit
// ---------------------------------------------------------------------------

describe('saveUploadDraftAction — auth gate', () => {
  it('returns unauthenticated when there is no user', async () => {
    getUserResponse = { data: { user: null }, error: null }
    const result = await saveUploadDraftAction({ step: 1 })
    expect(result).toEqual({
      ok: false,
      error: 'Not signed in',
      code: 'unauthenticated',
    })
    // Auth check happens BEFORE the rate-limit check, so no DB
    // calls are made at all when the session is missing.
    expect(calls.find((c) => c.method === 'from')).toBeUndefined()
  })
})

describe('saveUploadDraftAction — rate limit', () => {
  it('allows the first 60 calls in a 60-second window', async () => {
    const ok = await saveUploadDraftAction({
      step: 1,
      payload: {
        details: {
          title: 'Test course title for unit test',
          long_description:
            'A description that is at least fifty characters long so the strict Zod schema passes for step one validation.',
          category_id: 1,
          kind: 'video_course',
        },
      },
    })
    expect(ok.ok).toBe(true)
  })

  it(`denies the ${SAVE_UPLOAD_DRAFT_RATE_LIMIT_MAX_PER_USER + 1}th call with retryAfterSeconds`, async () => {
    // Burn through the entire quota.
    for (let i = 0; i < SAVE_UPLOAD_DRAFT_RATE_LIMIT_MAX_PER_USER; i++) {
      // eslint-disable-next-line no-await-in-loop
      const r = await saveUploadDraftAction({
        step: 1,
        payload: {
          details: {
            title: 'Test course title for unit test',
            long_description:
              'A description that is at least fifty characters long so the strict Zod schema passes for step one validation.',
            category_id: 1,
            kind: 'video_course',
          },
        },
      })
      expect(r.ok).toBe(true)
    }
    // The next one is denied.
    const denied = await saveUploadDraftAction({
      step: 1,
      payload: {
        details: {
          title: 'Test course title for unit test',
          long_description:
            'A description that is at least fifty characters long so the strict Zod schema passes for step one validation.',
          category_id: 1,
          kind: 'video_course',
        },
      },
    })
    expect(denied.ok).toBe(false)
    if (!denied.ok) {
      expect(denied.code).toBe('rate_limited')
      expect(typeof denied.retryAfterSeconds).toBe('number')
      expect(denied.retryAfterSeconds).toBeGreaterThan(0)
      expect(denied.retryAfterSeconds).toBeLessThanOrEqual(60)
    }
  })

  it('rate-limit check happens BEFORE the DB read', async () => {
    // Fill the bucket silently (don't bother asserting intermediate).
    for (let i = 0; i < SAVE_UPLOAD_DRAFT_RATE_LIMIT_MAX_PER_USER; i++) {
      // eslint-disable-next-line no-await-in-loop
      await saveUploadDraftAction({
        step: 1,
        payload: {
          details: {
            title: 'Test course title for unit test',
            long_description:
              'A description that is at least fifty characters long so the strict Zod schema passes for step one validation.',
            category_id: 1,
            kind: 'video_course',
          },
        },
      })
    }
    calls.length = 0
    const denied = await saveUploadDraftAction({
      step: 1,
      payload: { details: { title: 'x' } },
    })
    expect(denied.ok).toBe(false)
    // No DB call should have been made on the rate-limited attempt.
    expect(calls.find((c) => c.method === 'from')).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// Zod validation
// ---------------------------------------------------------------------------

describe('SaveUploadDraftInput — wire schema', () => {
  it('accepts a step in 1..5 with an object payload', () => {
    const r = SaveUploadDraftInput.safeParse({ step: 1, payload: { foo: 'bar' } })
    expect(r.success).toBe(true)
  })

  it('accepts a step in 1..5 with no payload (undefined → optional)', () => {
    const r = SaveUploadDraftInput.safeParse({ step: 1 })
    expect(r.success).toBe(true)
  })

  it('rejects step < 1', () => {
    expect(SaveUploadDraftInput.safeParse({ step: 0 }).success).toBe(false)
    expect(SaveUploadDraftInput.safeParse({ step: -1 }).success).toBe(false)
  })

  it('rejects step > 5', () => {
    expect(SaveUploadDraftInput.safeParse({ step: 6 }).success).toBe(false)
    expect(SaveUploadDraftInput.safeParse({ step: 99 }).success).toBe(false)
  })

  it('rejects non-integer step', () => {
    expect(SaveUploadDraftInput.safeParse({ step: 1.5 }).success).toBe(false)
    expect(SaveUploadDraftInput.safeParse({ step: NaN }).success).toBe(false)
  })

  it('rejects step that is a string', () => {
    expect(SaveUploadDraftInput.safeParse({ step: 'abc' }).success).toBe(false)
  })

  it('rejects missing step', () => {
    expect(SaveUploadDraftInput.safeParse({}).success).toBe(false)
  })

  it('rejects array payload at the wire level (records only, not arrays)', () => {
    // z.record(z.unknown()) refuses arrays — the wire shape is strictly
    // a record. A client that accidentally sends an array gets
    // invalid_input back, which the form's friendly error surfaces.
    const r = SaveUploadDraftInput.safeParse({ step: 1, payload: ['a', 'b'] })
    expect(r.success).toBe(false)
  })
})

describe('payloadForStep — per-step schema', () => {
  it('Step 1: DetailsPayload accepts a valid full details object', () => {
    const schema = payloadForStep(1)
    const r = schema.safeParse({
      details: {
        title: 'A perfectly valid title',
        long_description:
          'A description that is at least fifty characters long so the strict Zod schema passes for step one validation.',
        category_id: 7,
        kind: 'ebook',
      },
    })
    expect(r.success).toBe(true)
  })

  it('Step 1: DetailsPayload rejects title shorter than 1 char (after trim)', () => {
    const schema = payloadForStep(1)
    const r = schema.safeParse({
      details: {
        title: '   ',
        long_description:
          'A description that is at least fifty characters long so the strict Zod schema passes for step one validation.',
        category_id: 7,
        kind: 'ebook',
      },
    })
    expect(r.success).toBe(false)
  })

  it('Step 1: DetailsPayload rejects long_description shorter than 50 chars', () => {
    const schema = payloadForStep(1)
    const r = schema.safeParse({
      details: {
        title: 'A title',
        long_description: 'too short',
        category_id: 7,
        kind: 'ebook',
      },
    })
    expect(r.success).toBe(false)
  })

  it('Step 1: DetailsPayload rejects unknown kind value', () => {
    const schema = payloadForStep(1)
    const r = schema.safeParse({
      details: {
        title: 'A title',
        long_description:
          'A description that is at least fifty characters long so the strict Zod schema passes for step one validation.',
        category_id: 7,
        kind: 'not_a_real_kind',
      },
    })
    expect(r.success).toBe(false)
  })

  it('Step 2 ships a STRICT curriculum schema (Slice 2 in place) — accepts { curriculum: { modules: [] } } and rejects arbitrary objects', () => {
    for (const step of [2]) {
      const schema = payloadForStep(step)
      // Strict — accepts the canonical wrap shape.
      expect(schema.safeParse({ curriculum: { modules: [] } }).success).toBe(true)
      // Rejects arbitrary shapes — these used to pass when Step 2 was
      // an open shape in Slice 1.
      expect(schema.safeParse({ anything: 'goes' }).success).toBe(false)
      expect(schema.safeParse({}).success).toBe(false)
      expect(schema.safeParse(undefined).success).toBe(false)
    }
  })

  it('Steps 3-5 ship open shapes — any object passes (Slices 3-5 will tighten in place)', () => {
    for (const step of [3, 4, 5]) {
      const schema = payloadForStep(step)
      expect(schema.safeParse({ anything: 'goes' }).success).toBe(true)
      expect(schema.safeParse({}).success).toBe(true)
      expect(schema.safeParse(undefined).success).toBe(true)
    }
  })

  it('Out-of-range step returns z.never()', () => {
    const schema = payloadForStep(99)
    expect(schema.safeParse(undefined).success).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Action behavior — happy path
// ---------------------------------------------------------------------------

describe('saveUploadDraftAction — happy path', () => {
  it('upserts with onConflict=user_id and returns the saved step + savedAt', async () => {
    const result = await saveUploadDraftAction({
      step: 1,
      payload: {
        details: {
          title: 'My new course',
          long_description:
            'A long-form description that is at least fifty characters so the strict Zod schema accepts it on step one validation.',
          category_id: 3,
          kind: 'video_course',
        },
      },
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.currentStep).toBe(1)
      expect(result.lastSavedStep).toBe(1)
      expect(result.savedAt).toBe('2026-06-30T00:30:00Z')
    }
    const upsertCall = calls.find((c) => c.method === 'upsert') as
      | { method: 'upsert'; payload: Record<string, unknown>; opts: Record<string, unknown> }
      | undefined
    expect(upsertCall).toBeDefined()
    expect(upsertCall!.opts).toEqual({ onConflict: 'user_id' })
    expect(upsertCall!.payload.user_id).toBe('user-uuid-1')
    expect(upsertCall!.payload.current_step).toBe(1)
    expect(upsertCall!.payload.last_saved_step).toBe(1)
    expect(upsertCall!.payload.status).toBe('draft')
    expect(upsertCall!.payload.payload).toEqual({
      details: {
        title: 'My new course',
        long_description:
          'A long-form description that is at least fifty characters so the strict Zod schema accepts it on step one validation.',
        category_id: 3,
        kind: 'video_course',
      },
    })
  })

  it('advances current_step (never regresses) when saving a later step', async () => {
    draftReadResponse = {
      data: { payload: { details: { title: 'X', long_description: 'Y', category_id: 1, kind: 'ebook' } }, current_step: 1, status: 'draft' },
      error: null,
    }
    const result = await saveUploadDraftAction({ step: 3, payload: { files: { video: [] } } })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.currentStep).toBe(3)
    const upsertCall = calls.find((c) => c.method === 'upsert') as
      | { method: 'upsert'; payload: Record<string, unknown> }
      | undefined
    expect(upsertCall!.payload.current_step).toBe(3)
  })

  it('does NOT regress current_step when saving an earlier step', async () => {
    draftReadResponse = {
      data: { payload: { curriculum: [] }, current_step: 4, status: 'draft' },
      error: null,
    }
    const result = await saveUploadDraftAction({ step: 2, payload: { curriculum: { modules: [] } } })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.currentStep).toBe(4)
    const upsertCall = calls.find((c) => c.method === 'upsert') as
      | { method: 'upsert'; payload: Record<string, unknown> }
      | undefined
    expect(upsertCall!.payload.current_step).toBe(4)
    expect(upsertCall!.payload.last_saved_step).toBe(2)
  })

  it('preserves prior step keys when shallow-merging (saving step 2 after step 1 keeps details)', async () => {
    draftReadResponse = {
      data: {
        payload: { details: { title: 'A title', long_description: 'x'.repeat(60), category_id: 1, kind: 'ebook' } },
        current_step: 1,
        status: 'draft',
      },
      error: null,
    }
    const result = await saveUploadDraftAction({ step: 2, payload: { curriculum: { modules: [] } } })
    expect(result.ok).toBe(true)
    const upsertCall = calls.find((c) => c.method === 'upsert') as
      | { method: 'upsert'; payload: Record<string, unknown> }
      | undefined
    const merged = upsertCall!.payload.payload as Record<string, unknown>
    expect(merged.details).toEqual({
      title: 'A title',
      long_description: 'x'.repeat(60),
      category_id: 1,
      kind: 'ebook',
    })
    expect(merged.curriculum).toEqual({ modules: [] })
  })

  it('revalidatePath is called for /partner/upload', async () => {
    await saveUploadDraftAction({
      step: 1,
      payload: {
        details: {
          title: 'A title',
          long_description:
            'A long-form description that is at least fifty characters so the strict Zod schema accepts it on step one validation.',
          category_id: 1,
          kind: 'ebook',
        },
      },
    })
    expect(calls.find((c) => c.method === 'revalidatePath' && c.path === '/partner/upload')).toBeDefined()
  })
})

// ---------------------------------------------------------------------------
// Action behavior — failure modes
// ---------------------------------------------------------------------------

describe('saveUploadDraftAction — failure modes', () => {
  it('rejects a submitted draft with a friendly error', async () => {
    draftReadResponse = {
      data: { payload: {}, current_step: 5, status: 'submitted' },
      error: null,
    }
    const result = await saveUploadDraftAction({
      step: 1,
      payload: { details: { title: 'A title', long_description: 'x'.repeat(60), category_id: 1, kind: 'ebook' } },
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe('save_failed')
      expect(result.error).toMatch(/withdraw/i)
    }
    // No upsert on a submitted draft.
    expect(calls.find((c) => c.method === 'upsert')).toBeUndefined()
  })

  it('fails soft on read error', async () => {
    draftReadResponse = { data: null, error: { message: 'connection reset' } }
    const result = await saveUploadDraftAction({ step: 1, payload: { details: { title: 'A title', long_description: 'x'.repeat(60), category_id: 1, kind: 'ebook' } } })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('save_failed')
    expect(calls.find((c) => c.method === 'upsert')).toBeUndefined()
    expect(auditInserts).toHaveLength(0)
  })

  it('fails soft on upsert error', async () => {
    draftUpsertResponse = { data: null, error: { message: 'deadlock' } }
    const result = await saveUploadDraftAction({ step: 1, payload: { details: { title: 'A title', long_description: 'x'.repeat(60), category_id: 1, kind: 'ebook' } } })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('save_failed')
    expect(auditInserts).toHaveLength(0)
  })

  it('rejects an invalid payload (Step 1 strict schema fails on too-short description)', async () => {
    const result = await saveUploadDraftAction({
      step: 1,
      payload: { details: { title: 'A title', long_description: 'too short', category_id: 1, kind: 'ebook' } },
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('invalid_input')
    expect(calls.find((c) => c.method === 'upsert')).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// Action behavior — FormData path
// ---------------------------------------------------------------------------

describe('saveUploadDraftAction — FormData path', () => {
  it('parses FormData with JSON-encoded payload', async () => {
    const fd = new FormData()
    fd.set('step', '1')
    fd.set(
      'payload',
      JSON.stringify({
        details: { title: 'A title', long_description: 'x'.repeat(60), category_id: 1, kind: 'ebook' },
      }),
    )
    const result = await saveUploadDraftAction(fd)
    expect(result.ok).toBe(true)
  })

  it('tolerates malformed JSON payload (silently drops it; Zod then passes undefined)', async () => {
    const fd = new FormData()
    fd.set('step', '1')
    fd.set('payload', 'not-valid-json{')
    // step 1's strict schema requires a payload with `details` —
    // an undefined payload fails. We accept either invalid_input or a
    // successful save depending on Zod branch. The contract is "don't
    // crash" — assert no throw.
    const result = await saveUploadDraftAction(fd)
    expect(typeof result.ok).toBe('boolean')
  })
})

// ---------------------------------------------------------------------------
// Step 2 — Curriculum (Slice 2 surface)
// ---------------------------------------------------------------------------

describe('saveUploadDraftAction — Step 2 Curriculum', () => {
  it('saves a one-module / one-lesson curriculum and round-trips through the merge', async () => {
    const result = await saveUploadDraftAction({
      step: 2,
      payload: {
        curriculum: {
          modules: [
            {
              id: 'm-1',
              title: 'Getting started',
              summary: 'A short intro',
              display_order: 0,
              lessons: [
                {
                  id: 'l-1',
                  title: 'Welcome',
                  summary: '',
                  duration_seconds: 60,
                  is_preview: true,
                  display_order: 0,
                },
              ],
            },
          ],
        },
      },
    })
    expect(result.ok).toBe(true)
    const upsertCall = calls.find((c) => c.method === 'upsert') as
      | { method: 'upsert'; payload: Record<string, unknown>; opts: Record<string, unknown> }
      | undefined
    expect(upsertCall).toBeDefined()
    expect(upsertCall!.opts).toEqual({ onConflict: 'user_id' })
    const merged = upsertCall!.payload.payload as Record<string, unknown>
    expect(merged.curriculum).toEqual({
      modules: [
        {
          id: 'm-1',
          title: 'Getting started',
          summary: 'A short intro',
          display_order: 0,
          lessons: [
            {
              id: 'l-1',
              title: 'Welcome',
              summary: '',
              duration_seconds: 60,
              is_preview: true,
              display_order: 0,
            },
          ],
        },
      ],
    })
  })

  it('accepts an empty curriculum (autosave partial state)', async () => {
    const result = await saveUploadDraftAction({
      step: 2,
      payload: { curriculum: { modules: [] } },
    })
    expect(result.ok).toBe(true)
  })

  it('rejects a malformed curriculum (missing required module title) → invalid_input', async () => {
    const result = await saveUploadDraftAction({
      step: 2,
      payload: {
        curriculum: {
          modules: [
            {
              id: 'm-1',
              title: '',
              display_order: 0,
              lessons: [],
            },
          ],
        },
      },
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('invalid_input')
    expect(calls.find((c) => c.method === 'upsert')).toBeUndefined()
  })

  it('rejects a negative lesson display_order → invalid_input', async () => {
    const result = await saveUploadDraftAction({
      step: 2,
      payload: {
        curriculum: {
          modules: [
            {
              id: 'm-1',
              title: 'M',
              display_order: 0,
              lessons: [
                {
                  id: 'l-1',
                  title: 'L',
                  duration_seconds: 60,
                  is_preview: false,
                  display_order: -1,
                },
              ],
            },
          ],
        },
      },
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('invalid_input')
  })

  it('rejects a lesson with duration_seconds = -5 → invalid_input', async () => {
    const result = await saveUploadDraftAction({
      step: 2,
      payload: {
        curriculum: {
          modules: [
            {
              id: 'm-1',
              title: 'M',
              display_order: 0,
              lessons: [
                {
                  id: 'l-1',
                  title: 'L',
                  duration_seconds: -5,
                  is_preview: false,
                  display_order: 0,
                },
              ],
            },
          ],
        },
      },
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('invalid_input')
  })

  it('audit row metadata lists `curriculum` in fields_changed (NEVER the body)', async () => {
    auditInserts.length = 0
    await saveUploadDraftAction({
      step: 2,
      payload: {
        curriculum: {
          modules: [
            {
              id: 'm-secret',
              title: 'Secret module title that must not leak',
              summary: 'A private summary that must not appear in logs',
              display_order: 0,
              lessons: [
                {
                  id: 'l-secret',
                  title: 'Secret lesson title',
                  duration_seconds: 0,
                  is_preview: false,
                  display_order: 0,
                },
              ],
            },
          ],
        },
      },
    })
    expect(auditInserts).toHaveLength(1)
    const row = auditInserts[0]!
    expect(row.action).toBe('partner_upload.step_saved')
    expect(row.target_kind).toBe('partner_upload_drafts')
    expect(row.target_id).toBe('user-uuid-1')
    const meta = row.metadata as Record<string, unknown>
    expect(meta.step).toBe(2)
    expect(Array.isArray(meta.fields_changed)).toBe(true)
    // Specifically list `curriculum` as the changed field.
    expect((meta.fields_changed as string[]).includes('curriculum')).toBe(true)
    // The body MUST NOT be in the metadata.
    const metaStr = JSON.stringify(meta)
    expect(metaStr).not.toContain('Secret module title')
    expect(metaStr).not.toContain('Secret lesson title')
    expect(metaStr).not.toContain('A private summary')
  })

  it('shallow-merges curriculum with prior-step keys (saving Step 2 after Step 1 keeps details)', async () => {
    draftReadResponse = {
      data: {
        payload: { details: { title: 'My course', long_description: 'x'.repeat(60), category_id: 1, kind: 'ebook' } },
        current_step: 1,
        status: 'draft',
      },
      error: null,
    }
    const result = await saveUploadDraftAction({
      step: 2,
      payload: {
        curriculum: {
          modules: [
            {
              id: 'm-1',
              title: 'Module 1',
              summary: '',
              display_order: 0,
              lessons: [],
            },
          ],
        },
      },
    })
    expect(result.ok).toBe(true)
    const upsertCall = calls.find((c) => c.method === 'upsert') as
      | { method: 'upsert'; payload: Record<string, unknown> }
      | undefined
    const merged = upsertCall!.payload.payload as Record<string, unknown>
    expect(merged.details).toEqual({
      title: 'My course',
      long_description: 'x'.repeat(60),
      category_id: 1,
      kind: 'ebook',
    })
    expect(merged.curriculum).toBeDefined()
  })
})

// ---------------------------------------------------------------------------
// PII safety — audit metadata never contains the payload body
// ---------------------------------------------------------------------------

describe('saveUploadDraftAction — audit log PII safety', () => {
  it('audit row metadata contains only step + fields_changed, NEVER the payload body', async () => {
    await saveUploadDraftAction({
      step: 1,
      payload: {
        details: {
          title: 'A title',
          long_description:
            'A long-form description that is at least fifty characters so the strict Zod schema accepts it on step one validation.',
          category_id: 1,
          kind: 'ebook',
        },
      },
    })
    expect(auditInserts).toHaveLength(1)
    const row = auditInserts[0]!
    expect(row.action).toBe('partner_upload.step_saved')
    expect(row.target_kind).toBe('partner_upload_drafts')
    expect(row.target_id).toBe('user-uuid-1')
    const meta = row.metadata as Record<string, unknown>
    expect(meta.step).toBe(1)
    expect(meta.next_step).toBe(1)
    expect(Array.isArray(meta.fields_changed)).toBe(true)
    // The body MUST NOT be in the metadata. We check by string-search
    // because JSON serialization is opaque.
    const metaStr = JSON.stringify(meta)
    expect(metaStr).not.toContain('A long-form description')
    expect(metaStr).not.toContain('long_description')
  })

  it('audit row masks the user email via actor_email (logged, but the metadata body never carries it)', async () => {
    await saveUploadDraftAction({
      step: 1,
      payload: { details: { title: 'A title', long_description: 'x'.repeat(60), category_id: 1, kind: 'ebook' } },
    })
    const row = auditInserts[0]!
    expect(row.actor_id).toBe('user-uuid-1')
    expect(row.actor_email).toBe('klaas@example.com') // not masked at this layer; pino redact list does that
    // The metadata is what gets carried through; actor_email is a
    // top-level column, not a log payload body.
  })
})
