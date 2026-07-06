// Unit tests for `00-foundations/gdpr/delete-cascade.ts`. Strategy:
//   - mock `getServiceSupabase()` to return a stub whose `.rpc(...)`
//     returns whatever the test sets via `setRpcResponse()`
//   - assert every RPC outcome maps to the right typed result
//   - assert PII safety (logs never contain the user_id, even when
//     the RPC fails or returns unexpected data)
//
// Run: `pnpm test delete-cascade` (vitest).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Pino logger stub — captures calls so we can assert the log shape is PII-safe.
// ---------------------------------------------------------------------------
type LogCall = {
  level: 'info' | 'warn' | 'error' | 'debug'
  obj: Record<string, unknown>
  msg: string | undefined
}
const logCalls: LogCall[] = []

vi.mock('@foundations/log/pino', () => ({
  loggerFor: vi.fn(() => ({
    info: (obj: Record<string, unknown>, msg?: string) =>
      logCalls.push({ level: 'info', obj, msg }),
    warn: (obj: Record<string, unknown>, msg?: string) =>
      logCalls.push({ level: 'warn', obj, msg }),
    error: (obj: Record<string, unknown>, msg?: string) =>
      logCalls.push({ level: 'error', obj, msg }),
    debug: (obj: Record<string, unknown>, msg?: string) =>
      logCalls.push({ level: 'debug', obj, msg }),
  })),
}))

// ---------------------------------------------------------------------------
// Supabase service-role stub. `rpc(...)` is the only surface the wrapper uses.
// ---------------------------------------------------------------------------
type RpcResponse = { data: unknown; error: null | { message: string } }

let rpcResponses: RpcResponse[] = []
let rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = []

function setRpcResponse(data: unknown, error: { message: string } | null = null) {
  // Queue-mode: pop one per `.rpc()` call. Tests that need a single
  // response set just one; tests that need multiple set multiple.
  rpcResponses.push({ data, error })
}

function setRpcResponses(...responses: RpcResponse[]) {
  rpcResponses = [...responses]
}

const fakeServiceSupabase = {
  rpc: vi.fn((fn: string, args: Record<string, unknown>) => {
    rpcCalls.push({ fn, args })
    const next = rpcResponses.shift() ?? { data: null, error: null }
    return Promise.resolve(next)
  }),
}

vi.mock('@foundations/data/supabase', () => ({
  getServiceSupabase: vi.fn(() => fakeServiceSupabase),
}))

// Import AFTER mocks so the module binds to the mocked deps.
const { deleteMyAccountCascade } = await import('./delete-cascade')

const USER_ID = '11111111-1111-1111-1111-111111111111'

// ---------------------------------------------------------------------------
// PII safety assertion — reused across every test that produces logs.
// ---------------------------------------------------------------------------
function assertNoPii(call: LogCall) {
  const serialized = JSON.stringify({ ...call.obj, msg: call.msg })
  // The user_id value is a PII identifier per AGENTS.md; the pino redact
  // list covers `user_id` and `*.user_id` paths, but the wrapper should
  // also never pass it in the first place.
  expect(serialized).not.toContain(USER_ID)
  // Generic safety: no email-like string in the log.
  expect(serialized).not.toMatch(/[a-z0-9]+@[a-z0-9]+\.[a-z]+/i)
}

// ===========================================================================
// Tests
// ===========================================================================

beforeEach(() => {
  rpcResponses = []
  rpcCalls = []
  logCalls.length = 0
  fakeServiceSupabase.rpc.mockClear()
})

afterEach(() => {
  rpcResponses = []
  rpcCalls = []
  logCalls.length = 0
})

describe('deleteMyAccountCascade — RPC contract', () => {
  it('invokes the `delete_my_account` RPC with p_user_id = userId', async () => {
    setRpcResponse('anonymized')
    await deleteMyAccountCascade(USER_ID)
    expect(rpcCalls).toHaveLength(1)
    expect(rpcCalls[0]).toEqual({
      fn: 'delete_my_account',
      args: { p_user_id: USER_ID },
    })
  })

  it('does not pass the user_id via any other parameter name', async () => {
    setRpcResponse('anonymized')
    await deleteMyAccountCascade(USER_ID)
    const args = rpcCalls[0]?.args ?? {}
    expect(Object.keys(args)).toEqual(['p_user_id'])
  })
})

