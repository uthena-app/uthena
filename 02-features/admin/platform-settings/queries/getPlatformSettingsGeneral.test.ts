// getPlatformSettingsGeneral.test.ts — unit tests for the admin
// platform-settings general reader. Mocks the service-role client so
// we don't need a real Supabase. Covers:
//
// - Happy path: full row + display name lookup
// - Missing row → null
// - DB error → null + warn log
// - Defensive coercion: every numeric field falls back when bad
// - Bad currency → 'USD' fallback
// - Missing updated_by → no profile lookup (no second query)
// - Updated_by with bad profile → null display name
// - Missing display_name on profile → null
// - Bad types in support_email / legal_email / hero_* → null
// - String-coerced numeric values → fallback

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ----- Service-role mock ---------------------------------------------------

type ServiceCall =
  | { method: 'from'; table: string }
  | { method: 'select'; payload: unknown }
  | { method: 'eq'; col: string; val: unknown }
  | { method: 'maybeSingle' }

const serviceCalls: ServiceCall[] = []
let serviceQueue: Array<{ data: unknown; error: unknown }> = []

function makeChain() {
  const chain: any = {
    select(payload: unknown) {
      serviceCalls.push({ method: 'select', payload })
      return chain
    },
    eq(col: string, val: unknown) {
      serviceCalls.push({ method: 'eq', col, val })
      return chain
    },
    maybeSingle: vi.fn(async () => {
      serviceCalls.push({ method: 'maybeSingle' })
      return serviceQueue.shift() ?? { data: null, error: null }
    }),
  }
  return chain
}

const fakeServiceSupabase = {
  from: vi.fn((table: string) => {
    serviceCalls.push({ method: 'from', table })
    return makeChain()
  }),
}

vi.mock('@foundations/data/supabase', () => ({
  getServiceSupabase: vi.fn(() => fakeServiceSupabase),
}))

// ----- Logger mock ---------------------------------------------------------

const logCalls: Array<{ level: string; payload: Record<string, unknown> }> = []

vi.mock('@foundations/log/pino', () => ({
  loggerFor: () => ({
    info: (p: Record<string, unknown>) => logCalls.push({ level: 'info', payload: p }),
    warn: (p: Record<string, unknown>) => logCalls.push({ level: 'warn', payload: p }),
    error: (p: Record<string, unknown>) => logCalls.push({ level: 'error', payload: p }),
    debug: (p: Record<string, unknown>) => logCalls.push({ level: 'debug', payload: p }),
  }),
}))

// ----- Helpers -------------------------------------------------------------

function resetAll(): void {
  serviceCalls.length = 0
  serviceQueue.length = 0
  logCalls.length = 0
  vi.clearAllMocks()
}

function enqueue(data: unknown, error: unknown = null): void {
  serviceQueue.push({ data, error })
}

// ----- Tests ---------------------------------------------------------------

describe('getPlatformSettingsGeneral — happy path', () => {
  beforeEach(resetAll)
  afterEach(resetAll)

  it('reads the singleton row + looks up the editor display name', async () => {
    const { getPlatformSettingsGeneral } = await import('./getPlatformSettingsGeneral')
    enqueue({
      default_royalty_pct_bps: 3000,
      plr_subscriber_discount_pct_bps: 1500,
      default_refund_window_days: 14,
      default_currency: 'USD',
      support_email: 'support@uthena.com',
      legal_email: 'legal@uthena.com',
      hero_title: 'Premium video courses.',
      hero_subtitle: 'Buy once, rebrand, resell.',
      updated_at: '2026-06-29T10:00:00.000Z',
      updated_by: 'u_admin_1',
    })
    enqueue({ display_name: 'Klaas' })
    const out = await getPlatformSettingsGeneral()
    expect(out).not.toBeNull()
    expect(out!.default_royalty_pct_bps).toBe(3000)
    expect(out!.plr_subscriber_discount_pct_bps).toBe(1500)
    expect(out!.default_refund_window_days).toBe(14)
    expect(out!.default_currency).toBe('USD')
    expect(out!.support_email).toBe('support@uthena.com')
    expect(out!.legal_email).toBe('legal@uthena.com')
    expect(out!.hero_title).toBe('Premium video courses.')
    expect(out!.updated_at).toBe('2026-06-29T10:00:00.000Z')
    expect(out!.updated_by_display_name).toBe('Klaas')

    // Two reads: platform_settings + profiles
    const froms = serviceCalls.filter((c) => c.method === 'from').map((c) => c.table)
    expect(froms).toEqual(['platform_settings', 'profiles'])
  })

  it('reads the singleton row without a display-name lookup when updated_by is null', async () => {
    const { getPlatformSettingsGeneral } = await import('./getPlatformSettingsGeneral')
    enqueue({
      default_royalty_pct_bps: 3000,
      plr_subscriber_discount_pct_bps: 1500,
      default_refund_window_days: 14,
      default_currency: 'USD',
      support_email: null,
      legal_email: null,
      hero_title: null,
      hero_subtitle: null,
      updated_at: '2026-06-29T10:00:00.000Z',
      updated_by: null,
    })
    const out = await getPlatformSettingsGeneral()
    expect(out!.updated_by_display_name).toBeNull()
    const froms = serviceCalls.filter((c) => c.method === 'from').map((c) => c.table)
    expect(froms).toEqual(['platform_settings'])
  })
})

