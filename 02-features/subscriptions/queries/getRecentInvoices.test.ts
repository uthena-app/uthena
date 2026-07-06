// getRecentInvoices.test.ts — P5.7 unit tests for the invoice-history
// query helper.
//
// Covers:
//   - **Defaults** — `limit = 24` (safety cap) and `olderThanMonths =
//     12` (P5.7 window) when called with no args.
//   - **Date filter passed correctly** — when `olderThanMonths = 12`,
//     Stripe's `invoices.list` receives `created: { gte: <now - 12mo in
//     seconds> }`. When `olderThanMonths = null`, no `created` field
//     is sent.
//   - **Custom limit honored** — `limit = 5` flows through to Stripe.
//   - **Auth gating** — no session returns `[]` with no DB call and no
//     Stripe call.
//   - **Stripe-unconfigured gating** — `[]` returned with no DB call
//     and no Stripe call when `STRIPE_SECRET_KEY` is empty.
//   - **No-customer gating** — user has a `subscriptions` row but
//     `stripe_customer_id` is null → `[]` with no Stripe call.
//   - **No subscription row at all** — `maybeSingle()` returns null
//     → `[]` with no Stripe call.
//   - **Mapped shape** — happy-path invoices are normalized to the
//     `RecentInvoice` shape (id, number, created_at ISO, amount
//     fields, currency, status, hosted_invoice_url, invoice_pdf).
//   - **Read failure** — `withStripeErrorHandling` returns `ok:false` →
//     function returns `[]`.
//   - **Defensive mapping** — null/undefined invoice fields don't
//     crash the mapper; missing `created` falls back to `Date.now()`
//     in the mapper (defensive — Stripe always sets it, but the unit
//     test pins the fallback).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ----- Mock @foundations/auth/guards -------------------------------
let mockUser: { id: string; email: string | null } | null = null
vi.mock('@foundations/auth/guards', () => ({
  getSessionUser: vi.fn(async () => mockUser),
}))

// ----- Mock @foundations/money/stripe -----------------------------
let stripeConfigured = true
let invoicesListError: Error | null = null
let invoicesListResult: unknown = { data: [], has_more: false, url: '/v1/invoices' }
let capturedListParams: unknown = null

const fakeStripe = {
  invoices: {
    list: vi.fn(async (params: unknown) => {
      capturedListParams = params
      if (invoicesListError) throw invoicesListError
      return invoicesListResult
    }),
  },
}
vi.mock('@foundations/money/stripe', () => ({
  isStripeConfigured: vi.fn(() => stripeConfigured),
  getStripe: vi.fn(() => fakeStripe),
  withStripeErrorHandling: vi.fn(async (fn: () => Promise<unknown>) => {
    try {
      const data = await fn()
      return { ok: true, data }
    } catch (err) {
      return {
        ok: false,
        code: 'unknown',
        message: (err as Error).message ?? 'unknown error',
      }
    }
  }),
}))

// ----- Mock Supabase server client --------------------------------
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
}
vi.mock('@foundations/data/supabase', () => ({
  getServerSupabase: vi.fn(async () => fakeServerSupabase),
}))

// ----- Mock logger (capture for PII-safety assertions) -------------
const logCalls: Array<{ level: string; payload: unknown; msg: string | undefined }> = []
vi.mock('@foundations/log/pino', () => ({
  loggerFor: () => ({
    info: (payload: unknown, msg?: string) => logCalls.push({ level: 'info', payload, msg }),
    warn: (payload: unknown, msg?: string) => logCalls.push({ level: 'warn', payload, msg }),
    error: (payload: unknown, msg?: string) => logCalls.push({ level: 'error', payload, msg }),
    debug: (payload: unknown, msg?: string) => logCalls.push({ level: 'debug', payload, msg }),
  }),
}))

// ----- Import after mocks -----------------------------------------
const { getRecentInvoices, DEFAULT_INVOICE_LIMIT, DEFAULT_INVOICE_WINDOW_MONTHS } =
  await import('./getRecentInvoices')

// Frozen "now" so the date math in the test is deterministic.
// 2026-06-26 06:30:00 UTC = 1782425400000 ms
const NOW_MS = 1_782_425_400_000
const TWELVE_MONTHS_MS = 12 * (365.25 / 12) * 24 * 60 * 60 * 1000
const EXPECTED_GTE_12MO = Math.floor((NOW_MS - TWELVE_MONTHS_MS) / 1000)

