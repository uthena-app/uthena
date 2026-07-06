import 'server-only'
import { getServerSupabase } from '@foundations/data/supabase'
import { loggerFor } from '@foundations/log/pino'
import { decodeSessionIdFromJwt } from '../lib/decodeSessionId'

const log = loggerFor({ component: 'account.settings.sessions' })

export type SessionInfo = {
  /** Session id from `auth.sessions.id`. Stable per device. */
  id: string
  /** Whether this row matches the current request's session. */
  isCurrent: boolean
  /** Last update (or sign-in) time as ISO 8601. */
  lastActiveAt: string
  /** User-agent captured at sign-in. May be null (programmatic / mobile). */
  userAgent: string | null
  /** Truncated, redacted user-agent for display (max 120 chars). */
  userAgentDisplay: string
  /** Time the session was created (sign-in), as ISO 8601. */
  createdAt: string
}

export type MySessions = {
  /** All active sessions for the calling user, newest first. */
  sessions: SessionInfo[]
  /** The id of the current request's session, or null if we couldn't
   *  determine it (e.g. expired cookie). The frontend falls back to a
   *  user-agent heuristic in that case. */
  currentSessionId: string | null
}

type RpcSessionRow = {
  id: string
  created_at: string
  updated_at: string
  user_agent: string | null
  ip: string | null
  aal: string | null
  not_after: string | null
}

/**
 * Read every active session for the calling user. Server-only. P1.8 —
 * the per-device list on /account/settings.
 *
 * Two reads:
 *   1. The current request's `access_token` (from the session cookie
 *      via `supabase.auth.getSession()`). We decode the JWT to get the
 *      `session_id` claim. This is the "is this row me?" signal — the
 *      list highlights the matching row with a "This device" badge.
 *   2. The `public.list_user_sessions()` RPC (defined in 0021). The
 *      function is SECURITY DEFINER so it can read `auth.sessions` —
 *      a `public`-schema table the regular PostgREST API does not
 *      expose. The function filters to `user_id = auth.uid()` so the
 *      caller can only ever see their own sessions.
 *
 * Failure modes:
 *   - No session cookie → empty list, `currentSessionId = null`. The
 *     /account/settings page is auth-gated, so this only happens if
 *     the session expired between the page load and the data fetch.
 *   - RPC throws → log a warn and return an empty list. The page
 *     renders the existing "Sign out this device" / "Sign out
 *     everywhere" controls (the per-device list is "best effort" —
 *     if the RPC is unavailable, the user can still sign out).
 */
export async function getMySessions(): Promise<MySessions> {
  const supabase = await getServerSupabase()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { sessions: [], currentSessionId: null }

  // 1. Identify the current request's session via the JWT's
  //    `session_id` claim. The session cookie carries an `access_token`
  //    which is a JWT; we decode the payload to get the claim.
  const { data: sessionData } = await supabase.auth.getSession()
  const currentSessionId = decodeSessionIdFromJwt(sessionData?.session?.access_token)

  // 2. List every active session for the calling user.
  const { data, error } = await supabase.rpc('list_user_sessions')
  if (error) {
    log.warn(
      { code: 'list_user_sessions_failed', message: error.message },
      'list_user_sessions rpc failed; returning empty session list',
    )
    return { sessions: [], currentSessionId }
  }

  const rows = (data ?? []) as RpcSessionRow[]
  const sessions: SessionInfo[] = rows.map((row) => {
    const isCurrent = currentSessionId != null && row.id === currentSessionId
    const ua = row.user_agent ?? null
    return {
      id: row.id,
      isCurrent,
      lastActiveAt: row.updated_at,
      createdAt: row.created_at,
      userAgent: ua,
      userAgentDisplay: ua ? truncateForDisplay(ua) : 'Unknown device',
    }
  })

  return { sessions, currentSessionId }
}

function truncateForDisplay(ua: string, max = 120): string {
  if (ua.length <= max) return ua
  return ua.slice(0, max - 1) + '\u2026'
}