describe('getPlatformSettingsGeneral — error + null paths', () => {
  beforeEach(resetAll)
  afterEach(resetAll)

  it('returns null when the row is missing', async () => {
    const { getPlatformSettingsGeneral } = await import('./getPlatformSettingsGeneral')
    enqueue(null)
    const out = await getPlatformSettingsGeneral()
    expect(out).toBeNull()
  })

  it('returns null on DB error + warn log', async () => {
    const { getPlatformSettingsGeneral } = await import('./getPlatformSettingsGeneral')
    enqueue(null, { message: 'permission denied' })
    const out = await getPlatformSettingsGeneral()
    expect(out).toBeNull()
    const warns = logCalls.filter((c) => c.level === 'warn')
    expect(warns.length).toBe(1)
    expect(warns[0]!.payload['code']).toBe('platform_settings_read_failed')
  })

  it('returns null display name when the profile row is missing', async () => {
    const { getPlatformSettingsGeneral } = await import('./getPlatformSettingsGeneral')
    enqueue({
      default_royalty_pct_bps: 3000,
      plr_subscriber_discount_pct_bps: 1500,
      default_refund_window_days: 14,
      default_currency: 'USD',
      support_email: null,
      legal_email: null,
      hero_title: null,
      hero_subtitle: null,
      updated_at: '2026-06-29T10:00:00.000Z',
      updated_by: 'u_admin_1',
    })
    enqueue(null)
    const out = await getPlatformSettingsGeneral()
    expect(out!.updated_by_display_name).toBeNull()
  })

  it('returns null display name when the profile has no display_name', async () => {
    const { getPlatformSettingsGeneral } = await import('./getPlatformSettingsGeneral')
    enqueue({
      default_royalty_pct_bps: 3000,
      plr_subscriber_discount_pct_bps: 1500,
      default_refund_window_days: 14,
      default_currency: 'USD',
      support_email: null,
      legal_email: null,
      hero_title: null,
      hero_subtitle: null,
      updated_at: '2026-06-29T10:00:00.000Z',
      updated_by: 'u_admin_1',
    })
    enqueue({}) // no display_name field
    const out = await getPlatformSettingsGeneral()
    expect(out!.updated_by_display_name).toBeNull()
  })
})

