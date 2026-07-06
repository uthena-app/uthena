// Per-IP rate limiting + suspicious-pattern detection for the auth
// callback route (P1.9).
//
// The callback (`app/auth/callback/route.ts`) is the choke point for
// three Supabase Auth flows:
//   1. OAuth provider redirect (Google, Apple)
//   2. Email verification link click
//   3. Password reset link click
//
// All three flows hand the browser a `?code=...` and the callback
// exchanges it for a session via `supabase.auth.exchangeCodeForSession`.
// A determined attacker could script hundreds of code guesses (the
// code is single-use + short-lived, but verifying that costs a
// Supabase Auth roundtrip per attempt) — the per-IP rate limit
// bounds the damage.
//
// Spec windows (per `01-specs/pages/auth-callback.md`):
//   - 20 callback hits per IP per 5 minutes (burst / code-guessing)
//   - 100 callback hits per IP per 1 hour (hard ceiling)
//   - Suspicious pattern: > 5 successful flows per IP per 10 minutes
//     → write one admin_audit_log row with action='oauth_suspicious_activity'
//
// We reuse the existing `auth_failed_attempts` table for both hit
// counting and audit trail (same pattern as the rest of the auth
// rate-limit helpers in `00-foundations/auth/rate-limit.ts`). The
// `kind` column is extended to include 'oauth_callback' in
// migration 0022; the `reason` column gains 'success' so the
// suspicious-pattern detector can count successful flows.
//
// Why a separate module (and not just calling into the existing
// `00-foundations/auth/rate-limit.ts` helper):
//   - The existing helper uses a fixed 15-minute window. The callback
//     spec needs TWO windows (5min + 1h). Generalizing the existing
//     helper to accept a window would touch every caller; a focused
//     helper keeps the change isolated.
//   - The callback records BOTH successful and failed hits (the
//     suspicious-pattern detector only counts successes). The
//     existing helper is failure-only.
//   - The callback's audit action is callback-specific
//     (`oauth_callback_rate_limited` / `oauth_suspicious_activity`)
//     and would clutter the existing helper's `LIMITS` /
//     `AUDIT_ACTION_BY_KIND` tables.

import { createHash } from 'node:crypto'
import { getServiceSupabase } from '@foundations/data/supabase'
import { loggerFor } from '@foundations/log/pino'

const log = loggerFor({ component: 'auth-callback-rate-limit' })

/** Spec windows. The 5-min window catches the burst (replay / code
 *  guessing) pattern; the 1-hour window is the hard ceiling. */
export const CALLBACK_RATE_LIMIT_WINDOW_5MIN_SECONDS = 5 * 60
export const CALLBACK_RATE_LIMIT_WINDOW_1HOUR_SECONDS = 60 * 60
export const CALLBACK_MAX_PER_IP_5MIN = 20
export const CALLBACK_MAX_PER_IP_1HOUR = 100

/** Suspicious-pattern detection: if an IP completes > 5 successful
 *  flows in 10 minutes, log an admin_audit_log warning. */
export const SUSPICIOUS_SUCCESS_WINDOW_SECONDS = 10 * 60
export const SUSPICIOUS_SUCCESS_THRESHOLD = 5

/** Reasons the callback can record. Mapped to the `reason` column
 *  in `auth_failed_attempts`. The five failure reasons cover every
 *  non-success branch of the route; 'success' is the new value
 *  added by migration 0022 for the suspicious-pattern detector. */
export type CallbackHitReason =
  | 'success'
  | 'invalid_code'
  | 'no_code'
  | 'provider_error'
  | 'rate_limited'
  | 'server_error'

export type CallbackRateLimitVerdict = {
  /** True when the caller is allowed to proceed. */
  allowed: boolean
  /** The window that triggered the lockout (undefined when allowed). */
  triggered?: '5min' | '1hour'
  /** Remaining seconds in the triggered window (0 when allowed). */
  retryAfterSeconds: number
  /** The count that triggered the limit (for logging only). */
  count?: number
}

/** Hash an IP with the audit salt. Matches the pattern used by the
 *  existing `00-foundations/auth/rate-limit.ts` helper so the two
 *  stay compatible — admins who query the audit tables cross-table
 *  get the same hash for the same identifier. */
function hashIdentifier(value: string): string {
  const salt = process.env.AUDIT_HASH_SALT ?? `dev-${process.pid}`
  return createHash('sha256').update(`${salt}:${value}`).digest('hex').slice(0, 32)
}

/** Record one callback hit. Called for every GET /auth/callback
 *  invocation, regardless of whether the code was valid. The
 *  reason lets the suspicious-pattern detector count successes
 *  independently of failures. The helper never throws — a
 *  counter-write failure is logged + ignored so the auth flow
 *  degrades to "no rate limit" (consistent with the existing
 *  `00-foundations/auth/rate-limit.ts` failure policy). */
export async function recordCallbackHit(input: {
  ip: string | null
  userAgent: string | null
  reason: CallbackHitReason
}): Promise<void> {
  try {
    const supabase = getServiceSupabase()
    const ipHash = input.ip ? hashIdentifier(input.ip) : null
    await supabase.from('auth_failed_attempts').insert({
      kind: 'oauth_callback',
      // The callback has no concept of "email" for an unauthenticated
      // caller — the OAuth/email-link code IS the credential. The
      // email is only available after the exchange completes (and
      // then only via the session's `user.email`). For rate-limit
      // purposes the IP is the only durable signal at the callback
      // boundary, so email_hash stays null.
      email_hash: null,
      ip_hash: ipHash,
      ip_raw: input.ip,
      user_agent: input.userAgent ? input.userAgent.slice(0, 200) : null,
      reason: input.reason,
    } as never)
  } catch (err) {
    log.warn(
      { code: 'callback_hit_write_failed', msg: (err as Error).message, reason: input.reason },
      'recordCallbackHit failed — rate limit may be undercounting this hit',
    )
  }
}

