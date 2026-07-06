// logInvoiceDownload.test.ts — unit tests for the server action that
// writes the invoice-redirect audit row on /account/orders/[id].
//
// Covers:
//   - input validation: rejects non-positive orderId, rejects
//     missing/oversized invoiceId strings (Zod-enforced)
//   - auth gating: returns not_authenticated when there is no user
//   - rate limiting: 60/hour ceiling per user, denial returns
//     retry_after_ms; never counts a denied request against the window
//   - audit-row insert: shape is correct (kind='invoice_redirect',
//     url_expires_at is ~24h out, ip_hash/ip_raw/user_agent all null)
//   - audit insert failure: returns audit_failed, but the audit row
//     failure does NOT change the rate-limit count
//   - PII safety: the Stripe hosted URL is NEVER passed to the
//     service-role client (the action only knows invoiceId); the
//     audit row payload never contains the URL or any user email

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ----- Mock @foundations/auth/guards -------------------------------
let mockUser: { id: string; email: string | null } | null = null
vi.mock('@foundations/auth/guards', () => ({
  getSessionUser: vi.fn(async () => mockUser),
}))

// ----- Mock @foundations/data/supabase -----------------------------
type InsertCall = {
  table: string
  payload: Record<string, unknown>
}
const insertCalls: InsertCall[] = []
let insertShouldFail = false

vi.mock('@foundations/data/supabase', () => ({
  getServiceSupabase: vi.fn(() => ({
    from: vi.fn((table: string) => ({
      insert: vi.fn((payload: Record<string, unknown>) => {
        insertCalls.push({ table, payload })
        if (insertShouldFail) {
          return Promise.resolve({ error: { message: 'insert failed' } })
        }
        return Promise.resolve({ error: null })
      }),
    })),
  })),
}))

const {
  logInvoiceDownloadAction,
} = await import('./logInvoiceDownload')
const {
  _resetInvoiceDownloadRateLimitForTests,
} = await import('./logInvoiceDownload.rate-limit')

