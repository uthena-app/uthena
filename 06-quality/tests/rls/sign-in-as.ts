// The `signInAs` helper — returns a Supabase client configured as
// the given role. Used by the live-mode RLS executor (future slice)
// and by the integration tests that need to verify "what does this
// user see?" behaviour.
//
// **Three modes:**
//   1. **mocked** (unit tests) — the caller passes `mockFactory`;
//      `signInAs` skips the network and returns the factory's
//      output. No env read, no Supabase call.
//   2. **live** (staging DB) — the helper reads the env (or the
//      `opts` overrides) and either returns the anon client, calls
//      `supabase.auth.signInWithPassword` for an authenticated
//      role, or returns the service-role client. The session is
//      cached for the duration of the run so a 200-test suite
//      doesn't sign in 200 times.
//   3. **anon-by-default** (no opts) — if no env is provided AND
//      no `mockFactory`, the helper returns a stub client that
//      `signInAs` callers can detect. The runner sees a stub and
//      skips the test (recording `outcome: 'skipped'`).
//
// **Why a stub-and-skip default?** The unit-test suite runs without
// any env. If the live executor accidentally tries to read
// `process.env` and Supabase isn't reachable, the test should
// gracefully skip (not crash). The stub is the contract for "no
// live client available, skip this test".

import type { SupabaseClient } from '@supabase/supabase-js'
import type { RlsRole } from './types'
import { isAuthenticatedRole, isServiceRole, RLS_SEED_USERS } from './roles'

/** A Supabase client tagged with the role it was created for.
 *  Used by the runner to log + report which role each test ran as. */
export interface RlsSupabaseClient {
  readonly client: SupabaseClient
  readonly role: RlsRole
}

/** Options for `signInAs`. */
export interface SignInAsOptions {
  /** Override the Supabase URL (for unit tests + the live runner's
   *  staging-URL config). Falls back to the env, then to empty. */
  readonly url?: string
  /** Override the anon key. Same precedence as `url`. */
  readonly anonKey?: string
  /** Override the service-role key. Same precedence as `url`. */
  readonly serviceKey?: string
  /** Mock factory — if provided, the helper returns the factory's
   *  output wrapped in `{ client, role }`. Use this in unit tests
   *  to avoid touching the network. */
  readonly mockFactory?: (role: RlsRole) => SupabaseClient
  /** Override the seed-user email map. The live runner uses this
   *  to point at a non-default seed cohort. Defaults to the
   *  canonical `RLS_SEED_USERS`. */
  readonly seedUsers?: Readonly<Record<RlsRole, string>>
  /** Override the seed-user password. Defaults to the env var
   *  `RLS_SEED_USER_PASSWORD`. The unit tests should always pass
   *  a static value. */
  readonly seedPassword?: string
  /** Shared session cache — if the caller already signed in as the
   *  role in a previous call, the helper reuses the cached client
   *  instead of re-signing-in. The cache is per-`signInAs`
   *  invocation; the runner owns the top-level cache. */
  readonly sessionCache?: Map<RlsRole, SupabaseClient>
}

/** Read the first non-empty value from a list of env vars. */
function readEnv(...keys: string[]): string {
  for (const key of keys) {
    const value = process.env[key]
    if (value && value.length > 0) return value
  }
  return ''
}

/** Marker the runner uses to detect a stub client (i.e. live mode
 *  is not configured). The runner's executor checks for this
 *  flag and records the test as `outcome: 'skipped'` instead of
 *  trying to call any methods. */
export const RLS_STUB_MARKER = '__rlsStub' as const

/** Check if a Supabase client is the stub (no live DB available). */
export function isRlsStub(client: SupabaseClient): boolean {
  return (client as unknown as Record<string, unknown>)[RLS_STUB_MARKER] === true
}

/** Build a no-network stub client. The runner detects this via
 *  the `__rlsStub` flag and records the test as skipped. */
function buildStubClient(): SupabaseClient {
  // Every method is a rejection so an accidental call fails
  // loudly (the runner's `isRlsStub` check is the primary guard;
  // this rejection is a defense-in-depth fallback).
  const rejection = (): Promise<never> =>
    Promise.reject(
      new Error('RLS stub: live mode not configured (set SUPABASE_URL_FOR_RLS_TESTS)'),
    )
  const stub = {
    from: rejection,
    auth: {
      signInWithPassword: rejection,
      signOut: rejection,
      getUser: rejection,
      getSession: rejection,
    },
  }
  return Object.assign(stub as unknown as SupabaseClient, { [RLS_STUB_MARKER]: true })
}

