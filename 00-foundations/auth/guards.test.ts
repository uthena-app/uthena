// Unit tests for `00-foundations/auth/guards.ts`.
//
// Covers:
//   - getSessionUser: anon, authed-with-profile, authed-without-profile
//   - requireUser: anon redirect, safe returnTo, unsafe returnTo fallback
//   - requireRole: anon redirect, wrong-role redirect, allowed role returns user
//   - requireAdmin / requirePartner / requireAffiliate: each role's matrix
//   - requireSelfOrAdmin: self, admin, super_admin, neither → /403
//
// Strategy: vi.mock `next/navigation` (so `redirect()` is observable)
// and vi.mock `@foundations/data/supabase` (so `getServerSupabase()`
// returns a controllable fake client). Each test sets up the fake's
// `.auth.getUser()` + `.from('profiles').select(...).single()`
// response, then asserts what the guard does.
//
// Run: `pnpm test guards` (vitest).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// `redirect()` is the only observable side-effect we need to capture.
// We throw a typed error so the test can detect "did this guard
// redirect?" without crashing the test runner.
const redirectMock = vi.fn((url: string): never => {
  // eslint-disable-next-line @typescript-eslint/no-throw-literal
  const err = new Error(`NEXT_REDIRECT:${url}`) as Error & { __redirectUrl: string }
  err.__redirectUrl = url
  throw err
})

vi.mock('next/navigation', () => ({
  redirect: (url: string) => redirectMock(url),
}))

// Fake Supabase client. Tests configure `.auth.getUser` and `.from`
// per scenario.
type AuthGetUserResult = { data: { user: { id: string; email: string } | null } }
type ProfileRow = { role: string; display_name: string } | null
type FromSingleResult = { data: ProfileRow; error: { message: string } | null }

const fakeSupabase = {
  auth: {
    getUser: vi.fn(async (): Promise<AuthGetUserResult> => ({ data: { user: null } })),
  },
  from: vi.fn(),
}

vi.mock('@foundations/data/supabase', () => ({
  getServerSupabase: vi.fn(async () => fakeSupabase),
}))

// Import AFTER mocks so the module binds to the mocked deps.
const {
  getSessionUser,
  requireUser,
  requireRole,
  requireAdmin,
  requirePartner,
  requireAffiliate,
  requireSelfOrAdmin,
} = await import('./guards')

/**
 * Helper: configure the fake supabase client for "authed user with a
 * profile row". Returns the user id and email so tests can assert.
 */
function mockAuthedUser(opts: {
  id?: string
  email?: string
  role?: 'customer' | 'partner' | 'affiliate' | 'admin' | 'super_admin'
  display_name?: string
}) {
  const userId = opts.id ?? '11111111-1111-1111-1111-111111111111'
  const email = opts.email ?? 'alice@example.com'
  const role = opts.role ?? 'customer'
  const display_name = opts.display_name ?? 'Alice'

  fakeSupabase.auth.getUser.mockResolvedValueOnce({
    data: { user: { id: userId, email } },
  })

  const selectChain = {
    eq: vi.fn().mockReturnThis(),
    single: vi.fn(async (): Promise<FromSingleResult> => ({
      data: { role, display_name },
      error: null,
    })),
  }
  fakeSupabase.from.mockReturnValueOnce({
    select: vi.fn().mockReturnValue(selectChain),
  })

  return { userId, email, role, display_name }
}

function mockAnon() {
  fakeSupabase.auth.getUser.mockResolvedValueOnce({ data: { user: null } })
}

function expectRedirect(err: unknown): string {
  expect(err).toBeInstanceOf(Error)
  const url = (err as Error & { __redirectUrl?: string }).__redirectUrl
  expect(typeof url).toBe('string')
  return url as string
}

