// Public auth pages. Server components that compose the client forms.

import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { SignInForm } from '@features/auth/AuthForms'
import { getSessionUser } from '@foundations/auth/guards'
import { getOAuthEnabledProviders } from '@foundations/auth/oauth'
import { sensitivePageMetadata } from '@foundations/metadata'
import { safeNext } from '@foundations/auth/safe-next'
import styles from './auth.module.css'

// P0.21 — `noindex` so the auth surface isn't indexed.
export const metadata: Metadata = sensitivePageMetadata({
  title: 'Sign in',
  description: 'Sign in to your Uthena account — your library, orders, subscriptions, and downloads.',
  path: '/login',
})

// P1.6 — friendly error message for the OAuth round-trip. The
// `signInWithOAuthAction` redirects back to /login?error=<key> when
// the OAuth init fails or the rate-limit trips. This map turns the
// internal key into copy the user can read. The keys are stable
// (the action's URL contract); adding a new key is a one-line
// addition here.
const OAUTH_ERROR_MESSAGES: Record<string, string> = {
  oauth_provider_invalid:
    "That sign-in method isn't available. Try another option below.",
  oauth_provider_disabled:
    "That sign-in method isn't currently enabled. Try another option below.",
  oauth_signin_rate_limited:
    'Too many sign-in attempts. Please try again in a few minutes.',
  oauth_signin_failed: "We couldn't start the sign-in flow. Please try again.",
  oauth_signin_no_url:
    "The sign-in provider isn't configured yet. Please contact support.",
  // P1.9 — the auth callback handler redirects here with the
  // generic `oauth_failed` key for every failure mode
  // (rate-limited / provider error / exchange failed / no code /
  // replay attempt). Per spec we never echo the provider's raw
  // error to the user, so this single friendly message covers all
  // five. The user's intended `next=` is preserved separately.
  oauth_failed: "We couldn't complete sign-in. Please try again.",
  // OAuth provider returned an error (e.g. user denied consent on
  // Google's consent screen). The message is whatever the provider
  // sent; we prefix it so the user knows where it came from.
}

function resolveOAuthError(raw: string | undefined): string | null {
  if (!raw) return null
  // Known internal keys have a fixed message.
  if (Object.prototype.hasOwnProperty.call(OAUTH_ERROR_MESSAGES, raw)) {
    return OAUTH_ERROR_MESSAGES[raw] ?? null
  }
  // Unknown values: the action may have re-thrown a provider
  // error message verbatim (Supabase returns the provider's text
  // when the user denies consent). Show the raw value with a
  // "Sign-in failed:" prefix so the user knows it's not a Uthena
  // system error.
  return `Sign-in failed: ${raw}`
}

// P1.2 — already-logged-in users skip the form. We send them to the
// `?next=` target when valid, otherwise the canonical post-login
// destination (/library). The redirect happens server-side so a stale
// "Sign in" CTA doesn't leave the user staring at a form that does
// nothing on submit (Supabase will happily re-issue a session, but
// the UX is jarring — the button just sits there).
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | undefined; error?: string | undefined }>
}) {
  const sp = await searchParams
  const existing = await getSessionUser()
  if (existing) {
    const target = safeNext(sp.next ?? '') ?? '/library'
    redirect(target)
  }
  // P1.6 — read the enabled OAuth providers once at request time.
  // The env read is cached, so this is a single in-memory lookup.
  const enabledProviders = getOAuthEnabledProviders()
  // P1.6 — translate the action's `?error=<key>` to a user-facing
  // message. When the user lands on /login from a redirected OAuth
  // failure, the form shows the message as a top-of-form alert.
  const initialError = resolveOAuthError(sp.error)
  return (
    <main className={styles.page}>
      <div className={styles.card}>
        <SignInForm
          next={sp.next ?? undefined}
          enabledProviders={enabledProviders}
          initialError={initialError ?? undefined}
        />
      </div>
    </main>
  )
}
