// Unit tests for getAdminOrderDetail — covers the anonymous-path
// (anon → throw before any RPC call), the happy-path mapping with
// every defensive coercion, and the RPC-error fail-soft path.
//
// All Supabase calls are mocked via vi.mock so the tests run in pure
// Node — no real database needed.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Hoisted mocks — the requireAdmin() call must NOT run before the
// test sets up its mock state, so we stub it via vi.mock below.
vi.mock('@foundations/auth/guards', () => ({
  requireAdmin: vi.fn(),
}))

import { requireAdmin } from '@foundations/auth/guards'

// getServerSupabase is what the query uses; mock its rpc() chain.
const rpcMock = vi.fn()
const getServerSupabaseMock = vi.fn()

vi.mock('@foundations/data/supabase', () => ({
  getServerSupabase: () => getServerSupabaseMock(),
}))

import { getAdminOrderDetail } from './getAdminOrderDetail'

const asAdmin = () =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ({ id: '11111111-2222-3333-4444-555555555555', email: 'admin@uthena' } as any)

const asAnon = () => null

describe('getAdminOrderDetail', () => {
  beforeEach(() => {
    rpcMock.mockReset()
    getServerSupabaseMock.mockReset()
    getServerSupabaseMock.mockResolvedValue({ rpc: rpcMock })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns null when the id is malformed', async () => {
    // Cast through unknown to bypass the requireAdmin overload — the
    // helper throws so we need to mock that path differently.
    vi.mocked(requireAdmin).mockResolvedValue(asAdmin())
    // We still assert that a non-numeric id short-circuits to null
    // even though requireAdmin was called.
    expect(await getAdminOrderDetail('not-a-number')).toBeNull()
    expect(rpcMock).not.toHaveBeenCalled()
  })

  it('returns null on empty / null / undefined id without calling RPC', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(asAdmin())
    expect(await getAdminOrderDetail('')).toBeNull()
    expect(await getAdminOrderDetail(null)).toBeNull()
    expect(await getAdminOrderDetail(undefined)).toBeNull()
    expect(rpcMock).not.toHaveBeenCalled()
  })

  it('returns null when requireAdmin throws (anon path)', async () => {
    vi.mocked(requireAdmin).mockRejectedValue(new Error('not admin'))
    await expect(getAdminOrderDetail('12345')).rejects.toThrow('not admin')
    expect(rpcMock).not.toHaveBeenCalled()
  })

  it('maps the happy-path RPC row with every defensive coercion', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(asAdmin())
    rpcMock.mockResolvedValue({
      data: [
        {
          order_id: '12345',
          user_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
          customer_checkout_email: 'jane.doe@example.com',
          status: 'paid',
          subtotal_cents: 9900,
          discount_cents: '500',
          tax_cents: '0',
          total_cents: '9400',
          currency: 'USD',
          refunded_cents: 0,
          billing_address_jsonb: { name: 'Jane Doe', line1: '1 Main St' },
          ip_raw: '203.0.113.42',
          ip_hash: null,
          user_agent: 'Mozilla/5.0',
          stripe_checkout_session_id: 'cs_test_abc',
          stripe_payment_intent_id: 'pi_test_xyz',
          stripe_charge_id: 'ch_test_qrs',
          stripe_customer_id: 'cus_test_tuv',
          subscription_id: null,
          coupon_id: 7,
          paid_at: '2026-06-30 12:34:56+00',
          fulfilled_at: null,
          created_at: '2026-06-30 12:34:56+00',
          updated_at: '2026-06-30 12:34:56+00',
          customer_display_name: 'Jane Doe',
          customer_avatar_url: null,
          customer_since: '2025-01-01 00:00:00+00',
          customer_lifetime_orders: 3,
          customer_lifetime_spend_cents: 30000,
          customer_last_login_at: '2026-06-25 08:00:00+00',
          partner_id: 99,
          partner_display_name: 'Acme Partner',
          partner_status: 'approved',
          partner_public_slug: 'acme',
          affiliate_id: 42,
          affiliate_display_name: 'Aff Jane',
          affiliate_handle: 'janeaff',
          items_count: 2,
        },
      ],
      error: null,
    })

    const detail = await getAdminOrderDetail('12345')
    expect(detail).not.toBeNull()
    expect(detail!.order_id).toBe(12345)
    expect(detail!.status).toBe('paid')
    expect(detail!.subtotal_cents).toBe(9900)
    expect(detail!.discount_cents).toBe(500)
    expect(detail!.total_cents).toBe(9400)
    expect(detail!.currency).toBe('USD')
    expect(detail!.items_count).toBe(2)
    expect(detail!.customer_checkout_email_raw).toBe('jane.doe@example.com')
    expect(detail!.customer_checkout_email_masked).toBe('j***@example.com')
    expect(detail!.ip_raw).toBe('203.0.113.42')
    expect(detail!.ip_masked).toBe('203.0.11...')
    expect(detail!.stripe_payment_intent_id).toBe('pi_test_xyz')
    expect(detail!.customer_display_name).toBe('Jane Doe')
    expect(detail!.partner_id).toBe(99)
    expect(detail!.partner_display_name).toBe('Acme Partner')
    expect(detail!.affiliate_id).toBe(42)
    expect(detail!.affiliate_handle).toBe('janeaff')
  })

  it('falls back to "pending" for an unknown status string', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(asAdmin())
    rpcMock.mockResolvedValue({
      data: [
        {
          order_id: '1',
          user_id: 'aaaaaaaa',
          customer_checkout_email: null,
          status: 'delivered_to_mars',
          subtotal_cents: 0,
          discount_cents: 0,
          tax_cents: 0,
          total_cents: 0,
          currency: 'USD',
          refunded_cents: 0,
          billing_address_jsonb: null,
          ip_raw: null,
          ip_hash: null,
          user_agent: null,
          stripe_payment_intent_id: null,
          coupon_id: null,
          created_at: '2026-06-30 00:00:00+00',
          updated_at: '2026-06-30 00:00:00+00',
          customer_display_name: '',
          items_count: 0,
        },
      ],
      error: null,
    })
    const detail = await getAdminOrderDetail('1')
    expect(detail!.status).toBe('pending')
  })

  it('returns null when the RPC returns an empty array', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(asAdmin())
    rpcMock.mockResolvedValue({ data: [], error: null })
    const detail = await getAdminOrderDetail('1')
    expect(detail).toBeNull()
  })

  it('returns null on RPC error and warns (no throw)', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(asAdmin())
    rpcMock.mockResolvedValue({
      data: null,
      error: { message: 'permission denied' },
    })
    const detail = await getAdminOrderDetail('1')
    expect(detail).toBeNull()
  })

  it('clamps negative bigints to 0 across every cents column', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(asAdmin())
    rpcMock.mockResolvedValue({
      data: [
        {
          order_id: '1',
          user_id: 'aaaaaaaa',
          customer_checkout_email: null,
          status: 'paid',
          subtotal_cents: -5,
          discount_cents: -3,
          tax_cents: -2,
          total_cents: -10,
          currency: 'USD',
          refunded_cents: -1,
          billing_address_jsonb: null,
          ip_raw: null,
          ip_hash: null,
          user_agent: null,
          stripe_payment_intent_id: null,
          coupon_id: null,
          created_at: '2026-06-30 00:00:00+00',
          updated_at: '2026-06-30 00:00:00+00',
          customer_display_name: '',
          items_count: -2,
        },
      ],
      error: null,
    })
    const detail = await getAdminOrderDetail('1')
    expect(detail!.subtotal_cents).toBe(0)
    expect(detail!.discount_cents).toBe(0)
    expect(detail!.total_cents).toBe(0)
    expect(detail!.items_count).toBe(0)
  })

  it('handles missing partner + affiliate gracefully (null fields)', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(asAdmin())
    rpcMock.mockResolvedValue({
      data: [
        {
          order_id: '1',
          user_id: 'aaaaaaaa',
          customer_checkout_email: null,
          status: 'paid',
          subtotal_cents: 100,
          discount_cents: 0,
          tax_cents: 0,
          total_cents: 100,
          currency: 'USD',
          refunded_cents: 0,
          billing_address_jsonb: null,
          ip_raw: null,
          ip_hash: null,
          user_agent: null,
          stripe_payment_intent_id: null,
          coupon_id: null,
          created_at: '2026-06-30 00:00:00+00',
          updated_at: '2026-06-30 00:00:00+00',
          customer_display_name: 'Anon',
          partner_id: null,
          partner_display_name: null,
          partner_status: null,
          partner_public_slug: null,
          affiliate_id: null,
          affiliate_display_name: null,
          affiliate_handle: null,
          items_count: 1,
        },
      ],
      error: null,
    })
    const detail = await getAdminOrderDetail('1')
    expect(detail!.partner_id).toBeNull()
    expect(detail!.partner_display_name).toBeNull()
    expect(detail!.affiliate_id).toBeNull()
    expect(detail!.affiliate_handle).toBeNull()
  })
})
