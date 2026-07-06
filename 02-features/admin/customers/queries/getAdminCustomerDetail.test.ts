// getAdminCustomerDetail.test.ts — unit tests for the customer detail
// query wrapper.
//
// Pattern matches the existing getAdminCustomersList.test.ts +
// getAdminCustomerStats.test.ts — mock the Supabase client + assert
// the RPC shape + the defensive mapping.

import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock the foundations layer so we can control auth + supabase +
// logger without pulling real env vars.
vi.mock('@foundations/auth/guards', () => ({
  requireAdmin: vi.fn(async () => ({
    id: 'admin-id',
    email: 'admin@uthena.com',
    role: 'admin',
    display_name: 'Admin',
  })),
}))

const mockRpc = vi.fn()
const mockFrom = vi.fn()
const mockOrder = vi.fn()
const mockLimit = vi.fn()
const mockMaybeSingle = vi.fn()
const mockNot = vi.fn()
const mockEq = vi.fn()

vi.mock('@foundations/data/supabase', () => ({
  getServerSupabase: vi.fn(async () => ({
    rpc: mockRpc,
    from: mockFrom,
  })),
}))

vi.mock('@foundations/log/pino', () => ({
  loggerFor: vi.fn(() => ({
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}))

import { getAdminCustomerDetail } from './getAdminCustomerDetail'

const VALID_UUID = '550e8400-e29b-41d4-a716-446655440000'

function buildRpcResult(rows: unknown[] | null, error: unknown = null) {
  return { data: rows, error }
}

function chainableOrder(thenable: Promise<unknown>) {
  const obj: Record<string, unknown> = {
    order: vi.fn(() => obj),
    limit: vi.fn(() => obj),
    maybeSingle: vi.fn(() => thenable),
    not: vi.fn(() => obj),
    eq: vi.fn(() => obj),
    single: vi.fn(() => thenable),
    select: vi.fn(() => obj),
    insert: vi.fn(() => obj),
    update: vi.fn(() => obj),
    delete: vi.fn(() => obj),
  }
  // Make `await chainable.then(...)` work for safety in case the
  // caller awaits the chain itself.
  ;(obj as { then: unknown }).then = (
    onFulfilled?: (v: unknown) => unknown,
    onRejected?: (e: unknown) => unknown,
  ) => thenable.then(onFulfilled, onRejected)
  return obj
}

beforeEach(() => {
  vi.clearAllMocks()
  // Re-wire defaults: orders query returns a single row with masked ip.
  const orderThenable = Promise.resolve({ data: { ip: '192.168.1.42' }, error: null })
  const chainable = chainableOrder(orderThenable)
  mockFrom.mockReturnValue(chainable)
  mockRpc.mockResolvedValue(buildRpcResult(null))
})

describe('getAdminCustomerDetail', () => {
  describe('input validation', () => {
    it('returns null for invalid uuid', async () => {
      const result = await getAdminCustomerDetail('not-a-uuid')
      expect(result).toBeNull()
      expect(mockRpc).not.toHaveBeenCalled()
    })

    it('returns null for null input', async () => {
      const result = await getAdminCustomerDetail(null as unknown as string)
      expect(result).toBeNull()
      expect(mockRpc).not.toHaveBeenCalled()
    })

    it('returns null for undefined input', async () => {
      const result = await getAdminCustomerDetail(undefined as unknown as string)
      expect(result).toBeNull()
      expect(mockRpc).not.toHaveBeenCalled()
    })

    it('lowercases uppercase uuid', async () => {
      const rpcRows = [
        {
          user_id: VALID_UUID,
          display_name: 'Jane Doe',
          avatar_url: null,
          bio: null,
          locale: 'en',
          timezone: 'UTC',
          role: 'customer',
          status: 'active',
          suspended_at: null,
          suspended_until: null,
          suspended_reason: null,
          banned_at: null,
          banned_reason: null,
          banned_by: null,
          warnings_count: 0,
          signup_date: '2026-01-15T00:00:00Z',
          profile_updated_at: '2026-01-15T00:00:00Z',
          email: 'jane@example.com',
          last_sign_in_at: '2026-06-29T12:00:00Z',
          lifetime_spend_cents: 0,
          order_count: 0,
          library_size: 0,
          last_active_at: null,
          refund_count: 0,
          refund_rate: 0,
          risk_refund_count: 0,
          risk_dispute_count: 0,
          risk_signal_severity_sum: 0,
          risk_refund_contribution: 0,
          risk_dispute_contribution: 0,
          risk_activity_contribution: 0,
          risk_total_score: 0,
        },
      ]
      mockRpc.mockResolvedValueOnce(buildRpcResult(rpcRows))
      const result = await getAdminCustomerDetail(VALID_UUID.toUpperCase())
      expect(result).not.toBeNull()
      expect(result?.user_id).toBe(VALID_UUID)
    })
  })

  describe('happy path', () => {
    it('returns a fully-populated detail object', async () => {
      const rpcRows = [
        {
          user_id: VALID_UUID,
          display_name: 'Jane Doe',
          avatar_url: 'https://cdn.example.com/avatar.jpg',
          bio: 'Hello world',
          locale: 'en',
          timezone: 'UTC',
          role: 'customer',
          status: 'active',
          suspended_at: null,
          suspended_until: null,
          suspended_reason: null,
          banned_at: null,
          banned_reason: null,
          banned_by: null,
          warnings_count: 0,
          signup_date: '2026-01-15T00:00:00Z',
          profile_updated_at: '2026-06-29T12:00:00Z',
          email: 'jane.doe@example.com',
          last_sign_in_at: '2026-06-29T12:00:00Z',
          lifetime_spend_cents: 12500,
          order_count: 3,
          library_size: 2,
          last_active_at: '2026-06-29T12:00:00Z',
          refund_count: 1,
          refund_rate: 33.33,
          risk_refund_count: 1,
          risk_dispute_count: 0,
          risk_signal_severity_sum: 0,
          risk_refund_contribution: 8,
          risk_dispute_contribution: 0,
          risk_activity_contribution: 0,
          risk_total_score: 8,
        },
      ]
      mockRpc.mockResolvedValueOnce(buildRpcResult(rpcRows))

      const result = await getAdminCustomerDetail(VALID_UUID)
      expect(result).not.toBeNull()
      expect(result?.display_name).toBe('Jane Doe')
      expect(result?.role).toBe('customer')
      expect(result?.status).toBe('active')
      expect(result?.email_raw).toBe('jane.doe@example.com')
      expect(result?.email_masked).toBe('j***@example.com')
      expect(result?.first_seen_ip_raw).toBe('192.168.1.42')
      expect(result?.first_seen_ip_masked).toBe('192.168....')
      expect(result?.lifetime_spend_cents).toBe(12500)
      expect(result?.order_count).toBe(3)
      expect(result?.refund_rate).toBe(33.33)
      expect(result?.risk_score).toBe(8)
      expect(result?.risk_refund_contribution).toBe(8)
    })

    it('coerces bigint-as-string defensive', async () => {
      const rpcRows = [
        {
          user_id: VALID_UUID,
          display_name: 'Jane Doe',
          avatar_url: null,
          bio: null,
          locale: 'en',
          timezone: 'UTC',
          role: 'customer',
          status: 'active',
          suspended_at: null,
          suspended_until: null,
          suspended_reason: null,
          banned_at: null,
          banned_reason: null,
          banned_by: null,
          warnings_count: '0',
          signup_date: '2026-01-15T00:00:00Z',
          profile_updated_at: '2026-01-15T00:00:00Z',
          email: null,
          last_sign_in_at: null,
          lifetime_spend_cents: '12500',
          order_count: '3',
          library_size: '2',
          last_active_at: null,
          refund_count: '1',
          refund_rate: '33.33',
          risk_refund_count: '1',
          risk_dispute_count: '0',
          risk_signal_severity_sum: '0',
          risk_refund_contribution: '8',
          risk_dispute_contribution: '0',
          risk_activity_contribution: '0',
          risk_total_score: '8',
        },
      ]
      mockRpc.mockResolvedValueOnce(buildRpcResult(rpcRows))
      const result = await getAdminCustomerDetail(VALID_UUID)
      expect(result?.lifetime_spend_cents).toBe(12500)
      expect(result?.order_count).toBe(3)
      expect(result?.risk_score).toBe(8)
    })

    it('falls back to null email mask when email is null', async () => {
      const rpcRows = [
        {
          user_id: VALID_UUID,
          display_name: 'Jane Doe',
          avatar_url: null,
          bio: null,
          locale: 'en',
          timezone: 'UTC',
          role: 'customer',
          status: 'active',
          suspended_at: null,
          suspended_until: null,
          suspended_reason: null,
          banned_at: null,
          banned_reason: null,
          banned_by: null,
          warnings_count: 0,
          signup_date: '2026-01-15T00:00:00Z',
          profile_updated_at: '2026-01-15T00:00:00Z',
          email: null,
          last_sign_in_at: null,
          lifetime_spend_cents: 0,
          order_count: 0,
          library_size: 0,
          last_active_at: null,
          refund_count: 0,
          refund_rate: 0,
          risk_refund_count: 0,
          risk_dispute_count: 0,
          risk_signal_severity_sum: 0,
          risk_refund_contribution: 0,
          risk_dispute_contribution: 0,
          risk_activity_contribution: 0,
          risk_total_score: 0,
        },
      ]
      mockRpc.mockResolvedValueOnce(buildRpcResult(rpcRows))
      const result = await getAdminCustomerDetail(VALID_UUID)
      expect(result?.email_raw).toBeNull()
      expect(result?.email_masked).toBeNull()
    })

    it('coerces unknown role / status to safe defaults', async () => {
      const rpcRows = [
        {
          user_id: VALID_UUID,
          display_name: 'Jane Doe',
          avatar_url: null,
          bio: null,
          locale: 'en',
          timezone: 'UTC',
          role: 'unknown-role-typo',
          status: 'unknown-status-typo',
          suspended_at: null,
          suspended_until: null,
          suspended_reason: null,
          banned_at: null,
          banned_reason: null,
          banned_by: null,
          warnings_count: 0,
          signup_date: '2026-01-15T00:00:00Z',
          profile_updated_at: '2026-01-15T00:00:00Z',
          email: null,
          last_sign_in_at: null,
          lifetime_spend_cents: 0,
          order_count: 0,
          library_size: 0,
          last_active_at: null,
          refund_count: 0,
          refund_rate: 0,
          risk_refund_count: 0,
          risk_dispute_count: 0,
          risk_signal_severity_sum: 0,
          risk_refund_contribution: 0,
          risk_dispute_contribution: 0,
          risk_activity_contribution: 0,
          risk_total_score: 0,
        },
      ]
      mockRpc.mockResolvedValueOnce(buildRpcResult(rpcRows))
      const result = await getAdminCustomerDetail(VALID_UUID)
      expect(result?.role).toBe('customer')
      expect(result?.status).toBe('active')
    })
  })

  describe('fail-soft', () => {
    it('returns null when RPC returns an error', async () => {
      mockRpc.mockResolvedValueOnce(buildRpcResult(null, { message: 'rpc failed' }))
      const result = await getAdminCustomerDetail(VALID_UUID)
      expect(result).toBeNull()
    })

    it('returns null when RPC returns empty array (admin row / nonexistent)', async () => {
      mockRpc.mockResolvedValueOnce(buildRpcResult([]))
      const result = await getAdminCustomerDetail(VALID_UUID)
      expect(result).toBeNull()
    })

    it('returns null when RPC returns null', async () => {
      mockRpc.mockResolvedValueOnce(buildRpcResult(null))
      const result = await getAdminCustomerDetail(VALID_UUID)
      expect(result).toBeNull()
    })
  })

  describe('PII safety', () => {
    it('does NOT log the raw email on a successful read', async () => {
      // The query layer never logs the email — the raw value flows
      // through to the masked display, never to a log payload. We
      // capture all log.warn calls and assert no email-shape string
      // appears anywhere in the payload.
      const logSpy = vi.fn()
      // Re-mock the logger for this single test so we can intercept.
      const loggerForMock = (await import('@foundations/log/pino')).loggerFor as unknown as ReturnType<typeof vi.fn>
      const originalImpl = loggerForMock.getMockImplementation()
      loggerForMock.mockImplementationOnce(() => ({
        warn: logSpy,
        info: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      }))
      const rpcRows = [
        {
          user_id: VALID_UUID,
          display_name: 'Jane',
          avatar_url: null,
          bio: null,
          locale: 'en',
          timezone: 'UTC',
          role: 'customer',
          status: 'active',
          suspended_at: null,
          suspended_until: null,
          suspended_reason: null,
          banned_at: null,
          banned_reason: null,
          banned_by: null,
          warnings_count: 0,
          signup_date: '2026-01-15T00:00:00Z',
          profile_updated_at: '2026-01-15T00:00:00Z',
          email: 'jane@example.com',
          last_sign_in_at: null,
          lifetime_spend_cents: 0,
          order_count: 0,
          library_size: 0,
          last_active_at: null,
          refund_count: 0,
          refund_rate: 0,
          risk_refund_count: 0,
          risk_dispute_count: 0,
          risk_signal_severity_sum: 0,
          risk_refund_contribution: 0,
          risk_dispute_contribution: 0,
          risk_activity_contribution: 0,
          risk_total_score: 0,
        },
      ]
      mockRpc.mockResolvedValueOnce(buildRpcResult(rpcRows))
      await getAdminCustomerDetail(VALID_UUID)
      // Restore the original mock impl.
      if (originalImpl) loggerForMock.mockImplementation(originalImpl)
      // Logger might have been called with the user_id (PII-safe)
      // but NEVER the email. Inspect the warn payloads.
      const allCalls = logSpy.mock.calls
      for (const call of allCalls) {
        const payload = JSON.stringify(call)
        expect(payload).not.toContain('jane@example.com')
      }
    })
  })
})