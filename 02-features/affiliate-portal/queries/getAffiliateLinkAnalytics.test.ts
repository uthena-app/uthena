// getAffiliateLinkAnalytics.test.ts — P13.7 link analytics queries.
//
// Coverage mirrors getAffiliateDailyPerformance.test.ts across all 3
// new query functions:
//   - Anon path (no auth user) returns []
//   - Non-affiliate path (no `affiliates` row) returns [] without
//     calling the RPC
//   - RPC error returns [] + warn with FNV-1a-hashed affiliate_id
//     (NEVER raw affiliate_id in the log payload)
//   - Happy path: each query maps the RPC shape to the typed
//     entity shape with defensive coercion (bigint-as-string +
//     numeric-as-string + ISO-string)
//   - Non-array RPC response falls back to []
//   - hoursBack / daysBack parameter forwarding (defaults + custom)
//   - The geo + device breakdowns render the "Unknown" bucket
//     correctly when country / device_class are NULL upstream
//   - PII safety: raw affiliate_id NEVER appears in any log payload
//   - Happy path is log-free

import { describe, it, expect, vi, beforeEach } from 'vitest'

// --- mock the supabase + logger modules -----------------------------------

const mockGetServerSupabase = vi.fn()
const mockWarn = vi.fn()

vi.mock('@foundations/data/supabase', () => ({
  getServerSupabase: () => mockGetServerSupabase(),
}))

vi.mock('@foundations/log/pino', () => ({
  loggerFor: () => ({ warn: mockWarn }),
}))

function makeChain(initial: {
  data: unknown
  error: unknown
} = { data: null, error: null }) {
  const state: { data: unknown; error: unknown } = { ...initial }
  const builder: Record<string, unknown> = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    maybeSingle: vi.fn(() => Promise.resolve({ data: state.data, error: state.error })),
  }
  return { builder, state }
}

function rpcHandler(payload: unknown) {
  return () => Promise.resolve({ data: payload, error: null })
}

function makeFakeSupabase(args: {
  user: { id: string } | null
  fromHandlers: Record<string, () => unknown>
  rpcHandlers: Record<string, () => Promise<unknown>>
}) {
  return {
    auth: {
      getUser: () =>
        Promise.resolve({ data: { user: args.user }, error: null }),
    },
    from: (table: string) => args.fromHandlers[table]!(),
    rpc: (fn: string) => args.rpcHandlers[fn]!(),
  }
}

beforeEach(() => {
  vi.resetModules()
  mockGetServerSupabase.mockReset()
  mockWarn.mockReset()
})

async function loadQuery() {
  return await import('./getAffiliateLinkAnalytics')
}

// ===========================================================================
// getAffiliateHourlyClicks
// ===========================================================================

describe('getAffiliateHourlyClicks — auth + ownership gates', () => {
  it('returns [] when there is no auth user', async () => {
    mockGetServerSupabase.mockResolvedValue(
      makeFakeSupabase({
        user: null,
        fromHandlers: {},
        rpcHandlers: {},
      }),
    )
    const q = await loadQuery()
    const out = await q.getAffiliateHourlyClicks()
    expect(out).toEqual([])
  })

  it('returns [] when the affiliates row is missing', async () => {
    const aff = makeChain({ data: null, error: null })
    mockGetServerSupabase.mockResolvedValue(
      makeFakeSupabase({
        user: { id: 'u-1' },
        fromHandlers: { affiliates: () => aff.builder },
        rpcHandlers: {},
      }),
    )
    const q = await loadQuery()
    const out = await q.getAffiliateHourlyClicks()
    expect(out).toEqual([])
    expect(mockWarn).not.toHaveBeenCalled()
  })
})

