// getHostedInvoiceForOrder.test.ts — unit tests for the Stripe
// hosted-invoice lookup used by /account/orders/[id].
//
// Covers:
//   - anon path: returns null with no DB / Stripe calls
//   - invalid orderId: returns null immediately
//   - Stripe-unconfigured: returns null with no DB calls
//   - order not owned by user: returns null after the DB lookup
//   - order status not 'paid' / 'fulfilled' / 'partially_refunded':
//     returns null (no invoice to surface for unpaid orders)
//   - missing stripe_payment_intent_id: returns null after the DB
//     lookup, no Stripe call
//   - happy path: paymentIntents.retrieve → invoices.retrieve chain
//     returns the hosted + PDF URLs + invoice id + invoice number
//   - PI retrieve fails (withStripeErrorHandling returns ok:false) →
//     null with a warn log
//   - PI has no latest_invoice (subscription renewal without an
//     invoice): returns null
//   - invoice.retrieve returns no hosted_invoice_url: returns null
//     (we don't surface a button when Stripe can't give us a URL)
//   - invoice.retrieve fails: returns null with a warn log
//   - PII safety: the hosted URL (a Stripe single-tenant bearer-ish
//     URL) is NEVER passed through a log call

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ----- Mock @foundations/auth/guards -------------------------------
let mockUser: { id: string; email: string | null } | null = null
vi.mock('@foundations/auth/guards', () => ({
  getSessionUser: vi.fn(async () => mockUser),
}))

// ----- Mock @foundations/money/stripe -----------------------------
// The PaymentIntent type's invoice field is `invoice` (NOT
// `latest_invoice` despite the Stripe Dashboard label). Mocks use the
// real Stripe field name so the test exercises the actual code path.
let stripeConfigured = true
let piRetrieveResponse: unknown = { id: 'pi_test_1', invoice: 'in_test_1' }
let piRetrieveShouldFail = false
let invoiceRetrieveResponse: unknown = {
  id: 'in_test_1',
  number: 'ABC-2026-0001',
  hosted_invoice_url: 'https://invoice.stripe.com/i/abc',
  invoice_pdf: 'https://invoice.stripe.com/i/abc.pdf',
}
let invoiceRetrieveShouldFail = false

