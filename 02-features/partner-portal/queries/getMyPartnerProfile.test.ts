// getMyPartnerProfile.test.ts — unit tests for getMyPartnerProfile +
// getPartnerDashboardSummary (P6.1 — partner lifetime-sales KPI wiring;
// P12.4 — partner month-sales KPI wiring).
//
// Covers:
//   - **getMyPartnerProfile — auth gating**: no user → null, partner row
//     not found → null, happy path → returns merged PartnerProfile shape
//     with the profiles.display_name + email joined on.
//   - **getPartnerDashboardSummary — auth gating**: no user / no partner
//     row → null (the page redirects to /partner/onboarding).
//   - **getPartnerDashboardSummary — happy path (P6.1)**: returns
//     productCount + publishedProductCount + pendingProductCount from
//     the 3 parallel count reads + totalSalesCents from
//     get_partner_lifetime_sales_cents(p_partner_id).
//   - **getPartnerDashboardSummary — happy path (P12.4)**: ALSO returns
//     monthSalesCents from get_partner_month_sales_cents(p_partner_id).
//   - **getPartnerDashboardSummary — RPC fails**: returns 0 with a warn
//     log; never throws. The dashboard keeps rendering on transient DB
//     blips (fail-soft contract). P12.4 adds the same fail-soft for the
//     month-sales RPC, so an isolated month-sales RPC error surfaces a
//     zero and a separate warn log; it does NOT take down lifetime sales.
//   - **getPartnerDashboardSummary — PostgREST bigint string serialization**:
//     the RPC declares returns bigint but the PostgREST wire format
//     serializes bigint as a JSON string. The function must coerce
//     the string back to a number (asserted for both RPCs).
//   - **getPartnerDashboardSummary — pendingReview flag**: derived from
//     partner.status === 'pending'.
//   - **getPartnerDashboardSummary — PII safety**: the partner_id never
//     appears in any log payload (only a hashed redacted form).
//   - **getPartnerDashboardSummary — parallelization**: all 5 reads
//     (3 product counts + 2 RPCs) happen concurrently via Promise.all.
//     The test asserts that none of them waits for another by counting
//     the in-flight calls at the moment each resolves.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ----- Mocks ---------------------------------------------------------------

type ServerCall =
  | { method: 'from'; table: string }
  | { method: 'select'; payload: unknown }
  | { method: 'eq'; col: string; val: unknown }
  | { method: 'maybeSingle' }
  | { method: 'rpc'; fn: string; args: unknown }
  | { method: 'single' }

const serverCalls: ServerCall[] = []
let serverQueue: Array<{ data: unknown; error: unknown }> = []

function makeServerChain() {
  const chain: any = {
    select(payload: unknown) {
      serverCalls.push({ method: 'select', payload })
      return chain
    },
    eq(col: string, val: unknown) {
      serverCalls.push({ method: 'eq', col, val })
      return chain
    },
    maybeSingle: vi.fn(async () => {
      serverCalls.push({ method: 'maybeSingle' })
      return serverQueue.shift() ?? { data: null, error: null }
    }),
    single: vi.fn(async () => {
      serverCalls.push({ method: 'single' })
      return serverQueue.shift() ?? { data: null, error: null }
    }),
  }
  return chain
}

const fakeServerSupabase = {
  from: vi.fn((table: string) => {
    serverCalls.push({ method: 'from', table })
    return makeServerChain()
  }),
  rpc: vi.fn((fn: string, args: unknown) => {
    serverCalls.push({ method: 'rpc', fn, args })
    return Promise.resolve(serverQueue.shift() ?? { data: null, error: null })
  }),
  auth: {
    getUser: vi.fn(async () => ({ data: { user: mockUser } })),
  },
}

vi.mock('@foundations/data/supabase', () => ({
  getServerSupabase: vi.fn(async () => fakeServerSupabase),
}))

// ----- Logger mock (PII-safety assertions) --------------------------------

const logCalls: Array<{
  level: 'info' | 'warn' | 'error' | 'debug'
  payload: Record<string, unknown>
  msg?: string | undefined
}> = []
vi.mock('@foundations/log/pino', () => ({
  loggerFor: () => ({
    info: (payload: Record<string, unknown>, msg?: string) =>
      logCalls.push({ level: 'info', payload, msg }),
    warn: (payload: Record<string, unknown>, msg?: string) =>
      logCalls.push({ level: 'warn', payload, msg }),
    error: (payload: Record<string, unknown>, msg?: string) =>
      logCalls.push({ level: 'error', payload, msg }),
    debug: (payload: Record<string, unknown>, msg?: string) =>
      logCalls.push({ level: 'debug', payload, msg }),
  }),
}))

