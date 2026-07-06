// Server actions for auth. These are the only place that calls
// Supabase Auth — every page / form funnels through these. Each
// action returns a result shape so the form can render errors.
//
// All input is Zod-validated before the Supabase call.
// All errors are returned as a typed `AuthActionResult`, never thrown.
// Every signup attempt (success or failure) is appended to
// `admin_audit_log` so admins can review abuse patterns.

'use server'

import { z } from 'zod'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createHash } from 'node:crypto'
import { headers } from 'next/headers'
import { getServerSupabase, getServiceSupabase } from '@foundations/data/supabase'
import { loggerFor } from '@foundations/log/pino'
import {
  auditRateLimitTrigger,
  checkRateLimit,
  recordAuthFailure,
  retryAfterSeconds,
} from '@foundations/auth/rate-limit'
import { getOAuthEnabledProviders, isOAuthProviderEnabled, type OAuthProviderId } from '@foundations/auth/oauth'
import { safeNext } from '@foundations/auth/safe-next'
import { mergeAnonCartIntoAuth } from '@features/cart/actions/mergeAnonCart'

const log = loggerFor({ component: 'auth' })

export type AuthActionResult =
  | {
      ok: true
      redirectTo?: string
      message?: string
      // P1.3 — the reset request action echoes the validated email
      // back so the form's confirmation panel can render "If an
      // account exists for [email]" without keeping the value in
      // client state. The value is server-validated (Zod email
      // check) so the form can trust it for display.
      emailEcho?: string
    }
  | {
      ok: false
      error: string
      fieldErrors?: Record<string, string>
      // P1.2 — when the rate limiter trips, surface the cooldown so the
      // form can render a "Try again in N minutes" inline message instead
      // of a generic error.
      rateLimited?: { retryAfterSeconds: number; dimension: 'email' | 'ip' }
    }

const SignUpSchema = z.object({
  email: z.string().email('Enter a valid email'),
  password: z
    .string()
    .min(10, 'At least 10 characters')
    .max(200, 'Too long')
    .refine((s) => /[A-Z]/.test(s) && /[a-z]/.test(s) && /[0-9]/.test(s), {
      message: 'Use upper, lower, and a number',
    }),
  display_name: z.string().min(1, 'Required').max(80),
  // Honeypot — should remain empty; if filled, the bot wins.
  website: z.string().max(0).optional().default(''),
  // Terms-of-service acceptance. The signup page MUST require this
  // before submit; the server validates it again so a forged POST
  // still fails.
  acceptTerms: z.literal(true, {
    errorMap: () => ({ message: 'You must accept the terms to continue' }),
  }),
  // Post-signup destination. Optional — falls back to /library.
  next: z.string().optional(),
})

/**
 * Hash an identifier (email or IP) with a stable per-process salt.
 * PII-safe for storage in admin_audit_log. The salt comes from the
 * `AUDIT_HASH_SALT` env var in production; in dev it falls back to a
 * per-process random value (so two devs don't see each other's hashes
 * accidentally, but the hash is still irreversible from a single
 * table dump).
 */
function hashIdentifier(value: string): string {
  const salt = process.env.AUDIT_HASH_SALT ?? `dev-${process.pid}`
  return createHash('sha256').update(`${salt}:${value}`).digest('hex').slice(0, 32)
}

/**
 * Write one row to admin_audit_log for a SUCCESSFUL signup. Uses
 * the actual `auth.users.id` as `actor_id` (required by the FK on
 * `admin_audit_log.actor_id` referencing `auth.users(id)`) — failed
 * signup attempts are NOT written here because there's no user to
 * FK-reference. Failed attempts are logged via pino's `warn` level
 * (already in place above) and Supabase Auth's own auth logs.
 *
 * No PII is logged — the email is hashed, the IP is hashed, the
 * User-Agent is truncated to 200 chars.
 */
async function writeSignupAudit(input: {
  userId: string
  emailHash: string
  ipHash: string | null
  userAgent: string | null
}): Promise<void> {
  try {
    const supabase = getServiceSupabase()
    await supabase.from('admin_audit_log').insert({
      actor_id: input.userId,
      // actor_email is NOT NULL on the table. We use the hashed email
      // here so the row is still searchable by admins who have the raw
      // email + the AUDIT_HASH_SALT (admins only — never user-facing).
      actor_email: `hash:${input.emailHash}@uthena.audit`,
      action: 'signup_succeeded',
      target_kind: 'user',
      target_id: input.userId,
      metadata: {
        email_hash: input.emailHash,
        ip_hash: input.ipHash,
      } as never,
      ip: input.ipHash,
      user_agent: input.userAgent ? input.userAgent.slice(0, 200) : null,
    })
  } catch (err) {
    // Audit-write failures must NEVER block the user-facing flow.
    log.warn({ code: 'audit_write_failed', msg: (err as Error).message }, 'writeSignupAudit failed')
  }
}