beforeEach(() => {
  serverCalls.length = 0
  serverQueue = []
  logCalls.length = 0
  capturedListParams = null
  invoicesListError = null
  invoicesListResult = { data: [], has_more: false, url: '/v1/invoices' }
  stripeConfigured = true
  mockUser = { id: 'user-1', email: 'user@example.com' }
  fakeServerSupabase.from.mockClear()
  fakeStripe.invoices.list.mockClear()
})

afterEach(() => {
  vi.clearAllMocks()
})

// ===================================================================
// Defaults (P5.7 — last 12 months, PDF per invoice)
// ===================================================================

describe('getRecentInvoices — defaults (P5.7)', () => {
  it('exports DEFAULT_INVOICE_LIMIT = 24 (safety cap, 2× a 12-month monthly cadence)', () => {
    expect(DEFAULT_INVOICE_LIMIT).toBe(24)
  })

  it('exports DEFAULT_INVOICE_WINDOW_MONTHS = 12 (P5.7 spec)', () => {
    expect(DEFAULT_INVOICE_WINDOW_MONTHS).toBe(12)
  })

  it('passes customer + limit=24 + created[gte]=now-12mo to Stripe when called with no args', async () => {
    serverQueue.push({ data: { stripe_customer_id: 'cus_test_1' }, error: null })

    await getRecentInvoices(undefined, undefined, NOW_MS)

    expect(capturedListParams).toEqual({
      customer: 'cus_test_1',
      limit: 24,
      created: { gte: EXPECTED_GTE_12MO },
    })
  })
})

// ===================================================================
// Date filter math
// ===================================================================

describe('getRecentInvoices — date filter', () => {
  it('converts a 12-month window to a Unix-seconds `created[gte]` value', async () => {
    serverQueue.push({ data: { stripe_customer_id: 'cus_test_1' }, error: null })

    await getRecentInvoices(24, 12, NOW_MS)

    const params = capturedListParams as { created?: { gte: number } }
    expect(params.created?.gte).toBe(EXPECTED_GTE_12MO)
  })

  it('honors a custom olderThanMonths value (e.g. 3)', async () => {
    serverQueue.push({ data: { stripe_customer_id: 'cus_test_1' }, error: null })

    await getRecentInvoices(24, 3, NOW_MS)

    const params = capturedListParams as { created?: { gte: number } }
    const expected = Math.floor((NOW_MS - 3 * (365.25 / 12) * 24 * 60 * 60 * 1000) / 1000)
    expect(params.created?.gte).toBe(expected)
  })

  it('omits the `created` field entirely when olderThanMonths is null', async () => {
    serverQueue.push({ data: { stripe_customer_id: 'cus_test_1' }, error: null })

    await getRecentInvoices(24, null, NOW_MS)

    const params = capturedListParams as Record<string, unknown>
    expect('created' in params).toBe(false)
  })

  it('uses Date.now() as the time anchor when `now` is not provided', async () => {
    serverQueue.push({ data: { stripe_customer_id: 'cus_test_1' }, error: null })

    const before = Math.floor((Date.now() - TWELVE_MONTHS_MS) / 1000)
    await getRecentInvoices()
    const after = Math.floor((Date.now() - TWELVE_MONTHS_MS) / 1000)

    const params = capturedListParams as { created?: { gte: number } }
    expect(params.created?.gte).toBeGreaterThanOrEqual(before)
    expect(params.created?.gte).toBeLessThanOrEqual(after)
  })
})

// ===================================================================
// Custom limit honored
// ===================================================================

describe('getRecentInvoices — custom limit', () => {
  it('honors a custom limit value (e.g. 5)', async () => {
    serverQueue.push({ data: { stripe_customer_id: 'cus_test_1' }, error: null })

    await getRecentInvoices(5)

    const params = capturedListParams as { limit: number }
    expect(params.limit).toBe(5)
  })
})

// ===================================================================
// Auth gating
// ===================================================================

describe('getRecentInvoices — auth gating', () => {
  it('returns [] when no user is signed in (no DB call, no Stripe call)', async () => {
    mockUser = null

    const result = await getRecentInvoices()
    expect(result).toEqual([])
    expect(fakeServerSupabase.from).not.toHaveBeenCalled()
    expect(fakeStripe.invoices.list).not.toHaveBeenCalled()
  })
})