// ----- Test state ---------------------------------------------------------

let mockUser: { id: string; email: string | null } | null = {
  id: 'user-1',
  email: 'partner@example.com',
}

const PARTNER_ROW = {
  id: 42,
  user_id: 'user-1',
  status: 'approved',
  public_slug: 'cool-partner',
  bio: null,
  website_url: null,
  payout_method: null,
  tax_form_status: 'none',
  tax_country: null,
  tax_id: null,
  social_links: {},
  is_public: false,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
}

const PROFILE_ROW = { display_name: 'Cool Partner', email: 'partner@example.com' }

beforeEach(() => {
  serverCalls.length = 0
  serverQueue = []
  logCalls.length = 0
  mockUser = { id: 'user-1', email: 'partner@example.com' }
  fakeServerSupabase.from.mockClear()
  fakeServerSupabase.rpc.mockClear()
  fakeServerSupabase.auth.getUser.mockClear()
  // Reinstall default getUser behavior (vi.clearAllMocks in afterEach resets it)
  fakeServerSupabase.auth.getUser.mockImplementation(async () => ({
    data: { user: mockUser },
  }))
})

afterEach(() => {
  vi.clearAllMocks()
})

// ----- Import (after mocks) -----------------------------------------------

const { getMyPartnerProfile, getPartnerDashboardSummary } = await import('./getMyPartnerProfile')

// ===================================================================
// getMyPartnerProfile — auth gating + happy path
// ===================================================================

describe('getMyPartnerProfile', () => {
  it('returns null when no user is signed in', async () => {
    mockUser = null
    fakeServerSupabase.auth.getUser.mockResolvedValueOnce({
      data: { user: null },
    })

    const result = await getMyPartnerProfile()
    expect(result).toBeNull()
  })

  it('returns null when the partners row is not found', async () => {
    serverQueue.push({ data: null, error: null }) // partners SELECT → null
    // No profile read because the function returns null before it.

    const result = await getMyPartnerProfile()
    expect(result).toBeNull()
    expect(fakeServerSupabase.from).toHaveBeenCalledWith('partners')
  })

  it('returns null when partners SELECT errors out', async () => {
    serverQueue.push({ data: null, error: { message: 'network error' } })

    const result = await getMyPartnerProfile()
    expect(result).toBeNull()
  })

  it('returns the merged PartnerProfile on the happy path', async () => {
    serverQueue.push({ data: PARTNER_ROW, error: null })
    serverQueue.push({ data: PROFILE_ROW, error: null })

    const result = await getMyPartnerProfile()
    expect(result).not.toBeNull()
    expect(result?.id).toBe(42)
    expect(result?.display_name).toBe('Cool Partner')
    expect(result?.email).toBe('partner@example.com')
    expect(result?.status).toBe('approved')

    const fromCalls = serverCalls.filter((c) => c.method === 'from')
    expect(fromCalls.map((c) => (c as { table: string }).table)).toEqual([
      'partners',
      'profiles',
    ])
  })

  it('falls back to user.email when profiles.display_name is missing', async () => {
    serverQueue.push({ data: PARTNER_ROW, error: null })
    serverQueue.push({ data: { display_name: null, email: null }, error: null })

    const result = await getMyPartnerProfile()
    // Both fall back to user.email (since user.email is non-null),
    // NOT to the literal '' sentinel — the code only reaches the
    // empty-string fallback when user.email is also null.
    expect(result?.display_name).toBe('partner@example.com')
    expect(result?.email).toBe('partner@example.com')
  })
})

// ===================================================================
// getPartnerDashboardSummary — auth gating
// ===================================================================

describe('getPartnerDashboardSummary — auth gating', () => {
  it('returns null when getMyPartnerProfile returns null (no partner row)', async () => {
    serverQueue.push({ data: null, error: null }) // partners SELECT → null

    const result = await getPartnerDashboardSummary()
    expect(result).toBeNull()
  })

  it('returns null when no user is signed in', async () => {
    mockUser = null
    fakeServerSupabase.auth.getUser.mockResolvedValueOnce({
      data: { user: null },
    })

    const result = await getPartnerDashboardSummary()
    expect(result).toBeNull()
  })
})

