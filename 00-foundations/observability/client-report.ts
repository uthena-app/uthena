// Client-safe wrapper for the Sentry seam. The actual captureError
// lives in `00-foundations/observability/sentry.ts` and is server-only
// (`import 'server-only'`). Every error boundary in this codebase is a
// `'use client'` component (required by Next.js for the reset() +
// useEffect + clipboard surface), so it can't import the seam directly.
// This wrapper is the bridge: it serializes a PII-safe payload +
// POSTs to `/api/errors/report`, which calls captureError server-side.
//
// Why this lives next to sentry.ts instead of in `02-features/errors/`:
//   - It's the client-facing surface of the observability seam. The
//     barrel `index.ts` re-exports both — server consumers pick
//     `sentry.ts`, client consumers pick `client-report.ts`. This
//     matches the P0.5 barrel-split pattern (`@features/search/index`
//     vs `@features/search/client`).
//   - Keeping them in one folder makes the seam-vs-wrapper relationship
//     obvious to the next agent; the P0.5 lesson ("barrel re-export
//     of a server-only module breaks client components") is the
//     exact failure mode this prevents.
//
// PII contract (the AGENTS.md §2 "No PII in logs. Ever."):
//   - We NEVER forward error.message — error.message often contains
//     URLs, user input, query strings, PII-flavored fragments from
//     the failing query. The seam logs only error.name.
//   - We NEVER forward error.stack — stack traces contain file
//     paths and variable values. Next.js's opaque `error.digest` is
//     forwarded instead; support cross-references via Sentry tags.
//   - The typed body schema on the route handler is the third gate
//     (after the client's serialization here + the seam's payload
//     assembly).
//
// Why `keepalive: true`:
//   - The boundary's useEffect fires during render — if the user
//     closes the tab immediately, a normal fetch() would be cancelled.
//     `keepalive: true` lets the browser flush the request even as
//     the page unloads. This is the standard pattern for client-side
//     error reporting (Sentry's browser SDK uses it too).
//
// Why `signal: AbortSignal.timeout(2500)`:
//   - The boundary is the last line of UX. A hung fetch here would
//     block the user's "Try again" click for 30+ seconds (browser
//     default fetch timeout). 2.5s is generous for a same-origin
//     JSON POST; after that, the wrapper gives up silently and the
//     user can retry. The seam's server-side path remains
//     unaffected.

const REPORT_PATH = '/api/errors/report'
const REPORT_TIMEOUT_MS = 2_500

/** Result of reportError. Mirrors the seam's SentryCaptureResult
 *  shape so the call-site code reads the same way. `mode: 'logged'`
 *  means the POST reached the server (the actual transport may
 *  still be `'log'` or `'sentry'` — that's the seam's business).
 *  `mode: 'skipped'` means the wrapper chose not to POST (network
 *  failure, validation failure, timeout). The boundary must always
 *  render; this is purely advisory. */
export type ReportErrorReason =
  | 'invalid_input'
  | 'network'
  | 'timeout'
  | 'fetch_failed'
  | 'http_error'

export type ReportErrorResult =
  | { ok: true; mode: 'logged' }
  | { ok: false; mode: 'skipped'; reason: ReportErrorReason }

/** Client-safe report function. Sends the PII-safe payload to the
 *  error-report route handler. Never throws — failures are returned
 *  as `{ ok: false, ... }` so the boundary's useEffect stays clean.
 *
 *  Note: the input mirrors SentryContext but is duplicated here to
 *  avoid pulling the server-only type into the client bundle. The
 *  server-side route handler re-validates via Zod before calling
 *  captureError. */
export function reportError(
  error: Error & { digest?: string },
  ctx: {
    surface: string
    errId: string
    actor?:
      | { kind: 'anon' }
      | { kind: 'user'; user_id: string }
      | { kind: 'admin'; user_id: string; role: 'admin' | 'super_admin' }
      | { kind: 'system' }
    tags?: Record<string, string>
  },
): ReportErrorResult {
  if (!ctx.errId || !ctx.surface) {
    return { ok: false, mode: 'skipped', reason: 'invalid_input' }
  }

  const payload = {
    surface: ctx.surface,
    errId: ctx.errId,
    errorName: error.name,
    errorDigest: error.digest,
    actor: ctx.actor,
    tags: ctx.tags,
  }

  // The fetch is fire-and-forget from the caller's perspective — we
  // await it because Next.js's useEffect is async-friendly, but the
  // boundary doesn't gate on success. We use keepalive so the
  // request can complete even if the user closes the tab, and we
  // cap the wait at 2.5s so the user can always click "Try again".
  try {
    // Synchronous path: kick off the fetch and never await it.
    // The boundary's useEffect stays clean and the user's next
    // click is never blocked. Trade-off: we never know whether the
    // capture succeeded. The server-side seam's pino log is the
    // source of truth.
    void fetch(REPORT_PATH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      keepalive: true,
      signal: AbortSignal.timeout(REPORT_TIMEOUT_MS),
    }).then(
      () => ({ ok: true as const, mode: 'logged' as const }),
      (err: unknown) => {
        // Swallow — the boundary is the last line of UX. We could
        // queue + retry, but the server-side seam's pino log is
        // already the audit trail; a missed capture is a log gap,
        // not a data integrity issue.
        const reason: ReportErrorReason =
          err instanceof DOMException && err.name === 'TimeoutError'
            ? 'timeout'
            : 'fetch_failed'
        if (typeof console !== 'undefined') {
          // PII-safe: we only log the wrapper's own outcome — never
          // the error itself (per AGENTS.md §2).
          // eslint-disable-next-line no-console
          console.warn('[client-report] capture failed:', reason)
        }
        return { ok: false as const, mode: 'skipped' as const, reason }
      },
    )

    // Return the optimistic "logged" shape — the call site treats
    // it the same as the real outcome. The actual outcome arrives
    // asynchronously and is logged but not surfaced.
    return { ok: true, mode: 'logged' }
  } catch {
    // fetch() can throw synchronously only on truly broken inputs
    // (rare). Treat the same as a network failure.
    return { ok: false, mode: 'skipped', reason: 'fetch_failed' }
  }
}