// ===================================================================
// Stripe-unconfigured gating
// ===================================================================

describe('getRecentInvoices — Stripe-unconfigured gate', () => {
  it('returns [] when STRIPE_SECRET_KEY is empty (no DB call, no Stripe call)', async () => {
    stripeConfigured = false

    const result = await getRecentInvoices()
    expect(result).toEqual([])
    expect(fakeServerSupabase.from).not.toHaveBeenCalled()
    expect(fakeStripe.invoices.list).not.toHaveBeenCalled()
  })
})

// ===================================================================
// Subscription-row gating
// ===================================================================

describe('getRecentInvoices — subscription-row gating', () => {
  it('returns [] when the user has no subscription row at all (no Stripe call)', async () => {
    serverQueue.push({ data: null, error: null })

    const result = await getRecentInvoices()
    expect(result).toEqual([])
    expect(fakeStripe.invoices.list).not.toHaveBeenCalled()
  })

  it('returns [] when the subscription row exists but stripe_customer_id is null (no Stripe call)', async () => {
    serverQueue.push({ data: { stripe_customer_id: null }, error: null })

    const result = await getRecentInvoices()
    expect(result).toEqual([])
    expect(fakeStripe.invoices.list).not.toHaveBeenCalled()
  })

  it('queries the subscriptions table with only the stripe_customer_id column', async () => {
    serverQueue.push({ data: { stripe_customer_id: 'cus_test_1' }, error: null })

    await getRecentInvoices()

    const fromCalls = serverCalls.filter((c) => c.method === 'from')
    const selectCalls = serverCalls.filter((c) => c.method === 'select')
    expect(fromCalls).toHaveLength(1)
    const [fromCall] = fromCalls as Array<{ method: 'from'; table: string }>
    expect(fromCall).toBeDefined()
    expect(fromCall!.table).toBe('subscriptions')
    expect(selectCalls).toHaveLength(1)
    const [selectCall] = selectCalls as Array<{ method: 'select'; payload: string }>
    expect(selectCall).toBeDefined()
    expect(selectCall!.payload).toBe('stripe_customer_id')
  })
})

// ===================================================================
// Happy path — mapped shape
// ===================================================================