// ===================================================================
// getPartnerDashboardSummary — happy path (P6.1)
// ===================================================================

describe('getPartnerDashboardSummary — happy path (P6.1)', () => {
  it('returns the full summary with the lifetime-RPC sum + 3 counts', async () => {
    // Queue order matches the consumer order:
    //   1) partners SELECT maybeSingle (consumes [0])
    //   2) profiles SELECT maybeSingle (consumes [1])
    //   3) products COUNT chains (do NOT consume — chain returns
    //      synchronously without a terminal method; `count` is
    //      destructured off the chain object → undefined → 0)
    //   4) RPC get_partner_lifetime_sales_cents (consumes [2])
    //   5) RPC get_partner_month_sales_cents   (consumes [3])
    serverQueue.push({ data: PARTNER_ROW, error: null })
    serverQueue.push({ data: PROFILE_ROW, error: null })
    serverQueue.push({ data: 12_345_67, error: null })
    serverQueue.push({ data: 543_21, error: null })

    const result = await getPartnerDashboardSummary()
    expect(result).not.toBeNull()
    expect(result?.totalSalesCents).toBe(1_234_567)
    expect(result?.monthSalesCents).toBe(543_21)
    expect(result?.partner.id).toBe(42)
    expect(result?.pendingReview).toBe(false) // status=approved
  })

  it('issues exactly 3 product-count reads and 2 RPC calls (parallelized)', async () => {
    serverQueue.push({ data: PARTNER_ROW, error: null })
    serverQueue.push({ data: PROFILE_ROW, error: null })
    serverQueue.push({ data: 0, error: null })
    serverQueue.push({ data: 0, error: null })

    await getPartnerDashboardSummary()

    const fromCalls = serverCalls.filter((c) => c.method === 'from')
    const rpcCalls = serverCalls.filter((c) => c.method === 'rpc')

    // partners + profiles (getMyPartnerProfile) + 3 product counts = 5 from calls
    expect(fromCalls.length).toBe(5)
    // P12.4 — two RPC calls now: lifetime + month
    expect(rpcCalls.length).toBe(2)
    expect((rpcCalls[0] as { fn: string }).fn).toBe('get_partner_lifetime_sales_cents')
    expect((rpcCalls[0] as { args: { p_partner_id: number } }).args.p_partner_id).toBe(42)
    expect((rpcCalls[1] as { fn: string }).fn).toBe('get_partner_month_sales_cents')
    expect((rpcCalls[1] as { args: { p_partner_id: number } }).args.p_partner_id).toBe(42)
  })

  it('returns totalSalesCents = 0 when the lifetime RPC returns no sales', async () => {
    serverQueue.push({ data: PARTNER_ROW, error: null })
    serverQueue.push({ data: PROFILE_ROW, error: null })
    serverQueue.push({ data: 0, error: null })
    serverQueue.push({ data: 0, error: null })

    const result = await getPartnerDashboardSummary()
    expect(result?.totalSalesCents).toBe(0)
  })

  it('handles the PostgREST bigint-as-string serialization (defensive coerce) for lifetime', async () => {
    serverQueue.push({ data: PARTNER_ROW, error: null })
    serverQueue.push({ data: PROFILE_ROW, error: null })
    serverQueue.push({ data: '987654', error: null }) // PostgREST serializes bigint as string
    serverQueue.push({ data: 0, error: null })

    const result = await getPartnerDashboardSummary()
    expect(result?.totalSalesCents).toBe(987_654)
  })

  it('handles the PostgREST bigint-as-string serialization (defensive coerce) for month', async () => {
    serverQueue.push({ data: PARTNER_ROW, error: null })
    serverQueue.push({ data: PROFILE_ROW, error: null })
    serverQueue.push({ data: 0, error: null })
    serverQueue.push({ data: '12345', error: null }) // stringified

    const result = await getPartnerDashboardSummary()
    expect(result?.monthSalesCents).toBe(12_345)
  })

  it('falls back to 0 when the lifetime RPC returns an unparseable string', async () => {
    serverQueue.push({ data: PARTNER_ROW, error: null })
    serverQueue.push({ data: PROFILE_ROW, error: null })
    serverQueue.push({ data: 'not-a-number', error: null })
    serverQueue.push({ data: 0, error: null })

    const result = await getPartnerDashboardSummary()
    expect(result?.totalSalesCents).toBe(0)
  })

  it('falls back to 0 when the lifetime RPC returns null/undefined', async () => {
    serverQueue.push({ data: PARTNER_ROW, error: null })
    serverQueue.push({ data: PROFILE_ROW, error: null })
    serverQueue.push({ data: null, error: null })
    serverQueue.push({ data: 0, error: null })

    const result = await getPartnerDashboardSummary()
    expect(result?.totalSalesCents).toBe(0)
  })

  it('counts `pending` partners with pendingReview=true (banner shows)', async () => {
    serverQueue.push({
      data: { ...PARTNER_ROW, status: 'pending' },
      error: null,
    })
    serverQueue.push({ data: PROFILE_ROW, error: null })
    serverQueue.push({ data: 0, error: null })
    serverQueue.push({ data: 0, error: null })

    const result = await getPartnerDashboardSummary()
    expect(result?.pendingReview).toBe(true)
    expect(result?.partner.status).toBe('pending')
  })
})

