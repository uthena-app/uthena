// Unit tests for `00-foundations/gdpr/export.ts`. Strategy:
//   - mock the Supabase client (just enough for the table reads each
//     builder does)
//   - assert each per-entity builder returns the right shape
//   - assert the bundle includes every section + a meta block
//   - assert secrets never leak (token_hash, raw IP, password hash)
//
// Run: `pnpm test export` (vitest).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

// Build a fake Supabase client that records the chained calls and
// returns whatever the test sets via `mockTableResponse()`. The shape
// is intentionally minimal — we only implement the methods our builders
// use (from().select().eq().order().maybeSingle() / etc).
type TableResponse = { data: unknown; error: null | { message: string } }
type Recorded = {
  table: string
  op: 'select' | 'eq' | 'order' | 'maybeSingle' | 'single'
  args?: unknown
}

function makeFakeClient() {
  const recorded: Recorded[] = []
  const responses = new Map<string, TableResponse>()

  // Each `from(table)` call creates a chain that's bound to that table.
  // Capturing `table` in the closure is critical: when builders run in
  // Promise.all, the awaits fire as microtasks AFTER every from() has
  // run. A shared `lastTable` variable would race and the wrong
  // response would be returned. Binding at from() time is the fix.
  function chainFor(table: string): Record<string, unknown> {
    function chain(): Record<string, unknown> {
      // The real Supabase chain is a PostgrestFilterBuilder — it has a
      // `.then()` method that resolves to `{data, error}`. We make the
      // chain itself awaitable so callers can `await chain()` directly
      // (the real builder pattern) instead of `chain.maybeSingle()`.
      const obj: Record<string, unknown> = {
        select: vi.fn((cols: string) => {
          recorded.push({ table, op: 'select', args: cols })
          return chain()
        }),
        eq: vi.fn((col: string, val: unknown) => {
          recorded.push({ table, op: 'eq', args: { col, val } })
          return chain()
        }),
        order: vi.fn((col: string, opts?: unknown) => {
          recorded.push({ table, op: 'order', args: { col, opts } })
          return chain()
        }),
        maybeSingle: vi.fn(async () => {
          recorded.push({ table, op: 'maybeSingle' })
          return responses.get(table) ?? { data: null, error: null }
        }),
        single: vi.fn(async () => {
          recorded.push({ table, op: 'single' })
          return responses.get(table) ?? { data: null, error: null }
        }),
      }
      // Make the chain itself awaitable — resolves to `{data, error}` from
      // the registered response. This mirrors the real PostgrestFilterBuilder.
      // `table` is captured in the closure, NOT looked up dynamically.
      obj.then = (resolve: (v: TableResponse) => void) => {
        resolve(responses.get(table) ?? { data: null, error: null })
        return Promise.resolve(responses.get(table) ?? { data: null, error: null })
      }
      return obj
    }
    return chain()
  }

  const client = {
    from: vi.fn((table: string) => {
      recorded.push({ table, op: 'select' })
      return chainFor(table)
    }),
    _recorded: recorded,
    _responses: responses,
    mockTableResponse(table: string, data: unknown, error: { message: string } | null = null) {
      responses.set(table, { data, error })
    },
  }
  return client
}

const fakeClient = makeFakeClient()

vi.mock('@foundations/data/supabase', () => ({
  getServerSupabase: vi.fn(async () => fakeClient as unknown as SupabaseClient),
  getServiceSupabase: vi.fn(() => fakeClient as unknown as SupabaseClient),
}))

// Import AFTER mocks so the module binds to the mocked deps.
const {
  buildMyDataExport,
  buildProfileExport,
  buildPartnerExport,
  buildAffiliateExport,
  buildOrdersExport,
  buildSubscriptionsExport,
  buildLibraryGrantsExport,
  buildReviewsExport,
  buildConsentLogExport,
  buildNotificationPrefsExport,
  buildApiTokensExport,
  buildFileDownloadsExport,
  buildRiskSignalsExport,
  buildReportsExport,
  buildPartnerUploadsExport,
  buildOnboardingDraftExport,
  GDPR_EXPORT_SCHEMA_VERSION,
} = await import('./export')

// ===========================================================================
// Fixtures
// ===========================================================================

