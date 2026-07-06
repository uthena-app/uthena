// getAdminPartnerDetail.test.ts — unit tests for the partner detail
// query wrapper.
//
// Pattern matches the existing getAdminCustomerDetail.test.ts — mock
// the Supabase client + assert the RPC shape + the defensive mapping.

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

vi.mock('@foundations/data/supabase', () => ({
  getServerSupabase: vi.fn(async () => ({
    rpc: mockRpc,
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

// decryptStringOrPassThrough: real implementation; no mock needed.

import { getAdminPartnerDetail } from './getAdminPartnerDetail'

function buildRpcResult(rows: unknown[] | null, error: unknown = null) {
  return { data: rows, error }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockRpc.mockResolvedValue(buildRpcResult(null))
})

describe('getAdminPartnerDetail', () => {
  describe('input validation', () => {
    it('returns null for non-numeric input', async () => {
      const result = await getAdminPartnerDetail('not-a-number')
      expect(result).toBeNull()
      expect(mockRpc).not.toHaveBeenCalled()
    })

    it('returns null for negative input', async () => {
      const result = await getAdminPartnerDetail('-1')
      expect(result).toBeNull()
      expect(mockRpc).not.toHaveBeenCalled()
    })

    it('returns null for zero input', async () => {
      const result = await getAdminPartnerDetail('0')
      expect(result).toBeNull()
      expect(mockRpc).not.toHaveBeenCalled()
    })

    it('returns null for decimal input', async () => {
      const result = await getAdminPartnerDetail('1.5')
      expect(result).toBeNull()
      expect(mockRpc).not.toHaveBeenCalled()
    })

    it('returns null for oversized input (> 16 digits)', async () => {
      const result = await getAdminPartnerDetail('10000000000000000')
      expect(result).toBeNull()
      expect(mockRpc).not.toHaveBeenCalled()
    })

    it('returns null for empty string', async () => {
      const result = await getAdminPartnerDetail('')
      expect(result).toBeNull()
      expect(mockRpc).not.toHaveBeenCalled()
    })

    it('returns null for null input', async () => {
      const result = await getAdminPartnerDetail(null as unknown as string)
      expect(result).toBeNull()
      expect(mockRpc).not.toHaveBeenCalled()
    })

    it('returns null for undefined input', async () => {
      const result = await getAdminPartnerDetail(undefined as unknown as string)
      expect(result).toBeNull()
      expect(mockRpc).not.toHaveBeenCalled()
    })

    it('accepts numeric input (not just strings)', async () => {
      mockRpc.mockResolvedValue(buildRpcResult(null))
      const result = await getAdminPartnerDetail(42 as unknown as string)
      expect(result).toBeNull() // RPC returned 0 rows
      expect(mockRpc).toHaveBeenCalledWith(
        'get_admin_partner_detail',
        expect.objectContaining({ p_partner_id: 42 }),
      )
    })
  })

  describe('auth gating', () => {
    it('calls requireAdmin before invoking RPC', async () => {
      const { requireAdmin } = await import('@foundations/auth/guards')
      mockRpc.mockResolvedValue(buildRpcResult(null))
      await getAdminPartnerDetail('42')
      expect(requireAdmin).toHaveBeenCalled()
    })

    it('forwards the canonical id to the RPC', async () => {
      mockRpc.mockResolvedValue(buildRpcResult(null))
      await getAdminPartnerDetail('12345')
      expect(mockRpc).toHaveBeenCalledWith(
        'get_admin_partner_detail',
        { p_partner_id: 12345 },
      )
    })
  })

  describe('happy path', () => {
    it('maps a fully-populated RPC row to PartnerDetail', async () => {
      mockRpc.mockResolvedValue(
        buildRpcResult([
          {
            partner_id: 42,
            user_id: 'admin-id-fake-uuid-1234',
            status: 'approved',
            kyc_status: 'approved',
            tax_form_status: 'approved',
            public_slug: 'jane-doe',
            bio: 'A great instructor.',
            website_url: 'https://example.com',
            royalty_pct_bps: 6000,
            approved_at: '2026-06-01T10:00:00Z',
            approved_by: 'super-admin-uuid',
            created_at: '2026-05-01T00:00:00Z',
            updated_at: '2026-06-15T00:00:00Z',
            display_name: 'Jane Doe',
            email: 'jane@example.com',
            avatar_url: 'https://cdn.example.com/avatar.jpg',
            locale: 'en-US',
            timezone: 'UTC',
            payout_email_envelope: null,
            courses_count: 5,
            distinct_buyers_count: 100,
            lifetime_revenue_cents: '5000000',
            lifetime_paid_out_cents: '3000000',
            refund_count: 2,
            total_order_count: 50,
            last_active_at: '2026-06-20T10:00:00Z',
          },
        ]),
      )

      const result = await getAdminPartnerDetail('42')
      expect(result).not.toBeNull()
      expect(result!.partner_id).toBe(42)
      expect(result!.display_name).toBe('Jane Doe')
      expect(result!.status).toBe('approved')
      expect(result!.kyc_status).toBe('approved')
      expect(result!.tax_form_status).toBe('approved')
      expect(result!.public_slug).toBe('jane-doe')
      expect(result!.partner_bio).toBe('A great instructor.')
      expect(result!.website_url).toBe('https://example.com')
      expect(result!.royalty_pct_bps).toBe(6000)
      expect(result!.approved_at).toBe('2026-06-01T10:00:00Z')
      expect(result!.courses_count).toBe(5)
      expect(result!.distinct_buyers_count).toBe(100)
      expect(result!.lifetime_revenue_cents).toBe(5000000)
      expect(result!.lifetime_paid_out_cents).toBe(3000000)
      expect(result!.refund_count).toBe(2)
      expect(result!.total_order_count).toBe(50)
      expect(result!.refund_rate).toBe(2 / 50)
      expect(result!.last_active_at).toBe('2026-06-20T10:00:00Z')
    })

    it('masks the email by default', async () => {
      mockRpc.mockResolvedValue(
        buildRpcResult([
          {
            partner_id: 42,
            user_id: 'admin-id-fake-uuid-1234',
            status: 'approved',
            kyc_status: 'none',
            tax_form_status: 'none',
            public_slug: null,
            bio: null,
            website_url: null,
            royalty_pct_bps: null,
            approved_at: null,
            approved_by: null,
            created_at: '2026-05-01T00:00:00Z',
            updated_at: '2026-05-01T00:00:00Z',
            display_name: 'Jane Doe',
            email: 'jane.doe@example.com',
            avatar_url: null,
            locale: null,
            timezone: null,
            payout_email_envelope: null,
            courses_count: 0,
            distinct_buyers_count: 0,
            lifetime_revenue_cents: 0,
            lifetime_paid_out_cents: 0,
            refund_count: 0,
            total_order_count: 0,
            last_active_at: null,
          },
        ]),
      )

      const result = await getAdminPartnerDetail('42')
      expect(result!.email_raw).toBe('jane.doe@example.com')
      expect(result!.email_masked).toBe('j***@example.com')
    })

    it('passes payout_email_raw through after server-side decryption', async () => {
      // The mock returns the envelope as-is (we don't actually encrypt
      // in the test). decryptStringOrPassThrough recognizes plaintext
      // vs envelope and either passes through or decrypts.
      mockRpc.mockResolvedValue(
        buildRpcResult([
          {
            partner_id: 42,
            user_id: 'admin-id-fake-uuid-1234',
            status: 'approved',
            kyc_status: 'approved',
            tax_form_status: 'approved',
            public_slug: null,
            bio: null,
            website_url: null,
            royalty_pct_bps: null,
            approved_at: null,
            approved_by: null,
            created_at: '2026-05-01T00:00:00Z',
            updated_at: '2026-05-01T00:00:00Z',
            display_name: 'Jane Doe',
            email: 'jane@example.com',
            avatar_url: null,
            locale: null,
            timezone: null,
            // Legacy plaintext form (STUB-052 backfill incomplete).
            payout_email_envelope: 'paypal-jane@example.com',
            courses_count: 0,
            distinct_buyers_count: 0,
            lifetime_revenue_cents: 0,
            lifetime_paid_out_cents: 0,
            refund_count: 0,
            total_order_count: 0,
            last_active_at: null,
          },
        ]),
      )

      const result = await getAdminPartnerDetail('42')
      expect(result!.payout_email_raw).toBe('paypal-jane@example.com')
      expect(result!.payout_email_masked).toBe('p***@example.com')
    })

    it('returns null payout_email_masked when envelope is null', async () => {
      mockRpc.mockResolvedValue(
        buildRpcResult([
          {
            partner_id: 42,
            user_id: 'admin-id-fake-uuid-1234',
            status: 'pending',
            kyc_status: 'none',
            tax_form_status: 'none',
            public_slug: null,
            bio: null,
            website_url: null,
            royalty_pct_bps: null,
            approved_at: null,
            approved_by: null,
            created_at: '2026-05-01T00:00:00Z',
            updated_at: '2026-05-01T00:00:00Z',
            display_name: 'New Partner',
            email: 'new@example.com',
            avatar_url: null,
            locale: null,
            timezone: null,
            payout_email_envelope: null,
            courses_count: 0,
            distinct_buyers_count: 0,
            lifetime_revenue_cents: 0,
            lifetime_paid_out_cents: 0,
            refund_count: 0,
            total_order_count: 0,
            last_active_at: null,
          },
        ]),
      )

      const result = await getAdminPartnerDetail('42')
      expect(result!.payout_email_raw).toBeNull()
      expect(result!.payout_email_masked).toBeNull()
    })

    it('returns null refund_rate when total_order_count is 0', async () => {
      mockRpc.mockResolvedValue(
        buildRpcResult([
          {
            partner_id: 42,
            user_id: 'admin-id-fake-uuid-1234',
            status: 'approved',
            kyc_status: 'approved',
            tax_form_status: 'approved',
            public_slug: null,
            bio: null,
            website_url: null,
            royalty_pct_bps: null,
            approved_at: null,
            approved_by: null,
            created_at: '2026-05-01T00:00:00Z',
            updated_at: '2026-05-01T00:00:00Z',
            display_name: 'New Partner',
            email: 'new@example.com',
            avatar_url: null,
            locale: null,
            timezone: null,
            payout_email_envelope: null,
            courses_count: 0,
            distinct_buyers_count: 0,
            lifetime_revenue_cents: 0,
            lifetime_paid_out_cents: 0,
            refund_count: 0,
            total_order_count: 0,
            last_active_at: null,
          },
        ]),
      )

      const result = await getAdminPartnerDetail('42')
      expect(result!.refund_rate).toBe(0)
    })
  })

  describe('defensive coercion', () => {
    it('coerces bigint-as-string to number', async () => {
      mockRpc.mockResolvedValue(
        buildRpcResult([
          {
            partner_id: '42',
            user_id: 'admin-id-fake-uuid-1234',
            status: 'approved',
            kyc_status: 'approved',
            tax_form_status: 'approved',
            public_slug: null,
            bio: null,
            website_url: null,
            royalty_pct_bps: null,
            approved_at: null,
            approved_by: null,
            created_at: '2026-05-01T00:00:00Z',
            updated_at: '2026-05-01T00:00:00Z',
            display_name: 'Jane Doe',
            email: 'jane@example.com',
            avatar_url: null,
            locale: null,
            timezone: null,
            payout_email_envelope: null,
            courses_count: '5',
            distinct_buyers_count: '100',
            lifetime_revenue_cents: '5000000',
            lifetime_paid_out_cents: '3000000',
            refund_count: '2',
            total_order_count: '50',
            last_active_at: null,
          },
        ]),
      )

      const result = await getAdminPartnerDetail('42')
      expect(result!.partner_id).toBe(42)
      expect(result!.courses_count).toBe(5)
      expect(result!.distinct_buyers_count).toBe(100)
      expect(result!.lifetime_revenue_cents).toBe(5000000)
    })

    it('falls back to pending status on unknown enum value', async () => {
      mockRpc.mockResolvedValue(
        buildRpcResult([
          {
            partner_id: 42,
            user_id: 'admin-id-fake-uuid-1234',
            status: 'unknown-value',
            kyc_status: 'unknown',
            tax_form_status: 'unknown',
            public_slug: null,
            bio: null,
            website_url: null,
            royalty_pct_bps: null,
            approved_at: null,
            approved_by: null,
            created_at: '2026-05-01T00:00:00Z',
            updated_at: '2026-05-01T00:00:00Z',
            display_name: 'Jane',
            email: 'jane@example.com',
            avatar_url: null,
            locale: null,
            timezone: null,
            payout_email_envelope: null,
            courses_count: 0,
            distinct_buyers_count: 0,
            lifetime_revenue_cents: 0,
            lifetime_paid_out_cents: 0,
            refund_count: 0,
            total_order_count: 0,
            last_active_at: null,
          },
        ]),
      )

      const result = await getAdminPartnerDetail('42')
      expect(result!.status).toBe('pending')
      expect(result!.kyc_status).toBe('none')
      expect(result!.tax_form_status).toBe('none')
    })

    it('uses "Unknown partner" fallback for missing display_name', async () => {
      mockRpc.mockResolvedValue(
        buildRpcResult([
          {
            partner_id: 42,
            user_id: 'admin-id-fake-uuid-1234',
            status: 'pending',
            kyc_status: 'none',
            tax_form_status: 'none',
            public_slug: null,
            bio: null,
            website_url: null,
            royalty_pct_bps: null,
            approved_at: null,
            approved_by: null,
            created_at: '2026-05-01T00:00:00Z',
            updated_at: '2026-05-01T00:00:00Z',
            display_name: null,
            email: 'jane@example.com',
            avatar_url: null,
            locale: null,
            timezone: null,
            payout_email_envelope: null,
            courses_count: 0,
            distinct_buyers_count: 0,
            lifetime_revenue_cents: 0,
            lifetime_paid_out_cents: 0,
            refund_count: 0,
            total_order_count: 0,
            last_active_at: null,
          },
        ]),
      )

      const result = await getAdminPartnerDetail('42')
      expect(result!.display_name).toBe('Unknown partner')
    })
  })

  describe('failure modes', () => {
    it('returns null when RPC errors', async () => {
      mockRpc.mockResolvedValue(buildRpcResult(null, { message: 'rpc failed' }))
      const result = await getAdminPartnerDetail('42')
      expect(result).toBeNull()
    })

    it('returns null when RPC returns empty array', async () => {
      mockRpc.mockResolvedValue(buildRpcResult([]))
      const result = await getAdminPartnerDetail('42')
      expect(result).toBeNull()
    })

    it('returns null when RPC returns non-array data', async () => {
      mockRpc.mockResolvedValue(
        buildRpcResult({ not: 'an array' } as unknown as unknown[]),
      )
      const result = await getAdminPartnerDetail('42')
      expect(result).toBeNull()
    })
  })

  describe('PII safety', () => {
    it('raw email is preserved in payload but masked form is what callers render', async () => {
      mockRpc.mockResolvedValue(
        buildRpcResult([
          {
            partner_id: 42,
            user_id: 'admin-id-fake-uuid-1234',
            status: 'approved',
            kyc_status: 'approved',
            tax_form_status: 'approved',
            public_slug: null,
            bio: null,
            website_url: null,
            royalty_pct_bps: null,
            approved_at: null,
            approved_by: null,
            created_at: '2026-05-01T00:00:00Z',
            updated_at: '2026-05-01T00:00:00Z',
            display_name: 'Jane Doe',
            email: 'sensitive@example.com',
            avatar_url: null,
            locale: null,
            timezone: null,
            payout_email_envelope: 'paypal-sensitive@example.com',
            courses_count: 0,
            distinct_buyers_count: 0,
            lifetime_revenue_cents: 0,
            lifetime_paid_out_cents: 0,
            refund_count: 0,
            total_order_count: 0,
            last_active_at: null,
          },
        ]),
      )

      const result = await getAdminPartnerDetail('42')
      // The masked form preserves the first char + domain, hiding the
      // local part. The raw form is what a future reveal action would
      // return AFTER audit-logging the click.
      expect(result!.email_masked).toBe('s***@example.com')
      expect(result!.payout_email_masked).toBe('p***@example.com')
      expect(result!.email_raw).toBe('sensitive@example.com')
      expect(result!.payout_email_raw).toBe('paypal-sensitive@example.com')
    })
  })
})