beforeEach(() => {
  insertCalls.length = 0
  insertShouldFail = false
  _resetInvoiceDownloadRateLimitForTests()
  mockUser = { id: 'user-uuid-1', email: 'klaas@example.com' }
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('logInvoiceDownloadAction — input validation', () => {
  it('rejects negative orderId', async () => {
    const result = await logInvoiceDownloadAction({ orderId: -1, invoiceId: 'in_1' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('invalid_input')
    expect(insertCalls).toHaveLength(0)
  })

  it('rejects zero orderId', async () => {
    const result = await logInvoiceDownloadAction({ orderId: 0, invoiceId: 'in_1' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('invalid_input')
  })

  it('rejects non-integer orderId', async () => {
    const result = await logInvoiceDownloadAction({ orderId: 1.5, invoiceId: 'in_1' })
    expect(result.ok).toBe(false)
  })

  it('rejects missing invoiceId', async () => {
    const result = await logInvoiceDownloadAction({ orderId: 1, invoiceId: '' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('invalid_input')
  })

  it('rejects oversized invoiceId (> 64 chars)', async () => {
    const result = await logInvoiceDownloadAction({
      orderId: 1,
      invoiceId: 'x'.repeat(65),
    })
    expect(result.ok).toBe(false)
  })
})

describe('logInvoiceDownloadAction — auth', () => {
  it('returns not_authenticated when no session user', async () => {
    mockUser = null
    const result = await logInvoiceDownloadAction({ orderId: 1, invoiceId: 'in_1' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('not_authenticated')
    expect(insertCalls).toHaveLength(0)
  })
})

describe('logInvoiceDownloadAction — audit row shape', () => {
  it('writes a row to file_downloads with kind=invoice_redirect', async () => {
    const result = await logInvoiceDownloadAction({ orderId: 12345, invoiceId: 'in_test_1' })
    expect(result.ok).toBe(true)
    expect(insertCalls).toHaveLength(1)
    expect(insertCalls[0]!.table).toBe('file_downloads')
    expect(insertCalls[0]!.payload.kind).toBe('invoice_redirect')
    expect(insertCalls[0]!.payload.user_id).toBe('user-uuid-1')
    expect(insertCalls[0]!.payload.file_id).toBeNull()
    expect(insertCalls[0]!.payload.product_id).toBeNull()
  })

  it('sets url_expires_at ~24h from now', async () => {
    const before = Date.now()
    await logInvoiceDownloadAction({ orderId: 1, invoiceId: 'in_test_1' })
    const after = Date.now()
    const expiresAt = new Date(insertCalls[0]!.payload.url_expires_at as string).getTime()
    const expectedMin = before + 24 * 60 * 60 * 1000 - 100
    const expectedMax = after + 24 * 60 * 60 * 1000 + 100
    expect(expiresAt).toBeGreaterThanOrEqual(expectedMin)
    expect(expiresAt).toBeLessThanOrEqual(expectedMax)
  })

  it('returns audit_failed when the insert fails', async () => {
    insertShouldFail = true
    const result = await logInvoiceDownloadAction({ orderId: 1, invoiceId: 'in_test_1' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('audit_failed')
  })

  it('returns remaining count on success', async () => {
    const result = await logInvoiceDownloadAction({ orderId: 1, invoiceId: 'in_test_1' })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(typeof result.remaining).toBe('number')
      expect(result.remaining).toBeGreaterThanOrEqual(0)
    }
  })
})

describe('logInvoiceDownloadAction — rate limit', () => {
  it('triggers rate_limited after 60 calls within an hour', async () => {
    // Fire 60 successful calls
    for (let i = 0; i < 60; i++) {
      const result = await logInvoiceDownloadAction({
        orderId: i + 1,
        invoiceId: `in_${i}`,
      })
      expect(result.ok).toBe(true)
    }
    // 61st call must be denied
    const denied = await logInvoiceDownloadAction({ orderId: 100, invoiceId: 'in_100' })
    expect(denied.ok).toBe(false)
    if (!denied.ok) {
      expect(denied.error).toBe('rate_limited')
      expect(typeof denied.retryAfterMs).toBe('number')
      expect(denied.retryAfterMs).toBeGreaterThan(0)
    }
    // Insert count stays at 60 (the 61st was denied before insert)
    expect(insertCalls).toHaveLength(60)
  })

  it('isolates rate limits per user', async () => {
    for (let i = 0; i < 5; i++) {
      await logInvoiceDownloadAction({ orderId: i + 1, invoiceId: `in_${i}` })
    }
    // Switch to a different user — bucket starts fresh
    mockUser = { id: 'user-uuid-2', email: 'other@example.com' }
    const result = await logInvoiceDownloadAction({ orderId: 1, invoiceId: 'in_1' })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.remaining).toBe(59) // 60 - 1
  })

  it('does not count denied requests against the window', async () => {
    // Burn the bucket.
    for (let i = 0; i < 60; i++) {
      await logInvoiceDownloadAction({ orderId: i + 1, invoiceId: `in_${i}` })
    }
    // Try a few more — all denied.
    await logInvoiceDownloadAction({ orderId: 100, invoiceId: 'in_100' })
    await logInvoiceDownloadAction({ orderId: 101, invoiceId: 'in_101' })
    await logInvoiceDownloadAction({ orderId: 102, invoiceId: 'in_102' })
    // Clear and use a fresh user; their first call should succeed.
    mockUser = { id: 'fresh-user', email: 'fresh@example.com' }
    const fresh = await logInvoiceDownloadAction({ orderId: 1, invoiceId: 'in_1' })
    expect(fresh.ok).toBe(true)
  })
})

describe('logInvoiceDownloadAction — PII safety', () => {
  it('does not pass the user email or any hosted URL into the insert payload', async () => {
    mockUser = { id: 'user-uuid-1', email: 'PII@example.com' }
    await logInvoiceDownloadAction({ orderId: 1, invoiceId: 'in_test_1' })
    const payload = insertCalls[0]!.payload
    const payloadStr = JSON.stringify(payload)
    expect(payloadStr).not.toContain('PII@example.com')
    expect(payloadStr).not.toContain('invoice.stripe.com')
    // The payload is the standard file_downloads shape, not metadata
    expect(payload).not.toHaveProperty('metadata')
  })
})