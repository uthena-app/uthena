// consentEffects.ts — pure-effect helpers for the consent bridge.
//
// Lives outside the React component so they're testable without a
// DOM (the existing test env is `node`, no jsdom). The React island
// is a thin wrapper that calls these on mount + registers the
// listener; the helpers own the actual SDK calls.

import { initPostHog, setPostHogConsent } from '@foundations/analytics/posthog'
import { CONSENT_CHANGED_EVENT, type ConsentChangedDetail } from './consentEvents'
import type { ConsentState } from '@foundations/gdpr/consent.types'

/** Apply the resolved consent state at page-mount time. Idempotent:
 *  re-invoking on an already-initialized PostHog is safe. */
export function applyInitialConsent(initial: ConsentState): void {
  initPostHog()
  setPostHogConsent(initial.analytics === true)
}

/** Install the consent-changed listener and return the
 *  unsubscribe function. Caller owns the lifecycle (a React useEffect
 *  calls this once + invokes the returned cleanup on unmount).
 *
 *  Returns a noop cleanup on the server (where `window` is undefined)
 *  so the helper is safe to import from universal modules. */
export function subscribeConsentChanged(
  handler: (detail: ConsentChangedDetail) => void,
): () => void {
  if (typeof window === 'undefined') return () => {}
  function onEvent(event: Event) {
    const detail = (event as CustomEvent<ConsentChangedDetail>).detail
    if (detail) handler(detail)
  }
  window.addEventListener(CONSENT_CHANGED_EVENT, onEvent)
  return () => window.removeEventListener(CONSENT_CHANGED_EVENT, onEvent)
}

/** Default handler for the consent-changed event. Flips PostHog
 *  opt-in based on the new analytics flag. Defensive against
 *  malformed detail payloads. */
export function defaultConsentChangedHandler(detail: ConsentChangedDetail): void {
  setPostHogConsent(detail.analytics === true)
}
