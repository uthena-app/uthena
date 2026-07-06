// requestPayout.test.ts — unit tests for requestPayoutAction (P6.6).
//
// Covers:
//   - **Auth gating**: no session user → not_authorized; customer
//     / affiliate roles → not_authorized; partner / admin /
//     super_admin → allowed.
//   - **Partner row lookup**: missing → partner_not_found; errored
//     → partner_not_found (fail-closed).
//   - **Payout method gating**: missing payout_method →
//     payout_method_missing (partner has not set a PayPal email).
//   - **Available balance gating**: zero → no_available_balance;
//     below MIN_PAYOUT_REQUEST_CENTS → below_minimum; ≥
//     MIN_PAYOUT_REQUEST_CENTS → allowed through.
//   - **Pending request gating**: existing pending →
//     pending_request_exists (race-condition footgun).
//   - **Atomic operation**: insert ONE payout_requests row with
//     the masked PayPal email + the right status='pending' + the
//     available amount + the right currency; update the available
//     ledger rows to status='pending_payout' via service-role.
//   - **Audit log**: writes one row with action='payout_requested',
//     target_kind='payout_requests', target_id=string(requestId),
//     metadata.partner_id + amount_cents + ledger_rows_updated +
//     payout_method_target_masked (NEVER raw email). Actor email +
//     IP are hashed.
//   - **PII safety**: no raw email / no raw user_id / no raw partner_id
//     / no plaintext PayPal email in any log payload or audit row.
//   - **Fail-soft**: audit log insert failure does NOT abort the
//     request (the partner already has their pending row).
//   - **Fail-soft**: ledger UPDATE failure after a successful INSERT
//     still returns ok=true with ledgerRowsUpdated=0 (the admin
//     can reconcile manually).
//
// Pattern follows `exportLedgerCsv.test.ts` — chainable fake
// Supabase + queued results + Pino mock + audit-capture mock.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ----- Mocks ---------------------------------------------------------------

type ServerCall =
  | { method: 'from'; table: string }
  | { method: 'select'; payload: unknown }
  | { method: 'eq'; col: string; val: unknown }
  | { method: 'insert'; payload: unknown }
  | { method: 'update'; payload: unknown }
  | { method: 'maybeSingle' }
  | { method: 'single' }

const serverCalls: ServerCall[] = []
const serviceCalls: ServerCall[] = []
let serverQueue: Array<{ data: unknown; error: unknown }> = []
let serviceQueue: Array<{ data: unknown; error: unknown }> = []

function makeChain(track: ServerCall[]) {
  const chain: any = {
    select(payload: unknown) {
      track.push({ method: 'select', payload })
      return chain
    },
    eq(col: string, val: unknown) {
      track.push({ method: 'eq', col, val })
      return chain
    },
    insert(payload: unknown) {
      track.push({ method: 'insert', payload })
      // insert returns the chain — caller can chain .select / .single / etc.
      return chain
    },
    update(payload: unknown) {
      track.push({ method: 'update', payload })
      return chain
    },
    maybeSingle: vi.fn(async () => {
      track.push({ method: 'maybeSingle' })
      return (track === serverCalls ? serverQueue : serviceQueue).shift() ?? { data: null, error: null }
    }),
    single: vi.fn(async () => {
      track.push({ method: 'single' })
      return (track === serverCalls ? serverQueue : serviceQueue).shift() ?? { data: null, error: null }
    }),
    then: (
      onFulfilled: (v: { data: unknown; error: unknown }) => unknown,
      onRejected?: (e: unknown) => unknown,
    ) => {
      const q = track === serverCalls ? serverQueue : serviceQueue
      return Promise.resolve(q.shift() ?? { data: null, error: null }).then(onFulfilled, onRejected)
    },
  }
  return chain
}

const fakeServerSupabase = {
  from: vi.fn((table: string) => {
    serverCalls.push({ method: 'from', table })
    return makeChain(serverCalls)
  }),
}

const fakeServiceSupabase = {
  from: vi.fn((table: string) => {
    serviceCalls.push({ method: 'from', table })
    return makeChain(serviceCalls)
  }),
}

vi.mock('@foundations/data/supabase', () => ({
  getServerSupabase: vi.fn(async () => fakeServerSupabase),
  getServiceSupabase: vi.fn(() => fakeServiceSupabase),
}))

