// Auth callback route (P1.9 — email confirm + password reset + OAuth).
//
// Supabase Auth sends users here for THREE flows:
//   1. OAuth provider redirect (Google, Apple) — after the user
//      consents on the provider's screen, the provider redirects
//      back to `/auth/callback?code=...&next=...`.
//   2. Email verification link — `?code=...&next=/verify-email?...`
//   3. Password reset link — `?code=...&next=/update-password?...`
//
// All three flows hand the browser a `?code=...`; the callback
// exchanges it for a session via `supabase.auth.exchangeCodeForSession`,
// then redirects to `next` (validated) or `/library` by default.
//
// Defense layers (per `01-specs/pages/auth-callback.md` §Security):
//   1. Per-IP rate limit — 20 hits / 5 min + 100 hits / 1 h. Prevents
//      code-guessing + replay floods. Counter is the existing
//      `auth_failed_attempts` table (kind='oauth_callback') via the
//      helper in `02-features/auth/callbackRateLimit.ts`.
//   2. Suspicious-pattern detection — > 5 successful flows / IP /
//      10 min → one `admin_audit_log` row with
//      action='oauth_suspicious_activity'.
//   3. Open-redirect guard — `safeNext()` allows only relative paths
//      starting with `/` (no `//evil.com`, no `https://evil.com/x`,
//      no backslash, no encoded slash bypass). Invalid or empty
//      `next` → fallback to `/library`.
//   4. Provider error suppression — never echo the provider's
//      `?error=...` value to the user (the provider's error
//      message can leak state). Log raw server-side for debugging;
//      redirect with a generic `error=oauth_failed`.
//   5. PKCE state validation — handled internally by Supabase's
//      `exchangeCodeForSession`. Invalid state → error (treated
//      as `invalid_code`).
//   6. Code replay — Supabase invalidates the code after first
//      use. "Code already used" returns an error which we redirect
//      as `error=oauth_failed` (no oracle for "was this code valid
//      before?").

import { NextResponse, type NextRequest } from 'next/server'
import { getServerSupabase } from '@foundations/data/supabase'
import { loggerFor } from '@foundations/log/pino'
import {
  auditCallbackEvent,
  CALLBACK_MAX_PER_IP_1HOUR,
  CALLBACK_MAX_PER_IP_5MIN,
  CALLBACK_RATE_LIMIT_WINDOW_1HOUR_SECONDS,
  CALLBACK_RATE_LIMIT_WINDOW_5MIN_SECONDS,
  checkCallbackRateLimit,
  countRecentCallbackSuccesses,
  recordCallbackHit,
  SUSPICIOUS_SUCCESS_THRESHOLD,
  SUSPICIOUS_SUCCESS_WINDOW_SECONDS,
} from '@features/auth/callbackRateLimit'
import { safeNext } from '@foundations/auth/safe-next'

const log = loggerFor({ component: 'auth-callback' })

/** Maximum length of `?next=` we'll consider. Defensive — a 100KB
 *  `next` value is almost certainly malicious. We clamp BEFORE any
 *  other processing so safeNext() can't be tricked into returning a
 *  surprise-valid path from a huge payload. */
const NEXT_MAX_LENGTH = 2000

/** Generic failure key surfaced to `/login`. The login page's
 *  `OAUTH_ERROR_MESSAGES` map translates this into user-facing
 *  copy; we never echo the provider's raw error string. */
const OAUTH_FAILED_ERROR_KEY = 'oauth_failed'

