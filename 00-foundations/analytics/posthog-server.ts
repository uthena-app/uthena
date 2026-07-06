// posthog-server.ts — server-side PostHog capture. Used by cron jobs
// + server actions that need to fire events without a browser context
// (P4.6 cart_abandoned is the first consumer).
//
// Why a separate file from `posthog.ts`:
// - `posthog.ts` is `'use client'` (PostHog's browser SDK requires
//   `window` + `localStorage`). The server cannot import that file —
//   the bundler would trip on the missing browser globals.
// - This module is the canonical server seam: no `posthog-node` SDK
//   dependency, just a `fetch` to PostHog's public capture endpoint.
//   Keeps the dependency surface minimal; an SDK swap is a single-file
//   change in the future if/when a Node SDK is desired.
//
// Fail-open: if `POSTHOG_PROJECT_API_KEY` is empty (or env disabled
// via `isPosthogServerConfigured() === false`), the helper no-ops
// and logs a one-line warn so the cron operator can see the seam is
// off without the cron erroring. Analytics is opt-in; never block
// a business path on a telemetry side-channel.
//
// PII safety: the helper validates props against `POSTHOG_EVENT_PROPS[E]`
// (the same catalog the client uses) so an event with the wrong shape
// is rejected at the boundary. The validation result is logged at
// debug level (never the props themselves — props may contain PII
// fields that are not in the schema, and the schema's purpose is to
// gate what flows to PostHog, not to leak unknown fields into logs).
//
// Note on `import 'server-only'`: this module is intentionally NOT
// marked with the Next.js `server-only` directive because cron
// scripts (`04-platform/ci/scripts/cron/*.ts`) run under raw Node
// via `tsx` and don't have access to the `server-only` package
// resolution that the Next.js build provides. The file is documented
// as a server-only seam and only imports server-safe APIs (`fetch`,
// `node:crypto`, `@foundations/env`, `@foundations/log/pino`), so
// the build-time guard is redundant. If a future phase needs the
// explicit client-bundle guard, the right path is a per-import
// re-export from a wrapper module — the cron imports the wrapper
// (no `server-only`), the server action imports the inner file
// (with the directive).

import { createHash } from 'node:crypto'
import { getEnv } from '@foundations/env'
import { loggerFor } from '@foundations/log/pino'
import {
  type PostHogEvent,
  type PostHogEventProps,
  POSTHOG_EVENT_PROPS,
  DEFAULT_POSTHOG_HOST,
} from './events'

const log = loggerFor({ component: 'analytics.posthog-server' })

/** The PostHog capture endpoint. EU by default to match the
 *  browser-side seam; env override via `NEXT_PUBLIC_POSTHOG_HOST`
 *  (shared with the client). */
const CAPTURE_PATH = '/capture/'

/** Result of a server-side capture. Mirrors the `posthog.capture`
 *  success/failure contract without leaking the SDK shape. */
export type PosthogServerCaptureResult =
  | { ok: true; status: number }
  | { ok: false; error: string; status?: number }

/** True when the server-side PostHog seam is configured. Reads
 *  `POSTHOG_PROJECT_API_KEY` (the server-side key) but falls back
 *  to `NEXT_PUBLIC_POSTHOG_KEY` so a dev environment with only the
 *  browser key set still works. Both env vars share the same
 *  PostHog project key value; the dual name is purely for
 *  production deployments that want to disable the server seam
 *  without disabling the browser seam (or vice versa). */
export function isPosthogServerConfigured(): boolean {
  const env = getEnv()
  return Boolean(env.POSTHOG_PROJECT_API_KEY || env.NEXT_PUBLIC_POSTHOG_KEY)
}

/** Resolve the API key to use for the server-side capture. Prefers
 *  the dedicated `POSTHOG_PROJECT_API_KEY`; falls back to
 *  `NEXT_PUBLIC_POSTHOG_KEY` for dev parity. */
function resolveApiKey(): string {
  const env = getEnv()
  return env.POSTHOG_PROJECT_API_KEY || env.NEXT_PUBLIC_POSTHOG_KEY
}

/** Hash an identifier with the audit salt. Matches the pattern in
 *  `00-foundations/auth/rate-limit.ts` so server-side hashes are
 *  stable across the codebase. The 32-char prefix is the project's
 *  convention (see `cart_coupon_applied: z.object({ coupon_id_hash:
 *  z.string() })` — the schema doesn't constrain the length, but
 *  the rest of the codebase uses 32 hex chars from sha256 + salt). */
export function hashIdentifierForPosthog(value: string): string {
  const salt = getEnv().AUDIT_HASH_SALT ?? `dev-${process.pid}`
  return createHash('sha256').update(`${salt}:${value}`).digest('hex').slice(0, 32)
}

/**
 * Capture a server-side event. Validates props against the catalog
 * schema, POSTs to the PostHog capture endpoint, returns a result
 * discriminated by success.
 *
 * Distinct-id strategy:
 * - For identified events (a `user_id_hash` field is in the props),
 *   the `distinct_id` is the hash itself. PostHog then merges the
 *   event into the user profile keyed on that hash.
 * - For anonymous events, the caller passes its own distinct_id
 *   (e.g. a session id or the cron name + ISO timestamp). This
 *   helper does NOT derive a distinct_id from the props; the caller
 *   owns that decision.
 *
 * The request is fire-and-forget for the cron's purposes: a failure
 * (network blip / PostHog down) is logged but never thrown, so the
 * cron can keep running and the next run will re-attempt. (The cron
 * is idempotent on the DB side via UPDATE...RETURNING — the PostHog
 * event may double-fire on retry, but the underlying state is
 * already correctly marked.)
 */
export async function trackPosthogServer<E extends PostHogEvent>(
  event: E,
  props: PostHogEventProps<E>,
  distinctId: string,
): Promise<PosthogServerCaptureResult> {
  if (!isPosthogServerConfigured()) {
    log.debug({ event, distinct_id_kind: distinctId.length > 0 ? 'present' : 'empty' }, 'posthog-server: unconfigured; dropping event')
    return { ok: false, error: 'posthog_server_unconfigured' }
  }

  const schema = POSTHOG_EVENT_PROPS[event]
  const result = schema.safeParse(props)
  if (!result.success) {
    log.warn(
      { event, issues: result.error.issues.map((i) => `${i.path.join('.')}:${i.message}`) },
      'posthog-server: dropping event — props failed validation',
    )
    return { ok: false, error: 'invalid_props' }
  }

  const env = getEnv()
  const host = env.NEXT_PUBLIC_POSTHOG_HOST || DEFAULT_POSTHOG_HOST
  const url = `${host.replace(/\/$/, '')}${CAPTURE_PATH}`

  const body = {
    api_key: resolveApiKey(),
    event,
    distinct_id: distinctId,
    properties: {
      ...result.data,
      // Server-side capture marker. PostHog dashboards can filter
      // on this to separate browser-fired vs cron-fired events.
      $source: 'posthog-server',
    },
    // `timestamp` is omitted — PostHog uses the server's clock for
    // cron-fired events, which is the right default for "the
    // abandonment was detected at this time".
  }

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      // 4xx/5xx — log and return a typed failure. Body is read for
      // debugging but truncated to avoid log bloat.
      const errText = (await res.text()).slice(0, 200)
      log.warn(
        { event, status: res.status, body: errText },
        'posthog-server: capture returned non-2xx',
      )
      return { ok: false, error: 'capture_failed', status: res.status }
    }
    return { ok: true, status: res.status }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown'
    log.warn({ event, err: message }, 'posthog-server: capture threw')
    return { ok: false, error: 'fetch_failed' }
  }
}
