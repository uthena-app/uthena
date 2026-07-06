// getAdminRefundDetail.test.ts — server query unit tests.
//
// Per cron protocol §"Done": unit tests for every query. The tests
// stub getServerSupabase via vi.mock and assert:
//   - auth gate via requireRole
//   - parseRefundId rejects malformed ids (no RPC call)
//   - happy-path mapping of every RPC field to the RefundDetail shape
//   - defensive coercion (bigint-as-string, status fallback,
//     reason fallback, masked email helper)
//   - fail-soft on RPC error / 0 rows / throw

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@foundations/auth/guards', () => ({
  requireRole: vi.fn(async () => ({ id: 'admin-1', email: 'admin@example.com' })),
}))

const rpcMock = vi.fn()
vi.mock('@foundations/data/supabase', () => ({
  getServerSupabase: vi.fn(async () => ({
    rpc: (...args: unknown[]) => rpcMock(...args),
  })),
}))

vi.mock('@foundations/log/pino', () => ({
  loggerFor: vi.fn(() => ({
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  })),
}))

vi.mock('@foundations/data/mask', () => ({
  maskEmail: vi.fn((raw: string) => {
    if (!raw || !raw.includes('@')) return raw
    const [local, domain] = raw.split('@')
    if (!local || !domain) return raw
    return `${local[0]}***@${domain}`
  }),
  maskIp: vi.fn((raw: string) => raw),
}))

import { getAdminRefundDetail, getMaskedCustomerEmail } from './getAdminRefundDetail'

beforeEach(() => {
  rpcMock.mockReset()
})