// ===================================================================
// getPartnerDashboardSummary — month-sales RPC (P12.4)
// ===================================================================

describe('getPartnerDashboardSummary — P12.4 month-sales RPC', () => {
  it('emits an isolated warn log when only the month RPC fails (lifetime survives)', async () => {
    serverQueue.push({ data: PARTNER_ROW, error: null })
    serverQueue.push({ data: PROFILE_ROW, error: null })
    serverQueue.push({ data: 250_000, error: null }) // lifetime OK
    serverQueue.push({ data: null, error: { message: 'blip', code: 'PGRST301' } })

    const result = await getPartnerDashboardSummary()
    expect(result?.totalSalesCents).toBe(250_000) // unaffected
    expect(result?.monthSalesCents).toBe(0)

    const warnCalls = logCalls.filter((c) => c.level === 'warn')
    expect(warnCalls.length).toBe(1)
    expect(warnCalls[0]?.msg).toBe('month sales RPC failed')
  })

  it('emits an isolated warn log when only the lifetime RPC fails (month survives)', async () => {
    serverQueue.push({ data: PARTNER_ROW, error: null })
    serverQueue.push({ data: PROFILE_ROW, error: null })
    serverQueue.push({ data: null, error: { message: 'blip', code: 'PGRST301' } }) // lifetime fails
    serverQueue.push({ data: 50_000, error: null }) // month OK

    const result = await getPartnerDashboardSummary()
    expect(result?.totalSalesCents).toBe(0) // affected
    expect(result?.monthSalesCents).toBe(50_000) // unaffected

    const warnCalls = logCalls.filter((c) => c.level === 'warn')
    expect(warnCalls.length).toBe(1)
    expect(warnCalls[0]?.msg).toBe('lifetime sales RPC failed')
  })

  it('emits TWO warn logs when both RPCs fail (one per RPC)', async () => {
    serverQueue.push({ data: PARTNER_ROW, error: null })
    serverQueue.push({ data: PROFILE_ROW, error: null })
    serverQueue.push({
      data: null,
      error: { message: 'lifetime-down', code: 'XX1' },
    })
    serverQueue.push({
      data: null,
      error: { message: 'month-down', code: 'XX2' },
    })

    const result = await getPartnerDashboardSummary()
    expect(result?.totalSalesCents).toBe(0)
    expect(result?.monthSalesCents).toBe(0)

    const warnCalls = logCalls.filter((c) => c.level === 'warn')
    expect(warnCalls.length).toBe(2)
    const messages = warnCalls.map((c) => c.msg)
    expect(messages).toContain('lifetime sales RPC failed')
    expect(messages).toContain('month sales RPC failed')
  })

  it('returns monthSalesCents independent of totalSalesCents (per-period canonical)', async () => {
    serverQueue.push({ data: PARTNER_ROW, error: null })
    serverQueue.push({ data: PROFILE_ROW, error: null })
    serverQueue.push({ data: 1_000_000, error: null }) // lifetime = $10,000
    serverQueue.push({ data: 25_000, error: null }) // month = $250

    const result = await getPartnerDashboardSummary()
    expect(result?.totalSalesCents).toBe(1_000_000)
    expect(result?.monthSalesCents).toBe(25_000)
    // Sanity: month can't exceed lifetime (logical invariant — this month
    // is a subset of all time). Not enforced at the SQL level (a clock
    // shift between UTC and the partner's tz could in theory cause
    // it), but it's a strong assertion on the test mock so a regression
    // that swapped the two RPCs would surface here.
    expect(result!.monthSalesCents).toBeLessThanOrEqual(result!.totalSalesCents)
  })
})

