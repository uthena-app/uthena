// Verify-email landing page (P1.5).
//
// The page handles FOUR entry shapes — the union covers every URL
// Supabase or our own forms can send here:
//
//   1. `?token_hash=...&type=email` — direct OTP-style link (Supabase's
//      `verifyOtp` flow). The page server-side exchanges the token,
//      then renders success or expired based on the result.
//   2. `?type=signup` — the auth callback just exchanged a PKCE code
//      for a session and redirected here. The user is already
//      verified (the code exchange is what set `email_confirmed_at`).
//      We render the success state and auto-redirect to `next` (or
//      `/library` by default) after 2s.
//   3. No params — three sub-cases:
//        a) Signed in + verified → already verified. Render success
//           and auto-redirect (defensive — the page is rarely reached
//           in this state, but a `router.refresh` after verification
//           could land here).
//        b) Signed in + unverified → "Check your inbox" landing with
//           the resend button (so the user can request a fresh link
//           without re-signing-up).
//        c) Not signed in → "Check your inbox" landing, no resend
//           button (per spec — the resend action requires a session;
//           an anonymous visitor could only trigger enumeration if
//           the form accepted an email field).
//
// Per spec §Security: the page NEVER reveals whether an email is
// already verified. The expired state is shown for any token failure
// (never existed / expired / already used / already verified) so an
// attacker with a leaked link can't tell the difference.

import type { Metadata } from 'next'
import Link from 'next/link'
import { getSessionUser } from '@foundations/auth/guards'
import { getServerSupabase } from '@foundations/data/supabase'
import { Button } from '@foundations/ui/primitives/Button'
import { sensitivePageMetadata } from '@foundations/metadata'
import { loggerFor } from '@foundations/log/pino'
import { ResendVerificationForm } from '@features/auth/ResendVerificationForm'
import { VerifyEmailRedirect } from '@features/auth/VerifyEmailRedirect'
import { safeNext } from '@foundations/auth/safe-next'
import authStyles from '../login/auth.module.css'
import styles from './verify-email.module.css'

const log = loggerFor({ component: 'verify-email' })

export const metadata: Metadata = sensitivePageMetadata({
  title: 'Verify your email',
  description: 'Verify your email address to finish creating your Uthena account.',
  path: '/verify-email',
})

type PageState =
  | { kind: 'success'; redirectTo: string }
  | { kind: 'expired'; canResend: boolean; redirectTo: string }
  | { kind: 'check_inbox'; canResend: boolean }

export default async function VerifyEmailPage({
  searchParams,
}: {
  // Next.js 15 searchParams is a Promise — must be awaited (per the
  // typed-page-params change). The optional chaining + fallback
  // handles the no-params case.
  searchParams: Promise<{ token_hash?: string; type?: string; next?: string }>
}) {
  const params = await searchParams
  const tokenHash = typeof params.token_hash === 'string' ? params.token_hash : null
  const linkType = typeof params.type === 'string' ? params.type : null
  // P1.5 — `?next=` pass-through. The signup action embeds it in
  // the email's redirectTo, the auth callback preserves it through
  // the PKCE exchange, and we validate via `safeNext()` before
  // using it for the auto-redirect. Falls back to `/library`.
  const redirectTo = safeNext(params.next) ?? '/library'

  let state: PageState

  if (tokenHash && linkType === 'email') {
    // Direct OTP-style link — exchange the token server-side. The
    // response determines success vs expired. We deliberately do
    // NOT distinguish "invalid" from "expired" from "already used"
    // in the user-facing copy (spec §Security: "Email enumeration
    // protection").
    const supabase = await getServerSupabase()
    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: 'email',
    })
    if (error) {
      log.warn(
        { code: 'verify_email_failed', msg: error.message },
        'verifyOtp failed — rendering expired state',
      )
      const user = await getSessionUser()
      state = { kind: 'expired', canResend: user != null, redirectTo }
    } else {
      state = { kind: 'success', redirectTo }
    }
  } else if (linkType === 'signup') {
    // Came from the auth callback after a PKCE exchange. The
    // callback has already set `email_confirmed_at` on the user.
    state = { kind: 'success', redirectTo }
  } else {
    // No token in the URL. Sub-case on the session: signed in +
    // verified → success (defensive redirect path); signed in +
    // unverified → check_inbox with resend; not signed in →
    // check_inbox without resend.
    const user = await getSessionUser()
    if (user && user.email && (await isEmailVerified())) {
      state = { kind: 'success', redirectTo }
    } else if (user) {
      state = { kind: 'check_inbox', canResend: true }
    } else {
      state = { kind: 'check_inbox', canResend: false }
    }
  }

  return (
    <main className={authStyles.page}>
      <div className={authStyles.card}>
        {state.kind === 'success' && (
          <div className={styles.body} data-testid="verify-success">
            <VerifyEmailRedirect to={state.redirectTo} />
            <div className={styles.icon} aria-hidden="true">
              <svg
                width="40"
                height="40"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M20 6L9 17l-5-5" />
              </svg>
            </div>
            <h1 className={styles.h1}>Email verified</h1>
            <p className={styles.lede}>
              Taking you to your library&hellip;
            </p>
            <Link href={state.redirectTo} className={styles.cta}>
              <Button fullWidth>Go to your library</Button>
            </Link>
          </div>
        )}

        {state.kind === 'expired' && (
          <div className={styles.body} data-testid="verify-expired">
            <div className={`${styles.icon} ${styles.iconExpired}`} aria-hidden="true">
              <svg
                width="40"
                height="40"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
            </div>
            <h1 className={styles.h1}>This verification link has expired or already been used</h1>
            <p className={styles.lede}>
              Check your inbox for the most recent verification email. We can send a new one.
            </p>
            {state.canResend ? (
              <ResendVerificationForm />
            ) : (
              <Link href="/login" className={styles.cta}>
                <Button fullWidth variant="secondary">
                  Sign in
                </Button>
              </Link>
            )}
          </div>
        )}

        {state.kind === 'check_inbox' && (
          <div className={styles.body} data-testid="verify-check-inbox">
            <div className={`${styles.icon} ${styles.iconPending}`} aria-hidden="true">
              <svg
                width="40"
                height="40"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                <polyline points="22,6 12,13 2,6" />
              </svg>
            </div>
            <h1 className={styles.h1}>Check your inbox</h1>
            <p className={styles.lede}>
              {state.canResend
                ? 'Open the verification link we sent you on this device. Need a new one? Use the button below.'
                : 'Open the verification link we sent you on this device to finish creating your account.'}
            </p>
            {state.canResend ? (
              <ResendVerificationForm />
            ) : (
              <Link href="/login" className={styles.cta}>
                <Button fullWidth variant="secondary">
                  Back to sign in
                </Button>
              </Link>
            )}
          </div>
        )}
      </div>
    </main>
  )
}

/**
 * Read `auth.users.email_confirmed_at` via the service-role client.
 * Used on the no-token entry path to decide between `success`
 * (already verified → redirect to /library) and `check_inbox`
 * (still unverified → show the resend form).
 *
 * Falls open to "not verified" on any error so a transient Supabase
 * issue doesn't lock the user out of their resend button. The auth
 * callback path handles the actual verification; this read is just
 * a UX hint.
 */
async function isEmailVerified(): Promise<boolean> {
  try {
    const supabase = await getServerSupabase()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    return Boolean(user?.email_confirmed_at)
  } catch {
    return false
  }
}