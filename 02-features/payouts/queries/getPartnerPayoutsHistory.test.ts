// getPartnerPayoutsHistory.test.ts — unit tests for
// `getPartnerPayoutsHistory` (P12.14).
//
// Pattern follows getMyCourseSalesSummary.test.ts (P12.11): chainable
// fake Supabase + queued results + Pino mock with log-call capture.
//
// Coverage:
//   - **Auth gating**: no session user → [] + no DB calls past
//     getSessionUser.
//   - **Partner row missing**: returns [] (no RPC call) — partner
//     race during onboarding.
//   - **Partner row errored**: returns [] + warn log + no RPC call.
//   - **Partner row has invalid id**: returns [] + warn log + no
//     RPC call (defense-in-depth).
//   - **Happy path**: maps every RPC row into a typed PayoutBatch,
//     newest-first (RPC sorts by MAX(paid_at) DESC).
//   - **Bigint string coercion**: PostgREST returns numeric bigint
//     fields as JSON strings; coerce back to JS numbers.
//   - **Empty result**: returns [] (no rows yet) — no warn log.
//   - **Malformed row**: missing fields fall back to '' / 0 / epoch —
//     never crash the page.
//   - **Limit capping**: limit > 200 capped at 200; limit <= 0 falls
//     back to default; non-integer limit falls back to default.
//   - **Default limit**: omit → 50.
//   - **RPC fails**: returns [] + one warn log (fail-soft + PII-safe).
//   - **RPC returns non-array**: returns [] (defensive parse).
//   - **PII safety**: serialized logs never contain the raw
//     partner_id (42); only the hashed form appears.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ----- Mocks ---------------------------------------------------------------

type ServerCall =
  | { method: 'from'; table: string }
  | { method: 'select'; payload: unknown }
  | { method: 'eq'; col: string; val: unknown }
  | { method: 'maybeSingle' }
  | { method: 'rpc'; fn: string; args: unknown }

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
}

vi.mock('@foundations/data/supabase', () => ({
  getServerSupabase: vi.fn(async () => fakeServerSupabase),
}))