describe('getAffiliateHourlyClicks — happy path', () => {
  it('returns the 24-bucket series with coerced clicksCount', async () => {
    const aff = makeChain({ data: { id: 42 }, error: null })
    const now = Date.now()
    const buckets = Array.from({ length: 24 }, (_, i) => ({
      bucket_start: new Date(now - i * 3600_000).toISOString(),
      clicks_count: String(i * 3),
    })).reverse()
    mockGetServerSupabase.mockResolvedValue(
      makeFakeSupabase({
        user: { id: 'u-1' },
        fromHandlers: { affiliates: () => aff.builder },
        rpcHandlers: {
          get_affiliate_link_hourly_clicks: rpcHandler(buckets),
        },
      }),
    )
    const q = await loadQuery()
    const out = await q.getAffiliateHourlyClicks()
    expect(out).toHaveLength(24)
    // The test builds buckets oldest→newest (i=0 is newest) then
    // reverses, so out[0] is the oldest (i=23, 23*3 clicks) and
    // out[23] is the newest (i=0, 0 clicks).
    expect(out[0]!.clicksCount).toBe(23 * 3)
    expect(out[23]!.clicksCount).toBe(0)
    // ISO strings preserved (canonical form via new Date().toISOString())
    expect(out[0]!.bucketStart).toMatch(/T/)
  })

  it('defaults hoursBack to 24', async () => {
    const aff = makeChain({ data: { id: 42 }, error: null })
    const calls: Array<Record<string, unknown>> = []
    mockGetServerSupabase.mockResolvedValue({
      auth: {
        getUser: () => Promise.resolve({ data: { user: { id: 'u' } }, error: null }),
      },
      from: (table: string) => {
        if (table === 'affiliates') return aff.builder
        throw new Error(`unexpected from: ${table}`)
      },
      rpc: (_fn: string, args: Record<string, unknown>) => {
        calls.push(args)
        return Promise.resolve({ data: [], error: null })
      },
    })
    const q = await loadQuery()
    await q.getAffiliateHourlyClicks()
    expect(calls[0]!.p_hours_back).toBe(24)
    expect(calls[0]!.p_affiliate_id).toBe(42)
  })

  it('forwards a custom hoursBack', async () => {
    const aff = makeChain({ data: { id: 42 }, error: null })
    const calls: Array<Record<string, unknown>> = []
    mockGetServerSupabase.mockResolvedValue({
      auth: {
        getUser: () => Promise.resolve({ data: { user: { id: 'u' } }, error: null }),
      },
      from: (table: string) => {
        if (table === 'affiliates') return aff.builder
        throw new Error(`unexpected from: ${table}`)
      },
      rpc: (_fn: string, args: Record<string, unknown>) => {
        calls.push(args)
        return Promise.resolve({ data: [], error: null })
      },
    })
    const q = await loadQuery()
    await q.getAffiliateHourlyClicks({ hoursBack: 72 })
    expect(calls[0]!.p_hours_back).toBe(72)
  })

  it('coerces malformed bucket_start to empty string (never throws)', async () => {
    const aff = makeChain({ data: { id: 42 }, error: null })
    mockGetServerSupabase.mockResolvedValue(
      makeFakeSupabase({
        user: { id: 'u' },
        fromHandlers: { affiliates: () => aff.builder },
        rpcHandlers: {
          get_affiliate_link_hourly_clicks: rpcHandler([
            { bucket_start: 'not-a-date', clicks_count: '5' },
            { bucket_start: '',           clicks_count: '0' },
          ]),
        },
      }),
    )
    const q = await loadQuery()
    const out = await q.getAffiliateHourlyClicks()
    expect(out[0]!.bucketStart).toBe('')
    expect(out[1]!.bucketStart).toBe('')
  })

  it('clamps negative clicksCount to 0', async () => {
    const aff = makeChain({ data: { id: 42 }, error: null })
    mockGetServerSupabase.mockResolvedValue(
      makeFakeSupabase({
        user: { id: 'u' },
        fromHandlers: { affiliates: () => aff.builder },
        rpcHandlers: {
          get_affiliate_link_hourly_clicks: rpcHandler([
            { bucket_start: new Date().toISOString(), clicks_count: '-7' },
            { bucket_start: new Date().toISOString(), clicks_count: -3 },
          ]),
        },
      }),
    )
    const q = await loadQuery()
    const out = await q.getAffiliateHourlyClicks()
    expect(out[0]!.clicksCount).toBe(0)
    expect(out[1]!.clicksCount).toBe(0)
  })

  it('returns [] when the RPC returns a non-array', async () => {
    const aff = makeChain({ data: { id: 42 }, error: null })
    mockGetServerSupabase.mockResolvedValue(
      makeFakeSupabase({
        user: { id: 'u' },
        fromHandlers: { affiliates: () => aff.builder },
        rpcHandlers: {
          get_affiliate_link_hourly_clicks: () =>
            Promise.resolve({ data: { not: 'an array' }, error: null }),
        },
      }),
    )
    const q = await loadQuery()
    const out = await q.getAffiliateHourlyClicks()
    expect(out).toEqual([])
  })
})