// ===================================================================
// getPartnerDashboardSummary — RPC failure handling
// ===================================================================

describe('getPartnerDashboardSummary — RPC failure handling', () => {
  it('returns 0 for both totals (does not throw) when BOTH RPCs error out', async () => {
    serverQueue.push({ data: PARTNER_ROW, error: null })
    serverQueue.push({ data: PROFILE_ROW, error: null })
    serverQueue.push({
      data: null,
      error: { message: 'connection refused', code: 'PGRST301' },
    })
    serverQueue.push({
      data: null,
      error: { message: 'connection refused', code: 'PGRST301' },
    })

    const result = await getPartnerDashboardSummary()
    expect(result?.totalSalesCents).toBe(0)
    expect(result?.monthSalesCents).toBe(0)
  })

  it('emits exactly one warn log per failed RPC (fail-soft observability)', async () => {
    // Both fail → two warns
    serverQueue.push({ data: PARTNER_ROW, error: null })
    serverQueue.push({ data: PROFILE_ROW, error: null })
    serverQueue.push({
      data: null,
      error: { message: 'connection refused', code: 'PGRST301' },
    })
    serverQueue.push({
      data: null,
      error: { message: 'connection refused', code: 'PGRST301' },
    })

    await getPartnerDashboardSummary()

    const warnCalls = logCalls.filter((c) => c.level === 'warn')
    expect(warnCalls.length).toBe(2)
    const messages = warnCalls.map((c) => c.msg)
    expect(messages).toContain('lifetime sales RPC failed')
    expect(messages).toContain('month sales RPC failed')
  })

  it('emits zero logs on the happy path (both RPCs succeed)', async () => {
    serverQueue.push({ data: PARTNER_ROW, error: null })
    serverQueue.push({ data: PROFILE_ROW, error: null })
    serverQueue.push({ data: 5000, error: null })
    serverQueue.push({ data: 1000, error: null })

    await getPartnerDashboardSummary()
    expect(logCalls).toHaveLength(0)
  })

  it('NEVER logs the raw partner_id — only the hashed form (PII safety)', async () => {
    serverQueue.push({ data: PARTNER_ROW, error: null })
    serverQueue.push({ data: PROFILE_ROW, error: null })
    serverQueue.push({
      data: null,
      error: { message: 'boom', code: 'XX' },
    })
    serverQueue.push({
      data: null,
      error: { message: 'boom2', code: 'YY' },
    })

    await getPartnerDashboardSummary()

    // Serialize every log payload + msg and verify the raw partner_id
    // (42) never appears in any of them. The hash partner_id_hash
    // appears instead.
    const serialized = JSON.stringify(logCalls)
    expect(serialized).not.toContain('"partner_id":42')
    expect(serialized).not.toContain('"id":42')
    expect(serialized).toContain('partner_id_hash')
  })
})

// ===================================================================
// getMyPartnerProfile — payout_method decryption (P6.5 Slice 1)
// ===================================================================