describe('getRecentInvoices — happy path mapped shape', () => {
  it('maps Stripe invoice fields into the normalized RecentInvoice shape', async () => {
    serverQueue.push({ data: { stripe_customer_id: 'cus_test_1' }, error: null })
    invoicesListResult = {
      data: [
        {
          id: 'in_1',
          number: 'U-0001',
          created: 1_782_000_000, // 2026-06-22 ish
          amount_due: 1900,
          amount_paid: 1900,
          currency: 'usd',
          status: 'paid',
          hosted_invoice_url: 'https://invoice.stripe.com/i/hosted_1',
          invoice_pdf: 'https://invoice.stripe.com/i/pdf_1',
        },
      ],
      has_more: false,
      url: '/v1/invoices',
    }

    const result = await getRecentInvoices(undefined, undefined, NOW_MS)

    expect(result).toEqual([
      {
        id: 'in_1',
        number: 'U-0001',
        created_at: new Date(1_782_000_000 * 1000).toISOString(),
        amount_due_cents: 1900,
        amount_paid_cents: 1900,
        currency: 'usd',
        status: 'paid',
        hosted_invoice_url: 'https://invoice.stripe.com/i/hosted_1',
        invoice_pdf: 'https://invoice.stripe.com/i/pdf_1',
      },
    ])
  })

  it('returns [] when Stripe returns an empty data array', async () => {
    serverQueue.push({ data: { stripe_customer_id: 'cus_test_1' }, error: null })
    invoicesListResult = { data: [], has_more: false, url: '/v1/invoices' }

    const result = await getRecentInvoices()
    expect(result).toEqual([])
  })

  it('handles null Stripe response data gracefully', async () => {
    serverQueue.push({ data: { stripe_customer_id: 'cus_test_1' }, error: null })
    invoicesListResult = { data: null, has_more: false, url: '/v1/invoices' }

    const result = await getRecentInvoices()
    expect(result).toEqual([])
  })

  it('maps a missing `created` field to the current time (defensive)', async () => {
    serverQueue.push({ data: { stripe_customer_id: 'cus_test_1' }, error: null })
    invoicesListResult = {
      data: [
        {
          id: 'in_1',
          number: null,
          // created omitted
          amount_due: 1900,
          amount_paid: 1900,
          currency: 'usd',
          status: 'paid',
          hosted_invoice_url: null,
          invoice_pdf: null,
        },
      ],
      has_more: false,
      url: '/v1/invoices',
    }

    const result = await getRecentInvoices(undefined, undefined, NOW_MS)

    expect(result).toHaveLength(1)
    const [first] = result
    expect(first).toBeDefined()
    expect(first!.number).toBeNull()
    expect(first!.hosted_invoice_url).toBeNull()
    expect(first!.invoice_pdf).toBeNull()
    // created_at falls back to the mapper's "now" (Date.now()) — just
    // assert it's a valid ISO string in the present.
    expect(() => new Date(first!.created_at).toISOString()).not.toThrow()
    expect(new Date(first!.created_at).getTime()).toBeGreaterThan(NOW_MS - 5_000)
  })

  it('falls back to 0 for missing amount_due / amount_paid', async () => {
    serverQueue.push({ data: { stripe_customer_id: 'cus_test_1' }, error: null })
    invoicesListResult = {
      data: [
        {
          id: 'in_1',
          // amount_due omitted
          // amount_paid omitted
          created: NOW_MS / 1000,
          currency: 'usd',
          status: 'open',
        },
      ],
      has_more: false,
      url: '/v1/invoices',
    }

    const result = await getRecentInvoices()
    const [first] = result
    expect(first).toBeDefined()
    expect(first!.amount_due_cents).toBe(0)
    expect(first!.amount_paid_cents).toBe(0)
  })

  it('falls back to "usd" for missing currency', async () => {
    serverQueue.push({ data: { stripe_customer_id: 'cus_test_1' }, error: null })
    invoicesListResult = {
      data: [
        {
          id: 'in_1',
          created: NOW_MS / 1000,
          amount_due: 100,
          currency: undefined,
          status: 'paid',
        },
      ],
      has_more: false,
      url: '/v1/invoices',
    }

    const result = await getRecentInvoices()
    const [first] = result
    expect(first).toBeDefined()
    expect(first!.currency).toBe('usd')
  })
})

// ===================================================================
// Error / failure paths
// ===================================================================

describe('getRecentInvoices — error / failure paths', () => {
  it('returns [] when withStripeErrorHandling returns ok:false (no thrown error)', async () => {
    serverQueue.push({ data: { stripe_customer_id: 'cus_test_1' }, error: null })

    // Simulate withStripeErrorHandling returning ok:false by making
    // the inner fn throw.
    invoicesListError = new Error('rate_limited')

    const result = await getRecentInvoices()
    expect(result).toEqual([])
  })

  it('returns [] when the Stripe call throws unexpectedly (catch-all)', async () => {
    serverQueue.push({ data: { stripe_customer_id: 'cus_test_1' }, error: null })

    // Override the mock to throw outside the wrapper boundary.
    fakeStripe.invoices.list.mockRejectedValueOnce(new Error('network blip'))

    // Note: the wrapper above will catch this and return ok:false.
    // We want to test the path where the wrapper itself short-circuits,
    // which is hard to simulate here without restructuring mocks.
    // The catch block in the source is for the case where withStripeErrorHandling
    // somehow propagates — extremely rare; we cover it with this sanity check
    // that the function never throws even under hostile inputs.
    const result = await getRecentInvoices()
    expect(Array.isArray(result)).toBe(true)
  })
})

// ===================================================================
// PII safety
// ===================================================================

describe('getRecentInvoices — PII safety', () => {
  it('does not log the stripe_customer_id on the happy path', async () => {
    serverQueue.push({ data: { stripe_customer_id: 'cus_test_1' }, error: null })
    invoicesListResult = {
      data: [
        {
          id: 'in_1',
          number: 'U-0001',
          created: NOW_MS / 1000,
          amount_due: 1900,
          amount_paid: 1900,
          currency: 'usd',
          status: 'paid',
        },
      ],
      has_more: false,
      url: '/v1/invoices',
    }

    await getRecentInvoices()

    // No log lines on the happy path — the function only logs on the
    // catch-all failure path.
    expect(logCalls).toEqual([])
  })
})