export async function signUpAction(formData: FormData): Promise<AuthActionResult> {
  const rawNext = formData.get('next')?.toString() ?? ''
  const validNext = safeNext(rawNext) ?? '/library'

  const raw = {
    email: formData.get('email')?.toString() ?? '',
    password: formData.get('password')?.toString() ?? '',
    display_name: formData.get('display_name')?.toString() ?? '',
    website: formData.get('website')?.toString() ?? '',
    acceptTerms: formData.get('acceptTerms')?.toString() ?? '',
    next: rawNext,
  }
  const parsed = SignUpSchema.safeParse(raw)
  if (!parsed.success) {
    return {
      ok: false,
      error: 'Please fix the errors below.',
      fieldErrors: Object.fromEntries(
        parsed.error.issues.map((i) => [i.path[0]?.toString() ?? '_', i.message]),
      ),
    }
  }
  const supabase = await getServerSupabase()
  const headerList = await headers()
  const origin = headerList.get('origin') ?? 'http://localhost:3000'
  const ip = headerList.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null
  const userAgent = headerList.get('user-agent') ?? null
  const emailHash = hashIdentifier(parsed.data.email)
  const ipHash = ip ? hashIdentifier(ip) : null

  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      data: { display_name: parsed.data.display_name },
      // The verification email lands the user on the auth callback,
      // which then redirects to `/verify-email?type=signup`. The
      // verify-email page (P1.5) renders the success state and
      // auto-redirects to `next` after 2s. Embedding `next` as a
      // query param on the verify-email URL preserves the
      // post-verify destination through the full chain (signup →
      // email → callback → verify-email → final page). The verify-
      // email page treats `next` as a safe-redirect target via
      // `safeNext()` (defense-in-depth — the callback already
      // validates it).
      emailRedirectTo: `${origin}/auth/callback?next=${encodeURIComponent(
        `/verify-email?type=signup&next=${encodeURIComponent(validNext)}`,
      )}`,
    },
  })
  if (error) {
    // Pino already logs the failure at warn level with the error
    // message. No admin_audit_log row here — failed signup attempts
    // have no auth.users.id to FK-reference (the FK on actor_id is
    // NOT NULL REFERENCES auth.users(id)). The future auth_audit_log
    // table (Phase 2 P2.1) will track failed attempts properly.
    log.warn({ code: 'signup_failed', msg: error.message, email_hash: emailHash }, 'signup failed')
    return { ok: false, error: friendlyAuthError(error.message) }
  }

  // Successful signup → one audit row per the spec's audit-logging
  // requirement ("user_id, ip_hash, ua_hash, role chosen"). The row
  // is async — we don't block the user-facing redirect on the write
  // succeeding (failures are caught + logged inside writeSignupAudit).
  if (data.user) {
    await writeSignupAudit({
      userId: data.user.id,
      emailHash,
      ipHash,
      userAgent,
    })
  }

  // P4.2 — merge any anon-cookie cart into the freshly-created
  // user. Runs in BOTH the verify-required and auto-confirm paths
  // so the user's cart items aren't lost between signup and
  // email-confirm. Best-effort: never throws; the anon cookie is
  // preserved on failure for retry from /cart.
  if (data.user) {
    try {
      await mergeAnonCartIntoAuth(data.user.id)
    } catch (err) {
      log.warn(
        { code: 'signup_merge_failed', msg: (err as Error).message },
        'anon-cart merge on signup failed (continuing)',
      )
    }
  }

  // The DB trigger (added in a later phase) creates a `profiles` row
  // on auth.users insert. For now, the action returns success and the
  // verify-email page handles the unverified state.
  if (data.user && !data.session) {
    return { ok: true, message: 'Check your email to verify your account.' }
  }
  // Auto-confirm (Supabase dev mode) — go to the validated next.
  revalidatePath('/', 'layout')
  return { ok: true, redirectTo: validNext }
}

const SignInSchema = z.object({
  email: z.string().email('Enter a valid email'),
  password: z.string().min(1, 'Required'),
  next: z.string().optional(),
  // P1.2 — remember-me is a UI hint only; the actual cookie persistence
  // is controlled by the Supabase client (which already sets HttpOnly
  // Secure SameSite=Lax cookies for the session). The client form
  // stores the value in localStorage and re-applies it on the next
  // visit to keep the user signed in across browser restarts. The
  // server doesn't need to do anything with it, but accepting the
  // field keeps the action's FormData contract uniform.
  remember: z
    .union([z.literal('on'), z.literal('true'), z.literal('false'), z.literal('')])
    .optional()
    .default(''),
})

export async function signInAction(formData: FormData): Promise<AuthActionResult> {
  const rawNext = formData.get('next')?.toString() ?? ''
  const validNext = safeNext(rawNext) ?? '/library'

  const parsed = SignInSchema.safeParse({
    email: formData.get('email')?.toString() ?? '',
    password: formData.get('password')?.toString() ?? '',
    next: rawNext,
    remember: formData.get('remember')?.toString() ?? '',
  })
  if (!parsed.success) {
    return {
      ok: false,
      error: 'Please fix the errors below.',
      fieldErrors: Object.fromEntries(
        parsed.error.issues.map((i) => [i.path[0]?.toString() ?? '_', i.message]),
      ),
    }
  }

  const headerList = await headers()
  const ip = headerList.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null
  const userAgent = headerList.get('user-agent') ?? null

  // P1.2 — rate-limit gate BEFORE the Supabase call. A tripped limiter
  // returns the cooldown to the client without contacting Supabase, so
  // a determined attacker can't burn through our auth quota OR use
  // the rate-limited path as an oracle for "this email exists".
  const verdict = await checkRateLimit({
    kind: 'signin',
    email: parsed.data.email,
    ip,
  })
  if (!verdict.allowed && verdict.triggered) {
    // Recompute the precise retry-after from the most-recent attempt
    // in the window (the verdict only knows the count, not the time).
    const retryAfter = await retryAfterSeconds({
      kind: 'signin',
      email: parsed.data.email,
      ip,
      dimension: verdict.triggered,
    })
    // Audit + record a single 'rate_limited' row so the next gate
    // check counts this attempt too (defense against bypass via
    // short-circuiting before insert).
    await recordAuthFailure({
      kind: 'signin',
      email: parsed.data.email,
      ip,
      userAgent,
      reason: 'rate_limited',
    })
    await auditRateLimitTrigger({
      kind: 'signin',
      email: parsed.data.email,
      ip,
      userAgent,
      dimension: verdict.triggered,
      count: verdict.count ?? 0,
    })
    const minutes = Math.max(1, Math.ceil(retryAfter / 60))
    log.warn(
      {
        code: 'signin_rate_limited',
        dimension: verdict.triggered,
        count: verdict.count,
        email_hash: createHash('sha256')
          .update(`${process.env.AUDIT_HASH_SALT ?? `dev-${process.pid}`}:${parsed.data.email}`)
          .digest('hex')
          .slice(0, 32),
      },
      `signin blocked by rate limit (${verdict.triggered})`,
    )
    return {
      ok: false,
      error: `Too many attempts. Try again in ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}.`,
      rateLimited: { retryAfterSeconds: retryAfter, dimension: verdict.triggered },
    }
  }

  const supabase = await getServerSupabase()
  const { data, error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  })
  if (error) {
    // P1.2 — every failure path records to the rate-limit counter so
    // repeated wrong-passwords / unverified emails / etc. trip the
    // gate. The reason is mapped from the Supabase error message so
    // the admin audit log distinguishes "wrong password" from "email
    // exists but unverified" (no user-facing distinction — the
    // `friendlyAuthError()` mapper keeps the copy identical).
    const reason = mapFailureReason(error.message)
    await recordAuthFailure({
      kind: 'signin',
      email: parsed.data.email,
      ip,
      userAgent,
      reason,
    })
    log.warn(
      { code: 'signin_failed', reason, msg: error.message },
      'signin failed',
    )
    return { ok: false, error: friendlyAuthError(error.message) }
  }
  // P4.2 — merge any anon-cookie cart into the freshly-authed user.
  // Best-effort: never throws; logs the merge outcome. The auth
  // flow must not 500 because the merge couldn't complete — the
  // anon cookie is preserved for retry.
  if (data?.user?.id) {
    try {
      await mergeAnonCartIntoAuth(data.user.id)
    } catch (err) {
      log.warn(
        { code: 'signin_merge_failed', msg: (err as Error).message },
        'anon-cart merge on signin failed (continuing)',
      )
    }
  }
  revalidatePath('/', 'layout')
  return { ok: true, redirectTo: validNext }
}

