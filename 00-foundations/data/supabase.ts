// Supabase clients — three of them, by purpose:
//   1. `getServerSupabase()` — request-scoped, RLS-aware, reads the
//      user's session cookie. Use in RSC, route handlers, server actions.
//   2. `getBrowserSupabase()` — singleton on the browser. Use in client
//      components for auth state + realtime.
//   3. `getServiceSupabase()` — bypasses RLS. ONLY use in server code
//      that has a documented reason (webhooks, payouts, admin jobs).
//      Every call site is logged + reviewed in PR.
//
// All three fail closed if env is missing. The server client re-reads
// cookies on every call so RSC sees the latest auth state.
//
// SEC-6 — `import 'server-only'` below is a build-time trip-wire: this
// module exports `getServiceSupabase()` (the RLS-bypassing service-role
// client), and `getBrowserSupabase()` too — both must never end up in a
// client bundle. The whole file is server-only in practice (the
// browser client is only ever constructed from a 'use client' React
// tree that itself runs server-side during SSR, or from a client
// component that calls it directly at runtime — never imported into a
// component that ships to the browser as part of its module graph).
// `server-only` throws at import time if a client bundle ever pulls
// this module in, converting a silent service-role leak into a build
// failure. No logic changes — this is the marker import only.

import 'server-only'

import { createBrowserClient, createServerClient, type CookieOptionsWithName } from '@supabase/ssr'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { getEnv } from '@foundations/env'

/** Browser-side singleton. */
let _browser: SupabaseClient | null = null
export function getBrowserSupabase(): SupabaseClient {
  if (_browser) return _browser
  const env = getEnv()
  _browser = createBrowserClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
  return _browser
}

/** Server-side, request-scoped, RLS-aware. */
export async function getServerSupabase(): Promise<SupabaseClient> {
  const env = getEnv()
  const cookieStore = await cookies()
  return createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      setAll(cookiesToSet: { name: string; value: string; options: CookieOptionsWithName }[]) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          )
        } catch {
          // setAll is called from RSC where cookies are read-only. Safe to
          // ignore here; the session is refreshed on the next request.
        }
      },
    },
  })
}

/** Service-role client. Bypasses RLS. Use with care. */
let _service: SupabaseClient | null = null
export function getServiceSupabase(): SupabaseClient {
  if (_service) return _service
  const env = getEnv()
  _service = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  return _service
}
