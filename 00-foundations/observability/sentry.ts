// Sentry seam — env-gated captureError for the error boundaries
// (app/error.tsx and every per-route error.tsx). This is the call-site
// contract that ships in P2.11; the actual Sentry SDK wiring (server /
// client / edge init, source maps, release tracking, `sendDefaultPii:
// false`, `beforeSend` scrubber, tracesSampleRate, etc.) ships in PH18
// — see `04-platform/observability/README.md` and PHASES.md P18.1.
//
// Why a seam now (P2.11) and the SDK later (PH18):
//   - The P2.11 acceptance criterion calls for "friendly error pages,
//     Sentry capture (once Phase 18 wires it)." The "once PH18 wires it"
//     carve-out means the SDK is intentionally not in this tick.
//   - But the call sites (every error.tsx file) need a stable API to
//     wire against NOW so they don't have to be rewritten when the SDK
//     lands. Shipping the seam first is the same pattern as P2.9
//     (PostHog/Gorse/SES) and P2.5 (Stripe).
//   - When PH18 lands, the seam flips from `'log'` to `'sentry'` mode
//     without any call-site change.
//
// Why this module is `import 'server-only'`:
//   - `app/global-error.tsx` is the root-layout replacement boundary.
//     Per error-global.md: "No Sentry client-side error reporting (the
//     Sentry SDK is in the root layout; this page does not import it)."
//     global-error.tsx therefore does NOT call captureError — the root
//     layout is gone, pino is gone, and the only signal left is the
//     opaque ERR-{id} the user sees. PH18's browser Sentry SDK attaches
//     a global handler that picks up unhandled client exceptions.
//   - The boundaries that DO call captureError (`app/error.tsx` and the
//     per-route error.tsx files) are server-rendered during the normal
//     render tree, so `import 'server-only'` is safe for them.
//
// PII safety (the AGENTS.md §2 contract — "No PII in logs. Ever."):
//   - We NEVER log error.message (often contains URLs, user input,
//     PII-flavored fragments from the failing query)
//   - We NEVER log error.stack (contains file paths + variable values)
//   - We DO log error.name (exception class — safe)
//   - We DO log error.digest (Next.js's opaque hash — safe)
//   - We DO log the errId (the human-quotable reference — safe)
//   - We DO log surface (component that fired the capture) + actor
//     (if provided by the caller) — both are call-site-controlled

import 'server-only'

import { getEnv } from '@foundations/env'
import { loggerFor } from '@foundations/log/pino'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Identifier of who was using the app when the error fired. The
 *  caller passes this from the boundary's session check; never include
 *  the user's email or any other PII (the type is intentionally narrow
 *  so a PII-shaped value won't type-check). */
export type SentryActor =
  | { kind: 'anon' }
  | { kind: 'user'; user_id: string }
  | { kind: 'admin'; user_id: string; role: 'admin' | 'super_admin' }
  | { kind: 'system' }

/** Caller-supplied context for a captureError call. Surface identifies
 *  the boundary that fired (e.g. `'app.error'`, `'app.account.error'`).
 *  Tags are flat string-only key/value pairs — Sentry will index them. */
export type SentryContext = {
  /** Which surface fired (e.g. `'app.error'`, `'app.account.error'`).
   *  Becomes a Sentry tag. */
  surface: string
  /** The opaque ERR-{id} reference the user sees. Becomes a Sentry tag
   *  so support staff can correlate the user's quote with the Sentry
   *  event. */
  errId: string
  /** Optional actor (anon/user/admin/system). Already PII-shaped types
   *  (only IDs + roles, never emails). */
  actor?: SentryActor
  /** Additional tags — flat string-only. Will be added to the Sentry
   *  event as `tags.*`. Anything not safe to surface in support tooling
   *  should NOT be added here (e.g. never add `email`, `request_body`,
   *  `user_agent`, `ip`). */
  tags?: Record<string, string>
}

/** Result of captureError. `mode` reports which transport handled it —
 *  `'log'` = structured pino log only (PH18 wires `'sentry'`); `'skipped'`
 *  = the caller asked us not to capture (e.g. a non-error code path
 *  triggered the helper by mistake). */
export type SentryCaptureResult =
  | { ok: true; mode: 'log' | 'sentry'; id: string | null }
  | { ok: false; mode: 'skipped'; reason: string }

// ---------------------------------------------------------------------------
// Env gate
// ---------------------------------------------------------------------------

const log = loggerFor({ component: 'observability.sentry' })

/** True iff SENTRY_DSN is set. The SDK init in PH18 will read the same
 *  flag; the env gate here is intentionally simple (a non-empty DSN)
 *  so the seam doesn't drift from PH18's gate. */
export function isSentryConfigured(): boolean {
  return Boolean(getEnv().SENTRY_DSN)
}

// ---------------------------------------------------------------------------
// Capture
// ---------------------------------------------------------------------------

/** Capture an error to Sentry. In PH18, this calls
 *  `Sentry.captureException(error, { tags, user })`. In P2.11 (this
 *  tick), it writes the PII-safe payload to the structured pino log
 *  so the event is at least captured end-to-end. The function never
 *  throws — a failed capture must never break the error boundary. */
export function captureError(error: Error & { digest?: string }, ctx: SentryContext): SentryCaptureResult {
  // Defensive: never let a capture throw. The boundary is the last line
  // of UX — if captureError itself blows up, the user gets a worse
  // experience than no capture.
  try {
    if (!ctx.errId) {
      // Caller bug — without an errId we can't correlate the user's
      // quote with the Sentry event. Don't capture, return skipped.
      return { ok: false, mode: 'skipped', reason: 'missing errId' }
    }

    const tags: Record<string, string> = {
      'uthena.err_id': ctx.errId,
      'uthena.surface': ctx.surface,
      ...ctx.tags,
    }

    if (isSentryConfigured()) {
      // PH18 wires the SDK. Until then, the configured-DSN path is the
      // same as the unconfigured path — we log structurally and return
      // `mode: 'log'`. The interface contract is what the call sites
      // depend on; the SDK wiring is what PH18 changes.
      log.warn(
        {
          event: 'sentry.configured_but_sdk_not_wired',
          errId: ctx.errId,
          surface: ctx.surface,
          actor: ctx.actor,
        },
        'Sentry DSN configured but the SDK ships in PH18; falling back to structured log',
      )
      log.error(
        {
          event: 'server.error',
          errId: ctx.errId,
          surface: ctx.surface,
          'error.name': error.name,
          'error.digest': error.digest,
          actor: ctx.actor,
          tags,
        },
        `error: ${error.name}`,
      )
      return { ok: true, mode: 'log', id: null }
    }

    // Unconfigured: write to the structured log only.
    log.error(
      {
        event: 'server.error',
        errId: ctx.errId,
        surface: ctx.surface,
        'error.name': error.name,
        'error.digest': error.digest,
        actor: ctx.actor,
        tags,
      },
      `error: ${error.name}`,
    )
    return { ok: true, mode: 'log', id: null }
  } catch (captureErr) {
    // Capture-itself-broke. Never propagate. The user still sees the
    // friendly error page; we drop one log line and move on.
    // eslint-disable-next-line no-console
    console.error('[sentry-seam] captureError threw:', captureErr)
    return { ok: false, mode: 'skipped', reason: 'capture threw' }
  }
}