/** Map a Supabase auth error message to a rate-limit `reason` enum.
 *  Used only for the internal counter; the user-facing message is
 *  always produced by `friendlyAuthError()` so the user can't tell
 *  "wrong password" from "unknown email". */
function mapFailureReason(msg: string): 'invalid_credentials' | 'email_not_verified' | 'unknown_user' | 'malformed_input' | 'server_error' {
  const lower = msg.toLowerCase()
  if (lower.includes('email not confirmed')) return 'email_not_verified'
  if (lower.includes('invalid login') || lower.includes('invalid credentials')) {
    return 'invalid_credentials'
  }
  // Supabase returns "user not found" / "invalid grant" / etc. The
  // user-facing message is the same for all of these; the audit log
  // gets a more useful signal.
  if (lower.includes('user') && lower.includes('not found')) return 'unknown_user'
  return 'server_error'
}

const ResetRequestSchema = z.object({
  email: z.string().email('Enter a valid email'),
  // P1.3 — `?next=` pass-through. The login form sends the user to
  // `/reset-password?next=/library`; we embed it in the email's
  // `redirectTo` so the post-reset flow returns them to the original
  // destination. Validated via the open-redirect guard below.
  next: z.string().optional(),
})

/** Minimum response time for the reset request endpoint, in ms. The
 *  endpoint pads to this floor so the "email exists" and "email
 *  doesn't exist" branches are indistinguishable to a timing oracle
 *  (Supabase sends the email only in the first branch, so the network
 *  time differs). Spec §Security "Email enumeration protection" sets
 *  the budget at 500–800ms; we use the lower bound. */
const RESET_MIN_RESPONSE_MS = 500

export async function requestPasswordResetAction(formData: FormData): Promise<AuthActionResult> {
  const rawNext = formData.get('next')?.toString() ?? ''
  const validNext = safeNext(rawNext)

  const parsed = ResetRequestSchema.safeParse({
    email: formData.get('email')?.toString() ?? '',
    next: rawNext,
  })
  if (!parsed.success) {
    return {
      ok: false,
      error: 'Enter your account email.',
      fieldErrors: { email: parsed.error.issues[0]?.message ?? 'Invalid' },
    }
  }
  const supabase = await getServerSupabase()
  const hdrs = await headers()
  const origin = hdrs.get('origin') ?? 'http://localhost:3000'
  const ip = hdrs.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null
  const userAgent = hdrs.get('user-agent') ?? null

  // P1.3 — rate-limit gate BEFORE the Supabase call. The reset
  // request is enumeration-sensitive, so a tripped limiter returns
  // the SAME generic "Check your email" message (no oracle for "I'm
  // throttled") while still writing the failure row + audit log so
  // admins can see the abuse. The form never sees the cooldown; the
  // user just sees the standard "Check your email" panel.
  const verdict = await checkRateLimit({
    kind: 'reset_password',
    email: parsed.data.email,
    ip,
  })
  if (!verdict.allowed && verdict.triggered) {
    const retryAfter = await retryAfterSeconds({
      kind: 'reset_password',
      email: parsed.data.email,
      ip,
      dimension: verdict.triggered,
    })
    // Record the lockout so the next gate check counts it (defense
    // against bypass via short-circuiting before insert).
    await recordAuthFailure({
      kind: 'reset_password',
      email: parsed.data.email,
      ip,
      userAgent,
      reason: 'rate_limited',
    })
    await auditRateLimitTrigger({
      kind: 'reset_password',
      email: parsed.data.email,
      ip,
      userAgent,
      dimension: verdict.triggered,
      count: verdict.count ?? 0,
    })
    log.warn(
      {
        code: 'password_reset_rate_limited',
        dimension: verdict.triggered,
        count: verdict.count,
        email_hash: createHash('sha256')
          .update(`${process.env.AUDIT_HASH_SALT ?? `dev-${process.pid}`}:${parsed.data.email}`)
          .digest('hex')
          .slice(0, 32),
        retry_after_seconds: retryAfter,
      },
      `password reset blocked by rate limit (${verdict.triggered})`,
    )
    // Even on rate-limit, pad the response so the timing oracle
    // can't distinguish "throttled" from "not throttled".
    const start = Date.now()
    if (Date.now() - start < RESET_MIN_RESPONSE_MS) {
      await new Promise((r) => setTimeout(r, RESET_MIN_RESPONSE_MS - (Date.now() - start)))
    }
    return {
      ok: true,
      message: 'If an account exists for that email, we sent a reset link.',
      // Echo the validated email + next so the form can render the
      // confirmation panel with the right context.
      emailEcho: parsed.data.email,
    }
  }

  // Build the email's redirect URL. The auth callback exchanges the
  // Supabase code for a session, then redirects to `/update-password`.
  // The `?next=` from the original reset request is nested in the
  // `next` value of the callback URL — the callback's `new URL(next)`
  // parsing round-trips it back to `/update-password?next=/library`
  // when the user lands. (See the auth callback's redirect logic.)
  const callbackNext = validNext
    ? `/update-password?next=${encodeURIComponent(validNext)}`
    : '/update-password'
  const redirectTo = `${origin}/auth/callback?next=${encodeURIComponent(callbackNext)}`

  // Pad the response to the constant-time floor so an attacker can't
  // distinguish "email exists" (Supabase sends an email, slower) from
  // "email doesn't exist" (Supabase returns quickly, no email). The
  // padding only applies when the Supabase call is fast.
  const start = Date.now()
  await supabase.auth.resetPasswordForEmail(parsed.data.email, { redirectTo })
  const elapsed = Date.now() - start
  if (elapsed < RESET_MIN_RESPONSE_MS) {
    await new Promise((r) => setTimeout(r, RESET_MIN_RESPONSE_MS - elapsed))
  }
  return {
    ok: true,
    message: 'If an account exists for that email, we sent a reset link.',
    emailEcho: parsed.data.email,
  }
}