const USER_ID = '11111111-1111-1111-1111-111111111111'
const EMAIL = 'Alice@Example.com'

const profileRow = {
  id: 1,
  role: 'customer',
  display_name: 'Alice',
  avatar_url: 'https://cdn.example.com/avatar.png',
  bio: null,
  locale: 'en',
  timezone: 'UTC',
  status: 'active',
  suspended_at: null,
  suspended_until: null,
  suspended_reason: 'should NOT appear in the export — admin-internal',
  banned_at: null,
  banned_reason: 'should NOT appear in the export — admin-internal',
  banned_by: 'should NOT appear in the export — admin-internal',
  warnings_count: 0,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-02-01T00:00:00Z',
}

const partnerRow = {
  id: 10,
  user_id: USER_ID,
  public_slug: 'alice-co',
  bio: 'Selling courses',
  website_url: 'https://alice.example',
  payout_method: { kind: 'paypal', email: 'paypal@example' },
  tax_form_status: 'none',
  kyc_status: 'none',
  royalty_pct_bps: null,
  approved_at: null,
  status: 'pending',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-02-01T00:00:00Z',
}

const affiliateRow = {
  id: 20,
  user_id: USER_ID,
  handle: 'alice-aff',
  status: 'approved',
  bio: 'Promoting',
  payout_method: { kind: 'paypal', email: 'paypal@example' },
  commission_pct_bps: 1500,
  approved_at: '2026-02-01T00:00:00Z',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-02-01T00:00:00Z',
}

const ordersRows = [
  {
    id: 100,
    email: EMAIL,
    status: 'paid',
    currency: 'USD',
    subtotal_cents: 10000,
    discount_cents: 0,
    tax_cents: 800,
    total_cents: 10800,
    refunded_cents: 0,
    created_at: '2026-02-01T00:00:00Z',
    paid_at: '2026-02-01T00:01:00Z',
    fulfilled_at: '2026-02-01T00:02:00Z',
    metadata: { source: 'web' },
    order_items: [
      {
        id: 1000,
        product_id: 50,
        partner_id: 10,
        license: 'plr',
        quantity: 1,
        unit_price_cents: 10000,
        line_total_cents: 10000,
        royalty_pct_bps: 3000,
        royalty_cents: 3000,
      },
    ],
  },
]

const subscriptionsRows = [
  {
    id: 200,
    stripe_subscription_id: 'sub_abc',
    stripe_customer_id: 'cus_abc',
    status: 'active',
    current_period_start: '2026-02-01T00:00:00Z',
    current_period_end: '2026-03-01T00:00:00Z',
    cancel_at_period_end: false,
    canceled_at: null,
    trial_start: null,
    trial_end: null,
    created_at: '2026-01-15T00:00:00Z',
    updated_at: '2026-02-01T00:00:00Z',
  },
]

const libraryGrantsRows = [
  {
    id: 300,
    product_id: 50,
    source: 'purchase',
    order_id: 100,
    subscription_id: null,
    license: 'plr',
    revoked_at: null,
    revoked_reason: null,
    expires_at: null,
    created_at: '2026-02-01T00:00:00Z',
  },
]

const reviewsRows = [
  {
    id: 400,
    product_id: 50,
    rating: 5,
    title: 'Great course',
    body: 'I learned a lot from this course and would recommend it.',
    status: 'published',
    helpful_count: 3,
    created_at: '2026-02-10T00:00:00Z',
    updated_at: '2026-02-10T00:00:00Z',
  },
]

const consentLogRows = [
  {
    id: 500,
    essential: true,
    analytics: false,
    marketing: false,
    ip_hash: 'ip_hash_only',
    user_agent: 'Mozilla/5.0',
    created_at: '2026-02-01T00:00:00Z',
  },
]

const notificationPrefsRow = {
  order_updates_email: true,
  refund_updates_email: true,
  payout_updates_email: true,
  security_alerts_email: true,
  marketing_email: false,
  product_updates_email: true,
  weekly_digest_email: false,
  updated_at: '2026-02-01T00:00:00Z',
}

const apiTokenRows = [
  {
    id: 600,
    name: 'CI token',
    token_prefix: 'uth_live_abc',
    scopes: ['catalog:read'],
    last_used_at: '2026-02-05T00:00:00Z',
    expires_at: null,
    revoked_at: null,
    created_at: '2026-02-01T00:00:00Z',
    // NOTE: this is a SENSITIVE field. The builder must strip it.
    token_hash: 'never-export-this',
  },
]