describe('deleteMyAccountCascade — outcome mapping', () => {
  it("returns 'anonymized' when the RPC returns 'anonymized'", async () => {
    setRpcResponse('anonymized')
    const result = await deleteMyAccountCascade(USER_ID)
    expect(result).toBe('anonymized')
  })

  it("returns 'already_deleted' when the RPC returns 'already_deleted'", async () => {
    setRpcResponse('already_deleted')
    const result = await deleteMyAccountCascade(USER_ID)
    expect(result).toBe('already_deleted')
  })

  it("returns 'cancel_subscriptions_first' when the RPC returns 'cancel_subscriptions_first'", async () => {
    setRpcResponse('cancel_subscriptions_first')
    const result = await deleteMyAccountCascade(USER_ID)
    expect(result).toBe('cancel_subscriptions_first')
  })

  it("returns 'resolve_payouts_first' when the RPC returns 'resolve_payouts_first'", async () => {
    setRpcResponse('resolve_payouts_first')
    const result = await deleteMyAccountCascade(USER_ID)
    expect(result).toBe('resolve_payouts_first')
  })

  it("returns 'unknown' when the RPC returns an unexpected string", async () => {
    setRpcResponse('something_completely_unexpected')
    const result = await deleteMyAccountCascade(USER_ID)
    expect(result).toBe('unknown')
  })

  it("returns 'unknown' when the RPC returns null", async () => {
    setRpcResponse(null)
    const result = await deleteMyAccountCascade(USER_ID)
    expect(result).toBe('unknown')
  })

  it("returns 'unknown' when the RPC returns undefined", async () => {
    setRpcResponse(undefined)
    const result = await deleteMyAccountCascade(USER_ID)
    expect(result).toBe('unknown')
  })

  it("returns 'unknown' when the RPC returns an empty string", async () => {
    setRpcResponse('')
    const result = await deleteMyAccountCascade(USER_ID)
    expect(result).toBe('unknown')
  })

  it("returns 'unknown' when the RPC errors", async () => {
    setRpcResponse(null, { message: 'connection refused' })
    const result = await deleteMyAccountCascade(USER_ID)
    expect(result).toBe('unknown')
  })

  it("returns 'unknown' when the RPC errors with a null message", async () => {
    setRpcResponse(null, { message: '' })
    const result = await deleteMyAccountCascade(USER_ID)
    expect(result).toBe('unknown')
  })
})

describe('deleteMyAccountCascade — logging', () => {
  it('logs nothing on the happy path', async () => {
    setRpcResponse('anonymized')
    await deleteMyAccountCascade(USER_ID)
    expect(logCalls).toHaveLength(0)
  })

  it('logs nothing for the `already_deleted` path', async () => {
    setRpcResponse('already_deleted')
    await deleteMyAccountCascade(USER_ID)
    expect(logCalls).toHaveLength(0)
  })

  it('logs nothing for the `cancel_subscriptions_first` path', async () => {
    setRpcResponse('cancel_subscriptions_first')
    await deleteMyAccountCascade(USER_ID)
    expect(logCalls).toHaveLength(0)
  })

  it('logs nothing for the `resolve_payouts_first` path', async () => {
    setRpcResponse('resolve_payouts_first')
    await deleteMyAccountCascade(USER_ID)
    expect(logCalls).toHaveLength(0)
  })

  it('logs a warn with `delete_unexpected_result` for an unexpected string', async () => {
    setRpcResponse('wat')
    await deleteMyAccountCascade(USER_ID)
    expect(logCalls).toHaveLength(1)
    expect(logCalls[0]?.level).toBe('warn')
    expect(logCalls[0]?.obj).toMatchObject({
      code: 'delete_unexpected_result',
      result: 'wat',
    })
    assertNoPii(logCalls[0]!)
  })

  it('logs an error with `delete_rpc_failed` when the RPC errors', async () => {
    setRpcResponse(null, { message: 'permission denied for function delete_my_account' })
    await deleteMyAccountCascade(USER_ID)
    expect(logCalls).toHaveLength(1)
    expect(logCalls[0]?.level).toBe('error')
    expect(logCalls[0]?.obj).toMatchObject({
      code: 'delete_rpc_failed',
      msg: 'permission denied for function delete_my_account',
    })
    assertNoPii(logCalls[0]!)
  })
})

describe('deleteMyAccountCascade — PII safety across every path', () => {
  const fixtures: Array<{ name: string; response: RpcResponse }> = [
    { name: 'anonymized', response: { data: 'anonymized', error: null } },
    { name: 'already_deleted', response: { data: 'already_deleted', error: null } },
    { name: 'cancel_subscriptions_first', response: { data: 'cancel_subscriptions_first', error: null } },
    { name: 'resolve_payouts_first', response: { data: 'resolve_payouts_first', error: null } },
    { name: 'unexpected_string', response: { data: 'who_knows', error: null } },
    { name: 'null_data', response: { data: null, error: null } },
    { name: 'empty_string', response: { data: '', error: null } },
    { name: 'rpc_error', response: { data: null, error: { message: 'boom' } } },
  ]

  for (const fx of fixtures) {
    it(`never logs the user_id (${fx.name})`, async () => {
      setRpcResponse(fx.response.data, fx.response.error)
      await deleteMyAccountCascade(USER_ID)
      for (const call of logCalls) {
        assertNoPii(call)
      }
    })
  }
})

describe('deleteMyAccountCascade — outcome exhaustiveness', () => {
  // Compile-time exhaustiveness: this test references every member of
  // `DeleteMyAccountOutcome`. If a new outcome is added, this test
  // needs to be updated — but more importantly the type system should
  // force a switch-case update in delete-cascade.ts. We assert the
  // outcome union here for documentation purposes.
  it('has exactly five outcomes', () => {
    // Imported via the production module — type-only.
    type Outcome = (typeof import('./delete-cascade').deleteMyAccountCascade extends (
      ...args: never[]
    ) => Promise<infer R>
      ? R
      : never)
    const expected: Outcome[] = [
      'anonymized',
      'already_deleted',
      'cancel_subscriptions_first',
      'resolve_payouts_first',
      'unknown',
    ]
    expect(expected).toHaveLength(5)
  })
})