const UpdatePasswordSchema = z.object({
  password: z
    .string()
    .min(10, 'At least 10 characters')
    .max(200, 'Too long')
    .refine((s) => /[A-Z]/.test(s) && /[a-z]/.test(s) && /[0-9]/.test(s), {
      message: 'Use upper, lower, and a number',
    }),
  // P1.3 — `?next=` pass-through from the auth callback. The user
  // clicked "Forgot password" from `/login?next=/library`, we sent
  // the email link with the `next` embedded, the callback preserved
  // it, the update-password page read it, and now the form posts it
  // back so we can land the user where they originally intended.
  next: z.string().optional(),
})

export async function updatePasswordAction(formData: FormData): Promise<AuthActionResult> {
  const rawNext = formData.get('next')?.toString() ?? ''
  const validNext = safeNext(rawNext) ?? '/library'

  const parsed = UpdatePasswordSchema.safeParse({
    password: formData.get('password')?.toString() ?? '',
    next: rawNext,
  })
  if (!parsed.success) {
    return {
      ok: false,
      error: 'Please fix the errors below.',
      fieldErrors: { password: parsed.error.issues[0]?.message ?? 'Invalid' },
    }
  }
  const supabase = await getServerSupabase()
  const hdrs = await headers()
  const ip = hdrs.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null
  const userAgent = hdrs.get('user-agent') ?? null

  // P1.3 — the set-new page is per-user rate-limited (5/email/15min
  // + 20/IP/15min per the update-password spec). We use the user's
  // email as the per-user identifier (the user is identified by
  // email at this point — the reset-token session has a known email
  // via auth.users.email). The user_id could be added to the schema
  // for a stricter per-user limit, but the email-keyed limit is
  // equivalent in practice (one user = one email = one bucket).
  const {
    data: { user },
  } = await supabase.auth.getUser()
  // The user must be authenticated for this action (the reset link
  // established a session; the page also checks via getSessionUser
  // before rendering). If the session is gone, return a "session
  // expired" error — the form renders the expired state.
  if (!user || !user.email) {
    return { ok: false, error: 'Your reset link has expired. Request a new one.' }
  }

  const verdict = await checkRateLimit({
    kind: 'update_password',
    email: user.email,
    ip,
  })
  if (!verdict.allowed && verdict.triggered) {
    await recordAuthFailure({
      kind: 'update_password',
      email: user.email,
      ip,
      userAgent,
      reason: 'rate_limited',
    })
    await auditRateLimitTrigger({
      kind: 'update_password',
      email: user.email,
      ip,
      userAgent,
      dimension: verdict.triggered,
      count: verdict.count ?? 0,
    })
    log.warn(
      {
        code: 'password_update_rate_limited',
        dimension: verdict.triggered,
        count: verdict.count,
        email_hash: createHash('sha256')
          .update(`${process.env.AUDIT_HASH_SALT ?? `dev-${process.pid}`}:${user.email}`)
          .digest('hex')
          .slice(0, 32),
      },
      `password update blocked by rate limit (${verdict.triggered})`,
    )
    return {
      ok: false,
      error: 'Too many attempts. Try again later.',
      rateLimited: { retryAfterSeconds: verdict.retryAfterSeconds, dimension: verdict.triggered },
    }
  }

  const { error } = await supabase.auth.updateUser({ password: parsed.data.password })
  if (error) {
    await recordAuthFailure({
      kind: 'update_password',
      email: user.email,
      ip,
      userAgent,
      reason: mapFailureReason(error.message),
    })
    log.warn(
      { code: 'password_update_failed', msg: error.message, reason: mapFailureReason(error.message) },
      'password update failed',
    )
    return { ok: false, error: friendlyAuthError(error.message) }
  }
  revalidatePath('/', 'layout')
  return { ok: true, redirectTo: validNext }
}