const fileDownloadsRows = [
  {
    id: 700,
    file_id: 50,
    product_id: 50,
    kind: 'download',
    url_expires_at: '2026-02-01T01:00:00Z',
    ip_hash: 'ip_hash_only',
    // `ip_raw` MUST NOT be exported — it should not be in the SELECT
    // either, but the test ensures even if it leaks into the row, the
    // builder doesn't surface it in the result.
    ip_raw: '1.2.3.4',
    user_agent: 'Mozilla/5.0',
    range_start: null,
    range_end: null,
    bytes_served: 1234567,
    created_at: '2026-02-01T00:00:00Z',
  },
]

const riskSignalRows = [
  {
    id: 800,
    signal_kind: 'velocity',
    severity: 'info',
    context: { ip_count: 3 },
    resolved: true,
    resolved_at: '2026-02-02T00:00:00Z',
    resolved_by: 'should NOT appear in the export — admin identity',
    created_at: '2026-02-01T00:00:00Z',
  },
]

const reportRows = [
  {
    id: 900,
    target_kind: 'product',
    target_id: '999',
    reason: 'spam',
    details: 'This product looks like spam',
    status: 'open',
    created_at: '2026-02-05T00:00:00Z',
  },
]

const partnerUploadsRows = [
  {
    id: 1100,
    original_filename: 'module-1.mp4',
    size_bytes: 1024 * 1024 * 50,
    mime_type: 'video/mp4',
    scan_status: 'clean',
    scan_completed_at: '2026-02-01T01:00:00Z',
    scan_result: 'no_threats',
    encoding_status: 'ready',
    bunny_video_id: 'bunny-123',
    product_id: 50,
    created_at: '2026-02-01T00:00:00Z',
  },
]

const onboardingDraftRow = {
  payload: { step: 3, draft: { bio: 'WIP' } },
  current_step: 3,
  submitted_at: null,
  created_at: '2026-02-01T00:00:00Z',
  updated_at: '2026-02-01T00:00:00Z',
}

// ===========================================================================
// Setup / teardown
// ===========================================================================

beforeEach(() => {
  fakeClient.mockTableResponse('profiles', profileRow)
  fakeClient.mockTableResponse('partners', partnerRow)
  fakeClient.mockTableResponse('affiliates', affiliateRow)
  fakeClient.mockTableResponse('subscriptions', subscriptionsRows)
  fakeClient.mockTableResponse('library_grants', libraryGrantsRows)
  fakeClient.mockTableResponse('reviews', reviewsRows)
  fakeClient.mockTableResponse('consent_log', consentLogRows)
  fakeClient.mockTableResponse('notification_preferences', notificationPrefsRow)
  fakeClient.mockTableResponse('api_tokens', apiTokenRows)
  fakeClient.mockTableResponse('file_downloads', fileDownloadsRows)
  fakeClient.mockTableResponse('risk_signals', riskSignalRows)
  fakeClient.mockTableResponse('reports', reportRows)
  fakeClient.mockTableResponse('partner_uploads', partnerUploadsRows)
  fakeClient.mockTableResponse('partner_onboarding_drafts', onboardingDraftRow)
  // Orders needs an inline nested-select response — same shape as the
  // fixture. The builder calls from('orders').select('*, order_items:...').
  fakeClient.mockTableResponse('orders', ordersRows)
})

afterEach(() => {
  // Clear mock state — each test re-registers its own responses.
  fakeClient._responses.clear()
  fakeClient._recorded.length = 0
})

// ===========================================================================
// Per-entity builder tests
// ===========================================================================

