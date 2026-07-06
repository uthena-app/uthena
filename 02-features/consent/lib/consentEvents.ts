// consentEvents — module-scoped constants + helpers for cross-component
// consent-change notifications.
//
// Pattern mirrors `02-features/search/searchEvents.ts`. The user
// toggles a cookie category in either the CookiePreferencesForm or the
// CookieConsentBanner — both are client islands. The
// `<ConsentAwareAnalytics>` bridge listens for the resulting event so
// it can flip the PostHog opt-in/out state without prop-drilling.
//
// Why a named window CustomEvent instead of a shared context:
// - The form and the banner are siblings in the layout, not nested.
//   A shared React context would require lifting state into a wrapper
//   client component (more JS shipped + hydration cost).
// - A named event lets the bridge own its own state + listener
//   lifecycle (one place to add/remove the handler on mount/unmount).
// - Future surfaces (admin tools, a "reset all preferences" command
//   palette, etc.) can dispatch the same event without coupling.

export const CONSENT_CHANGED_EVENT = 'uthena:consent:changed'

export type ConsentChangedDetail = {
  /** Always `true` — the schema locks essential cookies on. The form
   *  + banner don't expose a toggle for it, and the action rejects
   *  any input that tries to set it false. The detail shape keeps
   *  the field for symmetry with the consent_log row. */
  essential: true
  analytics: boolean
  marketing: boolean
}

/** Fire a consent-changed notification. Safe to call from any client
 *  component. A no-op on the server (where `window` doesn't exist)
 *  so this helper is importable from universal modules without a
 *  `typeof window` guard at every call site.
 *
 *  PII safety: the detail shape is just booleans — no email, no IP,
 *  no user identifier. The durable row write (`consent_log`) and the
 *  audit-log row (`consent_self_update`) are the source of truth for
 *  who-changed-what; this event is a same-tick client-side hint so
 *  the PostHog SDK can flip opt-out without waiting on a server
 *  round-trip. */
export function dispatchConsentChanged(detail: ConsentChangedDetail): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent<ConsentChangedDetail>(CONSENT_CHANGED_EVENT, { detail }))
}
