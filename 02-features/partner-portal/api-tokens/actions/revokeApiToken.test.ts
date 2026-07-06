// Unit tests for `revokeApiTokenAction` — P12.19.
//
// Coverage:
//   - Anon → not_signed_in
//   - Non-partner → not_partner
//   - Invalid input (bad id, non-numeric, missing/wrong confirmation,
//     extra field via .strict()) → invalid_input
//   - Token not owned by user → not_found
//   - Token already revoked → already_revoked
//   - Read error → friendly error
//   - Update error → friendly error
//   - Happy path → ok, audit row written, revalidatePath called

import { describe, expect, it, vi, beforeEach } from 'vitest'

const getUserMock = vi.fn()
const profileSelectMock = vi.fn()
const profileEqMock = vi.fn()
const profileMaybeSingleMock = vi.fn()
const readSelectMock = vi.fn()
const readEqUserMock = vi.fn()
const readEqIdMock = vi.fn()
const readMaybeSingleMock = vi.fn()
const updateEqUserMock = vi.fn()
const updateEqIdMock = vi.fn()
const updateSelectMock = vi.fn()
const updateMaybeSingleMock = vi.fn()
const updateMock = vi.fn()

const hoisted = vi.hoisted(() => ({
  writeSelfAuditLogMock: vi.fn(),
  revalidatePathMock: vi.fn(),
}))

vi.mock('@foundations/data/supabase', () => ({
  getServerSupabase: async () => ({
    auth: { getUser: getUserMock },
    from: (table: string) => {
      if (table === 'profiles') {
        return { select: profileSelectMock }
      }
      if (table === 'api_tokens') {
        return {
          select: readSelectMock,
          update: updateMock,
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

import { revokeApiTokenAction } from './revokeApiToken'

const USER = { id: 'user-uuid-1', email: 'partner@example.com' }

const VALID = { tokenId: '42', confirmation: 'REVOKE' as const }

beforeEach(() => {
  vi.clearAllMocks()
  getUserMock.mockReturnValue({ data: { user: USER }, error: null })
  profileSelectMock.mockReturnValue({ eq: profileEqMock })
  profileEqMock.mockReturnValue({ maybeSingle: profileMaybeSingleMock })
  profileMaybeSingleMock.mockReturnValue({ data: { role: 'partner' }, error: null })

  readSelectMock.mockReturnValue({ eq: readEqIdMock })
  readEqIdMock.mockReturnValue({ eq: readEqUserMock })
  readEqUserMock.mockReturnValue({ maybeSingle: readMaybeSingleMock })
  readMaybeSingleMock.mockReturnValue({
    data: { id: 42, name: 'Zapier', revoked_at: null },
    error: null,
  })

  updateMock.mockReturnValue({ eq: updateEqIdMock })
  updateEqIdMock.mockReturnValue({ eq: updateEqUserMock })
  updateEqUserMock.mockReturnValue({ select: updateSelectMock })
  updateSelectMock.mockReturnValue({ maybeSingle: updateMaybeSingleMock })
  updateMaybeSingleMock.mockReturnValue({
    data: { id: 42, revoked_at: '2026-06-30T01:23:45.678Z' },
    error: null,
  })

  writeSelfAuditLogMock.mockResolvedValue(99)
})

describe('revokeApiTokenAction — auth', () => {
  it('returns not_signed_in when there is no user', async () => {
    getUserMock.mockReturnValue({ data: { user: null }, error: null })
    const out = await revokeApiTokenAction(VALID)
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.code).toBe('not_signed_in')
  })

  it('returns not_partner when role is customer', async () => {
    profileMaybeSingleMock.mockReturnValue({ data: { role: 'customer' }, error: null })
    const out = await revokeApiTokenAction(VALID)
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.code).toBe('not_partner')
  })
})

describe('revokeApiTokenAction — input validation', () => {
  it('rejects a non-numeric tokenId', async () => {
    const out = await revokeApiTokenAction({ tokenId: 'abc', confirmation: 'REVOKE' })
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.code).toBe('invalid_input')
  })

  it('rejects a negative tokenId', async () => {
    const out = await revokeApiTokenAction({ tokenId: '-1', confirmation: 'REVOKE' })
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.code).toBe('invalid_input')
  })

  it('rejects a wrong-case confirmation', async () => {
    const out = await revokeApiTokenAction({ tokenId: '42', confirmation: 'revoke' })
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.code).toBe('invalid_input')
  })

  it('rejects an empty confirmation', async () => {
    const out = await revokeApiTokenAction({ tokenId: '42', confirmation: '' })
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.code).toBe('invalid_input')
  })

  it('rejects an extra field (.strict())', async () => {
    const out = await revokeApiTokenAction({
      tokenId: '42',
      confirmation: 'REVOKE',
      reason: 'leaked',
    })
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.code).toBe('invalid_input')
  })
})

describe('revokeApiTokenAction — ownership', () => {
  it('returns not_found when the row does not exist', async () => {
    readMaybeSingleMock.mockReturnValue({ data: null, error: null })
    const out = await revokeApiTokenAction(VALID)
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.code).toBe('not_found')
  })

  it('returns already_revoked when revoked_at is already set', async () => {
    readMaybeSingleMock.mockReturnValue({
      data: { id: 42, name: 'Old', revoked_at: '2026-06-15T00:00:00.000Z' },
      error: null,
    })
    const out = await revokeApiTokenAction(VALID)
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.code).toBe('already_revoked')
  })

  it('returns a friendly error on read DB failure', async () => {
    readMaybeSingleMock.mockReturnValue({
      data: null,
      error: { message: 'db dead' },
    })
    const out = await revokeApiTokenAction(VALID)
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.error).toMatch(/try again/i)
  })
})