describe('buildProfileExport', () => {
  it('returns the profile with admin-internal fields stripped', async () => {
    const r = await buildProfileExport(
      fakeClient as unknown as SupabaseClient,
      USER_ID,
    )
    expect(r).not.toBeNull()
    expect(r?.display_name).toBe('Alice')
    // Critical: the export never includes suspension / ban / banned_by
    // fields. An admin reading the export should NOT see why the user
    // was warned — that info is admin-internal.
    const serialized = JSON.stringify(r)
    expect(serialized).not.toContain('suspended_reason')
    expect(serialized).not.toContain('banned_reason')
    expect(serialized).not.toContain('banned_by')
    expect(serialized).not.toContain('should NOT appear')
  })

  it('returns null when no profile exists', async () => {
    fakeClient.mockTableResponse('profiles', null)
    const r = await buildProfileExport(
      fakeClient as unknown as SupabaseClient,
      USER_ID,
    )
    expect(r).toBeNull()
  })

  it('returns null on error (graceful)', async () => {
    fakeClient.mockTableResponse('profiles', null, { message: 'rls denied' })
    const r = await buildProfileExport(
      fakeClient as unknown as SupabaseClient,
      USER_ID,
    )
    expect(r).toBeNull()
  })
})

describe('buildPartnerExport', () => {
  it('returns the partner row when present', async () => {
    const r = await buildPartnerExport(
      fakeClient as unknown as SupabaseClient,
      USER_ID,
    )
    expect(r?.public_slug).toBe('alice-co')
    expect(r?.payout_method).toEqual(partnerRow.payout_method)
  })
  it('returns null when not a partner', async () => {
    fakeClient.mockTableResponse('partners', null)
    const r = await buildPartnerExport(
      fakeClient as unknown as SupabaseClient,
      USER_ID,
    )
    expect(r).toBeNull()
  })
})

describe('buildAffiliateExport', () => {
  it('returns the affiliate row when present', async () => {
    const r = await buildAffiliateExport(
      fakeClient as unknown as SupabaseClient,
      USER_ID,
    )
    expect(r?.handle).toBe('alice-aff')
  })
})

describe('buildOrdersExport', () => {
  it('returns the orders + nested items', async () => {
    const r = await buildOrdersExport(
      fakeClient as unknown as SupabaseClient,
      USER_ID,
    )
    expect(r).toHaveLength(1)
    expect(r[0]?.id).toBe(100)
    expect(r[0]?.items).toHaveLength(1)
    expect(r[0]?.items[0]?.license).toBe('plr')
  })
  it('handles missing items array', async () => {
    fakeClient.mockTableResponse('orders', [{ id: 101, order_items: null }])
    const r = await buildOrdersExport(
      fakeClient as unknown as SupabaseClient,
      USER_ID,
    )
    expect(r[0]?.items).toEqual([])
  })
  it('returns [] on error', async () => {
    fakeClient.mockTableResponse('orders', null, { message: 'rls denied' })
    const r = await buildOrdersExport(
      fakeClient as unknown as SupabaseClient,
      USER_ID,
    )
    expect(r).toEqual([])
  })
})

describe('buildSubscriptionsExport', () => {
  it('returns the subscriptions list', async () => {
    const r = await buildSubscriptionsExport(
      fakeClient as unknown as SupabaseClient,
      USER_ID,
    )
    expect(r[0]?.status).toBe('active')
  })
})

describe('buildLibraryGrantsExport', () => {
  it('returns grants', async () => {
    const r = await buildLibraryGrantsExport(
      fakeClient as unknown as SupabaseClient,
      USER_ID,
    )
    expect(r[0]?.product_id).toBe(50)
  })
})

describe('buildReviewsExport', () => {
  it('returns reviews', async () => {
    const r = await buildReviewsExport(
      fakeClient as unknown as SupabaseClient,
      USER_ID,
    )
    expect(r[0]?.rating).toBe(5)
  })
})

describe('buildConsentLogExport', () => {
  it('returns consent history (with hashed IP only)', async () => {
    const r = await buildConsentLogExport(
      fakeClient as unknown as SupabaseClient,
      USER_ID,
    )
    expect(r[0]?.ip_hash).toBe('ip_hash_only')
  })
})

describe('buildNotificationPrefsExport', () => {
  it('returns the prefs row', async () => {
    const r = await buildNotificationPrefsExport(
      fakeClient as unknown as SupabaseClient,
      USER_ID,
    )
    expect(r?.marketing_email).toBe(false)
  })
  it('returns null when no row', async () => {
    fakeClient.mockTableResponse('notification_preferences', null)
    const r = await buildNotificationPrefsExport(
      fakeClient as unknown as SupabaseClient,
      USER_ID,
    )
    expect(r).toBeNull()
  })
})