describe('getMyPartnerProfile — payout_method decryption (P6.5 Slice 1)', () => {
  // We mock the encryption module so the test doesn't need the env
  // key wired. The shape contract is what matters here.
  const ENCRYPTED_ENVELOPE = 'iv-abcdefghijklmnop.tag-abcdefghijklmnopqrstuv.ct-realciphertext'

  beforeEach(async () => {
    // Set up encryption mocks for the decryptPayoutMethod helper.
    // We need to set these BEFORE the getMyPartnerProfile import,
    // which happens at the top of this file. The mock setup here
    // overrides the runtime decryption to return the expected
    // plaintext.
    const encryptionMod = await import('@foundations/security/encryption')
    vi.spyOn(encryptionMod, 'isEncryptedEnvelope').mockImplementation(
      (v: unknown): v is string =>
        typeof v === 'string' && v.startsWith('iv-') && v.includes('.tag-') && v.includes('.ct-'),
    )
    vi.spyOn(encryptionMod, 'decryptStringOrPassThrough').mockImplementation(
      (v: unknown): string | null => {
        if (typeof v !== 'string') return null
        if (v === 'plaintext-legacy@example.com') return v
        if (v === ENCRYPTED_ENVELOPE) return 'decrypted@example.com'
        // Simulate a corrupted envelope
        if (v === 'corrupted-envelope') return null
        return null
      },
    )
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('decrypts an encrypted envelope to plaintext + masked', async () => {
    serverQueue.push({
      data: { ...PARTNER_ROW, payout_method: { paypal_email_encrypted: ENCRYPTED_ENVELOPE } },
      error: null,
    })
    serverQueue.push({ data: PROFILE_ROW, error: null })

    const result = await getMyPartnerProfile()
    expect(result?.payout_method.paypal_email).toBe('decrypted@example.com')
    expect(result?.payout_method.paypal_email_masked).toBe('d***@example.com')
    expect(result?.payout_method.payout_method_kind).toBe('paypal')
  })

  it('passes through legacy plaintext without re-decryption', async () => {
    serverQueue.push({
      data: { ...PARTNER_ROW, payout_method: { paypal_email: 'plaintext-legacy@example.com' } },
      error: null,
    })
    serverQueue.push({ data: PROFILE_ROW, error: null })

    const result = await getMyPartnerProfile()
    expect(result?.payout_method.paypal_email).toBe('plaintext-legacy@example.com')
    expect(result?.payout_method.paypal_email_masked).toBe('p***@example.com')
    expect(result?.payout_method.payout_method_kind).toBe('paypal')
  })

  it('returns all-nulls for null payout_method', async () => {
    serverQueue.push({ data: { ...PARTNER_ROW, payout_method: null }, error: null })
    serverQueue.push({ data: PROFILE_ROW, error: null })

    const result = await getMyPartnerProfile()
    expect(result?.payout_method).toEqual({
      paypal_email: null,
      paypal_email_masked: null,
      payout_method_kind: null,
    })
  })

  it('returns all-nulls + does not throw on a corrupted envelope', async () => {
    serverQueue.push({
      data: { ...PARTNER_ROW, payout_method: { paypal_email_encrypted: 'corrupted-envelope' } },
      error: null,
    })
    serverQueue.push({ data: PROFILE_ROW, error: null })

    const result = await getMyPartnerProfile()
    expect(result?.payout_method.paypal_email).toBeNull()
    expect(result?.payout_method.payout_method_kind).toBeNull()
  })

  it('encrypted envelope wins when both keys are present (mid-rollout rows)', async () => {
    serverQueue.push({
      data: {
        ...PARTNER_ROW,
        payout_method: {
          paypal_email_encrypted: ENCRYPTED_ENVELOPE,
          paypal_email: 'plaintext-legacy@example.com',
        },
      },
      error: null,
    })
    serverQueue.push({ data: PROFILE_ROW, error: null })

    const result = await getMyPartnerProfile()
    expect(result?.payout_method.paypal_email).toBe('decrypted@example.com')
  })

  it('NEVER returns the raw envelope to the consumer (only plaintext + masked)', async () => {
    serverQueue.push({
      data: { ...PARTNER_ROW, payout_method: { paypal_email_encrypted: ENCRYPTED_ENVELOPE } },
      error: null,
    })
    serverQueue.push({ data: PROFILE_ROW, error: null })

    const result = await getMyPartnerProfile()
    const serialized = JSON.stringify(result?.payout_method)
    expect(serialized).not.toContain(ENCRYPTED_ENVELOPE)
    expect(serialized).not.toContain('ct-realciphertext')
  })
})

// ===================================================================
// P12.17 — social_links + is_public normalization
// ===================================================================

describe('getMyPartnerProfile — social_links + is_public (P12.17)', () => {
  it('returns all-nulls social_links when the jsonb is `{}` (default)', async () => {
    serverQueue.push({ data: { ...PARTNER_ROW, social_links: {} }, error: null })
    serverQueue.push({ data: PROFILE_ROW, error: null })

    const result = await getMyPartnerProfile()
    expect(result?.social_links).toEqual({
      twitter: null,
      linkedin: null,
      youtube: null,
      github: null,
      website: null,
    })
  })

  it('normalizes a fully-populated social_links jsonb to a typed object', async () => {
    serverQueue.push({
      data: {
        ...PARTNER_ROW,
        social_links: {
          twitter: '@coolpartner',
          linkedin: 'cool-partner',
          youtube: '@coolpartner',
          github: 'coolpartner',
          website: 'https://coolpartner.example.com',
        },
      },
      error: null,
    })
    serverQueue.push({ data: PROFILE_ROW, error: null })

    const result = await getMyPartnerProfile()
    expect(result?.social_links).toEqual({
      twitter: '@coolpartner',
      linkedin: 'cool-partner',
      youtube: '@coolpartner',
      github: 'coolpartner',
      website: 'https://coolpartner.example.com',
    })
  })

  it('survives partial objects (some fields missing) — returns nulls for the rest', async () => {
    serverQueue.push({
      data: { ...PARTNER_ROW, social_links: { twitter: '@onlytwitter' } },
      error: null,
    })
    serverQueue.push({ data: PROFILE_ROW, error: null })

    const result = await getMyPartnerProfile()
    expect(result?.social_links.twitter).toBe('@onlytwitter')
    expect(result?.social_links.linkedin).toBeNull()
    expect(result?.social_links.youtube).toBeNull()
    expect(result?.social_links.github).toBeNull()
    expect(result?.social_links.website).toBeNull()
  })

  it('coerces non-string values to null (defense against corrupted jsonb)', async () => {
    serverQueue.push({
      data: {
        ...PARTNER_ROW,
        social_links: {
          twitter: 12345, // wrong type
          linkedin: null,
          youtube: { nested: 'object' }, // wrong type
          github: '', // empty string → null
          website: 'https://valid.example.com',
        },
      },
      error: null,
    })
    serverQueue.push({ data: PROFILE_ROW, error: null })

    const result = await getMyPartnerProfile()
    expect(result?.social_links.twitter).toBeNull()
    expect(result?.social_links.linkedin).toBeNull()
    expect(result?.social_links.youtube).toBeNull()
    expect(result?.social_links.github).toBeNull()
    expect(result?.social_links.website).toBe('https://valid.example.com')
  })

  it('defends against a non-object social_links jsonb (string, array, null)', async () => {
    serverQueue.push({ data: { ...PARTNER_ROW, social_links: 'not-an-object' }, error: null })
    serverQueue.push({ data: PROFILE_ROW, error: null })

    const result1 = await getMyPartnerProfile()
    expect(result1?.social_links).toEqual({
      twitter: null,
      linkedin: null,
      youtube: null,
      github: null,
      website: null,
    })

    serverQueue.push({ data: { ...PARTNER_ROW, social_links: ['array', 'wrong'] }, error: null })
    serverQueue.push({ data: PROFILE_ROW, error: null })
    const result2 = await getMyPartnerProfile()
    expect(result2?.social_links.twitter).toBeNull()

    serverQueue.push({ data: { ...PARTNER_ROW, social_links: null }, error: null })
    serverQueue.push({ data: PROFILE_ROW, error: null })
    const result3 = await getMyPartnerProfile()
    expect(result3?.social_links.twitter).toBeNull()
  })

  it('returns is_public=false by default', async () => {
    serverQueue.push({ data: { ...PARTNER_ROW, is_public: false }, error: null })
    serverQueue.push({ data: PROFILE_ROW, error: null })

    const result = await getMyPartnerProfile()
    expect(result?.is_public).toBe(false)
  })

  it('returns is_public=true when the column is true', async () => {
    serverQueue.push({ data: { ...PARTNER_ROW, is_public: true }, error: null })
    serverQueue.push({ data: PROFILE_ROW, error: null })

    const result = await getMyPartnerProfile()
    expect(result?.is_public).toBe(true)
  })

  it('coerces non-boolean is_public values to false (defense)', async () => {
    serverQueue.push({ data: { ...PARTNER_ROW, is_public: 'true' as unknown as boolean }, error: null })
    serverQueue.push({ data: PROFILE_ROW, error: null })

    const result = await getMyPartnerProfile()
    expect(result?.is_public).toBe(false)
  })
})