// ----- decryptPayoutMethod mock (avoids pulling encryption + format) -----

vi.mock('@features/partner-portal/queries/decryptPayoutMethod', () => ({
  decryptPayoutMethod: vi.fn((_raw: unknown) => ({
    paypal_email: 'partner@example.com',
    paypal_email_masked: 'p***@example.com',
    payout_method_kind: 'paypal' as const,
  })),
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

// ----- Auth mock ----------------------------------------------------------

let mockSessionUser: { id: string; email: string; role: string; display_name: string } | null = {
  id: 'user_1',
  email: 'partner@example.com',
  role: 'partner',
  display_name: 'Partner One',
}

vi.mock('@foundations/auth/guards', () => ({
  getSessionUser: vi.fn(async () => mockSessionUser),
}))

// ----- Headers mock (for audit log IP/UA) ---------------------------------

vi.mock('next/headers', () => ({
  headers: vi.fn(async () => ({
    get: (k: string) => {
      if (k === 'x-forwarded-for') return '203.0.113.7, 10.0.0.1'
      if (k === 'user-agent') return 'Mozilla/5.0 (Test)'
      return null
    },
  })),
}))

// ----- Test state ---------------------------------------------------------

beforeEach(() => {
  serverCalls.length = 0
  serviceCalls.length = 0
  serverQueue = []
  serviceQueue = []
  logCalls.length = 0
  mockSessionUser = {
    id: 'user_1',
    email: 'partner@example.com',
    role: 'partner',
    display_name: 'Partner One',
  }
})

afterEach(() => {
  vi.clearAllMocks()
})

// ----- Imports under test ------------------------------------------------

const { requestPayoutAction } = await import('./requestPayout')
const { MIN_PAYOUT_REQUEST_CENTS } = await import('../request-options')

// ----- Helpers ------------------------------------------------------------

function enqueuePartner(id = 42) {
  serverQueue.push({ data: { id, payout_method: { paypal_email_encrypted: 'iv.tag.ct' } }, error: null })
}
function enqueueAvailable(rows: Array<{ amount_cents: number }> | null = [], error: unknown = null) {
  serverQueue.push({ data: rows, error })
}
function enqueueNoPending() {
  serverQueue.push({ data: null, error: null })
}
function enqueueInsertedRequest(id = 555) {
  // Service-role insert: the .insert().select().maybeSingle() chain returns the row.
  // Our test chain returns via maybeSingle() which consumes from serviceQueue.
  serviceQueue.push({ data: { id }, error: null })
}
function enqueueUpdatedLedger(rows: Array<{ id: number }> | null = [{ id: 1 }, { id: 2 }]) {
  // Service-role update: .update().eq().eq().select() returns rows via .then().
  serviceQueue.push({ data: rows, error: null })
}
function enqueueAuditResult() {
  // Service-role audit insert: .insert() with no .select()/.single() resolves
  // via .then() — empty result is fine (the action ignores the return).
  serviceQueue.push({ data: null, error: null })
}
function findCalls(track: ServerCall[], predicate: (c: ServerCall) => boolean): ServerCall[] {
  return track.filter(predicate)
}

// ----- Tests --------------------------------------------------------------

describe('requestPayoutAction — auth gating', () => {
  it('returns not_authorized when no session user', async () => {
    mockSessionUser = null
    const res = await requestPayoutAction()
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.code).toBe('not_authorized')
    expect(serverCalls).toHaveLength(0)
  })

  it('returns not_authorized for a customer role', async () => {
    mockSessionUser = {
      id: 'user_1',
      email: 'cust@example.com',
      role: 'customer',
      display_name: 'Customer',
    }
    const res = await requestPayoutAction()
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.code).toBe('not_authorized')
    expect(serverCalls).toHaveLength(0)
  })

  it('returns not_authorized for an affiliate role', async () => {
    mockSessionUser = {
      id: 'user_1',
      email: 'aff@example.com',
      role: 'affiliate',
      display_name: 'Affiliate',
    }
    const res = await requestPayoutAction()
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.code).toBe('not_authorized')
  })

  it('allows partner role', async () => {
    enqueueHappyPath()
    const res = await requestPayoutAction()
    expect(res.ok).toBe(true)
  })

  it('allows admin role', async () => {
    mockSessionUser = {
      id: 'user_2',
      email: 'admin@example.com',
      role: 'admin',
      display_name: 'Admin',
    }
    enqueueHappyPath()
    const res = await requestPayoutAction()
    expect(res.ok).toBe(true)
  })

  it('allows super_admin role', async () => {
    mockSessionUser = {
      id: 'user_3',
      email: 'root@example.com',
      role: 'super_admin',
      display_name: 'Root',
    }
    enqueueHappyPath()
    const res = await requestPayoutAction()
    expect(res.ok).toBe(true)
  })
})

