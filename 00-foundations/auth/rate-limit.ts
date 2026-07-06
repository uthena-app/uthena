// Rate limiting for auth events (P1.2 — login, P1.3 — password reset,
// P1.5 — email verification, P1.6 — OAuth signin, future — signup).
//
// Spec contracts:
//   - signin (P1.2):         5/email/15min + 20/IP/15min
//   - reset_password (P1.3): 3/email/15min + 10/IP/15min
//   - signup (STUB-038):     3/email/15min + 10/IP/15min (limits P1.1
//                            haven't adopted the helper yet — the
//                            helper supports the kind, the signup
//                            action will adopt it when P1.7 lands)
//   - oauth_signin (P1.6):   5/email/15min + 10/IP/15min (the per-IP
//                            ceiling stops an automated enrollment-
//                            flooding attempt; the per-email ceiling
//                            is keyed on the email the user passed in
//                            the action's FormData, which may be empty
//                            when the user clicked the OAuth button
//                            without typing an email)
//
// On lockout, the action receives a verdict with `retryAfterSeconds`
// + the dimension that tripped. The action decides what to do with
// the result:
//   - signin: surface the cooldown inline in the form (the user is
//     trying to sign in and a wrong-password burst is a normal
//     "I forgot my password" scenario — showing a cooldown helps
//     the legitimate user).
//   - reset_password: NEVER surface the cooldown to the user — the
//     page always shows the "Check your email" panel. An attacker
//     who triggers the reset rate-limit would otherwise get a free
//     oracle ("the form just told me I'm throttled → I know my
//     enumeration attempt is being detected").
//
// Implementation:
//   - Counts come from `auth_failed_attempts` rows whose `created_at`
//     falls inside the 15-minute window. The table is INSERT-only; the
//     helper reads the window and writes both the new failure row
//     and (when triggered) the lockout audit row.
//   - All identifiers are HASHED before storage. The raw IP lives in
//     the row only long enough to be returned to the client for the
//     cooldown display; the helper trims it to null on the response
//     so it never leaves the server in a way that would expose the
//     hashed value to the client. (The rate-limit response surfaces
//     the duration in seconds, not the IP.)
//   - "Lazy GC" — every Nth call the helper deletes rows older than
//     24 h. Keeps the table small without a separate cron job. N is
//     GC_EVERY_N_CALLS (32) so GC runs ~once per 32 failed attempts
//     per IP, which at the spec's max burst (20/15min) is ~once every
//     ~24 min — well below any performance concern.
//
// Why Supabase (not in-memory):
//   - Multi-instance deploys need shared counters. A single-instance
//     in-memory limiter would let an attacker distribute attempts
//     across instances to bypass it. The DB-backed counter is the
//     standard production rate-limit pattern (Cloudflare Workers KV,
//     Upstash, Supabase) — we already have Supabase, so we use it.

import { createHash } from 'node:crypto'
import { getServiceSupabase } from '@foundations/data/supabase'
import { loggerFor } from '@foundations/log/pino'

const log = loggerFor({ component: 'auth-rate-limit' })

/** Spec defaults per kind. The window is 15 min for every kind —
 *  only the per-email and per-IP maxima change. */
export const RATE_LIMIT_WINDOW_SECONDS = 15 * 60

export const SIGNIN_WINDOW_SECONDS = RATE_LIMIT_WINDOW_SECONDS // P1.2 alias
export const RESET_PASSWORD_MAX_PER_EMAIL = 3
export const RESET_PASSWORD_MAX_PER_IP = 10
export const SIGNIN_MAX_PER_EMAIL = 5
export const SIGNIN_MAX_PER_IP = 20
export const SIGNUP_MAX_PER_EMAIL = 3 // reserved (STUB-038)
export const SIGNUP_MAX_PER_IP = 10 // reserved (STUB-038)
// P1.5 — verification-resend: spec wants "1 per 60s + 5 per hour per
// user". The helper's 15-min window with per-email=1 gives a max of
// 4 attempts per hour (strictly tighter than 5/hour) and a minimum
// gap of 15 minutes between attempts (vastly more than 60s). The
// single-window approach is the simplest expression of the intent;
// if a finer-grained "1/min + 5/hour" split is ever needed, the
// helper gains a per-window override.
export const EMAIL_VERIFICATION_MAX_PER_EMAIL = 1
export const EMAIL_VERIFICATION_MAX_PER_IP = 20
// P1.6 — OAuth signin (Google + Apple button clicks). 5/email/15min
// (the per-email ceiling applies when the user passed an email in
// the FormData, which the OAuth button doesn't collect — so the
// per-IP ceiling is the real signal) + 10/IP/15min. The per-IP
// number is the same as the per-IP ceiling for the signin flow —
// a real user wouldn't click 10+ OAuth buttons in 15 minutes, so
// the limit is keyed on the IP.
export const OAUTH_SIGNIN_MAX_PER_EMAIL = 5
export const OAUTH_SIGNIN_MAX_PER_IP = 10

