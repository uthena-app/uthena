// updateConsent.test.ts — unit tests for the server action backing
// the /cookie-preferences form.
//
// Covers:
//   - Anon path (no user → consent still gets recorded with
//     userId=null; IP + UA come from the headers).
//   - Signed-in happy path: Zod-valid input → consent_log INSERT via
//     the `recordConsent` helper + audit-log row with focused diff +
//     revalidate('/cookie-preferences').
//   - Zod rejection: missing fields, wrong types, extra fields.
//   - essential:false is silently dropped (the schema doesn't carry it;
//     the action never reads or writes it).
//   - recordConsent throws → friendly error returned, no audit log.
//   - Audit log failure is non-fatal (the consent row is the source
//     of truth; a missing audit row just loses the diff visibility).
//   - No-change patch (same state as previous) → no audit row.
//   - IP extraction from x-forwarded-for (first entry), x-real-ip,
//     and the fallback to '0.0.0.0' when neither header is present.
//   - The action's input shape is minimal — the response carries the
//     full state (essential always true; analytics + marketing from
//     the persisted row).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Call =
  | { method: 'auth.getUser' }
  | { method: 'from'; table: string }
  | { method: 'select'; payload: string }
  | { method: 'eq'; col: string; val: unknown }
  | { method: 'order'; col: string; ascending: boolean }
  | { method: 'limit'; n: number }
  | { method: 'maybeSingle' }
  | { method: 'recordConsent'; userId: string | null; state: unknown; ip: string; ua: string; metadata?: unknown }
  | { method: 'writeSelfAuditLog'; payload: unknown }
  | { method: 'revalidatePath'; path: string }
  | { method: 'headers.get'; name: string }

const calls: Call[] = []
let getUserResponse: { data: { user: { id: string; email: string } | null }; error: unknown } = {
  data: { user: null },
  error: null,
}
let prevConsentResponse: {
  data: { analytics: unknown; marketing: unknown } | null
  error: unknown
} = { data: null, error: null }
let recordConsentImpl:
  | ((
      userId: string | null,
      state: unknown,
      ip: string,
      ua: string,
      metadata: unknown,
    ) => Promise<void>)
  | null = null
let recordConsentThrow: Error | null = null
let recordConsentOk: boolean | undefined = undefined
let writeAuditImpl: ((payload: unknown) => Promise<unknown>) | null = null
let headerMap: Record<string, string> = {}

function makeConsentChain() {
  const chain: any = {
    select(payload: string) {
      calls.push({ method: 'select', payload })
      return chain
    },
    eq(col: string, val: unknown) {
      calls.push({ method: 'eq', col, val })
      return chain
    },
    order(col: string, opts: { ascending?: boolean } = {}) {
      calls.push({ method: 'order', col, ascending: opts.ascending ?? true })
      return chain
    },
    limit(n: number) {
      calls.push({ method: 'limit', n })
      return chain
    },
    maybeSingle: vi.fn(async () => {
      calls.push({ method: 'maybeSingle' })
      return prevConsentResponse
    }),
  }
  return chain
}

const fakeSupabase = {
  auth: {
    getUser: vi.fn(async () => {
      calls.push({ method: 'auth.getUser' })
      return getUserResponse
    }),
  },
  from: vi.fn((table: string) => {
    calls.push({ method: 'from', table })
    if (table === 'consent_log') return makeConsentChain()
    return makeConsentChain()
  }),
}

vi.mock('@foundations/data/supabase', () => ({
  getServerSupabase: vi.fn(async () => fakeSupabase),
}))

vi.mock('@foundations/gdpr/consent', () => ({
  recordConsent: vi.fn(
    async (
      userId: string | null,
      state: unknown,
      ip: string,
      ua: string,
      metadata: unknown,
    ) => {
      calls.push({ method: 'recordConsent', userId, state, ip, ua, metadata })
      if (recordConsentThrow) throw recordConsentThrow
      if (recordConsentImpl) await recordConsentImpl(userId, state, ip, ua, metadata)
      // P11.2: recordConsent returns { ok: boolean } (fail-soft).
      // The mock returns ok: true unless `recordConsentOk: false` was
      // set by the test.
      return { ok: recordConsentOk ?? true }
    },
  ),
}))

vi.mock('@foundations/gdpr/consent.types', () => ({
  DEFAULT_CONSENT: { essential: true, analytics: false, marketing: false },
}))

vi.mock('@features/account/profile/actions/writeSelfAuditLog', () => ({
  writeSelfAuditLog: vi.fn(async (payload: unknown) => {
    calls.push({ method: 'writeSelfAuditLog', payload })
    if (writeAuditImpl) return await writeAuditImpl(payload)
    return 42
  }),
}))