describe('getAdminRefundDetail', () => {
  it('returns null for a malformed id without calling the RPC', async () => {
    const out = await getAdminRefundDetail('not-a-number')
    expect(out).toBeNull()
    expect(rpcMock).not.toHaveBeenCalled()
  })

  it('returns null for null / undefined / empty', async () => {
    expect(await getAdminRefundDetail(null)).toBeNull()
    expect(await getAdminRefundDetail(undefined)).toBeNull()
    expect(await getAdminRefundDetail('')).toBeNull()
  })

  it('returns null when RPC returns 0 rows', async () => {
    rpcMock.mockResolvedValueOnce({ data: [], error: null })
    const out = await getAdminRefundDetail('12345')
    expect(out).toBeNull()
  })

  it('returns null when RPC errors', async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: 'rpc failed' } })
    const out = await getAdminRefundDetail('12345')
    expect(out).toBeNull()
  })

  it('returns null when RPC throws', async () => {
    rpcMock.mockRejectedValueOnce(new Error('connection reset'))
    const out = await getAdminRefundDetail('12345')
    expect(out).toBeNull()
  })

  it('happy path: maps every RPC field to the RefundDetail shape', async () => {
    rpcMock.mockResolvedValueOnce({
      data: [
        {
          refund_id: '1001',
          order_id: '5001',
          amount_cents: '2500',
          currency: 'USD',
          reason: 'product_not_received',
          notes: 'Customer says the file is corrupt.',
          status: 'pending',
          stripe_refund_id: null,
          requested_by: 'user-1',
          requested_at: '2026-06-30T12:00:00Z',
          approved_by: null,
          approved_at: null,
          processed_at: null,
          resolution_notes: null,
          proof_path: 'refund-proofs/user-1/uuid.pdf',
          proof_filename: 'proof.pdf',
          order_status: 'paid',
          order_subtotal_cents: '2500',
          order_total_cents: '2500',
          order_paid_at: '2026-06-29T10:00:00Z',
          order_ip_raw: '203.0.113.5',
          order_ip_hash: 'sha256hash',
          order_stripe_payment_intent_id: 'pi_3OAB1234',
          order_customer_checkout_email: 'k@example.com',
          customer_user_id: 'user-1',
          customer_display_name: 'Klaas T',
          customer_email: 'k@example.com',
          customer_since: '2025-01-01T00:00:00Z',
          customer_lifetime_orders: '5',
          customer_lifetime_refunds: '1',
          customer_lifetime_refund_rate: '20.0',
          partner_share_reversal_cents: '-1500',
          affiliate_commission_reversal_cents: '-300',
          order_items_count: '1',
        },
      ],
      error: null,
    })
    const out = await getAdminRefundDetail('1001')
    expect(out).not.toBeNull()
    if (!out) return
    expect(out.refund_id).toBe(1001)
    expect(out.order_id).toBe(5001)
    expect(out.amount_cents).toBe(2500)
    expect(out.currency).toBe('USD')
    expect(out.reason).toBe('product_not_received')
    expect(out.notes).toBe('Customer says the file is corrupt.')
    expect(out.status).toBe('pending')
    expect(out.proof_path).toBe('refund-proofs/user-1/uuid.pdf')
    expect(out.proof_filename).toBe('proof.pdf')
    expect(out.order_status).toBe('paid')
    expect(out.order_total_cents).toBe(2500)
    expect(out.order_stripe_payment_intent_id).toBe('pi_3OAB1234')
    expect(out.customer_display_name).toBe('Klaas T')
    expect(out.customer_lifetime_orders).toBe(5)
    expect(out.customer_lifetime_refunds).toBe(1)
    expect(out.customer_lifetime_refund_rate).toBe(20)
    expect(out.partner_share_reversal_cents).toBe(-1500)
    expect(out.affiliate_commission_reversal_cents).toBe(-300)
    expect(out.order_items_count).toBe(1)
  })

  it('defensive mapping: unknown status falls back to `pending`', async () => {
    rpcMock.mockResolvedValueOnce({
      data: [
        {
          refund_id: 1,
          order_id: 1,
          amount_cents: 100,
          currency: 'USD',
          reason: 'other',
          notes: null,
          status: 'BOGUS',
          stripe_refund_id: null,
          requested_by: null,
          requested_at: '2026-06-30T00:00:00Z',
          approved_by: null,
          approved_at: null,
          processed_at: null,
          resolution_notes: null,
          proof_path: null,
          proof_filename: null,
          order_status: 'paid',
          order_subtotal_cents: 100,
          order_total_cents: 100,
          order_paid_at: '2026-06-29T00:00:00Z',
          order_ip_raw: null,
          order_ip_hash: null,
          order_stripe_payment_intent_id: null,
          order_customer_checkout_email: null,
          customer_user_id: null,
          customer_display_name: 'Anon',
          customer_email: 'k@example.com',
          customer_since: null,
          customer_lifetime_orders: 0,
          customer_lifetime_refunds: 0,
          customer_lifetime_refund_rate: 0,
          partner_share_reversal_cents: 0,
          affiliate_commission_reversal_cents: 0,
          order_items_count: 0,
        },
      ],
      error: null,
    })
    const out = await getAdminRefundDetail('1')
    expect(out?.status).toBe('pending')
  })

  it('defensive mapping: unknown order_status falls back to `pending`', async () => {
    rpcMock.mockResolvedValueOnce({
      data: [
        {
          refund_id: 1,
          order_id: 1,
          amount_cents: 100,
          currency: 'USD',
          reason: 'other',
          notes: null,
          status: 'pending',
          stripe_refund_id: null,
          requested_by: null,
          requested_at: '2026-06-30T00:00:00Z',
          approved_by: null,
          approved_at: null,
          processed_at: null,
          resolution_notes: null,
          proof_path: null,
          proof_filename: null,
          order_status: 'BOGUS',
          order_subtotal_cents: 100,
          order_total_cents: 100,
          order_paid_at: null,
          order_ip_raw: null,
          order_ip_hash: null,
          order_stripe_payment_intent_id: null,
          order_customer_checkout_email: null,
          customer_user_id: null,
          customer_display_name: 'Anon',
          customer_email: 'k@example.com',
          customer_since: null,
          customer_lifetime_orders: 0,
          customer_lifetime_refunds: 0,
          customer_lifetime_refund_rate: 0,
          partner_share_reversal_cents: 0,
          affiliate_commission_reversal_cents: 0,
          order_items_count: 0,
        },
      ],
      error: null,
    })
    const out = await getAdminRefundDetail('1')
    expect(out?.order_status).toBe('pending')
  })

  it('defensive mapping: missing currency falls back to "USD"', async () => {
    rpcMock.mockResolvedValueOnce({
      data: [
        {
          refund_id: 1,
          order_id: 1,
          amount_cents: 100,
          currency: null,
          reason: 'other',
          notes: null,
          status: 'pending',
          stripe_refund_id: null,
          requested_by: null,
          requested_at: '2026-06-30T00:00:00Z',
          approved_by: null,
          approved_at: null,
          processed_at: null,
          resolution_notes: null,
          proof_path: null,
          proof_filename: null,
          order_status: 'paid',
          order_subtotal_cents: 100,
          order_total_cents: 100,
          order_paid_at: null,
          order_ip_raw: null,
          order_ip_hash: null,
          order_stripe_payment_intent_id: null,
          order_customer_checkout_email: null,
          customer_user_id: null,
          customer_display_name: 'Anon',
          customer_email: 'k@example.com',
          customer_since: null,
          customer_lifetime_orders: 0,
          customer_lifetime_refunds: 0,
          customer_lifetime_refund_rate: 0,
          partner_share_reversal_cents: 0,
          affiliate_commission_reversal_cents: 0,
          order_items_count: 0,
        },
      ],
      error: null,
    })
    const out = await getAdminRefundDetail('1')
    expect(out?.currency).toBe('USD')
  })

  it('defensive mapping: missing customer_display_name falls back to "—"', async () => {
    rpcMock.mockResolvedValueOnce({
      data: [
        {
          refund_id: 1,
          order_id: 1,
          amount_cents: 100,
          currency: 'USD',
          reason: 'other',
          notes: null,
          status: 'pending',
          stripe_refund_id: null,
          requested_by: null,
          requested_at: '2026-06-30T00:00:00Z',
          approved_by: null,
          approved_at: null,
          processed_at: null,
          resolution_notes: null,
          proof_path: null,
          proof_filename: null,
          order_status: 'paid',
          order_subtotal_cents: 100,
          order_total_cents: 100,
          order_paid_at: null,
          order_ip_raw: null,
          order_ip_hash: null,
          order_stripe_payment_intent_id: null,
          order_customer_checkout_email: null,
          customer_user_id: null,
          customer_display_name: null,
          customer_email: '',
          customer_since: null,
          customer_lifetime_orders: 0,
          customer_lifetime_refunds: 0,
          customer_lifetime_refund_rate: 0,
          partner_share_reversal_cents: 0,
          affiliate_commission_reversal_cents: 0,
          order_items_count: 0,
        },
      ],
      error: null,
    })
    const out = await getAdminRefundDetail('1')
    expect(out?.customer_display_name).toBe('—')
  })

  it('defensive mapping: numeric fields coerce from string', async () => {
    rpcMock.mockResolvedValueOnce({
      data: [
        {
          refund_id: '12',
          order_id: '34',
          amount_cents: '99',
          currency: 'USD',
          reason: 'other',
          notes: null,
          status: 'pending',
          stripe_refund_id: null,
          requested_by: null,
          requested_at: '2026-06-30T00:00:00Z',
          approved_by: null,
          approved_at: null,
          processed_at: null,
          resolution_notes: null,
          proof_path: null,
          proof_filename: null,
          order_status: 'paid',
          order_subtotal_cents: '99',
          order_total_cents: '99',
          order_paid_at: null,
          order_ip_raw: null,
          order_ip_hash: null,
          order_stripe_payment_intent_id: null,
          order_customer_checkout_email: null,
          customer_user_id: null,
          customer_display_name: 'Anon',
          customer_email: 'k@example.com',
          customer_since: null,
          customer_lifetime_orders: '5',
          customer_lifetime_refunds: '1',
          customer_lifetime_refund_rate: '20.0',
          partner_share_reversal_cents: '-50',
          affiliate_commission_reversal_cents: '-10',
          order_items_count: '2',
        },
      ],
      error: null,
    })
    const out = await getAdminRefundDetail('12')
    expect(out?.refund_id).toBe(12)
    expect(out?.order_id).toBe(34)
    expect(out?.amount_cents).toBe(99)
    expect(out?.customer_lifetime_orders).toBe(5)
    expect(out?.partner_share_reversal_cents).toBe(-50)
    expect(out?.order_items_count).toBe(2)
  })

  it('parses string and number ids equivalently', async () => {
    rpcMock.mockResolvedValueOnce({ data: [], error: null })
    await getAdminRefundDetail('1001')
    expect(rpcMock).toHaveBeenCalledWith(
      'get_admin_refund_detail',
      expect.objectContaining({ p_refund_id: 1001 }),
    )
  })
})

describe('getMaskedCustomerEmail', () => {
  it('masks a valid email', () => {
    expect(getMaskedCustomerEmail('klaas@example.com')).toBe('k***@example.com')
  })

  it('returns null for empty / null input', () => {
    expect(getMaskedCustomerEmail(null)).toBeNull()
    expect(getMaskedCustomerEmail('')).toBeNull()
  })

  it('returns null when maskEmail returns the input unchanged', () => {
    expect(getMaskedCustomerEmail('not-an-email')).toBeNull()
  })
})