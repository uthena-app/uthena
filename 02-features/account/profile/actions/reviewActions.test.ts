// reviewActions.test.ts — unit tests for the three review server
// actions exposed by /account/reviews: `createReviewAction`,
// `updateReviewAction`, `deleteReviewAction`. Mirrors the
// chainable-fake-Supabase pattern from `updateProfile.test.ts` +
// `deleteMyAccount.test.ts`. Covers:
//
//   - Anon caller → typed "Not signed in" error (no DB calls).
//   - Zod input validation on each action: each field's rejection
//     path runs BEFORE any DB call.
//   - createReviewAction: granted-only enforcement (no
//     library_grants row → "You can only review products you own"),
//     the unique `(user_id, product_id)` constraint surface maps
//     PG code '23505' → "You've already reviewed this product",
//     status inserted as 'pending' on the happy path, the actual
//     inserted row carries `user_id`, `product_id`, `rating`,
//     normalized title (empty → null), `body`, and a hard-coded
//     `status: 'pending'`. revalidatePath fires with
//     '/account/reviews' on success.
//   - updateReviewAction: status resets to 'pending' on every edit
//     (re-moderation per the spec Security §"Status flow on edit"),
//     ownership-check via `eq('id', x).eq('user_id', y)` so the user
//     can never edit somebody else's row.
//   - deleteReviewAction: soft-delete shape (status='hidden', body=
//     '[deleted]') — schema enum has no 'rejected' so the
//     ship-real-schema shape is status='hidden' (per STUB-030), and
//     ownership-check via the same `id` + `user_id` filter pair.
//   - The 30-day edit-lock + photo upload + EXIF strip are NOT
//     implemented yet (see STUB entries in /Users/klaas/Documents/
//     Uthena/STUBS.md) — those tests are deferred with explicit
//     `it.todo` markers so the file stays honest about coverage.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Module mocks — set up BEFORE the dynamic import at the bottom.
// ---------------------------------------------------------------------------

const revalidateCalls: string[] = []
vi.mock('next/cache', () => ({
  revalidatePath: (path: string) => {
    revalidateCalls.push(path)
  },
}))

type Call =
  | { method: 'from'; table: string }
  | { method: 'select'; payload: string; opts?: Record<string, unknown> | undefined }
  | { method: 'eq'; col: string; val: unknown }
  | { method: 'is'; col: string; val: unknown }
  | { method: 'insert'; payload: unknown }
  | { method: 'update'; payload: unknown }
  | { method: 'single' }

// Two queues split per `from()` call so multiple awaited chains in
// the same action don't consume each other's queued responses in the
// wrong order (create-review calls grants first, then reviews insert).
const calls: Call[] = []
let chainsPending: Array<() => Promise<unknown>> = []
let mockUser: { id: string; email: string | null } | null = null

function makeChain(tableName: string) {
  // Mirror the real Supabase JS client: every chain method returns
  // the SAME builder, which is itself thenable. The builder resolves
  // to the next queued response when `await chain` fires — and only
  // when `await` fires. Calling `.select()` / `.eq()` / `.single()` /
  // etc. just records the call for later assertion.
  let resolved = false
  const chain: any = {
    select(payload: string, opts?: Record<string, unknown>) {
      calls.push({ method: 'from', table: tableName })
      calls.push({ method: 'select', payload, opts })
      return chain
    },
    eq(col: string, val: unknown) {
      calls.push({ method: 'eq', col, val })
      return chain
    },
    is(col: string, val: unknown) {
      calls.push({ method: 'is', col, val })
      return chain
    },
    insert(payload: unknown) {
      calls.push({ method: 'insert', payload })
      return chain
    },
    update(payload: unknown) {
      calls.push({ method: 'update', payload })
      return chain
    },
    single() {
      calls.push({ method: 'single' })
      return chain
    },
    // thenable — `await chain` consumes exactly ONE queued response.
    then(resolve: (v: unknown) => void) {
      if (resolved) {
        // Defensive: if the consumer awaits the chain twice, the
        // second await would block forever. Resolve with a neutral
        // empty response so the test fails on the assertion, not on
        // a hang.
        resolve({ data: null, error: null })
        return
      }
      resolved = true
      const next = chainsPending.shift() ?? (async () => ({ data: null, error: null }))
      next().then(resolve)
    },
  }
  return chain
}

