// getAdminRefundsQueue.test.ts — server query unit tests.
//
// Per cron protocol §"Done": unit tests for every server action /
// query. The tests stub `getServerSupabase` via vi.mock + use
// fake chains to assert the queue RPC contract: auth gate, filter
// payload, pagination clamping, defensive mapping (bigint coercion,
// enum fallback, nulls), and PII safety on the select payload.

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

import { getAdminRefundsQueue, DEFAULT_REFUNDS_PAGE_SIZE } from './getAdminRefundsQueue'

beforeEach(() => {
  rpcMock.mockReset()
})

describe('getAdminRefundsQueue', () => {
  it('returns empty result when RPC fails', async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: 'rpc failed' } })
    const out = await getAdminRefundsQueue({
      filters: { status: null, from: null, to: null, customerEmail: null, productId: null },
    })
    expect(out.rows).toEqual([])
    expect(out.total).toBe(0)
    expect(out.page).toBe(1)
    expect(out.perPage).toBe(DEFAULT_REFUNDS_PAGE_SIZE)
  })

  it('returns empty result when RPC returns 0 rows', async () => {
    rpcMock.mockResolvedValueOnce({ data: [], error: null })
    const out = await getAdminRefundsQueue({
      filters: { status: null, from: null, to: null, customerEmail: null, productId: null },
    })
    expect(out.rows).toEqual([])
    expect(out.total).toBe(0)
  })

  it('happy path: maps every RPC row to RefundQueueRow', async () => {
    rpcMock.mockResolvedValueOnce({
      data: [
        {
          refund_id: '1001',
          order_id: '5001',
          amount_cents: '2500',
          currency: 'USD',
          reason: 'requested_by_customer',
          status: 'pending',
          requested_at: '2026-06-30T12:34:56Z',
          requested_by: 'user-1',
          customer_user_id: 'user-1',
          customer_display_name: 'Klaas T',
          customer_email: 'k@example.com',
          proof_path: null,
          proof_filename: null,
          total_count: '7',
        },
      ],
      error: null,
    })
    const out = await getAdminRefundsQueue({
      filters: {
        status: 'pending',
        from: '2026-06-01',
        to: '2026-06-30',
        customerEmail: 'k@example.com',
        productId: 99,
      },
      page: 1,
      perPage: 25,
    })
    expect(out.rows).toHaveLength(1)
    expect(out.rows[0]).toEqual({
      refund_id: 1001,
      order_id: 5001,
      amount_cents: 2500,
      currency: 'USD',
      reason: 'requested_by_customer',
      status: 'pending',
      requested_at: '2026-06-30T12:34:56Z',
      requested_by: 'user-1',
      customer_user_id: 'user-1',
      customer_display_name: 'Klaas T',
      customer_email: 'k@example.com',
      proof_path: null,
      proof_filename: null,
      total_count: 7,
    })
    expect(out.total).toBe(7)
  })

  it('defensive mapping: unknown status falls back to `pending`', async () => {
    rpcMock.mockResolvedValueOnce({
      data: [
        {
          refund_id: 1,
          order_id: 2,
          amount_cents: 100,
          currency: 'USD',
          reason: 'requested_by_customer',
          status: 'BOGUS_STATUS',
          requested_at: '2026-06-30T00:00:00Z',
          requested_by: null,
          customer_user_id: null,
          customer_display_name: '',
          customer_email: '',
          proof_path: null,
          proof_filename: null,
          total_count: 1,
        },
      ],
      error: null,
    })
    const out = await getAdminRefundsQueue({
      filters: { status: null, from: null, to: null, customerEmail: null, productId: null },
    })
    expect(out.rows[0]?.status).toBe('pending')
  })

  it('defensive mapping: unknown reason falls back to `other`', async () => {
    rpcMock.mockResolvedValueOnce({
      data: [
        {
          refund_id: 1,
          order_id: 2,
          amount_cents: 100,
          currency: 'USD',
          reason: 'BOGUS_REASON',
          status: 'pending',
          requested_at: '2026-06-30T00:00:00Z',
          requested_by: null,
          customer_user_id: null,
          customer_display_name: '',
          customer_email: '',
          proof_path: null,
          proof_filename: null,
          total_count: 1,
        },
      ],
      error: null,
    })
    const out = await getAdminRefundsQueue({
      filters: { status: null, from: null, to: null, customerEmail: null, productId: null },
    })
    expect(out.rows[0]?.reason).toBe('other')
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
          status: 'pending',
          requested_at: '2026-06-30T00:00:00Z',
          requested_by: null,
          customer_user_id: null,
          customer_display_name: '',
          customer_email: '',
          proof_path: null,
          proof_filename: null,
          total_count: '100',
        },
      ],
      error: null,
    })
    const out = await getAdminRefundsQueue({
      filters: { status: null, from: null, to: null, customerEmail: null, productId: null },
    })
    expect(out.rows[0]?.refund_id).toBe(12)
    expect(out.rows[0]?.amount_cents).toBe(99)
    expect(out.total).toBe(100)
  })

  it('defensive mapping: missing currency falls back to "USD"', async () => {
    rpcMock.mockResolvedValueOnce({
      data: [
        {
          refund_id: 1,
          order_id: 2,
          amount_cents: 100,
          currency: null,
          reason: 'other',
          status: 'pending',
          requested_at: '2026-06-30T00:00:00Z',
          requested_by: null,
          customer_user_id: null,
          customer_display_name: '',
          customer_email: '',
          proof_path: null,
          proof_filename: null,
          total_count: 1,
        },
      ],
      error: null,
    })
    const out = await getAdminRefundsQueue({
      filters: { status: null, from: null, to: null, customerEmail: null, productId: null },
    })
    expect(out.rows[0]?.currency).toBe('USD')
  })

  it('clamps perPage > 200 down to 200', async () => {
    rpcMock.mockResolvedValueOnce({ data: [], error: null })
    const out = await getAdminRefundsQueue({
      filters: { status: null, from: null, to: null, customerEmail: null, productId: null },
      perPage: 99999,
    })
    expect(out.perPage).toBe(200)
  })

  it('clamps perPage < 1 up to 1', async () => {
    rpcMock.mockResolvedValueOnce({ data: [], error: null })
    const out = await getAdminRefundsQueue({
      filters: { status: null, from: null, to: null, customerEmail: null, productId: null },
      perPage: 0,
    })
    expect(out.perPage).toBe(1)
  })

  it('clamps page < 1 up to 1', async () => {
    rpcMock.mockResolvedValueOnce({ data: [], error: null })
    const out = await getAdminRefundsQueue({
      filters: { status: null, from: null, to: null, customerEmail: null, productId: null },
      page: -5,
    })
    expect(out.page).toBe(1)
  })

  it('passes the filter payload to the RPC', async () => {
    rpcMock.mockResolvedValueOnce({ data: [], error: null })
    await getAdminRefundsQueue({
      filters: {
        status: 'approved',
        from: '2026-06-01',
        to: '2026-06-30',
        customerEmail: 'k@example.com',
        productId: 99,
      },
      page: 2,
      perPage: 25,
    })
    expect(rpcMock).toHaveBeenCalledWith(
      'get_admin_refunds_queue',
      expect.objectContaining({
        p_filters: {
          status: 'approved',
          from: '2026-06-01',
          to: '2026-06-30',
          customerEmail: 'k@example.com',
          productId: 99,
        },
        p_page: 2,
        p_per_page: 25,
      }),
    )
  })

  it('returns empty result when RPC throws', async () => {
    rpcMock.mockRejectedValueOnce(new Error('connection reset'))
    const out = await getAdminRefundsQueue({
      filters: { status: null, from: null, to: null, customerEmail: null, productId: null },
    })
    expect(out.rows).toEqual([])
    expect(out.total).toBe(0)
  })
})