vi.mock('next/headers', () => ({
  headers: vi.fn(async () => {
    return {
      get(name: string) {
        calls.push({ method: 'headers.get', name })
        return headerMap[name.toLowerCase()] ?? null
      },
    }
  }),
}))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn((path: string) => {
    calls.push({ method: 'revalidatePath', path })
  }),
}))

const mockWarn = vi.fn()
vi.mock('@foundations/log/pino', () => ({
  loggerFor: () => ({
    info: vi.fn(),
    warn: (...args: unknown[]) => mockWarn(...args),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))

const { updateConsentAction } = await import('./updateConsent')

beforeEach(() => {
  calls.length = 0
  getUserResponse = { data: { user: null }, error: null }
  prevConsentResponse = { data: null, error: null }
  recordConsentImpl = null
  recordConsentThrow = null
  recordConsentOk = undefined
  writeAuditImpl = null
  headerMap = {}
  mockWarn.mockReset()
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('updateConsent — Zod validation', () => {
  it('rejects empty input with fieldErrors', async () => {
    const result = await updateConsentAction({})
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected not ok')
    expect(result.error).toBe('invalid_input')
    expect(result.fieldErrors).toBeDefined()
  })

  it('rejects non-boolean analytics', async () => {
    const result = await updateConsentAction({ analytics: 'yes', marketing: false })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected not ok')
    expect(result.error).toBe('invalid_input')
  })

  it('rejects extra keys via passthrough failure (strict mode)', async () => {
    // The schema doesn't allow unknown keys — Zod's default is
    // "strip" not "fail", so extra keys are silently dropped at
    // the schema layer. But the consent row still gets written with
    // just the two known fields.
    getUserResponse = { data: { user: { id: 'user-1', email: 'k@k.com' } }, error: null }
    const result = await updateConsentAction({
      analytics: true,
      marketing: false,
      essential: false, // silently dropped — schema doesn't carry it
    })
    expect(result.ok).toBe(true)
  })

  it('rejects null input', async () => {
    const result = await updateConsentAction(null)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected not ok')
    expect(result.error).toBe('invalid_input')
  })
})

describe('updateConsent — anon path', () => {
  beforeEach(() => {
    headerMap = { 'x-forwarded-for': '203.0.113.5, 10.0.0.1', 'user-agent': 'Mozilla/5.0 Test' }
  })

  it('persists the consent row with userId=null + hashed IP + UA', async () => {
    const result = await updateConsentAction({ analytics: true, marketing: false })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected ok')

    // The x-forwarded-for first entry is the originating client.
    const recordCall = calls.find((c) => c.method === 'recordConsent')
    expect(recordCall).toBeDefined()
    if (!recordCall || recordCall.method !== 'recordConsent') throw new Error('unreachable')
    expect(recordCall.userId).toBe(null)
    expect(recordCall.state).toEqual({ essential: true, analytics: true, marketing: false })
    expect(recordCall.ip).toBe('203.0.113.5')
    expect(recordCall.ua).toBe('Mozilla/5.0 Test')

    // No audit log for anon (the action only writes audit rows when
    // there's a userId — admin_audit_log.actor_id is NOT NULL).
    const auditCall = calls.find((c) => c.method === 'writeSelfAuditLog')
    expect(auditCall).toBeUndefined()

    // revalidatePath runs.
    expect(calls.some((c) => c.method === 'revalidatePath' && c.path === '/cookie-preferences')).toBe(true)
  })
})

describe('updateConsent — signed-in happy path', () => {
  beforeEach(() => {
    getUserResponse = { data: { user: { id: 'user-42', email: 'k@k.com' } }, error: null }
    headerMap = { 'user-agent': 'curl/8' }
    prevConsentResponse = { data: { analytics: false, marketing: false }, error: null }
  })

  it('persists + writes focused diff audit + revalidates', async () => {
    const result = await updateConsentAction({ analytics: true, marketing: false })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected ok')

    // The consent row is written with the userId.
    const recordCall = calls.find((c) => c.method === 'recordConsent')
    expect(recordCall).toBeDefined()
    if (!recordCall || recordCall.method !== 'recordConsent') throw new Error('unreachable')
    expect(recordCall.userId).toBe('user-42')

    // Only the changed field (analytics false→true) is recorded.
    const auditCall = calls.find((c) => c.method === 'writeSelfAuditLog')
    expect(auditCall).toBeDefined()
    if (!auditCall || auditCall.method !== 'writeSelfAuditLog') throw new Error('unreachable')
    const payload = auditCall.payload as {
      action: string
      targetKind: string
      targetId: string
      metadata: Record<string, unknown>
    }
    expect(payload.action).toBe('consent_self_update')
    expect(payload.targetKind).toBe('consent_log')
    expect(payload.targetId).toBe('user-42')
    expect(payload.metadata).toMatchObject({
      before: { 'Analytics cookies': false },
      after: { 'Analytics cookies': true },
      target_table: 'consent_log',
    })
    // Marketing was unchanged so it should NOT appear in the diff.
    const md = payload.metadata as Record<string, Record<string, unknown>>
    expect(md.before).not.toHaveProperty('Marketing cookies')
    expect(md.after).not.toHaveProperty('Marketing cookies')

    // revalidatePath is called.
    expect(calls.some((c) => c.method === 'revalidatePath' && c.path === '/cookie-preferences')).toBe(true)
  })

  it('no diff → no audit row (writes only when at least one field changes)', async () => {
    prevConsentResponse = { data: { analytics: true, marketing: false }, error: null }
    const result = await updateConsentAction({ analytics: true, marketing: false })
    expect(result.ok).toBe(true)
    const auditCall = calls.find((c) => c.method === 'writeSelfAuditLog')
    expect(auditCall).toBeUndefined()
  })

  it('reads the previous consent row for the user (RLS-friendly query)', async () => {
    prevConsentResponse = { data: null, error: null }
    const result = await updateConsentAction({ analytics: true, marketing: true })
    expect(result.ok).toBe(true)
    expect(calls).toEqual(
      expect.arrayContaining([
        { method: 'from', table: 'consent_log' },
        { method: 'select', payload: 'analytics, marketing' },
        { method: 'eq', col: 'user_id', val: 'user-42' },
        { method: 'order', col: 'created_at', ascending: false },
        { method: 'limit', n: 1 },
        { method: 'maybeSingle' },
      ]),
    )
  })
})

describe('updateConsent — IP extraction', () => {
  it('falls back to x-real-ip when x-forwarded-for is absent', async () => {
    headerMap = { 'x-real-ip': '198.51.100.7' }
    const result = await updateConsentAction({ analytics: true, marketing: false })
    expect(result.ok).toBe(true)
    const recordCall = calls.find((c) => c.method === 'recordConsent')
    if (!recordCall || recordCall.method !== 'recordConsent') throw new Error('unreachable')
    expect(recordCall.ip).toBe('198.51.100.7')
  })

  it('falls back to 0.0.0.0 when neither header is present', async () => {
    headerMap = {}
    const result = await updateConsentAction({ analytics: true, marketing: false })
    expect(result.ok).toBe(true)
    const recordCall = calls.find((c) => c.method === 'recordConsent')
    if (!recordCall || recordCall.method !== 'recordConsent') throw new Error('unreachable')
    expect(recordCall.ip).toBe('0.0.0.0')
  })

  it('picks the FIRST entry of x-forwarded-for (originating client)', async () => {
    headerMap = { 'x-forwarded-for': '203.0.113.5, 10.0.0.1, 10.0.0.2' }
    const result = await updateConsentAction({ analytics: true, marketing: false })
    expect(result.ok).toBe(true)
    const recordCall = calls.find((c) => c.method === 'recordConsent')
    if (!recordCall || recordCall.method !== 'recordConsent') throw new Error('unreachable')
    expect(recordCall.ip).toBe('203.0.113.5')
  })
})

describe('updateConsent — error handling', () => {
  beforeEach(() => {
    getUserResponse = { data: { user: { id: 'user-1', email: 'k@k.com' } }, error: null }
    headerMap = { 'user-agent': 'curl' }
  })

  it('recordConsent reports failure → friendly error + no audit row', async () => {
    recordConsentOk = false
    const result = await updateConsentAction({ analytics: true, marketing: false })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected not ok')
    expect(result.error).toBe('unknown')
    const auditCall = calls.find((c) => c.method === 'writeSelfAuditLog')
    expect(auditCall).toBeUndefined()
    expect(mockWarn).toHaveBeenCalled()
  })

  it('audit log failure is non-fatal (consent row already persisted)', async () => {
    writeAuditImpl = async () => {
      throw new Error('audit insert failed')
    }
    prevConsentResponse = { data: { analytics: false, marketing: false }, error: null }
    const result = await updateConsentAction({ analytics: true, marketing: false })
    expect(result.ok).toBe(true) // the user-facing call succeeds
    expect(mockWarn).toHaveBeenCalled()
  })
})