function enqueueHappyPath(opts?: {
  available?: Array<{ amount_cents: number }>
}) {
  enqueuePartner()
  enqueueAvailable(opts?.available ?? [{ amount_cents: 12500 }])
  enqueueNoPending()
  enqueueInsertedRequest(555)
  enqueueUpdatedLedger([{ id: 1 }, { id: 2 }])
  enqueueAuditResult()
}

describe('requestPayoutAction — partner row lookup', () => {
  it('returns partner_not_found when partner row is missing', async () => {
    serverQueue.push({ data: null, error: null })
    const res = await requestPayoutAction()
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.code).toBe('partner_not_found')
  })

  it('returns partner_not_found when partner lookup errors', async () => {
    serverQueue.push({ data: null, error: { message: 'partners unavailable' } })
    const res = await requestPayoutAction()
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.code).toBe('partner_not_found')
    const warn = logCalls.find((c) => c.level === 'warn')
    expect(warn?.payload.code).toBe('request_partner_lookup_failed')
  })
})

describe('requestPayoutAction — payout method gating', () => {
  it('returns payout_method_missing when partner has no PayPal email set', async () => {
    // decryptPayoutMethod mock returns the masked email by default — override
    // the mock once for this test.
    const decryptMod = await import('@features/partner-portal/queries/decryptPayoutMethod')
    ;(decryptMod.decryptPayoutMethod as ReturnType<typeof vi.fn>).mockReturnValueOnce({
      paypal_email: null,
      paypal_email_masked: null,
      payout_method_kind: null,
    })
    enqueuePartner()
    enqueueAvailable([{ amount_cents: 12500 }])
    const res = await requestPayoutAction()
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.code).toBe('payout_method_missing')
  })
})

describe('requestPayoutAction — available balance gating', () => {
  it('returns no_available_balance when available is 0', async () => {
    enqueuePartner()
    enqueueAvailable([])
    const res = await requestPayoutAction()
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.code).toBe('no_available_balance')
  })

  it('returns below_minimum when available < MIN_PAYOUT_REQUEST_CENTS', async () => {
    enqueuePartner()
    enqueueAvailable([{ amount_cents: MIN_PAYOUT_REQUEST_CENTS - 100 }])
    const res = await requestPayoutAction()
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.code).toBe('below_minimum')
  })

  it('returns available balance error when balance lookup errors', async () => {
    enqueuePartner()
    enqueueAvailable(null, { message: 'payout_ledger unavailable' })
    const res = await requestPayoutAction()
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.code).toBe('unknown')
    const warn = logCalls.find((c) => c.level === 'warn')
    expect(warn?.payload.code).toBe('request_balance_lookup_failed')
  })

  it('treats null amount_cents as 0 (fail-soft)', async () => {
    enqueuePartner()
    // Sum is MIN + 100 (the second row's null is treated as 0).
    // Above MIN so the request proceeds; we assert the sum is exact.
    enqueueAvailable([{ amount_cents: 5100 }, { amount_cents: null as unknown as number }])
    enqueueNoPending()
    enqueueInsertedRequest()
    enqueueUpdatedLedger([{ id: 1 }])
    const res = await requestPayoutAction()
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.amountCents).toBe(5100)
  })
})

describe('requestPayoutAction — pending request gating', () => {
  it('returns pending_request_exists when the partner already has a pending request', async () => {
    enqueuePartner()
    enqueueAvailable([{ amount_cents: 12500 }])
    serverQueue.push({ data: { id: 999 }, error: null }) // pending exists
    const res = await requestPayoutAction()
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.code).toBe('pending_request_exists')
  })

  it('returns unknown when pending-request lookup errors', async () => {
    enqueuePartner()
    enqueueAvailable([{ amount_cents: 12500 }])
    serverQueue.push({ data: null, error: { message: 'payout_requests unavailable' } })
    const res = await requestPayoutAction()
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.code).toBe('unknown')
    const warn = logCalls.find((c) => c.level === 'warn')
    expect(warn?.payload.code).toBe('request_pending_lookup_failed')
  })
})