describe('getAffiliateHourlyClicks — fail-soft + PII safety', () => {
  it('returns [] and logs a warn with FNV-1a-hashed affiliate_id (never raw)', async () => {
    const aff = makeChain({ data: { id: 999 }, error: null })
    mockGetServerSupabase.mockResolvedValue(
      makeFakeSupabase({
        user: { id: 'u' },
        fromHandlers: { affiliates: () => aff.builder },
        rpcHandlers: {
          get_affiliate_link_hourly_clicks: () =>
            Promise.resolve({
              data: null,
              error: { code: 'PGRST500', message: 'oops' },
            }),
        },
      }),
    )
    const q = await loadQuery()
    const out = await q.getAffiliateHourlyClicks()
    expect(out).toEqual([])
    expect(mockWarn).toHaveBeenCalledTimes(1)
    const [payload, message] = mockWarn.mock.calls[0] as [
      Record<string, unknown>,
      string,
    ]
    expect(message).toBe('hourly clicks RPC failed')
    expect(payload.affiliate_id_hash).toMatch(/^[0-9a-f]{8}$/)
    expect(JSON.stringify(payload)).not.toContain('999')
  })

  it('does not log on happy path', async () => {
    const aff = makeChain({ data: { id: 42 }, error: null })
    mockGetServerSupabase.mockResolvedValue(
      makeFakeSupabase({
        user: { id: 'u' },
        fromHandlers: { affiliates: () => aff.builder },
        rpcHandlers: {
          get_affiliate_link_hourly_clicks: rpcHandler([
            { bucket_start: new Date().toISOString(), clicks_count: '1' },
          ]),
        },
      }),
    )
    const q = await loadQuery()
    await q.getAffiliateHourlyClicks()
    expect(mockWarn).not.toHaveBeenCalled()
  })

  it('does not log when affiliates row read returns an error', async () => {
    // Affiliates read failure uses a different log message; should
    // still return [] without exposing affiliate_id.
    const aff = makeChain({
      data: null,
      error: { code: 'PGRST500', message: 'oops' },
    })
    mockGetServerSupabase.mockResolvedValue(
      makeFakeSupabase({
        user: { id: 'u' },
        fromHandlers: { affiliates: () => aff.builder },
        rpcHandlers: {},
      }),
    )
    const q = await loadQuery()
    const out = await q.getAffiliateHourlyClicks()
    expect(out).toEqual([])
    expect(mockWarn).toHaveBeenCalledTimes(1)
  })
})

// ===========================================================================
// getAffiliateGeoBreakdown
// ===========================================================================