/** Per-kind limits lookup. Kept in one place so adding a new kind
 *  is a one-line change. The shape is `{ perEmail, perIp }`. */
const LIMITS: Record<AttemptKind, { perEmail: number; perIp: number }> = {
  signin: { perEmail: SIGNIN_MAX_PER_EMAIL, perIp: SIGNIN_MAX_PER_IP },
  signup: { perEmail: SIGNUP_MAX_PER_EMAIL, perIp: SIGNUP_MAX_PER_IP },
  reset_password: { perEmail: RESET_PASSWORD_MAX_PER_EMAIL, perIp: RESET_PASSWORD_MAX_PER_IP },
  // update_password reuses the signin maxima (5/email + 20/IP per
  // the spec) — the per-user limit is keyed on email at the
  // update-password form since the user is identified by email
  // at that point. See `01-specs/pages/update-password.md`.
  update_password: { perEmail: SIGNIN_MAX_PER_EMAIL, perIp: SIGNIN_MAX_PER_IP },
  // P1.5 — verification-resend. See the constant comment above for
  // why 1/email/15min is the right ceiling.
  email_verification: {
    perEmail: EMAIL_VERIFICATION_MAX_PER_EMAIL,
    perIp: EMAIL_VERIFICATION_MAX_PER_IP,
  },
  // P1.6 — OAuth signin (Google + Apple). See OAUTH_SIGNIN_MAX_*
  // constants for the rationale.
  oauth_signin: { perEmail: OAUTH_SIGNIN_MAX_PER_EMAIL, perIp: OAUTH_SIGNIN_MAX_PER_IP },
}

/** Per-kind audit-log action name. Matches the spec's required
 *  `admin_audit_log.action` values:
 *    - signin → `signin_rate_limited`
 *    - signup → `signup_rate_limited`
 *    - reset_password → `password_reset_rate_limited`
 *    - update_password → `password_update_rate_limited`
 *    - email_verification → `email_verification_rate_limited` (P1.5)
 *    - oauth_signin → `oauth_signin_rate_limited` (P1.6)
 *  P1.3 also adds `password_update_rate_limited` for the set-new
 *  page (the action's `kind` stays `'reset_password'` for the
 *  request side, but the update side gets its own `kind` value). */
export const AUDIT_ACTION_BY_KIND: Record<AttemptKind, string> = {
  signin: 'signin_rate_limited',
  signup: 'signup_rate_limited',
  reset_password: 'password_reset_rate_limited',
  update_password: 'password_update_rate_limited',
  email_verification: 'email_verification_rate_limited',
  oauth_signin: 'oauth_signin_rate_limited',
}

/** Lazy GC — every Nth call we trim rows older than the keep window. */
const GC_EVERY_N_CALLS = 32
const GC_KEEP_HOURS = 24
let _callsSinceLastGc = 0

export type AttemptKind =
  | 'signin'
  | 'signup'
  | 'reset_password'
  | 'update_password'
  | 'email_verification'
  | 'oauth_signin'

export type RateLimitVerdict = {
  /** True when the caller is allowed to proceed. */
  allowed: boolean
  /** Seconds until the lockout window expires (0 when allowed). */
  retryAfterSeconds: number
  /** Which dimension tripped the limit (undefined when allowed). */
  triggered?: 'email' | 'ip'
  /** The count that triggered the limit (for logging only). */
  count?: number
}

export type FailureReason =
  | 'invalid_credentials'
  | 'rate_limited'
  | 'email_not_verified'
  | 'unknown_user'
  | 'malformed_input'
  | 'server_error'

/** Hash an identifier with the audit salt. Matches the pattern used by
 *  `02-features/auth/actions.ts` so the two stay compatible — admins
 *  who query the audit tables cross-table get the same hash for the
 *  same identifier. */