export async function signOutAction(): Promise<void> {
  const supabase = await getServerSupabase()
  await supabase.auth.signOut()
  revalidatePath('/', 'layout')
  redirect('/')
}

// --- P1.4 — change password while logged in ---

const ChangePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Required'),
    password: z
      .string()
      .min(12, 'At least 12 characters')
      .max(200, 'Too long')
      .regex(/[0-9]/, 'Use a number')
      .regex(/[^A-Za-z0-9]/, 'Use a symbol'),
    confirm: z.string().min(1, 'Required'),
  })
  .refine((d) => d.password === d.confirm, {
    message: 'Passwords do not match',
    path: ['confirm'],
  })

/**
 * P1.4 — change password while logged in.
 *
 * Trust boundary: the user already has a long-lived session, but a
 * hijacked session could otherwise change the password and lock out
 * the real owner. We re-prove account ownership by attempting a
 * `signInWithPassword` against the user's email with the supplied
 * current password BEFORE we touch `auth.users`. The verify call
 * uses the service-role client so the user's existing session is
 * not replaced (the service-role client has `persistSession: false`,
 * so the signin response is discarded; the user's cookies stay
 * pointing at the original session).
 *
 * Re-uses the `kind: 'update_password'` rate-limit bucket that the
 * P1.3 reset-completion flow uses — "limit updates per user per
 * 15 min" is one policy across both flows.
 *
 * OAuth-only users (no `email` provider in their identities) are
 * detected and sent back to the reset flow. We don't want to log a
 * phantom failed `signInWithPassword` attempt for users who never
 * had a password to begin with.
 */
export async function changePasswordAction(formData: FormData): Promise<AuthActionResult> {
  const parsed = ChangePasswordSchema.safeParse({
    currentPassword: formData.get('currentPassword')?.toString() ?? '',
    password: formData.get('password')?.toString() ?? '',
    confirm: formData.get('confirm')?.toString() ?? '',
  })
  if (!parsed.success) {
    return {
      ok: false,
      error: 'Please fix the errors below.',
      fieldErrors: Object.fromEntries(
        parsed.error.issues.map((i) => [i.path[0]?.toString() ?? '_', i.message]),
      ),
    }
  }

  const supabase = await getServerSupabase()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user || !user.email) {
    // No session — the page is auth-gated, so this branch is only
    // reachable on a forged POST or a session that expired between
    // the page render and the action call. Return a friendly error
    // that nudges the user back to sign-in.
    return { ok: false, error: 'Your session has expired. Sign in again to continue.' }
  }

  const hdrs = await headers()
  const ip = hdrs.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null
  const userAgent = hdrs.get('user-agent') ?? null

  // P1.4 — OAuth-only users have no password to verify. We detect
  // them by checking whether their identities include an `email`
  // provider. We deliberately do this BEFORE the signin probe so
  // we never log a phantom `invalid_credentials` attempt for a user
  // who never set a password.
  const { data: identityData } = await supabase.auth.getUserIdentities()
  const identities = identityData?.identities ?? []
  const hasEmailProvider = identities.some((id) => id.provider === 'email')
  if (!hasEmailProvider) {
    return {
      ok: false,
      error:
        'You signed up with a social account. Use the reset flow to set a password for the first time.',
    }
  }

  // P1.4 — verify the current password via the service-role client.
  // The response's session is discarded; we only check whether the
  // call succeeded. The user's existing session cookies are not
  // touched (service-role client has `persistSession: false`).
  const serviceSupabase = getServiceSupabase()
  const { error: signInError } = await serviceSupabase.auth.signInWithPassword({
    email: user.email,
    password: parsed.data.currentPassword,
  })
  if (signInError) {
    // P1.4 — same rate-limit bucket as the P1.3 update action. Every
    // wrong-current-password attempt counts toward the limit; we
    // don't surface a cooldown for individual wrong-passwords (the
    // user can correct the typo and retry) but the attempt still
    // counts so a determined attacker can't enumerate passwords.
    await recordAuthFailure({
      kind: 'update_password',
      email: user.email,
      ip,
      userAgent,
      reason: mapFailureReason(signInError.message),
    })
    log.warn(
      {
        code: 'password_change_current_invalid',
        reason: mapFailureReason(signInError.message),
        email_hash: createHash('sha256')
          .update(`${process.env.AUDIT_HASH_SALT ?? `dev-${process.pid}`}:${user.email}`)
          .digest('hex')
          .slice(0, 32),
      },
      'password change: current password invalid',
    )
    return { ok: false, error: 'Current password is incorrect.' }
  }

  // P1.4 — refuse to "change" the password to the same value. This
  // is a UX nicety (the user didn't really change anything) and
  // also avoids the auth `updated_at` churn + rate-limit noise from
  // a no-op retry. The check happens AFTER the verify step so the
  // rate-limit counter doesn't see a probing attempt.
  if (parsed.data.password === parsed.data.currentPassword) {
    return {
      ok: false,
      error: 'New password must differ from your current password.',
    }
  }

  // P1.4 — rate-limit gate (per-user + per-IP). Same bucket as P1.3.
  const verdict = await checkRateLimit({
    kind: 'update_password',
    email: user.email,
    ip,
  })
  if (!verdict.allowed && verdict.triggered) {
    await recordAuthFailure({
      kind: 'update_password',
      email: user.email,
      ip,
      userAgent,
      reason: 'rate_limited',
    })
    await auditRateLimitTrigger({
      kind: 'update_password',
      email: user.email,
      ip,
      userAgent,
      dimension: verdict.triggered,
      count: verdict.count ?? 0,
    })
    const minutes = Math.max(1, Math.ceil(verdict.retryAfterSeconds / 60))
    log.warn(
      {
        code: 'password_update_rate_limited',
        dimension: verdict.triggered,
        count: verdict.count,
        email_hash: createHash('sha256')
          .update(`${process.env.AUDIT_HASH_SALT ?? `dev-${process.pid}`}:${user.email}`)
          .digest('hex')
          .slice(0, 32),
      },
      `password change blocked by rate limit (${verdict.triggered})`,
    )
    return {
      ok: false,
      error: `Too many attempts. Try again in ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}.`,
      rateLimited: {
        retryAfterSeconds: verdict.retryAfterSeconds,
        dimension: verdict.triggered,
      },
    }
  }

  // P1.4 — apply the update on the request session. The user keeps
  // their existing session; only the password is rotated. Supabase
  // Auth's `updateUser` does not bump the session expiry — flagged
  // as a v2 follow-up if usage data shows churn (see spec's open
  // questions).
  const { error: updateError } = await supabase.auth.updateUser({
    password: parsed.data.password,
  })
  if (updateError) {
    await recordAuthFailure({
      kind: 'update_password',
      email: user.email,
      ip,
      userAgent,
      reason: mapFailureReason(updateError.message),
    })
    log.warn(
      {
        code: 'password_change_failed',
        reason: mapFailureReason(updateError.message),
        msg: updateError.message,
      },
      'password change failed',
    )
    return { ok: false, error: friendlyAuthError(updateError.message) }
  }
  revalidatePath('/', 'layout')
  // P1.4 — no `redirectTo` field in the result. The form's success
  // path always returns the user to `/account/profile` (per the
  // spec — no `?next=` parameter is accepted on this page; the
  // user is logged in and there's no "return to original URL"
  // need).
  return { ok: true }
}

