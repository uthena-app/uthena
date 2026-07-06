// Pino logger — single shared instance. Redacts PII paths.
// Used by every server action, route handler, webhook, and lib.
//
// Per AGENTS.md: "No PII in logs. Ever. Mask emails, redact tokens, hash IDs."
// We use pino's `redact` with sensible paths. If you add a new place
// where PII flows, extend the redact list here AND log a test.
//
// Per PHASES.md P2.10: structured schema (`event`, `actor`, `subject`,
// `context`), redactors for PII, request ID middleware. The structured
// schema lives in `./schema.ts`; the request ID middleware lives in
// `./request-id.ts` and `/middleware.ts` at the repo root. `loggerForRequest`
// below is the per-call glue.

import pino from 'pino'
import { getEnv } from '@foundations/env'
import { REQUEST_ID_HEADER, isValidRequestId } from './request-id'
import { REDACT_CENSOR, REDACT_PATHS } from './redact-paths'

let _logger: pino.Logger | null = null

export function getLogger(): pino.Logger {
  if (_logger) return _logger
  const env = getEnv()
  _logger = pino({
    level: env.NODE_ENV === 'production' ? 'info' : 'debug',
    redact: {
      // The canonical redact path list lives in `./redact-paths.ts` so
      // the regression-guard test can mirror it byte-for-byte. See the
      // header comment there for the pino wildcard syntax + the rationale
      // for enumerating depths 0-4 (pino's `**` is NOT a deep wildcard;
      // it's a silent no-op past depth 1).
      paths: [...REDACT_PATHS],
      censor: REDACT_CENSOR,
    },
    base: {
      app: env.NEXT_PUBLIC_APP_NAME,
      env: env.NODE_ENV,
    },
    timestamp: pino.stdTimeFunctions.isoTime,
  })
  return _logger
}

/** Shorthand to bind a context object to every log line. */
export function loggerFor(context: Record<string, unknown>): pino.Logger {
  return getLogger().child(context)
}

/**
 * Build a child logger bound to the current request's ID. Reads the
 * `x-uthena-request-id` header (set by the root middleware) so every
 * log line in a request shares a correlation key.
 *
 * Usage:
 * ```ts
 * const log = loggerForRequest(await headers(), { component: 'cart.addToCart' })
 * log.info({ event: 'cart.added', actor: { kind: 'user', user_id: user.id } }, 'added')
 * ```
 *
 * Design notes:
 *   - Explicit `Headers` parameter (not AsyncLocalStorage). AsyncLocalStorage
 *     crosses runtime boundaries awkwardly in Next.js 15 (middleware on
 *     Edge, server actions on Node) — a header is the simplest transport.
 *   - Missing or empty header → no `req_id` is bound. Logs still emit,
 *     just without the correlation key. The middleware should always
 *     set one, so this is a defensive fallback.
 *   - Returns a new `pino.Logger` (a `child`) — it's safe to call inside
 *     hot paths; pino's child creation is cheap (just a frozen bindings
 *     object).
 */
export function loggerForRequest(
  headers: Headers,
  context: Record<string, unknown> = {},
): pino.Logger {
  const raw = headers.get(REQUEST_ID_HEADER)?.trim() ?? ''
  const bindings: Record<string, unknown> = { ...context }
  if (raw && isValidRequestId(raw)) bindings.req_id = raw
  return getLogger().child(bindings)
}