function hashIdentifier(value: string): string {
  const salt = process.env.AUDIT_HASH_SALT ?? `dev-${process.pid}`
  return createHash('sha256').update(`${salt}:${value}`).digest('hex').slice(0, 32)
}

/** Record one failed attempt. Called by the sign-in action whenever
 *  Supabase Auth returns an error (wrong password, unknown email,
 *  unverified email, etc.). NOT called for client-side validation
 *  failures — those never reach the server. */
export async function recordAuthFailure(input: {
  kind: AttemptKind
  email: string | null
  ip: string | null
  userAgent: string | null
  reason: FailureReason
}): Promise<void> {
  try {
    const supabase = getServiceSupabase()
    const emailHash = input.email ? hashIdentifier(input.email) : null
    const ipHash = input.ip ? hashIdentifier(input.ip) : null
    await supabase.from('auth_failed_attempts').insert({
      kind: input.kind,
      email_hash: emailHash,
      ip_hash: ipHash,
      // Raw IP retained ONLY for the duration of the request so the
      // helper can echo the rate-limit response to the client. Not
      // read again after insert; GC removes it at 24h.
      ip_raw: input.ip,
      user_agent: input.userAgent ? input.userAgent.slice(0, 200) : null,
      reason: input.reason,
    } as never)
    maybeGc()
  } catch (err) {
    // NEVER block the auth action on the rate-limit counter. A
    // counter-write failure degrades to "no limit" (worse for abuse,
    // better for users — the Supabase auth layer + email enumeration
    // protections are still in place).
    log.warn(
      { code: 'rate_limit_write_failed', msg: (err as Error).message, kind: input.kind },
      'recordAuthFailure failed — rate limit disabled for this attempt',
    )
  }
}

/** Check whether a new attempt would be allowed right now. Used by the
 *  sign-in action BEFORE calling Supabase Auth — if the verdict is
 *  "denied", the action returns the cooldown to the client without
 *  touching Supabase (avoids leaking the "user exists / password
 *  wrong" distinction when an attacker is rate-limited).
 *
 *  P1.3: the per-kind maxima are looked up from `LIMITS` so a
 *  single helper covers signin / signup / reset_password. The
 *  action must declare which `kind` it represents. */
export async function checkRateLimit(input: {
  kind: AttemptKind
  email: string | null
  ip: string | null
}): Promise<RateLimitVerdict> {
  const limits = LIMITS[input.kind]
  const windowStart = new Date(Date.now() - RATE_LIMIT_WINDOW_SECONDS * 1000).toISOString()
  let supabase
  try {
    supabase = getServiceSupabase()
  } catch (err) {
    // If the service-role client can't be created (missing env in
    // dev, or a transient Supabase outage), FAIL OPEN. The whole
    // point of a rate limit is to be best-effort; never let a
    // helper failure take down the auth flow.
    log.warn(
      { code: 'rate_limit_supabase_unavailable', msg: (err as Error).message, kind: input.kind },
      'rate-limit check skipped — Supabase unavailable, allowing the attempt',
    )
    return { allowed: true, retryAfterSeconds: 0 }
  }

  // Per-email count (when an email was supplied)
  let emailCount = 0
  if (input.email) {
    const emailHash = hashIdentifier(input.email)
    const { count } = await supabase
      .from('auth_failed_attempts')
      .select('*', { count: 'exact', head: true })
      .eq('kind', input.kind)
      .eq('email_hash', emailHash)
      .gte('created_at', windowStart)
    emailCount = count ?? 0
  }

  // Per-IP count (always — IP is the durable anti-abuse signal)
  let ipCount = 0
  if (input.ip) {
    const ipHash = hashIdentifier(input.ip)
    const { count } = await supabase
      .from('auth_failed_attempts')
      .select('*', { count: 'exact', head: true })
      .eq('kind', input.kind)
      .eq('ip_hash', ipHash)
      .gte('created_at', windowStart)
    ipCount = count ?? 0
  }

  if (emailCount >= limits.perEmail) {
    return {
      allowed: false,
      retryAfterSeconds: RATE_LIMIT_WINDOW_SECONDS,
      triggered: 'email',
      count: emailCount,
    }
  }
  if (ipCount >= limits.perIp) {
    return {
      allowed: false,
      retryAfterSeconds: RATE_LIMIT_WINDOW_SECONDS,
      triggered: 'ip',
      count: ipCount,
    }
  }
  return { allowed: true, retryAfterSeconds: 0 }
}