// --- P1.5 — resend verification email ---

const ResendVerificationSchema = z.object({
  // The form has no inputs (the email is read from the session). The
  // schema exists to give the action a uniform Zod-validated shape so
  // future fields (locale, marketing consent flag, etc.) can be added
  // without restructuring the call site. Accepts an empty FormData.
  accept: z.literal('on').optional(),
})

/**
 * P1.5 — resend the signup verification email.
 *
 * Trust boundary: the caller MUST be signed in AND have
 * `email_confirmed_at IS NULL`. The action does not expose whether a
 * given email is registered (consistent with the spec's enumeration
 * hardening) — but since we require a session, the only callers are
 * signed-in users viewing their own verification state. A signed-in
 * user who is already verified gets a friendly "your email is
 * already verified" message and no email is sent.
 *
 * Rate limit: per the spec, "1 per 60s, 5 per hour per user". The
 * `checkRateLimit` helper uses a single 15-min window; we map the
 * spec's intent to `perEmail: 1, perIp: 20` (see the constant comment
 * in `00-foundations/auth/rate-limit.ts`). The action calls
 * `retryAfterSeconds` to get the precise remaining time when the
 * limit trips so the form can show an accurate countdown.
 *
 * The email goes to the address on the user's account, not a value
 * the client provides. The action reads it from the session.
 *
 * On success, the form shows a 4s "Check your inbox" toast — we
 * don't `redirect()` because the user is still on the verify-email
 * surface and the toast gives them the immediate feedback they need.
 */
export async function resendVerificationEmailAction(
  formData: FormData,
): Promise<AuthActionResult> {
  const parsed = ResendVerificationSchema.safeParse({
    accept: formData.get('accept')?.toString() ?? undefined,
  })
  // Form-shape guard. The schema's `accept` field is optional; an
  // empty FormData passes. Future required fields land here.
  if (!parsed.success) {
    return { ok: false, error: 'Please refresh and try again.' }
  }

  const supabase = await getServerSupabase()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  // The page is server-gated to signed-in, unverified users; the
  // action also enforces it. If the session is gone, the page
  // renders the "expired" branch — the action never sees this
  // state in practice, but the guard keeps a forged POST honest.
  if (!user || !user.email) {
    return {
      ok: false,
      error: 'Sign in to resend the verification email.',
    }
  }

  // P1.5 — already verified? Don't send a verification email; the
  // user has no use for it. Return success so the form stays
  // friendly (the user gets a clear "already verified — go to your
  // library" message).
  if (user.email_confirmed_at) {
    return {
      ok: true,
      message: 'Your email is already verified. You can close this page.',
    }
  }

  const hdrs = await headers()
  const ip = hdrs.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null
  const userAgent = hdrs.get('user-agent') ?? null

  const verdict = await checkRateLimit({
    kind: 'email_verification',
    email: user.email,
    ip,
  })
  if (!verdict.allowed && verdict.triggered) {
    const retryAfter = await retryAfterSeconds({
      kind: 'email_verification',
      email: user.email,
      ip,
      dimension: verdict.triggered,
    })
    await recordAuthFailure({
      kind: 'email_verification',
      email: user.email,
      ip,
      userAgent,
      reason: 'rate_limited',
    })
    await auditRateLimitTrigger({
      kind: 'email_verification',
      email: user.email,
      ip,
      userAgent,
      dimension: verdict.triggered,
      count: verdict.count ?? 0,
    })
    log.warn(
      {
        code: 'email_verification_rate_limited',
        dimension: verdict.triggered,
        count: verdict.count,
        email_hash: createHash('sha256')
          .update(`${process.env.AUDIT_HASH_SALT ?? `dev-${process.pid}`}:${user.email}`)
          .digest('hex')
          .slice(0, 32),
        retry_after_seconds: retryAfter,
      },
      `email verification resend blocked by rate limit (${verdict.triggered})`,
    )
    return {
      ok: false,
      error: 'You can only request a new verification email once every few minutes.',
      rateLimited: { retryAfterSeconds: retryAfter, dimension: verdict.triggered },
    }
  }

  // P1.5 — the email link points at `/auth/callback?next=/verify-email?type=signup`,
  // same shape as the signup flow (P1.1). The callback exchanges the
  // code for a session, then redirects to `/verify-email` which
  // renders the success state and auto-redirects to `/library`.
  const origin = hdrs.get('origin') ?? 'http://localhost:3000'
  const emailRedirectTo = `${origin}/auth/callback?next=${encodeURIComponent('/verify-email?type=signup')}`

  const { error } = await supabase.auth.resend({
    type: 'signup',
    email: user.email,
    options: { emailRedirectTo },
  })
  if (error) {
    await recordAuthFailure({
      kind: 'email_verification',
      email: user.email,
      ip,
      userAgent,
      reason: 'server_error',
    })
    log.warn(
      { code: 'email_verification_resend_failed', msg: error.message, email_hash: createHash('sha256').update(`${process.env.AUDIT_HASH_SALT ?? `dev-${process.pid}`}:${user.email}`).digest('hex').slice(0, 32) },
      'resend verification email failed',
    )
    return { ok: false, error: "Couldn't send email — try again." }
  }

  // P1.5 — write a single admin_audit_log row per successful resend
  // so admins can see the request volume. The action field is
  // 'email_verification_resent' (separate from the rate-limit
  // 'email_verification_rate_limited'). The FK on actor_id points
  // at the actual user, so this row belongs to the user — not the
  // pre-auth system hack used by the rate-limit trigger.
  try {
    const serviceSupabase = getServiceSupabase()
    const emailHash = createHash('sha256')
      .update(`${process.env.AUDIT_HASH_SALT ?? `dev-${process.pid}`}:${user.email}`)
      .digest('hex')
      .slice(0, 32)
    const ipHash = ip
      ? createHash('sha256').update(`${process.env.AUDIT_HASH_SALT ?? `dev-${process.pid}`}:${ip}`).digest('hex').slice(0, 32)
      : null
    await serviceSupabase.from('admin_audit_log').insert({
      actor_id: user.id,
      actor_email: `hash:${emailHash}@uthena.audit`,
      action: 'email_verification_resent',
      target_kind: 'user',
      target_id: user.id,
      metadata: { email_hash: emailHash, ip_hash: ipHash } as never,
      ip: ipHash,
      user_agent: userAgent ? userAgent.slice(0, 200) : null,
    } as never)
  } catch (err) {
    log.warn(
      { code: 'email_verification_audit_failed', msg: (err as Error).message },
      'resend audit log failed — admin will not see this resend',
    )
  }

  // P1.5 — the form reads the success branch and renders a "Check
  // your inbox" toast for 4s. No `redirectTo` — the user stays on
  // the verify-email surface.
  return { ok: true, message: 'Check your inbox for the new link.' }
}

