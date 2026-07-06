// Unit tests for `createApiTokenAction` — P12.19.
//
// Coverage:
//   - Anon path → { ok: false, code: 'not_signed_in' }
//   - Non-partner → { ok: false, code: 'not_partner' }
//   - Invalid input (bad name / no scopes / bad expiration /
//     missing acknowledgement / unknown scope) → { ok: false,
//     code: 'invalid_input' }
//   - Rate-limit cap → { ok: false, code: 'rate_limited' }
//   - 11th active token → { ok: false, code: 'too_many_active_tokens' }
//   - Happy path → { ok: true, plaintext, id, ... } + audit row
//     written + hash stored (NOT plaintext, NOT the original
//     plaintext in the audit metadata) + revalidate called
//   - Hash collision (PG 23505) → { ok: false, code: 'duplicate_prefix' }
//
// We stub `getServerSupabase` + `writeSelfAuditLog` + `revalidatePath`
// + the rate-limit reset helper to keep the test isolated.

import { describe, expect, it, vi, beforeEach } from 'vitest'

// Mocks declared before importing the action.
const getUserMock = vi.fn()
const profileSelectMock = vi.fn()
const profileEqMock = vi.fn()
const profileMaybeSingleMock = vi.fn()
const countSelectMock = vi.fn()
const countEqMock = vi.fn()
const countIsMock = vi.fn()
const countOrMock = vi.fn()
const insertSelectMock = vi.fn()
const insertSingleMock = vi.fn()
const insertMock = vi.fn()

let insertFn: (...args: unknown[]) => unknown
let countFn: (...args: unknown[]) => unknown

function setInsertReturn(returnValue: { data: unknown; error: unknown }) {
  insertFn = vi.fn(() => ({ select: insertSelectMock }))
  insertSelectMock.mockReturnValue({ single: insertSingleMock })
  insertSingleMock.mockReturnValue(returnValue)
  // When the action calls .insert(...), the chain is .from('api_tokens').insert(payload).select(...).single()
  // We override .insert in the test by giving the from('api_tokens') mock a new insert.
  insertMock.mockImplementation(() => ({ select: insertSelectMock }))
}

function setCountReturn(returnValue: { count: number | null; error: unknown }) {
  countFn = vi.fn(() => ({ eq: countEqMock }))
  countEqMock.mockReturnValue({ is: countIsMock })
  countIsMock.mockReturnValue({ or: countOrMock })
  countOrMock.mockReturnValue(returnValue)
  countSelectMock.mockImplementation(() => ({ eq: countEqMock }))
}

// Mocks for collaborators that must exist before the action is
// imported. We use `vi.hoisted` for the inner mock refs because
// Vitest hoists `vi.mock` factories above the test body.
const hoisted = vi.hoisted(() => ({
  writeSelfAuditLogMock: vi.fn(),
  revalidatePathMock: vi.fn(),
}))

vi.mock('@foundations/data/supabase', () => ({
  getServerSupabase: async () => ({
    auth: { getUser: getUserMock },
    from: (table: string) => {
      if (table === 'profiles') {
        return {
          select: profileSelectMock,
        }
      }
      if (table === 'api_tokens') {
        return {
          // The count query uses head:true select pattern: select().eq().is().or()
          select: (...args: unknown[]) => {
            const opts = args[1] as { head?: boolean; count?: string } | undefined
            if (opts?.head && opts?.count === 'exact') {
              return countSelectMock()
            }
            return { insert: insertMock }
          },
          // Direct .insert(...) for the create flow
          insert: insertMock,
        }
      }
      return { select: vi.fn() }
    },
  }),
  getServiceSupabase: async () => ({}),
}))

vi.mock('@features/account/profile/actions/writeSelfAuditLog', () => ({
  writeSelfAuditLog: hoisted.writeSelfAuditLogMock,
}))

vi.mock('next/cache', () => ({
  revalidatePath: hoisted.revalidatePathMock,
}))

const writeSelfAuditLogMock = hoisted.writeSelfAuditLogMock
const revalidatePathMock = hoisted.revalidatePathMock

import { createApiTokenAction } from './createApiToken'
import { _resetApiTokensRateLimitForTests } from './api-tokens.rate-limit'

const USER = { id: 'user-uuid-1', email: 'partner@example.com' }

const VALID_INPUT = {
  name: 'Zapier',
  scopes: ['read_sales' as const],
  expirationDays: 90 as const,
  acknowledgedOneTimeShow: true as const,
}

beforeEach(() => {
  vi.clearAllMocks()
  _resetApiTokensRateLimitForTests()
  getUserMock.mockReturnValue({ data: { user: USER }, error: null })
  profileSelectMock.mockReturnValue({ eq: profileEqMock })
  profileEqMock.mockReturnValue({ maybeSingle: profileMaybeSingleMock })
  profileMaybeSingleMock.mockReturnValue({ data: { role: 'partner' }, error: null })
})

