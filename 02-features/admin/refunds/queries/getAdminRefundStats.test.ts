// getAdminRefundStats.test.ts — server query unit tests.

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

import { getAdminRefundStats } from './getAdminRefundStats'
import { EMPTY_REFUND_STATS } from '../types'

beforeEach(() => {
  rpcMock.mockReset()
})

describe('getAdminRefundStats', () => {
  it('returns EMPTY_REFUND_STATS when RPC fails', async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: 'rpc failed' } })
    const out = await getAdminRefundStats()
    expect(out).toEqual(EMPTY_REFUND_STATS)
  })

  it('returns EMPTY_REFUND_STATS when RPC returns 0 rows', async () => {
    rpcMock.mockResolvedValueOnce({ data: [], error: null })
    const out = await getAdminRefundStats()
    expect(out).toEqual(EMPTY_REFUND_STATS)
  })

  it('returns EMPTY_REFUND_STATS when RPC throws', async () => {
    rpcMock.mockRejectedValueOnce(new Error('connection reset'))
    const out = await getAdminRefundStats()
    expect(out).toEqual(EMPTY_REFUND_STATS)
  })

  it('happy path: maps every bucket', async () => {
    rpcMock.mockResolvedValueOnce({
      data: [
        {
          total: '50',
          pending: '10',
          approved: '5',
          succeeded: '30',
          failed: '3',
          canceled: '2',
        },
      ],
      error: null,
    })
    const out = await getAdminRefundStats()
    expect(out).toEqual({
      total: 50,
      pending: 10,
      approved: 5,
      succeeded: 30,
      failed: 3,
      canceled: 2,
    })
  })

  it('coerces numeric fields from string', async () => {
    rpcMock.mockResolvedValueOnce({
      data: [
        {
          total: '7',
          pending: '1',
          approved: '2',
          succeeded: '3',
          failed: '0',
          canceled: '1',
        },
      ],
      error: null,
    })
    const out = await getAdminRefundStats()
    expect(out.total).toBe(7)
    expect(out.failed).toBe(0)
  })

  it('handles missing fields defensively (coerces to 0)', async () => {
    rpcMock.mockResolvedValueOnce({
      data: [
        {
          total: 1,
          // pending / approved / succeeded / failed / canceled all missing
        },
      ],
      error: null,
    })
    const out = await getAdminRefundStats()
    expect(out).toEqual({
      total: 1,
      pending: 0,
      approved: 0,
      succeeded: 0,
      failed: 0,
      canceled: 0,
    })
  })
})