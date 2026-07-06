// Unit tests for getOrderRefunds — covers the empty-result path, the
// defensive coercion, and the limit clamping.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@foundations/auth/guards', () => ({
  requireAdmin: vi.fn(),
}))

const rpcMock = vi.fn()
const getServerSupabaseMock = vi.fn()
vi.mock('@foundations/data/supabase', () => ({
  getServerSupabase: () => getServerSupabaseMock(),
}))

import { requireAdmin } from '@foundations/auth/guards'
import { DEFAULT_ORDER_REFUNDS_LIMIT, getOrderRefunds, MAX_ORDER_REFUNDS_LIMIT } from './getOrderRefunds'

const asAdmin = () =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ({ id: '11111111-2222-3333-4444-555555555555', email: 'admin@uthena' } as any)

describe('getOrderRefunds', () => {
  beforeEach(() => {
    rpcMock.mockReset()
    getServerSupabaseMock.mockReset()
    getServerSupabaseMock.mockResolvedValue({ rpc: rpcMock })
    vi.mocked(requireAdmin).mockResolvedValue(asAdmin())
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns [] on a malformed order id without calling RPC', async () => {
    const out = await getOrderRefunds({ rawOrderId: 'not-a-number' })
    expect(out).toEqual([])
    expect(rpcMock).not.toHaveBeenCalled()
  })

  it('returns [] on RPC error', async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: 'boom' } })
    const out = await getOrderRefunds({ rawOrderId: '1' })
    expect(out).toEqual([])
  })

  it('returns [] on an empty result set', async () => {
    rpcMock.mockResolvedValue({ data: [], error: null })
    expect(await getOrderRefunds({ rawOrderId: '1' })).toEqual([])
  })

  it('maps a happy-path refund row with the right field narrowing', async () => {
    rpcMock.mockResolvedValue({
      data: [
        {
          refund_id: '55',
          amount_cents: '1200',
          reason: 'requested_by_customer',
          notes: '   extra notes   ',
          status: 'succeeded',
          stripe_refund_id: 're_test_abc',
          requested_by: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
          requested_by_display_name: 'Jane Doe',
          approved_by: 'ffffffff-1111-2222-3333-444444444444',
          approved_by_display_name: 'Admin',
          approved_at: '2026-06-30 12:00:00+00',
          processed_at: '2026-06-30 12:01:00+00',
          created_at: '2026-06-30 11:59:00+00',
          updated_at: '2026-06-30 12:01:00+00',
        },
      ],
      error: null,
    })
    const out = await getOrderRefunds({ rawOrderId: '1' })
    expect(out).toHaveLength(1)
    expect(out[0]!.refund_id).toBe(55)
    expect(out[0]!.amount_cents).toBe(1200)
    expect(out[0]!.notes).toBe('extra notes') // trimmed
    expect(out[0]!.status).toBe('succeeded')
    expect(out[0]!.stripe_refund_id).toBe('re_test_abc')
    expect(out[0]!.approved_by_display_name).toBe('Admin')
  })

  it('clamps an unknown status to "pending"', async () => {
    rpcMock.mockResolvedValue({
      data: [
        {
          refund_id: '1',
          amount_cents: 100,
          reason: 'other',
          notes: null,
          status: 'pending_withdrawal',
          stripe_refund_id: null,
          requested_by: null,
          requested_by_display_name: null,
          approved_by: null,
          approved_by_display_name: null,
          approved_at: null,
          processed_at: null,
          created_at: '2026-06-30 00:00:00+00',
          updated_at: '2026-06-30 00:00:00+00',
        },
      ],
      error: null,
    })
    const out = await getOrderRefunds({ rawOrderId: '1' })
    expect(out[0]!.status).toBe('pending')
  })

  it('clamps the limit to the documented maximum', async () => {
    rpcMock.mockResolvedValue({ data: [], error: null })
    await getOrderRefunds({ rawOrderId: '1', limit: 99999 })
    // The 4th argument p_limit ends up clamped server-side too via
    // LEAST()/GREATEST(), but our wrapper forwards the clamped value.
    const args = rpcMock.mock.calls[0]?.[1] as Record<string, unknown>
    expect(args?.['p_limit']).toBe(MAX_ORDER_REFUNDS_LIMIT)
  })

  it('forwards the default limit when none is provided', async () => {
    rpcMock.mockResolvedValue({ data: [], error: null })
    await getOrderRefunds({ rawOrderId: '1' })
    const args = rpcMock.mock.calls[0]?.[1] as Record<string, unknown>
    expect(args?.['p_limit']).toBe(DEFAULT_ORDER_REFUNDS_LIMIT)
  })

  it('clamps a zero / negative limit to the minimum (1)', async () => {
    rpcMock.mockResolvedValue({ data: [], error: null })
    await getOrderRefunds({ rawOrderId: '1', limit: 0 })
    const args = rpcMock.mock.calls[0]?.[1] as Record<string, unknown>
    expect(args?.['p_limit']).toBe(1)
  })
})