describe('createApiTokenAction — auth', () => {
  it('returns not_signed_in when there is no user', async () => {
    getUserMock.mockReturnValue({ data: { user: null }, error: null })
    const out = await createApiTokenAction(VALID_INPUT)
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.code).toBe('not_signed_in')
  })

  it('returns not_partner when role is customer', async () => {
    profileMaybeSingleMock.mockReturnValue({ data: { role: 'customer' }, error: null })
    const out = await createApiTokenAction(VALID_INPUT)
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.code).toBe('not_partner')
  })

  it('returns not_partner when role is affiliate', async () => {
    profileMaybeSingleMock.mockReturnValue({ data: { role: 'affiliate' }, error: null })
    const out = await createApiTokenAction(VALID_INPUT)
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.code).toBe('not_partner')
  })

  it('allows admin and super_admin to create tokens (requirePartner parity)', async () => {
    for (const role of ['admin', 'super_admin'] as const) {
      profileMaybeSingleMock.mockReturnValue({ data: { role }, error: null })
      setCountReturn({ count: 0, error: null })
      setInsertReturn({ data: { id: 1, created_at: '2026-06-30T00:00:00.000Z' }, error: null })
      writeSelfAuditLogMock.mockResolvedValue(99)
      const out = await createApiTokenAction(VALID_INPUT)
      expect(out.ok).toBe(true)
    }
  })
})

describe('createApiTokenAction — input validation', () => {
  it('rejects an empty name', async () => {
    const out = await createApiTokenAction({ ...VALID_INPUT, name: '' })
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.code).toBe('invalid_input')
  })

  it('rejects zero scopes', async () => {
    const out = await createApiTokenAction({ ...VALID_INPUT, scopes: [] })
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.code).toBe('invalid_input')
  })

  it('rejects an unknown scope', async () => {
    const out = await createApiTokenAction({ ...VALID_INPUT, scopes: ['write_everything'] })
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.code).toBe('invalid_input')
  })

  it('rejects a non-union expirationDays', async () => {
    const out = await createApiTokenAction({ ...VALID_INPUT, expirationDays: 7 })
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.code).toBe('invalid_input')
  })

  it('rejects when acknowledgedOneTimeShow is false', async () => {
    const out = await createApiTokenAction({ ...VALID_INPUT, acknowledgedOneTimeShow: false })
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.code).toBe('invalid_input')
  })

  it('rejects when acknowledgedOneTimeShow is missing', async () => {
    const { acknowledgedOneTimeShow: _omit, ...rest } = VALID_INPUT
    void _omit
    const out = await createApiTokenAction(rest)
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.code).toBe('invalid_input')
  })

  it('rejects unknown extra fields (.strict())', async () => {
    const out = await createApiTokenAction({ ...VALID_INPUT, plaintext: 'sneaky' })
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.code).toBe('invalid_input')
  })
})

describe('createApiTokenAction — rate limit', () => {
  it('returns rate_limited after 5 creates in an hour', async () => {
    setCountReturn({ count: 0, error: null })
    setInsertReturn({ data: { id: 1, created_at: '2026-06-30T00:00:00.000Z' }, error: null })
    writeSelfAuditLogMock.mockResolvedValue(99)
    for (let i = 0; i < 5; i++) {
      const out = await createApiTokenAction(VALID_INPUT)
      expect(out.ok).toBe(true)
    }
    const out = await createApiTokenAction(VALID_INPUT)
    expect(out.ok).toBe(false)
    if (!out.ok) {
      expect(out.code).toBe('rate_limited')
      expect(out.error).toMatch(/minute/)
    }
  })
})

describe('createApiTokenAction — active-token cap', () => {
  it('returns too_many_active_tokens when the cap is reached', async () => {
    setCountReturn({ count: 10, error: null })
    const out = await createApiTokenAction(VALID_INPUT)
    expect(out.ok).toBe(false)
    if (!out.ok) {
      expect(out.code).toBe('too_many_active_tokens')
      expect(out.error).toMatch(/Maximum 10/)
    }
  })

  it('allows creates when under the cap', async () => {
    setCountReturn({ count: 9, error: null })
    setInsertReturn({ data: { id: 1, created_at: '2026-06-30T00:00:00.000Z' }, error: null })
    writeSelfAuditLogMock.mockResolvedValue(99)
    const out = await createApiTokenAction(VALID_INPUT)
    expect(out.ok).toBe(true)
  })

  it('treats null count as a generic failure', async () => {
    setCountReturn({ count: null, error: null })
    const out = await createApiTokenAction(VALID_INPUT)
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.code).toBeUndefined()
  })

  it('returns a friendly error on count DB failure', async () => {
    setCountReturn({ count: null, error: { message: 'db dead' } })
    const out = await createApiTokenAction(VALID_INPUT)
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.error).toMatch(/try again/i)
  })
})