describe('revokeApiTokenAction — happy path', () => {
  it('returns ok + the new revoked_at + calls revalidatePath', async () => {
    const out = await revokeApiTokenAction(VALID)
    expect(out.ok).toBe(true)
    if (out.ok) {
      expect(out.id).toBe(42)
      expect(out.revokedAt).toBe('2026-06-30T01:23:45.678Z')
    }
    expect(revalidatePathMock).toHaveBeenCalledWith('/partner/settings/api')
  })

  it('UPDATE is issued with the right shape', async () => {
    await revokeApiTokenAction(VALID)
    expect(updateMock).toHaveBeenCalledTimes(1)
    const updateArgs = updateMock.mock.calls[0]![0] as Record<string, unknown>
    expect(typeof updateArgs.revoked_at).toBe('string')
    expect(Date.parse(updateArgs.revoked_at as string)).toBeLessThanOrEqual(Date.now() + 1_000)
  })

  it('writes an audit row with the token name + revoked_at timestamp', async () => {
    await revokeApiTokenAction(VALID)
    expect(writeSelfAuditLogMock).toHaveBeenCalledTimes(1)
    const call = writeSelfAuditLogMock.mock.calls[0]![0] as Record<string, unknown>
    expect(call.action).toBe('api_token_revoked')
    expect(call.targetKind).toBe('api_tokens')
    expect(call.targetId).toBe('42')
    const metadata = call.metadata as Record<string, unknown>
    expect(metadata).not.toHaveProperty('token_hash')
    expect(metadata).not.toHaveProperty('plaintext')
    expect(metadata.name).toBe('Zapier')
    expect(metadata.revoked_at).toBe('2026-06-30T01:23:45.678Z')
  })

  it('returns a friendly error on UPDATE DB failure', async () => {
    updateMaybeSingleMock.mockReturnValue({
      data: null,
      error: { message: 'update failed' },
    })
    const out = await revokeApiTokenAction(VALID)
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.error).toMatch(/try again/i)
  })

  it('audit failure does NOT abort the revoke', async () => {
    writeSelfAuditLogMock.mockRejectedValue(new Error('audit boom'))
    const out = await revokeApiTokenAction(VALID)
    expect(out.ok).toBe(true)
  })
})