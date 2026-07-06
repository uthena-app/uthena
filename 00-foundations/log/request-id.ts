// Request ID — single helper for the `x-uthena-request-id` header.
//
// The root middleware (`/middleware.ts`) uses `getOrCreateRequestId` to:
//   1. Read the incoming `x-uthena-request-id` header — set by the load
//      balancer / upstream proxy / a previous edge in the chain so we
//      can correlate a single user action across hops.
//   2. If absent, generate a fresh UUID.
//   3. Return it for the middleware to attach to both the request
//      (forwarded to downstream handlers via `NextResponse.next({ request:
//      { headers } })`) and the response (so the browser + support
//      tooling can read it).
//
// Server-side callers (server actions, route handlers, queries) use
// `loggerForRequest(await headers(), { component: '...' })` — see
// `pino.ts`. The helper reads the same header from `next/headers()`.
//
// Why a header (not AsyncLocalStorage):
//   - Middleware runs on the Edge runtime; server actions run on the
//     Node runtime. Sharing AsyncLocalStorage across runtimes requires
//     a runtime boundary contract that doesn't exist for free in
//     Next.js 15. A header is the simplest cross-runtime transport.
//   - The header is also useful for client-side correlation: an error
//     toast can show the request ID so support can grep the logs.
//
// Edge + Node runtime parity:
//   - Both runtimes expose `crypto.randomUUID()` (Web Crypto API).
//   - Edge runtime has `crypto.randomUUID()` via globalThis.
//   - Node 20+ has `crypto.randomUUID()` via the `crypto` global.
//   - We never use `node:crypto.randomUUID` (it's Node-only and would
//     fail in the edge bundle).

/** The canonical header name. Lowercase + hyphenated per HTTP/2 norms. */
export const REQUEST_ID_HEADER = 'x-uthena-request-id'

/**
 * Read the incoming request ID, or mint a new one if absent.
 *
 * Returns the request ID as a lowercase string (UUIDs are already
 * lowercase but we coerce defensively). Empty string is treated as
 * absent (upstream might send an empty header for tracing-disabled
 * clients).
 */
export function getOrCreateRequestId(headers: Headers): string {
  const incoming = headers.get(REQUEST_ID_HEADER)?.trim().toLowerCase()
  if (incoming && isValidRequestId(incoming)) return incoming
  return generateRequestId()
}

/**
 * Generate a fresh request ID. Pure — no side effects, no module state.
 *
 * Wrapped so future ID schemes (ULID for sortable logs, prefix for
 * multi-tenant routing) can change in one place.
 */
export function generateRequestId(): string {
  return crypto.randomUUID()
}

/**
 * Lightweight validator. Accepts:
 *   - UUID v1-7 (any variant) — 8-4-4-4-12 hex, lowercase or uppercase.
 *   - Prefixed UUIDs (`req_<uuid>`, `trace_<uuid>`) — for upstream
 *     proxies that namespace their IDs.
 *
 * Rejects:
 *   - Empty / whitespace-only / non-hex.
 *   - Anything longer than 96 chars (defensive ceiling — prefixes plus
 *     UUID should never exceed ~40).
 *
 * Not RFC-4122-strict: we don't care about the variant bits, only that
 * the value is hex-shaped and the right length. Loose enough to accept
 * upstream-traced IDs, strict enough to reject garbage.
 */
export function isValidRequestId(value: string): boolean {
  if (!value || value.length > 96) return false
  // Optional prefix: letters/digits/underscores + underscore separator.
  // Body: hex digits + 3 hyphens at the canonical UUID positions.
  return /^[a-z0-9_]{0,32}_?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
}