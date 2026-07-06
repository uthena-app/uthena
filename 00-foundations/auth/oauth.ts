// OAuth provider configuration (P1.6 — Google + Apple).
//
// What lives here:
//   - The provider list (id + label + monogram + brand color hint).
//   - The `getOAuthEnabledProviders()` env-gated lookup that the
//     auth pages and the server action both call.
//
// What does NOT live here:
//   - The provider credentials (client ID + secret for Google,
//     Services ID + key for Apple). Those live in the Supabase
//     project's Authentication → Providers config. Our env has only
//     the boolean `OAUTH_GOOGLE_ENABLED` / `OAUTH_APPLE_ENABLED`
//     toggles that control whether the buttons are visible on
//     /login + /signup.
//
// Why a separate module (and not just env reads in the page):
//   - The action needs the same list of "enabled providers" the page
//     uses, so a forged POST that names a non-enabled provider gets
//     rejected server-side. Centralizing the list keeps the action
//     and the UI in sync.
//   - Adding a new provider (e.g. GitHub) is a one-line addition to
//     `PROVIDERS` + a new `OAUTH_GITHUB_ENABLED` env var. No call
//     site changes.

import { getEnv } from '@foundations/env'

/** The OAuth providers Uthena supports. Adding a new provider is a
 *  one-line addition here plus a new boolean env var. The order
 *  is the order the buttons appear on /login + /signup. */
export type OAuthProviderId = 'google' | 'apple'

export type OAuthProvider = {
  id: OAuthProviderId
  /** The button label, e.g. "Continue with Google". */
  label: string
  /** A short 1-char brand glyph (G, ) used in the button. Inline
   *  SVG would be nicer but adds bundle weight — the monogram keeps
   *  the button tiny. */
  monogram: string
}

/** Static provider metadata. The order here is the order the
 *  buttons render. Keep alphabetical or by user-preference signal. */
const PROVIDERS: Record<OAuthProviderId, OAuthProvider> = {
  google: { id: 'google', label: 'Continue with Google', monogram: 'G' },
  apple: { id: 'apple', label: 'Continue with Apple', monogram: '' },
}

/** Return the list of OAuth providers that are currently enabled in
 *  the environment. Pure (no I/O) — safe to call from RSC, server
 *  actions, and client components. The returned array preserves the
 *  `PROVIDERS` insertion order.
 *
 *  The `getOAuthEnabledProviders` function is the single source of
 *  truth for "which providers ship on /login + /signup". The auth
 *  action also consults this function to reject forged POSTs that
 *  name a non-enabled provider (defense in depth — the env vars are
 *  display-toggles, not security controls, but the action shouldn't
 *  initiate an OAuth flow to a non-configured provider regardless). */
export function getOAuthEnabledProviders(): OAuthProvider[] {
  const env = getEnv()
  const enabled: OAuthProvider[] = []
  if (env.OAUTH_GOOGLE_ENABLED) enabled.push(PROVIDERS.google)
  if (env.OAUTH_APPLE_ENABLED) enabled.push(PROVIDERS.apple)
  return enabled
}

/** Predicate: is the given provider ID currently enabled? Used by
 *  the action to reject forged POSTs. The `id is OAuthProviderId`
 *  narrowing only applies when the provider is enabled — when
 *  disabled, we still return `false` so the action knows to reject. */
export function isOAuthProviderEnabled(id: string): id is OAuthProviderId {
  const env = getEnv()
  if (id === 'google') return env.OAUTH_GOOGLE_ENABLED
  if (id === 'apple') return env.OAUTH_APPLE_ENABLED
  return false
}

/** Get a single provider's metadata by ID. Returns null if the
 *  provider doesn't exist (defensive — the action uses this to
 *  look up the provider config for the audit log). */
export function getOAuthProvider(id: OAuthProviderId): OAuthProvider {
  return PROVIDERS[id]
}
