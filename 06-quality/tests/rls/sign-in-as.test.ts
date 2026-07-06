// Unit tests for the sign-in helper. Pure tests — the helper's
// `mockFactory` short-circuits the real Supabase call, so the
// unit tests don't need a live DB.
//
// What the tests cover:
//   - mocked mode returns the factory's output
//   - cached fast-path reuses the cached client
//   - stub mode (no env, no factory) returns the stub
//   - the stub is correctly tagged with __rlsStub
//   - isRlsStub detects the stub
//   - authenticated roles with no email + no password fall back
//     to the stub (so a partial config doesn't crash)
//
// Run: `pnpm test rls-sign-in-as`.

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { signInAs, isRlsStub, RLS_STUB_MARKER } from './sign-in-as'
import type { RlsRole } from './types'

// Build a minimal mock Supabase client. The factory in each test
// is free to add `.from`, `.auth.getUser`, etc. — the helper
// doesn't call any of them.
function makeMockClient(role: RlsRole): SupabaseClient {
  return { __mockFor: role } as unknown as SupabaseClient
}

describe('signInAs', () => {
  // Snapshot the env before each test so the `delete process.env.X`
  // calls in the stub-mode tests don't pollute the next test.
  const originalEnv = { ...process.env }
  beforeEach(() => {
    for (const k of Object.keys(process.env)) {
      if (
        k === 'SUPABASE_URL_FOR_RLS_TESTS' ||
        k === 'SUPABASE_ANON_KEY_FOR_RLS_TESTS' ||
        k === 'SUPABASE_SERVICE_ROLE_KEY_FOR_RLS_TESTS' ||
        k === 'RLS_SEED_USER_PASSWORD' ||
        k === 'NEXT_PUBLIC_SUPABASE_URL' ||
        k === 'NEXT_PUBLIC_SUPABASE_ANON_KEY' ||
        k === 'SUPABASE_SERVICE_ROLE_KEY'
      ) {
        delete process.env[k]
      }
    }
  })
  afterEach(() => {
    for (const k of Object.keys(process.env)) {
      delete process.env[k]
    }
    Object.assign(process.env, originalEnv)
  })

  describe('mocked mode', () => {
    it('returns the factory output for anon', async () => {
      const factory = vi.fn(makeMockClient)
      const result = await signInAs('anon', { mockFactory: factory })
      expect(factory).toHaveBeenCalledWith('anon')
      expect(isRlsStub(result.client)).toBe(false)
      expect((result.client as unknown as { __mockFor: string }).__mockFor).toBe('anon')
      expect(result.role).toBe('anon')
    })

    it('returns the factory output for an authenticated role', async () => {
      const factory = vi.fn(makeMockClient)
      const result = await signInAs('authenticated_customer', { mockFactory: factory })
      expect(factory).toHaveBeenCalledWith('authenticated_customer')
      expect((result.client as unknown as { __mockFor: string }).__mockFor).toBe('authenticated_customer')
      expect(result.role).toBe('authenticated_customer')
    })

    it('caches the result for repeated calls', async () => {
      const factory = vi.fn(makeMockClient)
      const cache = new Map<RlsRole, SupabaseClient>()
      const r1 = await signInAs('authenticated_partner', { mockFactory: factory, sessionCache: cache })
      const r2 = await signInAs('authenticated_partner', { mockFactory: factory, sessionCache: cache })
      expect(factory).toHaveBeenCalledTimes(1)
      expect(r1.client).toBe(r2.client)
      expect(cache.has('authenticated_partner')).toBe(true)
    })

    it('uses the cache when provided (skips factory on second call)', async () => {
      const factory = vi.fn(makeMockClient)
      const cache = new Map<RlsRole, SupabaseClient>()
      const directClient = makeMockClient('authenticated_admin')
      cache.set('authenticated_admin', directClient)
      const result = await signInAs('authenticated_admin', { mockFactory: factory, sessionCache: cache })
      expect(factory).not.toHaveBeenCalled()
      expect(result.client).toBe(directClient)
    })
  })

  describe('stub mode (no env, no factory)', () => {
    it('returns a stub for anon when no env is set', async () => {
      const result = await signInAs('anon')
      expect(isRlsStub(result.client)).toBe(true)
      expect(result.role).toBe('anon')
    })

    it('returns a stub for an authenticated role when no env is set', async () => {
      const result = await signInAs('authenticated_customer')
      expect(isRlsStub(result.client)).toBe(true)
    })

    it('returns a stub for service_role when no env is set', async () => {
      const result = await signInAs('service_role')
      expect(isRlsStub(result.client)).toBe(true)
    })

    it('the stub is tagged with the RLS_STUB_MARKER property', async () => {
      const result = await signInAs('anon')
      expect((result.client as unknown as Record<string, unknown>)[RLS_STUB_MARKER]).toBe(true)
    })
  })

  describe('stub mode (partial env)', () => {
    it('returns a stub for an authenticated role when the seed password is missing', async () => {
      // URL + anon key set, but no RLS_SEED_USER_PASSWORD — the
      // helper should fall back to the stub rather than throwing.
      process.env.SUPABASE_URL_FOR_RLS_TESTS = 'https://test.supabase.co'
      process.env.SUPABASE_ANON_KEY_FOR_RLS_TESTS = 'a'.repeat(40)
      const result = await signInAs('authenticated_customer')
      expect(isRlsStub(result.client)).toBe(true)
    })

    it('returns a stub for service_role when the service key is missing', async () => {
      process.env.SUPABASE_URL_FOR_RLS_TESTS = 'https://test.supabase.co'
      process.env.SUPABASE_ANON_KEY_FOR_RLS_TESTS = 'a'.repeat(40)
      const result = await signInAs('service_role')
      expect(isRlsStub(result.client)).toBe(true)
    })
  })

  describe('isRlsStub', () => {
    it('returns true for a stub client', () => {
      const stub = { [RLS_STUB_MARKER]: true } as unknown as SupabaseClient
      expect(isRlsStub(stub)).toBe(true)
    })

    it('returns false for a non-stub client', () => {
      const client = {} as SupabaseClient
      expect(isRlsStub(client)).toBe(false)
    })
  })
})
