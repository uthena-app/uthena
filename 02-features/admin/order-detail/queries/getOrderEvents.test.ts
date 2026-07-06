// Unit tests for getOrderEvents — covers the empty-result path,
// defensive event_kind coercion, and the limit clamping.

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
import { DEFAULT_ORDER_EVENTS_LIMIT, getOrderEvents, MAX_ORDER_EVENTS_LIMIT } from './getOrderEvents'

const asAdmin = () =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ({ id: '11111111-2222-3333-4444-555555555555', email: 'admin@uthena' } as any)

describe('getOrderEvents', () => {
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
    const out = await getOrderEvents({ rawOrderId: 'oops' })
    expect(out).toEqual([])
    expect(rpcMock).not.toHaveBeenCalled()
  })

  it('returns [] on RPC error', async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: 'boom' } })
    const out = await getOrderEvents({ rawOrderId: '1' })
    expect(out).toEqual([])
  })

  it('maps audit_log + webhook rows with the right field narrowing', async () => {
    rpcMock.mockResolvedValue({
      data: [
        {
          event_id: 'audit:101',
          event_kind: 'audit_log',
          event_at: '2026-06-30 12:00:00+00',
          actor_id: 'aaaaaaaa',
          actor_email: 'admin@uthena',
          action: 'admin.order_detail_viewed',
          target_kind: 'orders',
          target_id: '1',
          summary: 'admin.order_detail_viewed',
          metadata: { tab: 'overview' },
        },
        {
          event_id: 'webhook:7',
          event_kind: 'stripe_webhook',
          event_at: '2026-06-30 11:00:00+00',
          actor_id: null,
          actor_email: null,
          action: 'charge.succeeded',
          target_kind: 'processed_webhooks',
          target_id: '7',
          summary: 'charge.succeeded',
          metadata: { order_id: '1', event_id: 'evt_1' },
        },
      ],
      error: null,
    })
    const out = await getOrderEvents({ rawOrderId: '1' })
    expect(out).toHaveLength(2)
    expect(out[0]!.event_kind).toBe('audit_log')
    expect(out[1]!.event_kind).toBe('stripe_webhook')
    expect(out[1]!.metadata).toEqual({ order_id: '1', event_id: 'evt_1' })
  })

  it('falls back to audit_log for an unknown event_kind', async () => {
    rpcMock.mockResolvedValue({
      data: [
        {
          event_id: 'audit:1',
          event_kind: 'shiny_new_kind',
          event_at: '2026-06-30 00:00:00+00',
          actor_id: null,
          actor_email: null,
          action: 'noop',
          target_kind: 'orders',
          target_id: '1',
          summary: 'noop',
          metadata: null,
        },
      ],
      error: null,
    })
    const out = await getOrderEvents({ rawOrderId: '1' })
    expect(out[0]!.event_kind).toBe('audit_log')
  })

  it('caps metadata at jsonb object shape, falling back to null on garbage', async () => {
    rpcMock.mockResolvedValue({
      data: [
        {
          event_id: 'audit:1',
          event_kind: 'audit_log',
          event_at: '2026-06-30 00:00:00+00',
          actor_id: null,
          actor_email: null,
          action: 'noop',
          target_kind: 'orders',
          target_id: '1',
          summary: 'noop',
          metadata: 'string-not-object',
        },
      ],
      error: null,
    })
    const out = await getOrderEvents({ rawOrderId: '1' })
    expect(out[0]!.metadata).toBeNull()
  })

  it('clamps an oversized limit to the documented maximum', async () => {
    rpcMock.mockResolvedValue({ data: [], error: null })
    await getOrderEvents({ rawOrderId: '1', limit: 9999 })
    const args = rpcMock.mock.calls[0]?.[1] as Record<string, unknown>
    expect(args?.['p_limit']).toBe(MAX_ORDER_EVENTS_LIMIT)
  })

  it('forwards the default limit when none is provided', async () => {
    rpcMock.mockResolvedValue({ data: [], error: null })
    await getOrderEvents({ rawOrderId: '1' })
    const args = rpcMock.mock.calls[0]?.[1] as Record<string, unknown>
    expect(args?.['p_limit']).toBe(DEFAULT_ORDER_EVENTS_LIMIT)
  })
})