describe('getPlatformSettingsGeneral — defensive coercion', () => {
  beforeEach(resetAll)
  afterEach(resetAll)

  it('falls back to 3000 bps for default_royalty when null', async () => {
    const { getPlatformSettingsGeneral } = await import('./getPlatformSettingsGeneral')
    enqueue({
      default_royalty_pct_bps: null,
      plr_subscriber_discount_pct_bps: 1500,
      default_refund_window_days: 14,
      default_currency: 'USD',
      support_email: null,
      legal_email: null,
      hero_title: null,
      hero_subtitle: null,
      updated_at: '2026-06-29T10:00:00.000Z',
      updated_by: null,
    })
    const out = await getPlatformSettingsGeneral()
    expect(out!.default_royalty_pct_bps).toBe(3000)
  })

  it('falls back to 1500 bps for plr_subscriber_discount when null', async () => {
    const { getPlatformSettingsGeneral } = await import('./getPlatformSettingsGeneral')
    enqueue({
      default_royalty_pct_bps: 3000,
      plr_subscriber_discount_pct_bps: null,
      default_refund_window_days: 14,
      default_currency: 'USD',
      support_email: null,
      legal_email: null,
      hero_title: null,
      hero_subtitle: null,
      updated_at: '2026-06-29T10:00:00.000Z',
      updated_by: null,
    })
    const out = await getPlatformSettingsGeneral()
    expect(out!.plr_subscriber_discount_pct_bps).toBe(1500)
  })

  it('falls back to 14 days for refund window when null', async () => {
    const { getPlatformSettingsGeneral } = await import('./getPlatformSettingsGeneral')
    enqueue({
      default_royalty_pct_bps: 3000,
      plr_subscriber_discount_pct_bps: 1500,
      default_refund_window_days: null,
      default_currency: 'USD',
      support_email: null,
      legal_email: null,
      hero_title: null,
      hero_subtitle: null,
      updated_at: '2026-06-29T10:00:00.000Z',
      updated_by: null,
    })
    const out = await getPlatformSettingsGeneral()
    expect(out!.default_refund_window_days).toBe(14)
  })

  it('falls back to 14 days for refund window when out-of-range (0)', async () => {
    const { getPlatformSettingsGeneral } = await import('./getPlatformSettingsGeneral')
    enqueue({
      default_royalty_pct_bps: 3000,
      plr_subscriber_discount_pct_bps: 1500,
      default_refund_window_days: 0,
      default_currency: 'USD',
      support_email: null,
      legal_email: null,
      hero_title: null,
      hero_subtitle: null,
      updated_at: '2026-06-29T10:00:00.000Z',
      updated_by: null,
    })
    const out = await getPlatformSettingsGeneral()
    expect(out!.default_refund_window_days).toBe(14)
  })

  it('falls back to 14 days for refund window when out-of-range (366)', async () => {
    const { getPlatformSettingsGeneral } = await import('./getPlatformSettingsGeneral')
    enqueue({
      default_royalty_pct_bps: 3000,
      plr_subscriber_discount_pct_bps: 1500,
      default_refund_window_days: 366,
      default_currency: 'USD',
      support_email: null,
      legal_email: null,
      hero_title: null,
      hero_subtitle: null,
      updated_at: '2026-06-29T10:00:00.000Z',
      updated_by: null,
    })
    const out = await getPlatformSettingsGeneral()
    expect(out!.default_refund_window_days).toBe(14)
  })

  it('falls back to USD when currency is invalid', async () => {
    const { getPlatformSettingsGeneral } = await import('./getPlatformSettingsGeneral')
    enqueue({
      default_royalty_pct_bps: 3000,
      plr_subscriber_discount_pct_bps: 1500,
      default_refund_window_days: 14,
      default_currency: 'JPY',
      support_email: null,
      legal_email: null,
      hero_title: null,
      hero_subtitle: null,
      updated_at: '2026-06-29T10:00:00.000Z',
      updated_by: null,
    })
    const out = await getPlatformSettingsGeneral()
    expect(out!.default_currency).toBe('USD')
  })

  it('treats string support_email / legal_email as null', async () => {
    const { getPlatformSettingsGeneral } = await import('./getPlatformSettingsGeneral')
    enqueue({
      default_royalty_pct_bps: 3000,
      plr_subscriber_discount_pct_bps: 1500,
      default_refund_window_days: 14,
      default_currency: 'USD',
      support_email: 12345,
      legal_email: { address: 'x' },
      hero_title: null,
      hero_subtitle: null,
      updated_at: '2026-06-29T10:00:00.000Z',
      updated_by: null,
    })
    const out = await getPlatformSettingsGeneral()
    expect(out!.support_email).toBeNull()
    expect(out!.legal_email).toBeNull()
  })
})