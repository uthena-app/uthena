// ConsentAwareAnalytics.tsx — client island that wires the user's
// cookie-consent state to the PostHog SDK's opt-in / opt-out API.
//
// Why this island exists:
// - P11.1 ships the `/cookie-preferences` form + the consent_log write.
// - P11.2 ships the geo-gated banner + the prior-decision lookup.
// - Neither calls `initPostHog()` or `setPostHogConsent(...)`. PostHog
//   is configured with `opt_out_capturing_by_default: true` at init
//   time, so before this island lands, no analytics fire (the safe
//   default for EU visitors).
//
// What this island does:
// 1. On mount, call `applyInitialConsent(initial)` — initialized the
//    PostHog SDK (idempotent) and applies the server-known consent
//    state from the same RSC round-trip the banner uses (no extra
//    DB read).
// 2. Subscribe to the `uthena:consent:changed` window CustomEvent.
//    When the form or banner fires the event after a successful
//    save, this island flips the PostHog opt-in state on the same
//    tick — the user doesn't have to refresh.
//
// Mount once from the root layout next to `<CookieBannerMount>`.
// The island renders null — pure side-effect.

'use client'

import { useEffect } from 'react'
import {
  applyInitialConsent,
  defaultConsentChangedHandler,
  subscribeConsentChanged,
} from '../lib/consentEffects'
import type { ConsentState } from '@foundations/gdpr/consent.types'

export type ConsentAwareAnalyticsProps = {
  /** The server-known consent state at page-render time. Same shape
   *  as the ConsentState projection `getConsentBannerState().consent`
   *  returns. */
  initial: ConsentState
}

export function ConsentAwareAnalytics({ initial }: ConsentAwareAnalyticsProps) {
  useEffect(() => {
    // Mount-once: applies the resolved consent + subscribes to
    // subsequent changes. `applyInitialConsent` is idempotent (it
    // calls `initPostHog`, which guards re-init via a module flag)
    // and `subscribeConsentChanged` returns the cleanup function
    // the effect MUST invoke on unmount so the listener doesn't
    // outlive the page.
    applyInitialConsent(initial)
    return subscribeConsentChanged(defaultConsentChangedHandler)
    // empty deps: the initial state is the server-known state at
    // SSR time. Subsequent client-driven changes flow through the
    // event listener, not the effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return null
}
