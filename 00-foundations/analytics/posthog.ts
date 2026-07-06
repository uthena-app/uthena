// PostHog — client + tracking. Fail-open: if NEXT_PUBLIC_POSTHOG_KEY
// is empty, the client init short-circuits and the tracking helpers
// are no-ops. Analytics is opt-in (PH11 wires the consent gate;
// PH18 may add server-side tracking).
//
// P2.9 ship:
//   - `initPostHog()` — idempotent client init; safe to call multiple times.
//   - `trackEvent(event, props?)` — loose-typed; use when you don't
//     need compile-time safety on the props shape.
//   - `trackTypedEvent<E>(event, props)` — strictly typed; props are
//     validated against the schema for the event and dropped with a
//     `console.warn` if they don't match.
//   - `setPostHogConsent(granted)` — flip opt-in / opt-out based on
//     the user's consent state.
//
// The event catalog (`POSTHOG_EVENTS` + `POSTHOG_EVENT_PROPS`) lives
// in `./events.ts` and is the source of truth for the analytics
// surface. Adding an event is a one-line addition there + a matching
// schema entry. Drift between name and schema fails typecheck via
// the `[E in PostHogEvent]` mapping.

'use client'

import posthog from 'posthog-js'
import { getEnv } from '@foundations/env'
import {
  type PostHogEvent,
  type PostHogEventProps,
  POSTHOG_EVENT_PROPS,
} from './events'

let initialized = false

/** Initialize PostHog on the client. Safe to call multiple times. */
export function initPostHog(): void {
  if (initialized) return
  if (typeof window === 'undefined') return
  const env = getEnv()
  if (!env.NEXT_PUBLIC_POSTHOG_KEY) return
  posthog.init(env.NEXT_PUBLIC_POSTHOG_KEY, {
    api_host: env.NEXT_PUBLIC_POSTHOG_HOST,
    capture_pageview: false, // we capture explicitly after consent (P11)
    capture_pageleave: true,
    opt_out_capturing_by_default: true, // P11 turns this off after consent
    persistence: 'localStorage',
  })
  initialized = true
}

/**
 * Track an event with loose-typed props. Use this when the event
 * isn't in the catalog yet or the props shape is intentionally
 * free-form. For catalog events, prefer `trackTypedEvent<E>`.
 */
export function trackEvent(event: string, props?: Record<string, unknown>): void {
  if (!initialized) return
  if (typeof window === 'undefined') return
  posthog.capture(event, props)
}

/**
 * Track a catalog event with strict props validation. The props
 * shape is checked against `POSTHOG_EVENT_PROPS[event].safeParse()`;
 * a parse failure logs a `console.warn` and drops the event
 * (PostHog is opt-in analytics — never throw on a malformed call).
 *
 * The generic `<E>` is constrained to `PostHogEvent` so the props
 * shape is inferred from the schema at the call site:
 *
 *   trackTypedEvent('catalog_product_viewed', { product_id: '42', slug: 'x' })
 */
export function trackTypedEvent<E extends PostHogEvent>(
  event: E,
  props: PostHogEventProps<E>,
): void {
  const schema = POSTHOG_EVENT_PROPS[event]
  const result = schema.safeParse(props)
  if (!result.success) {
    // eslint-disable-next-line no-console
    console.warn(`[posthog] dropping ${event}: props failed validation`, result.error.flatten())
    return
  }
  trackEvent(event, result.data as Record<string, unknown>)
}

/** Enable / disable capturing based on consent state (PH11 wires this). */
export function setPostHogConsent(granted: boolean): void {
  if (!initialized) return
  if (granted) posthog.opt_in_capturing()
  else posthog.opt_out_capturing()
}