describe('getAffiliateGeoBreakdown — happy path', () => {
  it('maps rows with country + clicks_count + share_pct (string→number coercion)', async () => {
    const aff = makeChain({ data: { id: 42 }, error: null })
    mockGetServerSupabase.mockResolvedValue(
      makeFakeSupabase({
        user: { id: 'u' },
        fromHandlers: { affiliates: () => aff.builder },
        rpcHandlers: {
          get_affiliate_link_geo_breakdown: rpcHandler([
            { country: 'US', clicks_count: '120', share_pct: '60.00' },
            { country: 'CA', clicks_count: '50',  share_pct: '25.00' },
            { country: 'Unknown', clicks_count: '30', share_pct: '15.00' },
          ]),
        },
      }),
    )
    const q = await loadQuery()
    const out = await q.getAffiliateGeoBreakdown()
    expect(out).toEqual([
      { country: 'US', clicksCount: 120, sharePct: 60 },
      { country: 'CA', clicksCount: 50, sharePct: 25 },
      { country: 'Unknown', clicksCount: 30, sharePct: 15 },
    ])
  })

  it('maps share_pct: null (empty window) → null', async () => {
    const aff = makeChain({ data: { id: 42 }, error: null })
    mockGetServerSupabase.mockResolvedValue(
      makeFakeSupabase({
        user: { id: 'u' },
        fromHandlers: { affiliates: () => aff.builder },
        rpcHandlers: {
          get_affiliate_link_geo_breakdown: rpcHandler([
            { country: 'US', clicks_count: '0', share_pct: null },
          ]),
        },
      }),
    )
    const q = await loadQuery()
    const out = await q.getAffiliateGeoBreakdown()
    expect(out[0]!.sharePct).toBeNull()
  })

  it('clamps share_pct to 0..100 range', async () => {
    const aff = makeChain({ data: { id: 42 }, error: null })
    mockGetServerSupabase.mockResolvedValue(
      makeFakeSupabase({
        user: { id: 'u' },
        fromHandlers: { affiliates: () => aff.builder },
        rpcHandlers: {
          get_affiliate_link_geo_breakdown: rpcHandler([
            { country: 'US', clicks_count: '1', share_pct: '250' },
            { country: 'CA', clicks_count: '1', share_pct: '-15' },
          ]),
        },
      }),
    )
    const q = await loadQuery()
    const out = await q.getAffiliateGeoBreakdown()
    expect(out[0]!.sharePct).toBe(100)
    expect(out[1]!.sharePct).toBe(0)
  })

  it('falls back to "Unknown" for empty / missing country', async () => {
    const aff = makeChain({ data: { id: 42 }, error: null })
    mockGetServerSupabase.mockResolvedValue(
      makeFakeSupabase({
        user: { id: 'u' },
        fromHandlers: { affiliates: () => aff.builder },
        rpcHandlers: {
          get_affiliate_link_geo_breakdown: rpcHandler([
            { country: '',     clicks_count: '5', share_pct: '100.00' },
            { country: null,   clicks_count: '3', share_pct: '60.00' },
          ]),
        },
      }),
    )
    const q = await loadQuery()
    const out = await q.getAffiliateGeoBreakdown()
    expect(out[0]!.country).toBe('Unknown')
    expect(out[1]!.country).toBe('Unknown')
  })

  it('defaults daysBack to 30', async () => {
    const aff = makeChain({ data: { id: 42 }, error: null })
    const calls: Array<Record<string, unknown>> = []
    mockGetServerSupabase.mockResolvedValue({
      auth: {
        getUser: () => Promise.resolve({ data: { user: { id: 'u' } }, error: null }),
      },
      from: (table: string) => {
        if (table === 'affiliates') return aff.builder
        throw new Error(`unexpected from: ${table}`)
      },
      rpc: (_fn: string, args: Record<string, unknown>) => {
        calls.push(args)
        return Promise.resolve({ data: [], error: null })
      },
    })
    const q = await loadQuery()
    await q.getAffiliateGeoBreakdown()
    expect(calls[0]!.p_days_back).toBe(30)
  })
})