export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  // Clamp `next` length BEFORE any other processing.
  const rawNext = (searchParams.get('next') ?? '').slice(0, NEXT_MAX_LENGTH)
  // Supabase + most providers send `?error=...&error_description=...`
  // when the flow fails. We read the combined `error_description`
  // when present (it carries the human-readable detail the provider
  // wants us to log) and fall back to `error`. We NEVER echo either
  // to the user.
  const errorDescription = searchParams.get('error_description')
  const errorCode = searchParams.get('error')
  const providerError = errorDescription ?? errorCode
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null
  const userAgent = request.headers.get('user-agent') ?? null

  // 1. Per-IP rate limit — runs BEFORE the code exchange so a
  // code-guessing flood can't burn through Supabase Auth quota.
  // Tripped limit → redirect to /login with a generic error
  // (we never echo the lockout window or count to the user).
  const verdict = await checkCallbackRateLimit({ ip })
  if (!verdict.allowed && verdict.triggered) {
    await recordCallbackHit({ ip, userAgent, reason: 'rate_limited' })
    await auditCallbackEvent({
      action: 'oauth_callback_rate_limited',
      ip,
      userAgent,
      count: verdict.count ?? 0,
      metadata: {
        window: verdict.triggered,
        max_per_window:
          verdict.triggered === '5min'
            ? CALLBACK_MAX_PER_IP_5MIN
            : CALLBACK_MAX_PER_IP_1HOUR,
        window_seconds:
          verdict.triggered === '5min'
            ? CALLBACK_RATE_LIMIT_WINDOW_5MIN_SECONDS
            : CALLBACK_RATE_LIMIT_WINDOW_1HOUR_SECONDS,
      },
    })
    log.warn(
      {
        code: 'auth_callback_rate_limited',
        window: verdict.triggered,
        count: verdict.count,
      },
      'auth callback rate-limited',
    )
    return redirectWithOAuthError(origin, rawNext)
  }

  // 2. Provider error — the OAuth provider or email-link flow
  // returned an error. We log the raw value server-side (so an
  // admin can debug) but redirect with a generic key. Echoing
  // the provider's error to the user can leak state (some
  // providers return partial account info, internal scopes, etc.).
  if (providerError) {
    await recordCallbackHit({ ip, userAgent, reason: 'provider_error' })
    log.warn(
      {
        code: 'auth_callback_provider_error',
        provider_error: providerError.slice(0, 200),
      },
      'auth callback: provider returned an error',
    )
    return redirectWithOAuthError(origin, rawNext)
  }

  // 3. No code — malformed callback URL. The user clicked a
  // bookmark, pasted a truncated URL, or an attacker is probing.
  // Count as a hit so the rate-limit window still sees it.
  if (!code) {
    await recordCallbackHit({ ip, userAgent, reason: 'no_code' })
    return redirectWithOAuthError(origin, rawNext)
  }

  // 4. Exchange the code for a session. Supabase validates the
  // PKCE state behind the scenes; invalid state → error. The
  // function also invalidates the code on first use, so a replay
  // attempt surfaces as "code already used" which we treat as
  // `invalid_code`.
  const supabase = await getServerSupabase()
  const { error } = await supabase.auth.exchangeCodeForSession(code)
  if (error) {
    await recordCallbackHit({ ip, userAgent, reason: 'invalid_code' })
    log.warn(
      {
        code: 'auth_callback_exchange_failed',
        msg: error.message.slice(0, 200),
      },
      'auth callback: exchangeCodeForSession failed',
    )
    return redirectWithOAuthError(origin, rawNext)
  }

  // 5. Success — record the success row BEFORE the suspicious-
  // pattern check so the count is current. The row also serves
  // as the aggregate metric ("daily successful OAuth logins by
  // provider") — an admin can run a simple SQL aggregation
  // against `auth_failed_attempts WHERE kind='oauth_callback'
  // AND reason='success' GROUP BY date_trunc('day', created_at)`
  // to recover the spec's required metric without a separate
  // counters table. (We don't have Prometheus wired; this is the
  // simplest production-ready expression of the intent.)
  await recordCallbackHit({ ip, userAgent, reason: 'success' })

  // 6. Suspicious-pattern detection — > 5 successful flows / IP /
  // 10 min → admin audit log warning. Real users don't complete
  // 6 OAuth flows in 10 minutes from one IP; a successful flow
  // at that cadence is either a script or a compromised device.
  const successCount = await countRecentCallbackSuccesses({ ip })
  if (successCount > SUSPICIOUS_SUCCESS_THRESHOLD) {
    await auditCallbackEvent({
      action: 'oauth_suspicious_activity',
      ip,
      userAgent,
      count: successCount,
      metadata: {
        window_seconds: SUSPICIOUS_SUCCESS_WINDOW_SECONDS,
        threshold: SUSPICIOUS_SUCCESS_THRESHOLD,
      },
    })
    log.warn(
      {
        code: 'oauth_suspicious_activity',
        count: successCount,
        threshold: SUSPICIOUS_SUCCESS_THRESHOLD,
        window_seconds: SUSPICIOUS_SUCCESS_WINDOW_SECONDS,
      },
      'suspicious OAuth callback volume detected',
    )
  }

  // 7. Validate `next` and redirect. safeNext() rejects non-relative
  // paths, protocol-relative URLs, encoded-slash bypasses, and
  // backslashes. Invalid or empty `next` → fallback to /library
  // (per spec — the canonical post-login destination).
  const safe = safeNext(rawNext)
  const target = safe ?? '/library'
  return NextResponse.redirect(new URL(target, origin))
}

/** Build the redirect URL for the failure cases. We NEVER echo the
 *  provider's error message or the rate-limit dimension to the user
 *  — both can leak state. The login page's `OAUTH_ERROR_MESSAGES`
 *  map translates the generic `oauth_failed` key into friendly copy.
 *  The user's intended `next` is preserved across the failure so
 *  they don't lose their place. */
function redirectWithOAuthError(origin: string, rawNext: string): NextResponse {
  const safe = safeNext(rawNext) ?? '/library'
  const url = new URL('/login', origin)
  url.searchParams.set('error', OAUTH_FAILED_ERROR_KEY)
  url.searchParams.set('next', safe)
  return NextResponse.redirect(url)
}