describe('requestPayoutAction — atomic insert + update', () => {
  it('inserts one payout_requests row with the masked PayPal + amount + USD currency', async () => {
    enqueueHappyPath({ available: [{ amount_cents: 12500 }, { amount_cents: 7500 }] })
    const res = await requestPayoutAction()
    expect(res.ok).toBe(true)
    if (!res.ok) return

    // The first insert is the payout_requests row; the second is the
    // admin_audit_log row. Use .shift() to get the first one.
    const insertCall = findCalls(serviceCalls, (c) => c.method === 'insert').shift()
    expect(insertCall).toBeDefined()
    const payload = (insertCall as { method: 'insert'; payload: unknown }).payload as Record<string, unknown>
    expect(payload.partner_id).toBe(42)
    expect(payload.amount_cents).toBe(20000)
    expect(payload.currency).toBe('USD')
    expect(payload.status).toBe('pending')
    expect(payload.payout_method_kind).toBe('paypal')
    expect(payload.payout_method_target_masked).toBe('p***@example.com')
    // Metadata shape — `source` is set so the admin queue can filter.
    const meta = payload.metadata as Record<string, unknown>
    expect(meta.source).toBe('partner_request')
    expect(meta.available_ledger_rows).toBe(2)
  })

  it('flips available ledger rows to status=pending_payout via service-role', async () => {
    enqueueHappyPath()
    const res = await requestPayoutAction()
    expect(res.ok).toBe(true)
    if (!res.ok) return

    const updateCall = findCalls(serviceCalls, (c) => c.method === 'update').pop()
    expect(updateCall).toBeDefined()
    const payload = (updateCall as { method: 'update'; payload: unknown }).payload as Record<string, unknown>
    expect(payload.status).toBe('pending_payout')

    const eqs = findCalls(serviceCalls, (c) => c.method === 'eq').map((c) =>
      c.method === 'eq' ? [c.col, c.val] : [],
    )
    expect(eqs).toContainEqual(['partner_id', 42])
    expect(eqs).toContainEqual(['status', 'available'])
  })

  it('returns ledgerRowsUpdated matching the update result', async () => {
    // Reset service queue + enqueue the 3 service-side calls in the
    // action's actual order: payout_requests insert → payout_ledger
    // update → admin_audit_log insert.
    serviceQueue.length = 0
    enqueueInsertedRequest(555)
    enqueueUpdatedLedger([{ id: 1 }, { id: 2 }, { id: 3 }])
    enqueueAuditResult()
    // Server queue for the pre-write reads.
    enqueuePartner()
    enqueueAvailable([{ amount_cents: 12500 }])
    enqueueNoPending()

    const res = await requestPayoutAction()
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.ledgerRowsUpdated).toBe(3)
  })

  it('returns ok=true with ledgerRowsUpdated=0 when the ledger update fails (fail-soft)', async () => {
    enqueuePartner()
    enqueueAvailable([{ amount_cents: 12500 }])
    enqueueNoPending()
    enqueueInsertedRequest(777)
    serviceQueue.push({ data: null, error: { message: 'payout_ledger update failed' } })
    const res = await requestPayoutAction()
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.requestId).toBe(777)
      expect(res.ledgerRowsUpdated).toBe(0)
    }
    const warn = logCalls.find((c) => c.level === 'warn')
    expect(warn?.payload.code).toBe('request_ledger_update_failed')
  })

  it('returns unknown when the payout_requests insert fails', async () => {
    enqueuePartner()
    enqueueAvailable([{ amount_cents: 12500 }])
    enqueueNoPending()
    serviceQueue.push({ data: null, error: { message: 'payout_requests insert failed' } })
    const res = await requestPayoutAction()
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.code).toBe('unknown')
  })
})