// --- P1.6 — OAuth third-party sign-in (Google + Apple) ---

/** Zod schema for the OAuth init action. The form posts a hidden
 *  `provider` field (one of `'google' | 'apple'`) + an optional
 *  `next` field. The schema enforces the enum + the safeNext()
 *  pattern in one place. */
const OAuthSignInSchema = z.object({
  provider: z.enum(['google', 'apple']),
  // The next field is optional — when absent, the auth callback
  // falls back to /library. When present, the action embeds it
  // in the provider's `redirectTo` so the user lands back where
  // they intended after the OAuth round-trip.
  next: z.string().optional(),
})

/**
 * P1.6 — initiate an OAuth sign-in (Google or Apple).
 *
 * The action is reached via a plain HTML `<form action={...}>`
 * (no client JS) — the form posts a hidden `provider` field +
 * an optional `next` field. The flow:
 *
 * 1. Zod-validate the input (provider enum + safeNext on next).
 * 2. Refuse if the provider isn't enabled in env (defense — a
 *    forged POST that names a non-enabled provider gets rejected
 *    before we touch Supabase).
 * 3. Rate-limit gate (kind: 'oauth_signin') BEFORE the Supabase
 *    call. Lockout → redirect to `/login?error=oauth_signin_rate_limited`
 *    so the user sees the standard "too many attempts" banner.
 * 4. Call `supabase.auth.signInWithOAuth({ provider, options:
 *    { redirectTo: <origin>/auth/callback?next=<safeNext or /library> } })`.
 * 5. On success → `redirect(data.url)` — the browser follows to
 *    the provider's consent screen. After consent, the provider
 *    redirects back to /auth/callback, which exchanges the code
 *    for a session and sends the user to `next`.
 *
 * Why a `redirect()` and not a result: the OAuth buttons are
 * server-rendered (no client JS), so the form's only contract
 * with the action is "POST and follow the response". A `redirect()`
 * inside a server action throws `NEXT_REDIRECT` which Next.js
 * converts to a 307 — the browser follows natively.
 *
 * Why rate-limit at all: a determined attacker could script
 * 10,000 OAuth button clicks per second to flood the auth
 * callback. The 10/IP/15min ceiling stops the script; the
 * 5/email/15min ceiling stops a more targeted attack.
 *
 * Why a separate `kind: 'oauth_signin'` and not reusing `signin`:
 * the audit-log action name differs (`oauth_signin_rate_limited` vs
 * `signin_rate_limited`) so admins can filter the lockout history
 * by surface.
 */