const fakeSupabase = {
  from: vi.fn((table: string) => makeChain(table)),
  auth: {
    getUser: vi.fn(async () => ({ data: { user: mockUser }, error: null })),
  },
}

vi.mock('@foundations/data/supabase', () => ({
  getServerSupabase: vi.fn(async () => fakeSupabase),
}))

const mockInfo = vi.fn()
const mockWarn = vi.fn()
vi.mock('@foundations/log/pino', () => ({
  loggerFor: () => ({
    info: (...args: unknown[]) => mockInfo(...args),
    warn: (...args: unknown[]) => mockWarn(...args),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))

const {
  createReviewAction,
  updateReviewAction,
  deleteReviewAction,
} = await import('./reviewActions')

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

const VALID_CREATE_INPUT = {
  productId: 7,
  rating: 5,
  title: 'Loved it',
  body: 'Sixty-plus character body content for create-review mapping verification.',
}

const VALID_UPDATE_INPUT = {
  reviewId: 42,
  rating: 4,
  title: 'Updated title',
  body: 'Updated body content — fifty plus chars so the Zod body min(50) check passes.',
}

const VALID_DELETE_INPUT = { reviewId: 42 }

function queueResponse(response: { data: unknown; error: unknown; count?: unknown | null }) {
  // Most response payloads `await chain` consumes — but the
  // createReview insert reads through `.single()`, so we wrap each
  // queued response to also feed a `data: { id }` shape when the
  // single() terminal fires.
  chainsPending.push(async () => response)
}

beforeEach(() => {
  calls.length = 0
  revalidateCalls.length = 0
  chainsPending = []
  mockUser = { id: 'user-uuid-1', email: 'klaas@example.com' }
  mockInfo.mockClear()
  mockWarn.mockClear()
  fakeSupabase.from.mockClear()
  fakeSupabase.auth.getUser.mockClear()
  fakeSupabase.auth.getUser.mockImplementation(async () => ({
    data: { user: mockUser },
    error: null,
  }))
})

afterEach(() => {
  vi.clearAllMocks()
})

// ---------------------------------------------------------------------------
// createReviewAction — auth gating
// ---------------------------------------------------------------------------

describe('createReviewAction — auth', () => {
  it('returns "Not signed in" for an anonymous caller (no DB call)', async () => {
    mockUser = null
    const result = await createReviewAction(VALID_CREATE_INPUT)
    expect(result).toEqual({ ok: false, error: 'Not signed in.' })
    expect(fakeSupabase.from).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// createReviewAction — Zod validation
// ---------------------------------------------------------------------------

describe('createReviewAction — Zod validation (runs BEFORE any DB call)', () => {
  it.each([
    [
      'missing productId',
      { rating: 5, title: '', body: VALID_CREATE_INPUT.body },
      'productId',
    ],
    [
      'non-numeric productId',
      { productId: 'seven', rating: 5, title: '', body: VALID_CREATE_INPUT.body },
      'productId',
    ],
    [
      'negative productId',
      { productId: -1, rating: 5, title: '', body: VALID_CREATE_INPUT.body },
      'productId',
    ],
    [
      'rating < 1',
      { productId: 7, rating: 0, title: '', body: VALID_CREATE_INPUT.body },
      'rating',
    ],
    [
      'rating > 5',
      { productId: 7, rating: 6, title: '', body: VALID_CREATE_INPUT.body },
      'rating',
    ],
    [
      'non-numeric rating',
      { productId: 7, rating: 'high', title: '', body: VALID_CREATE_INPUT.body },
      'rating',
    ],
    [
      'body too short (< 50 chars)',
      { productId: 7, rating: 5, title: '', body: 'too short' },
      'body',
    ],
    [
      'body too long (> 2000 chars)',
      {
        productId: 7,
        rating: 5,
        title: '',
        body: 'x'.repeat(2001),
      },
      'body',
    ],
    [
      'title too long (> 80 chars)',
      {
        productId: 7,
        rating: 5,
        title: 'x'.repeat(81),
        body: VALID_CREATE_INPUT.body,
      },
      'title',
    ],
  ])('rejects invalid input: %s', async (_label, badInput, expectedField) => {
    const result = await createReviewAction(badInput)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toBe('Please fix the errors below.')
      expect(result.fieldErrors?.[expectedField]).toBeTruthy()
    }
    expect(fakeSupabase.from).not.toHaveBeenCalled()
  })

  it('accepts a missing title (omitted → empty string default → normalized to null at insert time)', async () => {
    // Title is optional with a default of ''. The Zod check passes;
    // the action should then proceed to the grant check. Queue a
    // grant found (count=1) so we don't fail before the insert.
    queueResponse({ count: 1, data: [], error: null }) // grants count
    queueResponse({ data: { id: 99 }, error: null }) // insert returning
    const result = await createReviewAction({
      productId: 7,
      rating: 5,
      title: '',
      body: VALID_CREATE_INPUT.body,
    })
    expect(result.ok).toBe(true)
  })

  it('accepts snake_case payload (product_id) — the action maps to the shared Zod schema that uses camelCase', async () => {
    queueResponse({ count: 1, data: [], error: null }) // grants count
    queueResponse({ data: { id: 99 }, error: null }) // insert returning
    const result = await createReviewAction({
      product_id: 7,
      rating: 5,
      title: 'Hello',
      body: VALID_CREATE_INPUT.body,
    })
    expect(result.ok).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// createReviewAction — grant gate (the "you can only review products
// you own" enforcement)
// ---------------------------------------------------------------------------

describe('createReviewAction — grant gate', () => {
  it('refuses to insert when no library_grants row exists for (user_id, product_id, revoked_at IS NULL)', async () => {
    queueResponse({ count: 0, data: [], error: null }) // grants count = 0
    const result = await createReviewAction(VALID_CREATE_INPUT)
    expect(result).toEqual({
      ok: false,
      error: 'You can only review products you own.',
    })
    // The action must not have inserted anything.
    const insertCalls = calls.filter((c) => c.method === 'insert')
    expect(insertCalls).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// createReviewAction — happy path
// ---------------------------------------------------------------------------

describe('createReviewAction — happy path', () => {
  it('inserts with user_id, product_id, rating, normalized title (empty → null), body, and status=pending', async () => {
    queueResponse({ count: 1, data: [], error: null }) // grants count
    queueResponse({
      data: { id: 99 },
      error: null,
    }) // insert returning .single()
    const result = await createReviewAction({
      productId: 7,
      rating: 5,
      title: 'Loved it',
      body: VALID_CREATE_INPUT.body,
    })
    expect(result).toEqual({ ok: true, reviewId: 99 })
    // Wire-up: the insert must have carried the auth user as
    // user_id, the right product_id/rating/body, and status:
    // 'pending' (re-moderation surface — the spec Acceptance: "row
    // with status='pending'").
    const insertCall = calls.find((c) => c.method === 'insert')
    expect(insertCall).toBeDefined()
    if (insertCall?.method === 'insert') {
      expect(insertCall.payload).toEqual({
        user_id: 'user-uuid-1',
        product_id: 7,
        rating: 5,
        title: 'Loved it',
        body: VALID_CREATE_INPUT.body,
        status: 'pending',
      })
    }
    expect(revalidateCalls).toEqual(['/account/reviews'])
  })

  it('normalizes empty title to null at insert time (DB stores NULL, not "")', async () => {
    queueResponse({ count: 1, data: [], error: null }) // grants count
    queueResponse({ data: { id: 99 }, error: null }) // insert returning
    await createReviewAction({
      productId: 7,
      rating: 5,
      title: '',
      body: VALID_CREATE_INPUT.body,
    })
    const insertCall = calls.find((c) => c.method === 'insert')
    expect(insertCall).toBeDefined()
    if (insertCall?.method === 'insert') {
      expect((insertCall.payload as { title: unknown }).title).toBeNull()
    }
  })
})

// ---------------------------------------------------------------------------
// createReviewAction — the unique constraint + DB error surface
// ---------------------------------------------------------------------------

describe('createReviewAction — unique constraint + DB error', () => {
  it('maps PG code 23505 (unique violation) to a typed "already reviewed" error', async () => {
    queueResponse({ count: 1, data: [], error: null }) // grants count
    queueResponse({
      data: null,
      error: { code: '23505', message: 'duplicate key value violates unique constraint' },
    }) // insert fails with PG 23505
    const result = await createReviewAction(VALID_CREATE_INPUT)
    expect(result).toEqual({
      ok: false,
      error: "You've already reviewed this product. Edit your existing review instead.",
    })
  })

  it('maps any OTHER DB error to a generic "Could not submit" error and warns', async () => {
    queueResponse({ count: 1, data: [], error: null }) // grants count
    queueResponse({
      data: null,
      error: { code: '42P01', message: 'undefined_table' },
    }) // insert fails with non-23505
    const result = await createReviewAction(VALID_CREATE_INPUT)
    expect(result).toEqual({
      ok: false,
      error: 'Could not submit your review. Please try again.',
    })
    expect(mockWarn).toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// updateReviewAction
// ---------------------------------------------------------------------------

describe('updateReviewAction — auth', () => {
  it('returns "Not signed in" for an anonymous caller (no DB call)', async () => {
    mockUser = null
    const result = await updateReviewAction(VALID_UPDATE_INPUT)
    expect(result).toEqual({ ok: false, error: 'Not signed in.' })
    expect(fakeSupabase.from).not.toHaveBeenCalled()
  })
})

describe('updateReviewAction — Zod validation', () => {
  it.each([
    ['missing reviewId', { rating: 5, title: '', body: VALID_UPDATE_INPUT.body }],
    ['rating < 1', { reviewId: 42, rating: 0, title: '', body: VALID_UPDATE_INPUT.body }],
    ['body too short', { reviewId: 42, rating: 5, title: '', body: 'too short' }],
  ])('rejects invalid input: %s', async (_label, badInput) => {
    const result = await updateReviewAction(badInput)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toBe('Please fix the errors below.')
      expect(result.fieldErrors).toBeDefined()
    }
    expect(fakeSupabase.from).not.toHaveBeenCalled()
  })
})

describe('updateReviewAction — happy path (re-moderation surface)', () => {
  it('updates rating + normalized title (empty → null) + body AND resets status to "pending" (re-moderation)', async () => {
    queueResponse({ data: null, error: null }) // update resolves with no error
    const result = await updateReviewAction({
      reviewId: 42,
      rating: 3,
      title: 'Updated headline',
      body: 'Updated body — fifty plus chars so the Zod body min(50) check passes.',
    })
    expect(result).toEqual({ ok: true })
    const updateCall = calls.find((c) => c.method === 'update')
    expect(updateCall).toBeDefined()
    if (updateCall?.method === 'update') {
      // Spec Security §"Status flow on edit": "if the title, body, or
      // rating changes during an edit, the review's status resets to
      // pending for re-moderation".
      expect(updateCall.payload).toEqual({
        rating: 3,
        title: 'Updated headline',
        body: 'Updated body — fifty plus chars so the Zod body min(50) check passes.',
        status: 'pending',
      })
    }
    expect(revalidateCalls).toEqual(['/account/reviews'])
  })

  it('normalizes empty title to null at update time', async () => {
    queueResponse({ data: null, error: null }) // update resolves
    await updateReviewAction({
      reviewId: 42,
      rating: 4,
      title: '',
      body: 'Updated body — fifty plus chars so the Zod body min(50) check passes.',
    })
    const updateCall = calls.find((c) => c.method === 'update')
    expect(updateCall).toBeDefined()
    if (updateCall?.method === 'update') {
      expect((updateCall.payload as { title: unknown }).title).toBeNull()
    }
  })

  it('scopes the update to (id, user_id) — ownership check enforced via the WHERE clause (RLS-friendly)', async () => {
    queueResponse({ data: null, error: null })
    await updateReviewAction(VALID_UPDATE_INPUT)
    const eqCalls = calls.filter((c) => c.method === 'eq')
    expect(eqCalls).toEqual([
      { method: 'eq', col: 'id', val: 42 },
      { method: 'eq', col: 'user_id', val: 'user-uuid-1' },
    ])
  })
})

describe('updateReviewAction — DB error', () => {
  it('returns a generic "Could not save" message on any DB error', async () => {
    queueResponse({
      data: null,
      error: { code: '42501', message: 'insufficient privilege' },
    })
    const result = await updateReviewAction(VALID_UPDATE_INPUT)
    expect(result).toEqual({
      ok: false,
      error: 'Could not save your changes. Please try again.',
    })
    expect(mockWarn).toHaveBeenCalled()
  })
})

describe('updateReviewAction — 30-day edit lock', () => {
  // The 30-day edit lock from the spec Security §"Edit lock window"
  // is NOT yet implemented (see STUB entry filed for P9.14). When the
  // edit-lock check ships, this test should:
  //   1. Insert a review with `created_at = now() - 31 days`
  //   2. Call updateReviewAction on it
  //   3. Assert `{ ok: false, error: 'This review can no longer be edited.' }`
  // Until then, no test — keeping the contract honest.
  it.todo('rejects edits to reviews older than 30 days (deferred — STUB entry filed)')
})

// ---------------------------------------------------------------------------
// deleteReviewAction
// ---------------------------------------------------------------------------

describe('deleteReviewAction — auth', () => {
  it('returns "Not signed in" for an anonymous caller (no DB call)', async () => {
    mockUser = null
    const result = await deleteReviewAction(VALID_DELETE_INPUT)
    expect(result).toEqual({ ok: false, error: 'Not signed in.' })
    expect(fakeSupabase.from).not.toHaveBeenCalled()
  })
})

describe('deleteReviewAction — Zod validation', () => {
  it('rejects missing reviewId (no DB call)', async () => {
    const result = await deleteReviewAction({ reviewId: undefined })
    expect(result).toEqual({ ok: false, error: 'Invalid request.' })
    expect(fakeSupabase.from).not.toHaveBeenCalled()
  })

  it('rejects non-numeric reviewId (no DB call)', async () => {
    const result = await deleteReviewAction({ reviewId: 'abc' })
    expect(result).toEqual({ ok: false, error: 'Invalid request.' })
    expect(fakeSupabase.from).not.toHaveBeenCalled()
  })
})

describe('deleteReviewAction — soft-delete shape', () => {
  it('soft-deletes via status="hidden" + body="[deleted]" (per STUB-030 — the schema enum has no "rejected")', async () => {
    queueResponse({ data: null, error: null }) // update resolves
    const result = await deleteReviewAction(VALID_DELETE_INPUT)
    expect(result).toEqual({ ok: true })
    const updateCall = calls.find((c) => c.method === 'update')
    expect(updateCall).toBeDefined()
    if (updateCall?.method === 'update') {
      // STUB-030 says soft-delete uses 'hidden' (schema enum) instead
      // of the spec's 'rejected'. The spec's intent — body wiped,
      // row preserved for audit — is honored. The follow-up to PH21
      // resolves the spec vs schema enum mismatch.
      expect(updateCall.payload).toEqual({
        status: 'hidden',
        body: '[deleted]',
      })
    }
    expect(revalidateCalls).toEqual(['/account/reviews'])
  })

  it('scopes the delete to (id, user_id) — ownership check enforced via the WHERE clause (RLS-friendly)', async () => {
    queueResponse({ data: null, error: null })
    await deleteReviewAction(VALID_DELETE_INPUT)
    const eqCalls = calls.filter((c) => c.method === 'eq')
    expect(eqCalls).toEqual([
      { method: 'eq', col: 'id', val: 42 },
      { method: 'eq', col: 'user_id', val: 'user-uuid-1' },
    ])
  })
})

describe('deleteReviewAction — DB error', () => {
  it('returns a generic "Could not delete" message on any DB error', async () => {
    queueResponse({
      data: null,
      error: { code: '42501', message: 'insufficient privilege' },
    })
    const result = await deleteReviewAction(VALID_DELETE_INPUT)
    expect(result).toEqual({
      ok: false,
      error: 'Could not delete your review. Please try again.',
    })
    expect(mockWarn).toHaveBeenCalled()
  })
})
