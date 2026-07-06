'use server'

import { cookies } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { createServerClient, type CookieOptionsWithName } from '@supabase/ssr'
import { getEnv } from '@foundations/env'
import { getServerSupabase } from '@foundations/data/supabase'
import { loggerFor } from '@foundations/log/pino'
import { z } from 'zod'
import { writeSelfAuditLog } from './writeSelfAuditLog'
import { decodeSessionIdFromJwt } from '../lib/decodeSessionId'

const log = loggerFor({ component: 'account.settings.sessions' })

const _lastSignoutAll = new Map<string, number>()
const _lastSignoutOne = new Map<string, number>()
const RATELIMIT_MS = 60_000

export type SignOutResult = { ok: true; redirectTo: string } | { ok: false; error: string }

// P1.8 — per-session sign-out. Returns `ok: true` on success, `ok: false`
// with a user-facing error message on failure. The caller is the
// SessionsSection client island; the redirect path is preserved on the
// caller (we don't redirect here because the user might still want to
// sign out other devices after revoking one).
export type SignOutSessionResult =
  | { ok: true; signedOutSessionId: string }
  | { ok: false; error: string }

async function clearAuthCookies() {
  const env = getEnv()
  const cookieStore = await cookies()
  const tmp = createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      setAll(cookiesToSet: { name: string; value: string; options: CookieOptionsWithName }[]) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options))
        } catch {
          // best effort
        }
      },
    },
  })
  await tmp.auth.signOut()
}

/**
 * Sign out the current device only. Other devices stay signed in. Audit
 * log: `action='session_signout_one'`, `target_id = user.id`, metadata
 * `{ session_id: 'current' }`. After the call the user is redirected
 * to `/` (the caller is expected to follow up with `router.push`).
 */
export async function signOutCurrentSessionAction(): Promise<SignOutResult> {
  const supabase = await getServerSupabase()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'No active session.' }

  const sessionId = 'current'

  await writeSelfAuditLog({
    userId: user.id,
    userEmail: user.email ?? '',
    action: 'session_signout_one',
    targetKind: 'profiles',
    targetId: user.id,
    metadata: { session_id: sessionId, source: 'settings' },
  })

  await clearAuthCookies()
  revalidatePath('/', 'layout')
  return { ok: true, redirectTo: '/' }
}

/**
 * Sign out every active session for the current user (including the
 * current one). Requires the user to type their email to confirm — the
 * confirmation is checked in the caller before this action is invoked.
 * Audit log: `action='session_signout_all'`, metadata includes
 * `confirm_email_matches: true` so admins can verify the confirmation
 * gate fired. Rate-limited to 1 per 60s per user.
 */
export async function signOutEverywhereAction(input: { confirmEmail: string }): Promise<SignOutResult> {
  const supabase = await getServerSupabase()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user?.email) return { ok: false, error: 'Not signed in.' }

  if (input.confirmEmail.trim().toLowerCase() !== user.email.trim().toLowerCase()) {
    return { ok: false, error: 'Email does not match.' }
  }

  const last = _lastSignoutAll.get(user.id) ?? 0
  if (Date.now() - last < RATELIMIT_MS) {
    const wait = Math.ceil((RATELIMIT_MS - (Date.now() - last)) / 1000)
    return { ok: false, error: `Please wait ${wait}s before trying again.` }
  }

  await writeSelfAuditLog({
    userId: user.id,
    userEmail: user.email,
    action: 'session_signout_all',
    targetKind: 'profiles',
    targetId: user.id,
    metadata: { session_id: '*', source: 'settings', confirm_email_matches: true },
  })

  await clearAuthCookies()
  _lastSignoutAll.set(user.id, Date.now())

  revalidatePath('/', 'layout')
  return { ok: true, redirectTo: '/' }
}

// ---------------------------------------------------------------------------
// P1.8 — per-session sign-out
// ---------------------------------------------------------------------------

const SignOutSessionSchema = z.object({
  sessionId: z.string().uuid('Invalid session id.'),
})

/**
 * Sign out a single other-device session by its `auth.sessions.id`. The
 * current session is NOT signed out — use `signOutCurrentSessionAction`
 * for that (it also clears the cookies, which is the difference).
 *
 * Trust boundary: the `delete_user_session(p_session_id)` RPC is
 * SECURITY DEFINER and filters by `user_id = auth.uid()`. A user can
 * never delete another user's session even if they craft a forged
 * request with a guessed id — the RPC will silently return `false`
 * (the row doesn't match `user_id = auth.uid()`). We treat the false
 * return as "session not found" so the user can't enumerate ids.
 *
 * Rate-limited to 1 per 60s per user. (Same shape as
 * `signOutEverywhereAction` — per-session sign-out is rare but a
 * determined attacker shouldn't be able to revoke every other device
 * by spamming clicks.)
 *
 * The current session is detected by reading `auth.uid()`'s current
 * session id from the JWT and comparing it to `p_session_id`. If they
 * match, the action refuses (use the dedicated "Sign out this device"
 * button for that).
 */
export async function signOutSessionByIdAction(
  input: { sessionId: string },
): Promise<SignOutSessionResult> {
  const parsed = SignOutSessionSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: 'Invalid session id.' }
  }

  const supabase = await getServerSupabase()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Not signed in.' }

  // Reject the current session — use `signOutCurrentSessionAction` instead.
  // The current session id comes from the JWT's `session_id` claim.
  const { data: sessionData } = await supabase.auth.getSession()
  const jwtSessionId = decodeSessionIdFromJwt(sessionData?.session?.access_token)
  if (jwtSessionId && jwtSessionId === parsed.data.sessionId) {
    return {
      ok: false,
      error: 'Use "Sign out this device" to end the current session.',
    }
  }

  // Per-user rate limit (defense against enumeration / accidental spam).
  const last = _lastSignoutOne.get(user.id) ?? 0
  if (Date.now() - last < RATELIMIT_MS) {
    const wait = Math.ceil((RATELIMIT_MS - (Date.now() - last)) / 1000)
    return { ok: false, error: `Please wait ${wait}s before signing out another device.` }
  }

  const { data: deleted, error: rpcError } = await supabase.rpc('delete_user_session', {
    p_session_id: parsed.data.sessionId,
  })

  if (rpcError) {
    log.warn(
      {
        code: 'signout_session_rpc_failed',
        sessionId: parsed.data.sessionId,
        message: rpcError.message,
      },
      'delete_user_session rpc failed',
    )
    return { ok: false, error: 'Could not sign out that device. Please try again.' }
  }

  if (deleted !== true) {
    // Either the session didn't exist or it wasn't owned by this user.
    // We return the same error for both to prevent id enumeration.
    log.info(
      {
        code: 'signout_session_not_found',
        sessionId: parsed.data.sessionId,
        actorId: user.id,
      },
      'delete_user_session returned false (not found or not owned)',
    )
    return { ok: false, error: 'That session is no longer active.' }
  }

  _lastSignoutOne.set(user.id, Date.now())

  await writeSelfAuditLog({
    userId: user.id,
    userEmail: user.email ?? '',
    action: 'session_signout_one',
    targetKind: 'auth.sessions',
    targetId: parsed.data.sessionId,
    metadata: { session_id: parsed.data.sessionId, source: 'settings.per_device' },
  })

  revalidatePath('/account/settings')
  return { ok: true, signedOutSessionId: parsed.data.sessionId }
}