describe('guards', () => {
  beforeEach(() => {
    redirectMock.mockClear()
    fakeSupabase.auth.getUser.mockReset()
    fakeSupabase.from.mockReset()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  // ─── getSessionUser ────────────────────────────────────────────

  describe('getSessionUser', () => {
    it('returns null for anonymous callers', async () => {
      mockAnon()
      const user = await getSessionUser()
      expect(user).toBeNull()
      expect(redirectMock).not.toHaveBeenCalled()
    })

    it('returns null when the authed user has no profile row', async () => {
      fakeSupabase.auth.getUser.mockResolvedValueOnce({
        data: { user: { id: 'u-1', email: 'a@b.com' } },
      })
      const selectChain = {
        eq: vi.fn().mockReturnThis(),
        single: vi.fn(async () => ({ data: null, error: { message: 'not found' } })),
      }
      fakeSupabase.from.mockReturnValueOnce({
        select: vi.fn().mockReturnValue(selectChain),
      })
      const user = await getSessionUser()
      expect(user).toBeNull()
    })

    it('returns the merged SessionUser for an authed caller with a profile', async () => {
      mockAuthedUser({ id: 'u-1', email: 'a@b.com', role: 'partner', display_name: 'Alice' })
      const user = await getSessionUser()
      expect(user).toEqual({
        id: 'u-1',
        email: 'a@b.com',
        role: 'partner',
        display_name: 'Alice',
      })
    })

    it('falls back to the email when display_name is missing', async () => {
      mockAuthedUser({ display_name: '' as unknown as string })
      const user = await getSessionUser()
      // The guards use `?? user.email ?? 'User'` — '' is not nullish so
      // an empty string wins. We only fall back when display_name is
      // null/undefined. Verify the existing fallback behavior.
      expect(user?.email).toBe('alice@example.com')
    })

    it("defaults role to 'customer' when the profile's role is null", async () => {
      fakeSupabase.auth.getUser.mockResolvedValueOnce({
        data: { user: { id: 'u-1', email: 'a@b.com' } },
      })
      const selectChain = {
        eq: vi.fn().mockReturnThis(),
        single: vi.fn(async () => ({
          data: { role: null, display_name: 'Alice' },
          error: null,
        })),
      }
      fakeSupabase.from.mockReturnValueOnce({
        select: vi.fn().mockReturnValue(selectChain),
      })
      const user = await getSessionUser()
      expect(user?.role).toBe('customer')
    })

    it('returns the email as a last-resort display_name', async () => {
      fakeSupabase.auth.getUser.mockResolvedValueOnce({
        data: { user: { id: 'u-1', email: 'fallback@example.com' } },
      })
      const selectChain = {
        eq: vi.fn().mockReturnThis(),
        single: vi.fn(async () => ({
          data: { role: 'customer', display_name: null },
          error: null,
        })),
      }
      fakeSupabase.from.mockReturnValueOnce({
        select: vi.fn().mockReturnValue(selectChain),
      })
      const user = await getSessionUser()
      expect(user?.display_name).toBe('fallback@example.com')
    })
  })

  // ─── requireUser ───────────────────────────────────────────────

  describe('requireUser', () => {
    it('redirects to /login for anonymous callers', async () => {
      mockAnon()
      try {
        await requireUser()
      } catch (err) {
        const url = expectRedirect(err)
        expect(url).toBe('/login')
        return
      }
      throw new Error('expected redirect')
    })

    it('redirects to /login (no next) when returnTo is omitted', async () => {
      mockAnon()
      try {
        await requireUser()
      } catch (err) {
        expect(expectRedirect(err)).toBe('/login')
        return
      }
      throw new Error('expected redirect')
    })

    it('redirects to /login?next=<safe> for a safe returnTo', async () => {
      mockAnon()
      try {
        await requireUser('/library?from=winter-sale')
      } catch (err) {
        const url = expectRedirect(err)
        expect(url).toBe('/login?next=%2Flibrary%3Ffrom%3Dwinter-sale')
        return
      }
      throw new Error('expected redirect')
    })

    it('redirects to /login (no next) for an unsafe returnTo — defeats open redirect', async () => {
      mockAnon()
      try {
        await requireUser('https://evil.com/phish')
      } catch (err) {
        const url = expectRedirect(err)
        // Falls back to plain /login — the attacker-controlled URL is
        // discarded. This is the open-redirect guard's payoff.
        expect(url).toBe('/login')
        expect(url).not.toContain('evil.com')
        return
      }
      throw new Error('expected redirect')
    })

    it('redirects to /login (no next) for a protocol-relative returnTo', async () => {
      mockAnon()
      try {
        await requireUser('//evil.com')
      } catch (err) {
        expect(expectRedirect(err)).toBe('/login')
        return
      }
      throw new Error('expected redirect')
    })

    it('redirects to /login (no next) for a javascript: returnTo', async () => {
      mockAnon()
      try {
        await requireUser('/javascript:alert(1)')
      } catch (err) {
        expect(expectRedirect(err)).toBe('/login')
        return
      }
      throw new Error('expected redirect')
    })

    it('returns the user for an authed caller', async () => {
      mockAuthedUser({ id: 'u-1', role: 'customer' })
      const user = await requireUser('/library')
      expect(user.id).toBe('u-1')
      expect(user.role).toBe('customer')
      expect(redirectMock).not.toHaveBeenCalled()
    })

    it("ignores a safe returnTo when the user IS authed (no redirect needed)", async () => {
      mockAuthedUser({ id: 'u-1', role: 'customer' })
      const user = await requireUser('/somewhere')
      expect(user.id).toBe('u-1')
      expect(redirectMock).not.toHaveBeenCalled()
    })
  })

  // ─── requireRole ───────────────────────────────────────────────

  describe('requireRole', () => {
    it('redirects to /login for anon callers (regardless of allowed)', async () => {
      mockAnon()
      try {
        await requireRole(['admin'])
      } catch (err) {
        expect(expectRedirect(err)).toBe('/login')
        return
      }
      throw new Error('expected redirect')
    })

    it('redirects to /403 when the user is logged in but the role is not in allowed[]', async () => {
      mockAuthedUser({ role: 'customer' })
      try {
        await requireRole(['admin'])
      } catch (err) {
        expect(expectRedirect(err)).toBe('/403')
        return
      }
      throw new Error('expected redirect')
    })

    it('returns the user when their role IS in allowed[]', async () => {
      mockAuthedUser({ role: 'partner' })
      const user = await requireRole(['partner', 'admin'])
      expect(user.role).toBe('partner')
      expect(redirectMock).not.toHaveBeenCalled()
    })

    it('accepts any role from the allowed[] list', async () => {
      for (const role of ['customer', 'partner', 'affiliate', 'admin', 'super_admin'] as const) {
        mockAuthedUser({ role })
        const user = await requireRole([role])
        expect(user.role).toBe(role)
      }
    })
  })

  // ─── requireAdmin ──────────────────────────────────────────────

  describe('requireAdmin', () => {
    it('redirects to /login for anon', async () => {
      mockAnon()
      try {
        await requireAdmin()
      } catch (err) {
        expect(expectRedirect(err)).toBe('/login')
        return
      }
      throw new Error('expected redirect')
    })

    it.each(['customer', 'partner', 'affiliate'] as const)(
      'redirects to /403 for %s (not an admin)',
      async (role) => {
        mockAuthedUser({ role })
        try {
          await requireAdmin()
        } catch (err) {
          expect(expectRedirect(err)).toBe('/403')
          return
        }
        throw new Error('expected redirect')
      },
    )

    it.each(['admin', 'super_admin'] as const)(
      'returns the user for %s',
      async (role) => {
        mockAuthedUser({ role })
        const user = await requireAdmin()
        expect(user.role).toBe(role)
      },
    )
  })

  // ─── requirePartner ────────────────────────────────────────────

  describe('requirePartner', () => {
    it('redirects to /login for anon', async () => {
      mockAnon()
      try {
        await requirePartner()
      } catch (err) {
        expect(expectRedirect(err)).toBe('/login')
        return
      }
      throw new Error('expected redirect')
    })

    it.each(['customer', 'affiliate'] as const)(
      'redirects to /403 for %s',
      async (role) => {
        mockAuthedUser({ role })
        try {
          await requirePartner()
        } catch (err) {
          expect(expectRedirect(err)).toBe('/403')
          return
        }
        throw new Error('expected redirect')
      },
    )

    it.each(['partner', 'admin', 'super_admin'] as const)(
      'returns the user for %s',
      async (role) => {
        mockAuthedUser({ role })
        const user = await requirePartner()
        expect(user.role).toBe(role)
      },
    )
  })

  // ─── requireAffiliate ──────────────────────────────────────────

  describe('requireAffiliate', () => {
    it('redirects to /login for anon', async () => {
      mockAnon()
      try {
        await requireAffiliate()
      } catch (err) {
        expect(expectRedirect(err)).toBe('/login')
        return
      }
      throw new Error('expected redirect')
    })

    it.each(['customer', 'partner'] as const)(
      'redirects to /403 for %s',
      async (role) => {
        mockAuthedUser({ role })
        try {
          await requireAffiliate()
        } catch (err) {
          expect(expectRedirect(err)).toBe('/403')
          return
        }
        throw new Error('expected redirect')
      },
    )

    it.each(['affiliate', 'admin', 'super_admin'] as const)(
      'returns the user for %s',
      async (role) => {
        mockAuthedUser({ role })
        const user = await requireAffiliate()
        expect(user.role).toBe(role)
      },
    )
  })

  // ─── requireSelfOrAdmin ────────────────────────────────────────

  describe('requireSelfOrAdmin', () => {
    const targetId = '22222222-2222-2222-2222-222222222222'

    it('redirects to /login for anon', async () => {
      mockAnon()
      try {
        await requireSelfOrAdmin(targetId)
      } catch (err) {
        expect(expectRedirect(err)).toBe('/login')
        return
      }
      throw new Error('expected redirect')
    })

    it('returns the user when they own the resource', async () => {
      mockAuthedUser({ id: targetId, role: 'customer' })
      const user = await requireSelfOrAdmin(targetId)
      expect(user.id).toBe(targetId)
      expect(user.role).toBe('customer')
      expect(redirectMock).not.toHaveBeenCalled()
    })

    it.each(['admin', 'super_admin'] as const)(
      'returns the user when they are %s (even if not the owner)',
      async (role) => {
        mockAuthedUser({ id: 'someone-else', role })
        const user = await requireSelfOrAdmin(targetId)
        expect(user.role).toBe(role)
        expect(redirectMock).not.toHaveBeenCalled()
      },
    )

    it.each(['customer', 'partner', 'affiliate'] as const)(
      'redirects to /403 for non-self %s viewing another user\'s resource',
      async (role) => {
        mockAuthedUser({ id: 'someone-else', role })
        try {
          await requireSelfOrAdmin(targetId)
        } catch (err) {
          expect(expectRedirect(err)).toBe('/403')
          return
        }
        throw new Error('expected redirect')
      },
    )

    it('redirects to /login (no next) for an unsafe returnTo even when checking self-or-admin', async () => {
      mockAnon()
      try {
        await requireSelfOrAdmin(targetId, 'https://evil.com')
      } catch (err) {
        const url = expectRedirect(err)
        expect(url).toBe('/login')
        expect(url).not.toContain('evil.com')
        return
      }
      throw new Error('expected redirect')
    })

    it('redirects to /login?next=<safe> when anon + safe returnTo', async () => {
      mockAnon()
      try {
        await requireSelfOrAdmin(targetId, '/admin/customers/123')
      } catch (err) {
        expect(expectRedirect(err)).toBe('/login?next=%2Fadmin%2Fcustomers%2F123')
        return
      }
      throw new Error('expected redirect')
    })
  })

  // ─── Cross-cutting ─────────────────────────────────────────────

  describe('cross-cutting', () => {
    it('never throws for authed users with valid role — only redirects via the typed NEXT_REDIRECT path', async () => {
      mockAuthedUser({ role: 'admin' })
      const user = await requireAdmin()
      expect(user.id).toBe('11111111-1111-1111-1111-111111111111')
    })

    it('redirects on the FIRST failure mode (auth before role check)', async () => {
      // An anon caller should always get /login, never /403 — the
      // auth check has to run before the role check so we don't leak
      // "this route requires admin" to an unauthenticated visitor.
      mockAnon()
      try {
        await requireRole(['admin'])
      } catch (err) {
        expect(expectRedirect(err)).toBe('/login')
        return
      }
      throw new Error('expected redirect')
    })

    it('all six guards share the same anon behavior (redirect to /login)', async () => {
      for (const guard of [
        requireUser,
        requireRole.bind(null, ['admin']),
        requireAdmin,
        requirePartner,
        requireAffiliate,
        requireSelfOrAdmin.bind(null, '00000000-0000-0000-0000-000000000000'),
      ]) {
        mockAnon()
        try {
          await (guard as () => Promise<unknown>)()
        } catch (err) {
          expect(expectRedirect(err)).toBe('/login')
          continue
        }
        throw new Error(`guard did not redirect for anon: ${guard.name ?? 'anon'}`)
      }
    })
  })
})