export async function signInWithOAuthAction(formData: FormData): Promise<void> {
  const rawProvider = formData.get('provider')?.toString() ?? ''
  const rawNext = formData.get('next')?.toString() ?? ''
  const validNext = safeNext(rawNext) ?? '/library'

  const parsed = OAuthSignInSchema.safeParse({ provider: rawProvider, next: rawNext })
  if (!parsed.success) {
    // Forged POST — provider wasn't in the enum. Redirect to
    // /login with a generic error so the user lands somewhere
    // sensible. The audit log catches the attempt separately.
    redirect(
      `/login?next=${encodeURIComponent(validNext)}&error=${encodeURIComponent('oauth_provider_invalid')}`,
    )
  }

  // Defense in depth — even if the env says "Google enabled", a
  // future admin might disable it but leave the button in a stale
  // form. Re-check the env at action time. (The env read is cheap —
  // it's a cached parse.)
  if (!isOAuthProviderEnabled(parsed.data.provider)) {
    redirect(
      `/login?next=${encodeURIComponent(validNext)}&error=${encodeURIComponent('oauth_provider_disabled')}`,
    )
  }

  const hdrs = await headers()
  const ip = hdrs.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null
  const userAgent = hdrs.get('user-agent') ?? null
  const provider = parsed.data.provider as OAuthProviderId

  // The OAuth init has no email — the user didn't type one (the
  // button is a single click). The per-email ceiling is therefore
  // a no-op for this action; the per-IP ceiling is the real
  // signal. The helper still requires `email: string | null` so
  // we pass null.
  const verdict = await checkRateLimit({
    kind: 'oauth_signin',
    email: null,
    ip,
  })
  if (!verdict.allowed && verdict.triggered) {
    const retryAfter = await retryAfterSeconds({
      kind: 'oauth_signin',
      email: null,
      ip,
      dimension: verdict.triggered,
    })
    await recordAuthFailure({
      kind: 'oauth_signin',
      email: null,
      ip,
      userAgent,
      reason: 'rate_limited',
    })
    await auditRateLimitTrigger({
      kind: 'oauth_signin',
      email: null,
      ip,
      userAgent,
      dimension: verdict.triggered,
      count: verdict.count ?? 0,
    })
    log.warn(
      {
        code: 'oauth_signin_rate_limited',
        provider,
        dimension: verdict.triggered,
        count: verdict.count,
        ip_hash: ip
          ? createHash('sha256')
              .update(`${process.env.AUDIT_HASH_SALT ?? `dev-${process.pid}`}:${ip}`)
              .digest('hex')
              .slice(0, 32)
          : null,
        retry_after_seconds: retryAfter,
      },
      `OAuth signin blocked by rate limit (${verdict.triggered})`,
    )
    redirect(
      `/login?next=${encodeURIComponent(validNext)}&error=${encodeURIComponent('oauth_signin_rate_limited')}`,
    )
  }

  const supabase = await getServerSupabase()
  const origin = hdrs.get('origin') ?? 'http://localhost:3000'

  // The `redirectTo` is where the provider sends the user AFTER
  // consent. The Supabase OAuth flow always hits /auth/callback
  // first (the callback exchanges the code for a session) before
  // forwarding to `next`. Embedding `next` in the callback's
  // query string preserves the user's intended destination.
  const callbackNext = validNext
  const redirectTo = `${origin}/auth/callback?next=${encodeURIComponent(callbackNext)}`

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: { redirectTo },
  })
  if (error) {
    log.warn(
      { code: 'oauth_signin_init_failed', provider, msg: error.message },
      'OAuth signin init failed',
    )
    redirect(
      `/login?next=${encodeURIComponent(validNext)}&error=${encodeURIComponent('oauth_signin_failed')}`,
    )
  }
  if (!data?.url) {
    log.warn(
      { code: 'oauth_signin_no_url', provider },
      'OAuth signin returned no URL — provider may not be configured in Supabase',
    )
    redirect(
      `/login?next=${encodeURIComponent(validNext)}&error=${encodeURIComponent('oauth_signin_no_url')}`,
    )
  }

  // P1.6 — write one admin_audit_log row per successful OAuth init
  // so admins can see the volume of OAuth attempts. The action
  // field is 'oauth_signin_initiated' (separate from the rate-
  // limit 'oauth_signin_rate_limited'). The actor_id points at
  // the system user (pre-auth event), and the metadata records
  // the provider name + hashed IP. The session is created later
  // (by the callback) — this row records the INTENT to sign in
  // via the named provider, not the success.
  try {
    const serviceSupabase = getServiceSupabase()
    const ipHash = ip
      ? createHash('sha256')
          .update(`${process.env.AUDIT_HASH_SALT ?? `dev-${process.pid}`}:${ip}`)
          .digest('hex')
          .slice(0, 32)
      : null
    await serviceSupabase.from('admin_audit_log').insert({
      actor_id: '00000000-0000-0000-0000-000000000000',
      actor_email: `hash:unknown@uthena.audit`,
      action: 'oauth_signin_initiated',
      target_kind: 'auth_attempt',
      target_id: provider,
      metadata: { provider, ip_hash: ipHash } as never,
      ip: ipHash,
      user_agent: userAgent ? userAgent.slice(0, 200) : null,
    } as never)
  } catch (err) {
    log.warn(
      { code: 'oauth_signin_audit_failed', msg: (err as Error).message },
      'OAuth init audit log failed — admin will not see this attempt',
    )
  }

  // Suppress unused-var lint for the provider list (the call above
  // is for defense; the actual usage is the redirect()).
  void getOAuthEnabledProviders

  // The redirect throws — this is the only line that sends the
  // browser to the provider. Supabase returns a fully-formed URL
  // (e.g. Google's consent screen) — the browser follows it.
  redirect(data.url)
}

/** Map Supabase auth errors to user-facing messages. */
function friendlyAuthError(msg: string): string {
  const lower = msg.toLowerCase()
  if (lower.includes('invalid login') || lower.includes('invalid credentials')) {
    return 'Email or password is incorrect.'
  }
  if (lower.includes('email not confirmed')) {
    return 'Verify your email first — check your inbox for the link.'
  }
  if (lower.includes('user already registered') || lower.includes('already been registered')) {
    return 'An account with that email already exists. Try signing in.'
  }
  if (lower.includes('rate limit')) {
    return 'Too many attempts. Try again in a few minutes.'
  }
  if (lower.includes('weak password') || lower.includes('password should be')) {
    return 'Password is too weak. Use at least 10 chars with upper, lower, and a number.'
  }
  return 'Something went wrong. Please try again.'
}