/** Check both rate-limit windows for the IP. The 5-min window is
 *  checked first because it's tighter — most real floods trip it
 *  long before the 1-hour ceiling. Returns the most restrictive
 *  verdict. Fails open if Supabase is unreachable (consistent
 *  with the existing helper's policy). */
export async function checkCallbackRateLimit(input: {
  ip: string | null
}): Promise<CallbackRateLimitVerdict> {
  let supabase
  try {
    supabase = getServiceSupabase()
  } catch (err) {
    log.warn(
      { code: 'callback_rate_limit_supabase_unavailable', msg: (err as Error).message },
      'rate-limit check skipped — Supabase unavailable, allowing the hit',
    )
    return { allowed: true, retryAfterSeconds: 0 }
  }
  if (!input.ip) {
    // No IP (proxy header absent in dev). Without an IP we can't
    // enforce per-IP — allow through. The Supabase Auth layer +
    // audit log still see the request. Real prod deployments
    // terminate TLS at the proxy, so this branch is dev-only.
    return { allowed: true, retryAfterSeconds: 0 }
  }

  const ipHash = hashIdentifier(input.ip)
  const now = Date.now()

  // 5-min window check
  const fiveMinStart = new Date(now - CALLBACK_RATE_LIMIT_WINDOW_5MIN_SECONDS * 1000).toISOString()
  const { count: count5 } = await supabase
    .from('auth_failed_attempts')
    .select('*', { count: 'exact', head: true })
    .eq('kind', 'oauth_callback')
    .eq('ip_hash', ipHash)
    .gte('created_at', fiveMinStart)
  if ((count5 ?? 0) >= CALLBACK_MAX_PER_IP_5MIN) {
    return {
      allowed: false,
      triggered: '5min',
      retryAfterSeconds: CALLBACK_RATE_LIMIT_WINDOW_5MIN_SECONDS,
      count: count5 ?? 0,
    }
  }

  // 1-hour window check
  const oneHourStart = new Date(now - CALLBACK_RATE_LIMIT_WINDOW_1HOUR_SECONDS * 1000).toISOString()
  const { count: count1h } = await supabase
    .from('auth_failed_attempts')
    .select('*', { count: 'exact', head: true })
    .eq('kind', 'oauth_callback')
    .eq('ip_hash', ipHash)
    .gte('created_at', oneHourStart)
  if ((count1h ?? 0) >= CALLBACK_MAX_PER_IP_1HOUR) {
    return {
      allowed: false,
      triggered: '1hour',
      retryAfterSeconds: CALLBACK_RATE_LIMIT_WINDOW_1HOUR_SECONDS,
      count: count1h ?? 0,
    }
  }

  return { allowed: true, retryAfterSeconds: 0 }
}

/** Detect the "successful OAuth flood" suspicious pattern: > 5
 *  successful flows per IP in 10 minutes. Returns the count so
 *  the caller can log the magnitude. Fails open (returns 0) on
 *  any DB error — the suspicious-pattern log is best-effort. */
export async function countRecentCallbackSuccesses(input: {
  ip: string | null
}): Promise<number> {
  if (!input.ip) return 0
  try {
    const supabase = getServiceSupabase()
    const ipHash = hashIdentifier(input.ip)
    const start = new Date(Date.now() - SUSPICIOUS_SUCCESS_WINDOW_SECONDS * 1000).toISOString()
    const { count } = await supabase
      .from('auth_failed_attempts')
      .select('*', { count: 'exact', head: true })
      .eq('kind', 'oauth_callback')
      .eq('ip_hash', ipHash)
      .eq('reason', 'success')
      .gte('created_at', start)
    return count ?? 0
  } catch (err) {
    log.warn(
      { code: 'callback_success_count_failed', msg: (err as Error).message },
      'countRecentCallbackSuccesses failed — skipping suspicious-pattern check',
    )
    return 0
  }
}

/** Write one admin_audit_log row when a callback event of interest
 *  occurs. Two actions are emitted:
 *   - `oauth_callback_rate_limited` — when the IP trips either window
 *   - `oauth_suspicious_activity` — when the >5/10min threshold trips
 *  Pre-auth event → `actor_id` points at the system user (the
 *  same pre-auth FK-bypass the rest of the auth helpers use). */
export async function auditCallbackEvent(input: {
  action: 'oauth_callback_rate_limited' | 'oauth_suspicious_activity'
  ip: string | null
  userAgent: string | null
  count: number
  metadata?: Record<string, unknown>
}): Promise<void> {
  try {
    const supabase = getServiceSupabase()
    const ipHash = input.ip ? hashIdentifier(input.ip) : null
    await supabase.from('admin_audit_log').insert({
      actor_id: '00000000-0000-0000-0000-000000000000',
      actor_email: `hash:unknown@uthena.audit`,
      action: input.action,
      target_kind: 'auth_attempt',
      target_id: 'ip',
      metadata: {
        count: input.count,
        ip_hash: ipHash,
        ...(input.metadata ?? {}),
      } as never,
      ip: ipHash,
      user_agent: input.userAgent ? input.userAgent.slice(0, 200) : null,
    } as never)
  } catch (err) {
    log.warn(
      { code: 'callback_audit_failed', msg: (err as Error).message, action: input.action },
      'auditCallbackEvent failed — admin will not see this event',
    )
  }
}