describe('buildApiTokensExport', () => {
  it('NEVER includes token_hash', async () => {
    const r = await buildApiTokensExport(
      fakeClient as unknown as SupabaseClient,
      USER_ID,
    )
    expect(r).toHaveLength(1)
    expect(r[0]?.name).toBe('CI token')
    expect(r[0]?.token_prefix).toBe('uth_live_abc')
    const serialized = JSON.stringify(r)
    expect(serialized).not.toContain('never-export-this')
    expect(serialized).not.toContain('token_hash')
  })
})

describe('buildFileDownloadsExport', () => {
  it('NEVER includes ip_raw even if present in the row', async () => {
    const r = await buildFileDownloadsExport(
      fakeClient as unknown as SupabaseClient,
      USER_ID,
    )
    expect(r[0]?.ip_hash).toBe('ip_hash_only')
    const serialized = JSON.stringify(r)
    expect(serialized).not.toContain('1.2.3.4')
    expect(serialized).not.toContain('ip_raw')
  })
})

describe('buildRiskSignalsExport', () => {
  it('strips resolved_by (admin identity)', async () => {
    const r = await buildRiskSignalsExport(
      fakeClient as unknown as SupabaseClient,
      USER_ID,
    )
    const serialized = JSON.stringify(r)
    expect(serialized).not.toContain('admin identity')
    expect(serialized).not.toContain('resolved_by')
  })
})

describe('buildReportsExport', () => {
  it('returns the user-filed reports', async () => {
    const r = await buildReportsExport(
      fakeClient as unknown as SupabaseClient,
      USER_ID,
    )
    expect(r[0]?.target_kind).toBe('product')
  })
})

describe('buildPartnerUploadsExport', () => {
  it('returns uploads for the partner', async () => {
    const r = await buildPartnerUploadsExport(
      fakeClient as unknown as SupabaseClient,
      USER_ID,
    )
    expect(r[0]?.original_filename).toBe('module-1.mp4')
  })
  it('returns [] when user is not a partner', async () => {
    fakeClient.mockTableResponse('partners', null)
    const r = await buildPartnerUploadsExport(
      fakeClient as unknown as SupabaseClient,
      USER_ID,
    )
    expect(r).toEqual([])
  })
})

describe('buildOnboardingDraftExport', () => {
  it('returns the draft', async () => {
    const r = await buildOnboardingDraftExport(
      fakeClient as unknown as SupabaseClient,
      USER_ID,
    )
    expect(r?.current_step).toBe(3)
  })
})

// ===========================================================================
// Bundle test
// ===========================================================================