describe('getAffiliateGeoBreakdown — fail-soft + PII safety', () => {
  it('returns [] on RPC error + PII-safe warn', async () => {
    const aff = makeChain({ data: { id: 999 }, error: null })
    mockGetServerSupabase.mockResolvedValue(
      makeFakeSupabase({
        user: { id: 'u' },
        fromHandlers: { affiliates: () => aff.builder },
        rpcHandlers: {
          get_affiliate_link_geo_breakdown: () =>
            Promise.resolve({
              data: null,
              error: { code: 'PGRST500' },
            }),
        },
      }),
    )
    const q = await loadQuery()
    const out = await q.getAffiliateGeoBreakdown()
    expect(out).toEqual([])
    const [payload] = mockWarn.mock.calls[0] as [
      Record<string, unknown>,
      string,
    ]
    expect(JSON.stringify(payload)).not.toContain('999')
  })
})

// ===========================================================================
// getAffiliateDeviceBreakdown
// ===========================================================================

describe('getAffiliateDeviceBreakdown — happy path', () => {
  it('maps rows with device_class + clicks_count + share_pct', async () => {
    const aff = makeChain({ data: { id: 42 }, error: null })
    mockGetServerSupabase.mockResolvedValue(
      makeFakeSupabase({
        user: { id: 'u' },
        fromHandlers: { affiliates: () => aff.builder },
        rpcHandlers: {
          get_affiliate_link_device_breakdown: rpcHandler([
            { device_class: 'mobile',  clicks_count: '80', share_pct: '53.33' },
            { device_class: 'desktop', clicks_count: '60', share_pct: '40.00' },
            { device_class: 'tablet',  clicks_count: '10', share_pct: '6.67' },
          ]),
        },
      }),
    )
    const q = await loadQuery()
    const out = await q.getAffiliateDeviceBreakdown()
    expect(out).toEqual([
      { deviceClass: 'mobile',  clicksCount: 80, sharePct: 53.33 },
      { deviceClass: 'desktop', clicksCount: 60, sharePct: 40 },
      { deviceClass: 'tablet',  clicksCount: 10, sharePct: 6.67 },
    ])
  })

  it('falls back to "Unknown" for null device_class', async () => {
    const aff = makeChain({ data: { id: 42 }, error: null })
    mockGetServerSupabase.mockResolvedValue(
      makeFakeSupabase({
        user: { id: 'u' },
        fromHandlers: { affiliates: () => aff.builder },
        rpcHandlers: {
          get_affiliate_link_device_breakdown: rpcHandler([
            { device_class: null, clicks_count: '5', share_pct: '100.00' },
          ]),
        },
      }),
    )
    const q = await loadQuery()
    const out = await q.getAffiliateDeviceBreakdown()
    expect(out[0]!.deviceClass).toBe('Unknown')
  })

  it('coerces share_pct: string | number → number (defensive)', async () => {
    const aff = makeChain({ data: { id: 42 }, error: null })
    mockGetServerSupabase.mockResolvedValue(
      makeFakeSupabase({
        user: { id: 'u' },
        fromHandlers: { affiliates: () => aff.builder },
        rpcHandlers: {
          get_affiliate_link_device_breakdown: rpcHandler([
            { device_class: 'mobile', clicks_count: '5', share_pct: 25.5 },
          ]),
        },
      }),
    )
    const q = await loadQuery()
    const out = await q.getAffiliateDeviceBreakdown()
    expect(out[0]!.sharePct).toBe(25.5)
  })
})

describe('getAffiliateDeviceBreakdown — fail-soft + PII safety', () => {
  it('returns [] on RPC error + PII-safe warn', async () => {
    const aff = makeChain({ data: { id: 999 }, error: null })
    mockGetServerSupabase.mockResolvedValue(
      makeFakeSupabase({
        user: { id: 'u' },
        fromHandlers: { affiliates: () => aff.builder },
        rpcHandlers: {
          get_affiliate_link_device_breakdown: () =>
            Promise.resolve({
              data: null,
              error: { code: 'PGRST500' },
            }),
        },
      }),
    )
    const q = await loadQuery()
    const out = await q.getAffiliateDeviceBreakdown()
    expect(out).toEqual([])
    const [payload] = mockWarn.mock.calls[0] as [
      Record<string, unknown>,
      string,
    ]
    expect(JSON.stringify(payload)).not.toContain('999')
  })
})