/** Build the anon client. No session, just the anon key. */
async function buildAnonClient(url: string, anonKey: string): Promise<SupabaseClient> {
  const { createClient } = await import('@supabase/supabase-js')
  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

/** Build the service-role client. Bypasses RLS. */
async function buildServiceClient(
  url: string,
  serviceKey: string,
): Promise<SupabaseClient> {
  const { createClient } = await import('@supabase/supabase-js')
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

/** Build an authenticated client via `signInWithPassword`. The
 *  session is held in the client's internal storage; the runner
 *  reuses the same client across queries within the run. */
async function buildAuthenticatedClient(
  url: string,
  anonKey: string,
  email: string,
  password: string,
): Promise<SupabaseClient> {
  const { createClient } = await import('@supabase/supabase-js')
  const client = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { error } = await client.auth.signInWithPassword({ email, password })
  if (error) {
    const status = error.status !== undefined ? ` (${error.status})` : ''
    throw new Error(`RLS sign-in failed for ${email}: ${error.message}${status}`)
  }
  return client
}

/** Sign in as the given role and return a Supabase client.
 *
 *  In **mocked** mode (when `opts.mockFactory` is set), the helper
 *  skips the network and returns the factory's output. This is
 *  the path the unit tests use.
 *
 *  In **live** mode (when `opts.url` + `opts.anonKey` are set, or
 *  the matching env vars are set), the helper issues the real
 *  Supabase calls. This is the path the future staging-DB slice
 *  uses.
 *
 *  In **stub** mode (no env + no factory), the helper returns a
 *  stub client tagged with `__rlsStub: true`. The runner detects
 *  this and records every test as skipped (not failed) so a
 *  `pnpm test:rls` run in a fresh clone without env doesn't
 *  produce a wall of red.
 */
export async function signInAs(
  role: RlsRole,
  opts: SignInAsOptions = {},
): Promise<RlsSupabaseClient> {
  // ── 1. Cached fast-path ────────────────────────────────────
  const cache = opts.sessionCache
  if (cache?.has(role)) {
    return { client: cache.get(role) as SupabaseClient, role }
  }

  // ── 2. Mocked mode ─────────────────────────────────────────
  if (opts.mockFactory) {
    const client = opts.mockFactory(role)
    cache?.set(role, client)
    return { client, role }
  }

  // ── 3. Resolve env ─────────────────────────────────────────
  const url = opts.url || readEnv('SUPABASE_URL_FOR_RLS_TESTS', 'NEXT_PUBLIC_SUPABASE_URL')
  const anonKey =
    opts.anonKey || readEnv('SUPABASE_ANON_KEY_FOR_RLS_TESTS', 'NEXT_PUBLIC_SUPABASE_ANON_KEY')
  const serviceKey =
    opts.serviceKey || readEnv('SUPABASE_SERVICE_ROLE_KEY_FOR_RLS_TESTS', 'SUPABASE_SERVICE_ROLE_KEY')

  // ── 4. Stub mode (no env) ──────────────────────────────────
  if (!url || !anonKey) {
    return { client: buildStubClient(), role }
  }

  // ── 5. Live mode ───────────────────────────────────────────
  let client: SupabaseClient
  if (isServiceRole(role)) {
    if (!serviceKey) {
      return { client: buildStubClient(), role }
    }
    client = await buildServiceClient(url, serviceKey)
  } else if (role === 'anon' || !isAuthenticatedRole(role)) {
    client = await buildAnonClient(url, anonKey)
  } else {
    const seedUsers = opts.seedUsers ?? RLS_SEED_USERS
    const email = seedUsers[role]
    const password = opts.seedPassword || readEnv('RLS_SEED_USER_PASSWORD')
    if (!email || !password) {
      return { client: buildStubClient(), role }
    }
    client = await buildAuthenticatedClient(url, anonKey, email, password)
  }
  cache?.set(role, client)
  return { client, role }
}