describe('buildMyDataExport', () => {
  it('returns a complete DataExport with every section', async () => {
    const r = await buildMyDataExport(
      fakeClient as unknown as SupabaseClient,
      USER_ID,
      EMAIL,
    )
    expect(r.meta.schema_version).toBe(GDPR_EXPORT_SCHEMA_VERSION)
    expect(r.meta.user_id).toBe(USER_ID)
    expect(r.meta.email_hash).toMatch(/^[a-f0-9]{64}$/)
    // email_hash must be deterministic
    expect(r.meta.email_hash).toBe(
      require('node:crypto')
        .createHash('sha256')
        .update(EMAIL.toLowerCase())
        .digest('hex'),
    )
    expect(r.meta.exported_at).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(r.meta.retention_summary.orders).toContain('7 years')

    expect(r.profile?.display_name).toBe('Alice')
    expect(r.partner?.public_slug).toBe('alice-co')
    expect(r.affiliate?.handle).toBe('alice-aff')
    expect(r.orders).toHaveLength(1)
    expect(r.subscriptions).toHaveLength(1)
    expect(r.library_grants).toHaveLength(1)
    expect(r.reviews).toHaveLength(1)
    expect(r.consent_log).toHaveLength(1)
    expect(r.notification_preferences?.marketing_email).toBe(false)
    expect(r.api_tokens).toHaveLength(1)
    expect(r.file_downloads).toHaveLength(1)
    expect(r.risk_signals).toHaveLength(1)
    expect(r.reports).toHaveLength(1)
    expect(r.partner_uploads).toHaveLength(1)
    expect(r.partner_onboarding_draft?.current_step).toBe(3)
  })

  it('JSON-serializes without throwing', async () => {
    const r = await buildMyDataExport(
      fakeClient as unknown as SupabaseClient,
      USER_ID,
      EMAIL,
    )
    const json = JSON.stringify(r)
    expect(json.length).toBeGreaterThan(0)
  })

  it('the JSON NEVER contains token_hash, raw IP, or password fields', async () => {
    const r = await buildMyDataExport(
      fakeClient as unknown as SupabaseClient,
      USER_ID,
      EMAIL,
    )
    const json = JSON.stringify(r)
    expect(json).not.toContain('never-export-this')
    expect(json).not.toContain('token_hash')
    expect(json).not.toContain('1.2.3.4')
    expect(json).not.toContain('ip_raw')
    // The word "passwords" legitimately appears in the auth_identities
    // retention rationale ("Login identities (passwords, OAuth)") — we
    // don't want to flag that as a leak. We instead check that no
    // PASSWORD VALUE field (e.g. "password_hash", "encrypted_password")
    // appears, which is the actual leak vector.
    expect(json).not.toContain('password_hash')
    expect(json).not.toContain('encrypted_password')
    expect(json).not.toContain('suspended_reason')
    expect(json).not.toContain('banned_reason')
    expect(json).not.toContain('banned_by')
    // Raw email appears in the orders section (we keep it for receipt
    // traceability — the user IS the order owner, so this is OK), but
    // the profile section uses display_name, not email. The retention
    // summary's auth_identities label mentions "OAuth" which is fine.
    expect(json).not.toContain('admin identity')
    expect(json).not.toContain('resolved_by')
  })

  it('email_hash is case-insensitive (Alice@Example.com → same hash as alice@example.com)', async () => {
    const r1 = await buildMyDataExport(
      fakeClient as unknown as SupabaseClient,
      USER_ID,
      'Alice@Example.com',
    )
    const r2 = await buildMyDataExport(
      fakeClient as unknown as SupabaseClient,
      USER_ID,
      'alice@example.com',
    )
    expect(r1.meta.email_hash).toBe(r2.meta.email_hash)
  })

  it('handles empty user (no rows in any table)', async () => {
    // Override everything to null/empty
    fakeClient.mockTableResponse('profiles', null)
    fakeClient.mockTableResponse('partners', null)
    fakeClient.mockTableResponse('affiliates', null)
    fakeClient.mockTableResponse('orders', [])
    fakeClient.mockTableResponse('subscriptions', [])
    fakeClient.mockTableResponse('library_grants', [])
    fakeClient.mockTableResponse('reviews', [])
    fakeClient.mockTableResponse('consent_log', [])
    fakeClient.mockTableResponse('notification_preferences', null)
    fakeClient.mockTableResponse('api_tokens', [])
    fakeClient.mockTableResponse('file_downloads', [])
    fakeClient.mockTableResponse('risk_signals', [])
    fakeClient.mockTableResponse('reports', [])
    fakeClient.mockTableResponse('partner_uploads', [])
    fakeClient.mockTableResponse('partner_onboarding_drafts', null)

    const r = await buildMyDataExport(
      fakeClient as unknown as SupabaseClient,
      USER_ID,
      EMAIL,
    )
    expect(r.profile).toBeNull()
    expect(r.partner).toBeNull()
    expect(r.affiliate).toBeNull()
    expect(r.orders).toEqual([])
    expect(r.subscriptions).toEqual([])
    expect(r.library_grants).toEqual([])
    expect(r.reviews).toEqual([])
    expect(r.consent_log).toEqual([])
    expect(r.notification_preferences).toBeNull()
    expect(r.api_tokens).toEqual([])
    expect(r.file_downloads).toEqual([])
    expect(r.risk_signals).toEqual([])
    expect(r.reports).toEqual([])
    expect(r.partner_uploads).toEqual([])
    expect(r.partner_onboarding_draft).toBeNull()
    // meta should still be set
    expect(r.meta.user_id).toBe(USER_ID)
  })
})

describe('GDPR_EXPORT_SCHEMA_VERSION', () => {
  it('is a semver string', () => {
    expect(GDPR_EXPORT_SCHEMA_VERSION).toMatch(/^\d+\.\d+\.\d+$/)
  })
})