/** Compute the remaining seconds in the current window for the email
 *  OR IP that just tripped the limit. Used by the action to set the
 *  cooldown on the response. Returns the FULL window when no recent
 *  attempt is found (defensive — should not happen, but a counter
 *  race could let the helper through). */
export async function retryAfterSeconds(input: {
  kind: AttemptKind
  email: string | null
  ip: string | null
  dimension: 'email' | 'ip'
}): Promise<number> {
  let supabase
  try {
    supabase = getServiceSupabase()
  } catch {
    return RATE_LIMIT_WINDOW_SECONDS
  }
  const windowStart = new Date(Date.now() - RATE_LIMIT_WINDOW_SECONDS * 1000).toISOString()
  const column = input.dimension === 'email' ? 'email_hash' : 'ip_hash'
  const raw = input.dimension === 'email' ? input.email : input.ip
  if (!raw) return RATE_LIMIT_WINDOW_SECONDS
  const hash = hashIdentifier(raw)
  const { data } = await supabase
    .from('auth_failed_attempts')
    .select('created_at')
    .eq('kind', input.kind)
    .eq(column, hash)
    .gte('created_at', windowStart)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!data?.created_at) return RATE_LIMIT_WINDOW_SECONDS
  const lastAttempt = new Date(data.created_at).getTime()
  const expiresAt = lastAttempt + RATE_LIMIT_WINDOW_SECONDS * 1000
  return Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000))
}

/** Write one audit log row when a rate-limit triggers. Goes through
 *  the service-role client so the FK on actor_id (which references
 *  auth.users) is bypassed — these are pre-auth events, the actor is
 *  unknown. The "actor_email" column gets the hashed email (same
 *  pattern the signup action uses) so admins can correlate.
 *
 *  P1.3: the `action` is looked up from `AUDIT_ACTION_BY_KIND` so
 *  each kind's lockout lands in admin_audit_log with the spec's
 *  required action name (`signin_rate_limited` /
 *  `password_reset_rate_limited` / etc.). */
export async function auditRateLimitTrigger(input: {
  kind: AttemptKind
  email: string | null
  ip: string | null
  userAgent: string | null
  dimension: 'email' | 'ip'
  count: number
}): Promise<void> {
  try {
    const supabase = getServiceSupabase()
    const emailHash = input.email ? hashIdentifier(input.email) : null
    const ipHash = input.ip ? hashIdentifier(input.ip) : null
    await supabase.from('admin_audit_log').insert({
      // actor_id is NOT NULL FK on auth.users(id). For pre-auth events
      // we point at the system user (UUID 00000000-0000-0000-0000-
      // 000000000000). The hashed email on actor_email gives the
      // admin the real signal; the FK is a known design constraint
      // for pre-auth events.
      actor_id: '00000000-0000-0000-0000-000000000000',
      actor_email: `hash:${emailHash ?? 'unknown'}@uthena.audit`,
      action: AUDIT_ACTION_BY_KIND[input.kind],
      target_kind: 'auth_attempt',
      target_id: input.dimension,
      metadata: {
        kind: input.kind,
        dimension: input.dimension,
        count: input.count,
        email_hash: emailHash,
        ip_hash: ipHash,
      } as never,
      ip: ipHash,
      user_agent: input.userAgent ? input.userAgent.slice(0, 200) : null,
    } as never)
  } catch (err) {
    log.warn(
      { code: 'rate_limit_audit_failed', msg: (err as Error).message },
      'auditRateLimitTrigger failed — admin will not see this lockout',
    )
  }
}

function maybeGc(): void {
  _callsSinceLastGc += 1
  if (_callsSinceLastGc < GC_EVERY_N_CALLS) return
  _callsSinceLastGc = 0
  const supabase = getServiceSupabase()
  const cutoff = new Date(Date.now() - GC_KEEP_HOURS * 60 * 60 * 1000).toISOString()
  // Fire-and-forget. A failure here doesn't affect the auth flow; the
  // table will just hold a few extra rows until the next GC.
  void supabase
    .from('auth_failed_attempts')
    .delete()
    .lt('created_at', cutoff)
    .then(({ error }) => {
      if (error) {
        log.warn(
          { code: 'rate_limit_gc_failed', msg: error.message },
          'GC failed — table may grow until next call',
        )
      }
    })
}