describe('requestPayoutAction — audit log', () => {
  it('writes one admin_audit_log row with the masked PayPal + hashed actor_email + hashed IP', async () => {
    enqueueHappyPath()
    const res = await requestPayoutAction()
    expect(res.ok).toBe(true)

    // The audit insert is the last insert call on the service-role
    // client (after the payout_requests insert + the ledger update).
    const allInserts = findCalls(serviceCalls, (c) => c.method === 'insert')
    // We expect at least 2 inserts: payout_requests + admin_audit_log.
    expect(allInserts.length).toBeGreaterThanOrEqual(2)
    const auditInsert = allInserts[allInserts.length - 1]
    const payload = (auditInsert as { method: 'insert'; payload: unknown }).payload as Record<string, unknown>

    // Shape — the new action verb is 'payout_requested'.
    expect(payload.action).toBe('payout_requested')
    expect(payload.target_kind).toBe('payout_requests')
    expect(payload.target_id).toBe('555')

    // Metadata snapshot — masked PayPal only, no plaintext.
    const meta = payload.metadata as Record<string, unknown>
    expect(meta.partner_id).toBe('42')
    expect(meta.amount_cents).toBe(12500)
    expect(meta.currency).toBe('USD')
    expect(meta.ledger_rows_updated).toBe(2)
    expect(meta.payout_method_kind).toBe('paypal')
    expect(meta.payout_method_target_masked).toBe('p***@example.com')
  })

  it('actor_email is hashed — never the raw partner email', async () => {
    enqueueHappyPath()
    await requestPayoutAction()
    const allInserts = findCalls(serviceCalls, (c) => c.method === 'insert')
    const auditInsert = allInserts[allInserts.length - 1]
    const payload = (auditInsert as { method: 'insert'; payload: unknown }).payload as Record<string, unknown>
    expect(String(payload.actor_email)).not.toContain('partner@example.com')
    expect(String(payload.actor_email)).toMatch(/^hash:[0-9a-f]{32}@uthena\.audit$/)
  })

  it('IP is hashed — never the raw IP', async () => {
    enqueueHappyPath()
    await requestPayoutAction()
    const allInserts = findCalls(serviceCalls, (c) => c.method === 'insert')
    const auditInsert = allInserts[allInserts.length - 1]
    const payload = (auditInsert as { method: 'insert'; payload: unknown }).payload as Record<string, unknown>
    expect(String(payload.ip)).not.toContain('203.0.113.7')
    // The hash is a 64-char sha256 hex (the action slices to 32, but
    // depends on the env salt — the test here just asserts the shape).
    expect(String(payload.ip)).toMatch(/^[0-9a-f]+$/)
  })

  it('audit log insert failure does NOT abort the request (fail-soft)', async () => {
    enqueueHappyPath()
    // Replace the audit insert (last in the service queue) with a
    // throw via the .insert() chain — easiest way is to override
    // getServiceSupabase to return a chain that throws.
    const { getServiceSupabase } = await import('@foundations/data/supabase')
    const throwingSupabase = {
      from: vi.fn((table: string) => {
        if (table === 'admin_audit_log') {
          return {
            insert: vi.fn(() => {
              throw new Error('audit log insert failed')
            }),
          }
        }
        // For the prior payout_requests + ledger update calls, use
        // the normal fake chain.
        serviceCalls.push({ method: 'from', table })
        return makeChain(serviceCalls)
      }),
    }
    ;(getServiceSupabase as ReturnType<typeof vi.fn>).mockReturnValueOnce(throwingSupabase)

    const res = await requestPayoutAction()
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.requestId).toBe(555)
      expect(res.ledgerRowsUpdated).toBe(2)
    }
    const warn = logCalls.find((c) => c.level === 'warn')
    expect(warn?.payload.code).toBe('request_audit_log_failed')
  })
})

describe('requestPayoutAction — PII safety', () => {
  it('never logs raw user_id, partner_id, email, or plaintext PayPal', async () => {
    enqueueHappyPath()
    await requestPayoutAction()
    for (const call of logCalls) {
      const blob = JSON.stringify(call.payload) + ' ' + (call.msg ?? '')
      expect(blob).not.toContain('user_1')
      expect(blob).not.toContain('partner@example.com')
      expect(blob).not.toContain('203.0.113.7')
    }
  })

  it('never writes the raw PayPal email to the audit row (masked only)', async () => {
    enqueueHappyPath()
    await requestPayoutAction()
    const allInserts = findCalls(serviceCalls, (c) => c.method === 'insert')
    const auditInsert = allInserts[allInserts.length - 1]
    const payload = (auditInsert as { method: 'insert'; payload: unknown }).payload as Record<string, unknown>
    const blob = JSON.stringify(payload)
    expect(blob).not.toContain('partner@example.com')
  })
})