// getSessionUser → return the mock session user. Tests override by
// stubbing the imported module if needed (this slice only tests the
// authed path; the auth-fail path uses a different pattern below).
let mockSessionUser: { id: string; email: string | null; role: string } | null = {
  id: 'user-1',
  email: 'partner@example.com',
  role: 'partner',
}
vi.mock('@foundations/auth/guards', () => ({
  getSessionUser: vi.fn(async () => mockSessionUser),
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

const PARTNER_ID = 42
const PARTNER_ROW = { id: PARTNER_ID, user_id: 'user-1' }

beforeEach(() => {
  serverCalls.length = 0
  serverQueue = []
  logCalls.length = 0
  mockSessionUser = { id: 'user-1', email: 'partner@example.com', role: 'partner' }
  fakeServerSupabase.from.mockClear()
  fakeServerSupabase.rpc.mockClear()
})

afterEach(() => {
  vi.clearAllMocks()
})

// ----- Import (after mocks) -----------------------------------------------

const {
  getPartnerPayoutsHistory,
  DEFAULT_PAYOUT_HISTORY_LIMIT,
  MAX_PAYOUT_HISTORY_LIMIT,
} = await import('./getPartnerPayoutsHistory')

// ===================================================================
// Auth gating
// ===================================================================

describe('getPartnerPayoutsHistory — auth gating', () => {
  it('returns [] without DB calls when no user is signed in', async () => {
    mockSessionUser = null

    const result = await getPartnerPayoutsHistory()
    expect(result).toEqual([])
    expect(fakeServerSupabase.from).not.toHaveBeenCalled()
    expect(fakeServerSupabase.rpc).not.toHaveBeenCalled()
  })

  it('returns [] without RPC call when the partner row is missing', async () => {
    serverQueue.push({ data: null, error: null }) // partners → null

    const result = await getPartnerPayoutsHistory()
    expect(result).toEqual([])
    expect(fakeServerSupabase.rpc).not.toHaveBeenCalled()
  })

  it('returns [] + warn log when the partner lookup errors', async () => {
    serverQueue.push({ data: null, error: { code: 'PGRST301', message: 'timeout' } })

    const result = await getPartnerPayoutsHistory()
    expect(result).toEqual([])
    expect(fakeServerSupabase.rpc).not.toHaveBeenCalled()
    expect(logCalls).toHaveLength(1)
    const log = logCalls[0]
    expect(log).toBeDefined()
    if (!log) return
    expect(log.level).toBe('warn')
    expect(log.payload.code).toBe('PGRST301')
  })

  it('returns [] + warn log when the partner row has an invalid id', async () => {
    serverQueue.push({ data: { id: 'not-a-number', user_id: 'user-1' }, error: null })

    const result = await getPartnerPayoutsHistory()
    expect(result).toEqual([])
    expect(fakeServerSupabase.rpc).not.toHaveBeenCalled()
    expect(logCalls).toHaveLength(1)
    const log = logCalls[0]
    expect(log).toBeDefined()
    if (!log) return
    expect(log.level).toBe('warn')
    expect(log.payload.code).toBe('partner_id_invalid')
  })
})

// ===================================================================
// Happy path
// ===================================================================

describe('getPartnerPayoutsHistory — happy path', () => {
  it('maps one RPC row into a typed PayoutBatch', async () => {
    serverQueue.push({ data: PARTNER_ROW, error: null })
    serverQueue.push({
      data: [
        {
          paypal_payout_batch_id: 'BATCH_ABC123',
          period_start: '2026-06-01T10:00:00+00:00',
          period_end: '2026-06-30T18:00:00+00:00',
          amount_cents: '-127500',
          currency: 'USD',
          commission_count: 5,
          created_at: '2026-06-01T10:00:00+00:00',
        },
      ],
      error: null,
    })

    const result = await getPartnerPayoutsHistory()
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({
      paypalPayoutBatchId: 'BATCH_ABC123',
      periodStart: '2026-06-01T10:00:00.000Z',
      periodEnd: '2026-06-30T18:00:00.000Z',
      amountCents: -127500,
      currency: 'USD',
      commissionCount: 5,
      createdAt: '2026-06-01T10:00:00.000Z',
    })
  })

  it('preserves the RPC sort order (newest first)', async () => {
    serverQueue.push({ data: PARTNER_ROW, error: null })
    serverQueue.push({
      data: [
        {
          paypal_payout_batch_id: 'BATCH_NEW',
          period_start: '2026-05-01T10:00:00+00:00',
          period_end: '2026-05-31T18:00:00+00:00',
          amount_cents: '-50000',
          currency: 'USD',
          commission_count: 2,
          created_at: '2026-05-01T10:00:00+00:00',
        },
        {
          paypal_payout_batch_id: 'BATCH_OLD',
          period_start: '2026-04-01T10:00:00+00:00',
          period_end: '2026-04-30T18:00:00+00:00',
          amount_cents: '-30000',
          currency: 'USD',
          commission_count: 1,
          created_at: '2026-04-01T10:00:00+00:00',
        },
      ],
      error: null,
    })

    const result = await getPartnerPayoutsHistory()
    expect(result.map((b) => b.paypalPayoutBatchId)).toEqual(['BATCH_NEW', 'BATCH_OLD'])
  })

  it('returns [] when the RPC returns zero rows', async () => {
    serverQueue.push({ data: PARTNER_ROW, error: null })
    serverQueue.push({ data: [], error: null })

    const result = await getPartnerPayoutsHistory()
    expect(result).toEqual([])
    // Empty result is the happy path — no warn log.
    expect(logCalls).toHaveLength(0)
  })

  it('returns [] when the RPC returns a non-array', async () => {
    serverQueue.push({ data: PARTNER_ROW, error: null })
    serverQueue.push({ data: null, error: null })

    const result = await getPartnerPayoutsHistory()
    expect(result).toEqual([])
    // Non-array is a defensive fall-through — no warn log either.
    expect(logCalls).toHaveLength(0)
  })
})

// ===================================================================
// Bigint + timestamp coercion
// ===================================================================

describe('getPartnerPayoutsHistory — coercion', () => {
  it('coerces numeric bigints returned as JSON strings', async () => {
    serverQueue.push({ data: PARTNER_ROW, error: null })
    serverQueue.push({
      data: [
        {
          paypal_payout_batch_id: 'B',
          period_start: '2026-06-01T00:00:00Z',
          period_end: '2026-06-30T00:00:00Z',
          amount_cents: '-100',
          currency: 'USD',
          commission_count: '3',
          created_at: '2026-06-01T00:00:00Z',
        },
      ],
      error: null,
    })

    const result = await getPartnerPayoutsHistory()
    expect(result).toHaveLength(1)
    const batch = result[0]
    expect(batch).toBeDefined()
    if (!batch) return
    expect(batch.amountCents).toBe(-100)
    expect(batch.commissionCount).toBe(3)
  })

  it('falls back to 0 / epoch for null or malformed fields', async () => {
    serverQueue.push({ data: PARTNER_ROW, error: null })
    serverQueue.push({
      data: [
        {
          paypal_payout_batch_id: null,
          period_start: null,
          period_end: 'not-a-date',
          amount_cents: null,
          currency: null,
          commission_count: null,
          created_at: null,
        },
      ],
      error: null,
    })

    const result = await getPartnerPayoutsHistory()
    expect(result).toHaveLength(1)
    const batch = result[0]
    expect(batch).toBeDefined()
    if (!batch) return
    expect(batch.paypalPayoutBatchId).toBe('')
    expect(batch.periodStart).toBe(new Date(0).toISOString())
    expect(batch.periodEnd).toBe(new Date(0).toISOString())
    expect(batch.amountCents).toBe(0)
    expect(batch.currency).toBe('USD')
    expect(batch.commissionCount).toBe(0)
    expect(batch.createdAt).toBe(new Date(0).toISOString())
  })
})

// ===================================================================
// Limit capping
// ===================================================================

describe('getPartnerPayoutsHistory — limit capping', () => {
  function queueRpcCapture() {
    serverQueue.push({ data: PARTNER_ROW, error: null })
    serverQueue.push({ data: [], error: null })
  }

  it('uses the default limit when none is provided', async () => {
    queueRpcCapture()
    await getPartnerPayoutsHistory()
    expect(fakeServerSupabase.rpc).toHaveBeenCalledWith(
      'get_partner_payouts_history',
      expect.objectContaining({ p_limit: DEFAULT_PAYOUT_HISTORY_LIMIT }),
    )
  })

  it('caps a too-large limit at MAX_PAYOUT_HISTORY_LIMIT', async () => {
    queueRpcCapture()
    await getPartnerPayoutsHistory(MAX_PAYOUT_HISTORY_LIMIT + 5000)
    expect(fakeServerSupabase.rpc).toHaveBeenCalledWith(
      'get_partner_payouts_history',
      expect.objectContaining({ p_limit: MAX_PAYOUT_HISTORY_LIMIT }),
    )
  })

  it('falls back to the default for non-positive limits', async () => {
    queueRpcCapture()
    await getPartnerPayoutsHistory(0)
    expect(fakeServerSupabase.rpc).toHaveBeenCalledWith(
      'get_partner_payouts_history',
      expect.objectContaining({ p_limit: DEFAULT_PAYOUT_HISTORY_LIMIT }),
    )
  })

  it('falls back to the default for non-integer limits', async () => {
    queueRpcCapture()
    await getPartnerPayoutsHistory(12.7)
    expect(fakeServerSupabase.rpc).toHaveBeenCalledWith(
      'get_partner_payouts_history',
      expect.objectContaining({ p_limit: DEFAULT_PAYOUT_HISTORY_LIMIT }),
    )
  })

  it('forwards a custom limit when within bounds', async () => {
    queueRpcCapture()
    await getPartnerPayoutsHistory(20)
    expect(fakeServerSupabase.rpc).toHaveBeenCalledWith(
      'get_partner_payouts_history',
      expect.objectContaining({ p_limit: 20 }),
    )
  })

  it('forwards the partner_id as p_partner_id', async () => {
    queueRpcCapture()
    await getPartnerPayoutsHistory()
    expect(fakeServerSupabase.rpc).toHaveBeenCalledWith(
      'get_partner_payouts_history',
      expect.objectContaining({ p_partner_id: PARTNER_ID }),
    )
  })
})

// ===================================================================
// Fail-soft
// ===================================================================

describe('getPartnerPayoutsHistory — fail-soft on RPC error', () => {
  it('returns [] + one warn log when the RPC errors', async () => {
    serverQueue.push({ data: PARTNER_ROW, error: null })
    serverQueue.push({ data: null, error: { code: 'PGRST500', message: 'rpc failed' } })

    const result = await getPartnerPayoutsHistory()
    expect(result).toEqual([])
    expect(logCalls).toHaveLength(1)
    const log = logCalls[0]
    expect(log).toBeDefined()
    if (!log) return
    expect(log.level).toBe('warn')
    expect(log.payload.code).toBe('PGRST500')
    // PII-safety — partner_id (42) must NEVER appear in the log.
    expect(JSON.stringify(log.payload)).not.toContain('"42"')
    // The hashed form should be present (8 hex chars, padded).
    expect(typeof log.payload.partner_id_hash).toBe('string')
    expect((log.payload.partner_id_hash as string).length).toBe(8)
  })
})

// ===================================================================
// Query shape
// ===================================================================

describe('getPartnerPayoutsHistory — query shape', () => {
  it('reads from `partners` keyed off user_id', async () => {
    serverQueue.push({ data: PARTNER_ROW, error: null })
    serverQueue.push({ data: [], error: null })

    await getPartnerPayoutsHistory()

    const fromCalls = serverCalls.filter((c) => c.method === 'from')
    expect(fromCalls).toHaveLength(1)
    expect((fromCalls[0] as { method: 'from'; table: string }).table).toBe('partners')

    const eqCalls = serverCalls.filter((c) => c.method === 'eq')
    expect(eqCalls).toHaveLength(1)
    expect((eqCalls[0] as { method: 'eq'; col: string; val: unknown }).col).toBe('user_id')
    expect((eqCalls[0] as { method: 'eq'; col: string; val: unknown }).val).toBe('user-1')
  })

  it('invokes the RPC named `get_partner_payouts_history`', async () => {
    serverQueue.push({ data: PARTNER_ROW, error: null })
    serverQueue.push({ data: [], error: null })

    await getPartnerPayoutsHistory()
    const rpcCalls = serverCalls.filter((c) => c.method === 'rpc')
    expect(rpcCalls).toHaveLength(1)
    expect((rpcCalls[0] as { method: 'rpc'; fn: string; args: unknown }).fn).toBe(
      'get_partner_payouts_history',
    )
  })
})