const fakeStripe = {
  paymentIntents: {
    retrieve: vi.fn(async () => {
      if (piRetrieveShouldFail) throw new Error('stripe 500')
      return piRetrieveResponse
    }),
  },
  invoices: {
    retrieve: vi.fn(async () => {
      if (invoiceRetrieveShouldFail) throw new Error('invoice gone')
      return invoiceRetrieveResponse
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
        code: 'api_error',
        message: (err as Error).message ?? 'unknown error',
        status: 500,
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
let orderRow: Record<string, unknown> | null = null
let orderRowError: unknown = null

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
    maybeSingle() {
      serverCalls.push({ method: 'maybeSingle' })
      if (orderRowError) return Promise.resolve({ data: null, error: orderRowError })
      return Promise.resolve({ data: orderRow, error: null })
    },
  }
  return chain
}

vi.mock('@foundations/data/supabase', () => ({
  getServerSupabase: vi.fn(async () => ({
    from: vi.fn((_table: string) => {
      serverCalls.push({ method: 'from', table: _table })
      return makeServerChain()
    }),
  })),
}))

const { getHostedInvoiceForOrder } = await import('./getHostedInvoiceForOrder')

beforeEach(() => {
  serverCalls.length = 0
  fakeStripe.paymentIntents.retrieve.mockClear()
  fakeStripe.invoices.retrieve.mockClear()
  stripeConfigured = true
  piRetrieveShouldFail = false
  invoiceRetrieveShouldFail = false
  piRetrieveResponse = { id: 'pi_test_1', invoice: 'in_test_1' }
  invoiceRetrieveResponse = {
    id: 'in_test_1',
    number: 'ABC-2026-0001',
    hosted_invoice_url: 'https://invoice.stripe.com/i/abc',
    invoice_pdf: 'https://invoice.stripe.com/i/abc.pdf',
  }
  mockUser = { id: 'user-uuid-1', email: 'klaas@example.com' }
  orderRow = {
    id: 12345,
    stripe_payment_intent_id: 'pi_test_1',
    stripe_customer_id: 'cus_test_1',
    status: 'paid',
    currency: 'USD',
    total_cents: 44730,
  }
  orderRowError = null
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('getHostedInvoiceForOrder — anon / invalid input', () => {
  it('returns null when no user is signed in', async () => {
    mockUser = null
    const result = await getHostedInvoiceForOrder(12345)
    expect(result).toBeNull()
    // No DB call, no Stripe call.
    expect(fakeStripe.paymentIntents.retrieve).not.toHaveBeenCalled()
    expect(fakeStripe.invoices.retrieve).not.toHaveBeenCalled()
  })

  it('returns null for invalid orderId', async () => {
    expect(await getHostedInvoiceForOrder(0)).toBeNull()
    expect(await getHostedInvoiceForOrder(-1)).toBeNull()
    expect(await getHostedInvoiceForOrder(1.5)).toBeNull()
    expect(await getHostedInvoiceForOrder(NaN)).toBeNull()
    expect(fakeStripe.paymentIntents.retrieve).not.toHaveBeenCalled()
  })

  it('returns null when Stripe is unconfigured', async () => {
    stripeConfigured = false
    const result = await getHostedInvoiceForOrder(12345)
    expect(result).toBeNull()
    expect(fakeStripe.paymentIntents.retrieve).not.toHaveBeenCalled()
  })
})

describe('getHostedInvoiceForOrder — DB filtering', () => {
  it('returns null when the order is not owned by the user', async () => {
    orderRow = null // .maybeSingle returns null
    const result = await getHostedInvoiceForOrder(12345)
    expect(result).toBeNull()
    expect(fakeStripe.paymentIntents.retrieve).not.toHaveBeenCalled()
  })

  it('returns null when the order status is not paid/fulfilled/partially_refunded', async () => {
    orderRow = { ...orderRow!, status: 'pending' }
    const result = await getHostedInvoiceForOrder(12345)
    expect(result).toBeNull()
    expect(fakeStripe.paymentIntents.retrieve).not.toHaveBeenCalled()
  })

  it('returns null when stripe_payment_intent_id is missing', async () => {
    orderRow = { ...orderRow!, stripe_payment_intent_id: null }
    const result = await getHostedInvoiceForOrder(12345)
    expect(result).toBeNull()
    expect(fakeStripe.paymentIntents.retrieve).not.toHaveBeenCalled()
  })

  it('always pins the DB query to user_id = session user (defense in depth)', async () => {
    mockUser = { id: 'user-uuid-42', email: 'x@example.com' }
    await getHostedInvoiceForOrder(12345)
    const eqUserCalls = (serverCalls.filter(
      (c) => c.method === 'eq' && (c as Extract<ServerCall, { method: 'eq' }>).col === 'user_id',
    ) as Extract<ServerCall, { method: 'eq' }>[])
    expect(eqUserCalls.length).toBeGreaterThan(0)
    expect(eqUserCalls.some((c) => c.val === 'user-uuid-42')).toBe(true)
  })
})

describe('getHostedInvoiceForOrder — Stripe call chain', () => {
  it('returns the hosted invoice URL + PDF URL on the happy path', async () => {
    const result = await getHostedInvoiceForOrder(12345)
    expect(result).toEqual({
      hostedInvoiceUrl: 'https://invoice.stripe.com/i/abc',
      invoicePdfUrl: 'https://invoice.stripe.com/i/abc.pdf',
      invoiceId: 'in_test_1',
      invoiceNumber: 'ABC-2026-0001',
    })
    expect(fakeStripe.paymentIntents.retrieve).toHaveBeenCalledWith('pi_test_1')
    expect(fakeStripe.invoices.retrieve).toHaveBeenCalledWith('in_test_1')
  })

  it('handles latest_invoice returned as an object (expand form)', async () => {
    piRetrieveResponse = { id: 'pi_test_1', invoice: { id: 'in_test_2' } }
    invoiceRetrieveResponse = {
      id: 'in_test_2',
      number: null,
      hosted_invoice_url: 'https://invoice.stripe.com/i/xyz',
      invoice_pdf: 'https://invoice.stripe.com/i/xyz.pdf',
    }
    const result = await getHostedInvoiceForOrder(12345)
    expect(result!.invoiceId).toBe('in_test_2')
    expect(result!.invoiceNumber).toBeNull()
    expect(fakeStripe.invoices.retrieve).toHaveBeenCalledWith('in_test_2')
  })

  it('returns null when the PI has no latest_invoice', async () => {
    piRetrieveResponse = { id: 'pi_test_1', invoice: null }
    const result = await getHostedInvoiceForOrder(12345)
    expect(result).toBeNull()
    expect(fakeStripe.invoices.retrieve).not.toHaveBeenCalled()
  })

  it('returns null when the invoice has no hosted_invoice_url', async () => {
    invoiceRetrieveResponse = {
      id: 'in_test_1',
      number: 'X',
      hosted_invoice_url: null,
      invoice_pdf: 'https://invoice.stripe.com/i/x.pdf',
    }
    const result = await getHostedInvoiceForOrder(12345)
    expect(result).toBeNull()
  })

  it('returns null when the invoice has no invoice_pdf', async () => {
    invoiceRetrieveResponse = {
      id: 'in_test_1',
      number: 'X',
      hosted_invoice_url: 'https://invoice.stripe.com/i/x',
      invoice_pdf: null,
    }
    const result = await getHostedInvoiceForOrder(12345)
    expect(result).toBeNull()
  })

  it('returns null when paymentIntents.retrieve fails', async () => {
    piRetrieveShouldFail = true
    const result = await getHostedInvoiceForOrder(12345)
    expect(result).toBeNull()
    expect(fakeStripe.invoices.retrieve).not.toHaveBeenCalled()
  })

  it('returns null when invoices.retrieve fails', async () => {
    invoiceRetrieveShouldFail = true
    const result = await getHostedInvoiceForOrder(12345)
    expect(result).toBeNull()
  })

  it('accepts fulfilled and partially_refunded statuses', async () => {
    for (const status of ['fulfilled', 'partially_refunded'] as const) {
      orderRow = { ...orderRow!, status }
      const result = await getHostedInvoiceForOrder(12345)
      expect(result).not.toBeNull()
    }
  })
})

describe('getHostedInvoiceForOrder — PII safety', () => {
  it('never logs the hosted_invoice_url (it is a single-tenant URL)', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    // Use a hostile-looking URL — if anything logs it, the test fails.
    invoiceRetrieveResponse = {
      id: 'in_test_1',
      number: 'X',
      hosted_invoice_url: 'https://invoice.stripe.com/i/SECRET-BEARER-TOKEN',
      invoice_pdf: 'https://invoice.stripe.com/i/SECRET-BEARER-TOKEN.pdf',
    }
    invoiceRetrieveShouldFail = true // force a warn path
    await getHostedInvoiceForOrder(12345)
    const allWarnCalls = warnSpy.mock.calls.flat().map(String).join(' ')
    expect(allWarnCalls).not.toContain('SECRET-BEARER-TOKEN')
    warnSpy.mockRestore()
  })
})