describe('createApiTokenAction — happy path', () => {
  beforeEach(() => {
    setCountReturn({ count: 0, error: null })
    setInsertReturn({ data: { id: 42, created_at: '2026-06-30T00:00:00.000Z' }, error: null })
    writeSelfAuditLogMock.mockResolvedValue(99)
  })

  it('returns the plaintext token + the canonical fields', async () => {
    const out = await createApiTokenAction(VALID_INPUT)
    expect(out.ok).toBe(true)
    if (out.ok) {
      expect(out.id).toBe(42)
      expect(out.plaintext.startsWith('uth_pat_')).toBe(true)
      expect(out.tokenPrefix.startsWith('uth_pat_')).toBe(true)
      expect(out.tokenPrefix.endsWith('***')).toBe(true)
      expect(out.scopes).toEqual(['read_sales'])
      expect(out.name).toBe('Zapier')
      expect(out.expiresAt).not.toBeNull()
      expect(out.createdAt).toBe('2026-06-30T00:00:00.000Z')
    }
  })

  it('writes an audit row with metadata excluding the hash and plaintext', async () => {
    await createApiTokenAction(VALID_INPUT)
    expect(writeSelfAuditLogMock).toHaveBeenCalledTimes(1)
    const call = writeSelfAuditLogMock.mock.calls[0]![0] as Record<string, unknown>
    expect(call.action).toBe('api_token_created')
    expect(call.targetKind).toBe('api_tokens')
    expect(call.targetId).toBe('42')
    const metadata = call.metadata as Record<string, unknown>
    expect(metadata).not.toHaveProperty('plaintext')
    expect(metadata).not.toHaveProperty('token_hash')
    expect(metadata).not.toHaveProperty('hash')
    expect(metadata).toHaveProperty('name')
    expect(metadata).toHaveProperty('scopes')
    expect(metadata).toHaveProperty('expiration_days')
  })

  it('inserts the row with the user-scoped RLS predicate implied (service path)', async () => {
    await createApiTokenAction(VALID_INPUT)
    expect(insertMock).toHaveBeenCalledTimes(1)
    const insertArgs = insertMock.mock.calls[0]![0] as Record<string, unknown>
    expect(insertArgs.user_id).toBe(USER.id)
    expect(insertArgs.name).toBe('Zapier')
    expect(insertArgs.scopes).toEqual(['read_sales'])
    // expires_at is an ISO string ~90 days in the future
    expect(typeof insertArgs.expires_at).toBe('string')
    // token_hash is a 64-char hex (HMAC-SHA256), NOT the plaintext
    expect(typeof insertArgs.token_hash).toBe('string')
    expect((insertArgs.token_hash as string).length).toBe(64)
    expect((insertArgs.token_hash as string)).not.toMatch(/uth_pat_/)
    // token_prefix is the masked display string
    expect((insertArgs.token_prefix as string).endsWith('***')).toBe(true)
  })

  it('computes expirationDays=90 → expires_at ~90 days from now', async () => {
    const before = Date.now()
    await createApiTokenAction(VALID_INPUT)
    const insertArgs = insertMock.mock.calls[0]![0] as Record<string, unknown>
    const expiresMs = Date.parse(insertArgs.expires_at as string)
    const expectedMs = before + 90 * 86_400_000
    // Allow a 5-second window for clock drift.
    expect(Math.abs(expiresMs - expectedMs)).toBeLessThan(5_000)
  })

  it('null expirationDays → expires_at is null', async () => {
    await createApiTokenAction({ ...VALID_INPUT, expirationDays: null })
    const insertArgs = insertMock.mock.calls[0]![0] as Record<string, unknown>
    expect(insertArgs.expires_at).toBeNull()
  })

  it('calls revalidatePath("/partner/settings/api") on success', async () => {
    await createApiTokenAction(VALID_INPUT)
    expect(revalidatePathMock).toHaveBeenCalledWith('/partner/settings/api')
  })
})

describe('createApiTokenAction — insert failure', () => {
  it('maps PG 23505 (unique violation) to duplicate_prefix', async () => {
    setCountReturn({ count: 0, error: null })
    setInsertReturn({ data: null, error: { code: '23505', message: 'unique' } })
    const out = await createApiTokenAction(VALID_INPUT)
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.code).toBe('duplicate_prefix')
  })

  it('returns a generic error on other insert failures', async () => {
    setCountReturn({ count: 0, error: null })
    setInsertReturn({ data: null, error: { code: '08006', message: 'connection' } })
    const out = await createApiTokenAction(VALID_INPUT)
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.code).toBeUndefined()
  })
})