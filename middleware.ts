// Edge middleware.
//
// Responsibilities:
//   1. Generate / propagate a per-request correlation ID (`x-uthena-request-id`).
//      The ID is read from the incoming request (in case an upstream proxy
//      or load balancer already minted one) or freshly generated via
//      `crypto.randomUUID()`. It is forwarded to the downstream handlers
//      AND set on the response so clients + support tooling can correlate.
//   2. Apply security headers — single source of truth lives in
//      `00-foundations/security/headers.ts`. The helper classifies the
//      request URL and returns the right header set for the route kind
//      (HTML page, image, XML, text, JSON, binary, webhook, or health).
//      Per-route variant table: see `01-specs/pages/security-headers.md`.
//   3. Match against app routes that need a request-scoped header pass.
//      Static assets, the Next.js internal paths, the healthcheck, and
//      the API health route are excluded — the middleware never runs
//      on them, so they get Next.js's defaults.
//   4. **Maintenance mode enforcement (P14.15)** — when the
//      `__Host-uthena_maintenance_enabled` cookie is set to a value
//      that verifies against its HMAC signature (SEC-2 — see
//      `parseMaintenanceEnabledCookie`), non-admin routes get a 503
//      with a friendly HTML body. Admin routes (`/admin/*`) remain
//      accessible so the admin can flip the toggle back off. See
//      `01-specs/pages/admin-settings.md` line 123 for the canonical
//      contract. The cookie TTL is 60s (matches the spec's "60s
//      cache" recommendation); the toggle action
//      (`updateMaintenanceAction`) signs + sets/clears the cookie.
//
// Out of scope for middleware (intentional):
//   - Role-based gating happens in the layout / server action, NOT here.
//     Middleware can't read the role without a DB hit, and the role
//     check belongs at the trust boundary (server action / RSC render),
//     not at the edge.
//   - Legacy Shopify URL redirects live in `next.config.mjs` (build-time,
//     no auth check needed).
//   - CSP violation reporting + per-request nonces are deferred to a
//     follow-up spec.

import { NextResponse, type NextRequest } from 'next/server'
import { applySecurityHeaders } from '@foundations/security/headers'
import { REQUEST_ID_HEADER, getOrCreateRequestId } from '@foundations/log/request-id'
import {
  MAINTENANCE_COOKIE_ENABLED,
  MAINTENANCE_COOKIE_MESSAGE,
  MAINTENANCE_DEFAULT_MESSAGE,
  MAINTENANCE_PATH_EXEMPT_PREFIXES,
  formatMaintenanceMessage,
  parseMaintenanceEnabledCookie,
  parseMaintenanceMessageCookie,
} from '@features/admin/platform-settings'

/**
 * True when the request path matches one of the exempt prefixes
 * (admin routes + the canonical maintenance URL).
 */
function isMaintenanceExemptPath(pathname: string): boolean {
  return MAINTENANCE_PATH_EXEMPT_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(prefix),
  )
}

/**
 * Render the 503 HTML body for the maintenance page. Pure — no DB hit,
 * no module-level state. Used by the middleware when the maintenance
 * cookie is set and the request is to a non-admin route.
 *
 * Returns a self-contained HTML string (with inline CSS that uses
 * `currentColor` + system colors so it looks correct on both light +
 * dark backgrounds without a token-system lookup at the edge).
 */
function renderMaintenanceHtml(message: string, status: number): string {
  // Escape any user-controlled chars in the message before inlining
  // into HTML. Defense in depth — the message is admin-set, but a
  // future XSS via a stale cookie should never reach the rendered
  // surface.
  const safeMessage = message
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex,nofollow" />
<title>We'll be back soon</title>
<style>
  :root { color-scheme: light dark; }
  body {
    margin: 0;
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    background: #f5f3ec;
    color: #0b0c0d;
    line-height: 1.5;
  }
  @media (prefers-color-scheme: dark) {
    body { background: #15181b; color: #ececee; }
    .card { background: #1c2024 !important; border-color: #2a2f35 !important; }
    .lede { color: #b9bcc1 !important; }
    .footer { color: #8a8f96 !important; border-color: #2a2f35 !important; }
  }
  .wrap { max-width: 560px; padding: 32px 20px; text-align: center; }
  .card {
    background: #ffffff;
    border: 1px solid #e5e1d6;
    border-radius: 16px;
    padding: 36px 28px;
  }
  h1 { font-size: 24px; margin: 0 0 12px; font-weight: 600; letter-spacing: -0.01em; }
  .lede { font-size: 15px; color: #555048; margin: 0 0 24px; line-height: 1.6; }
  .message {
    font-size: 14px;
    color: inherit;
    background: rgba(26, 188, 156, 0.08);
    border: 1px solid rgba(26, 188, 156, 0.3);
    border-radius: 10px;
    padding: 14px 16px;
    margin: 0 0 20px;
    white-space: pre-wrap;
    word-wrap: break-word;
    text-align: left;
  }
  .footer {
    margin-top: 20px;
    font-size: 12px;
    color: #8a8f96;
    border-top: 1px solid #e5e1d6;
    padding-top: 16px;
  }
  a { color: #1abc9c; text-decoration: none; }
  a:hover { text-decoration: underline; }
</style>
</head>
<body>
<div class="wrap">
  <div class="card">
    <h1>We'll be back soon</h1>
    <p class="lede">Uthena is currently undergoing scheduled maintenance.</p>
    <div class="message">${safeMessage}</div>
    <div class="footer">
      Need help? Email <a href="mailto:support@uthena.com">support@uthena.com</a>.
    </div>
  </div>
</div>
</body>
</html>`
}

export async function middleware(request: NextRequest) {
  const requestId = getOrCreateRequestId(request.headers)

  // Forward the ID to downstream handlers (server actions, RSC, route
  // handlers) so `loggerForRequest(await headers(), ...)` can pick it up.
  const forwardedHeaders = new Headers(request.headers)
  forwardedHeaders.set(REQUEST_ID_HEADER, requestId)

  // ---------------------------------------------------------------------
  // Maintenance-mode check (P14.15).
  //
  // Reads the cookie the toggle action sets/clears. If maintenance is
  // on AND the request is NOT to an exempt path, return a 503 with the
  // admin-provided message inline. The cookie TTL is 60s — after that
  // the next request will re-evaluate from the DB via the page route.
  // ---------------------------------------------------------------------
  const enabledCookie = request.cookies.get(MAINTENANCE_COOKIE_ENABLED)?.value
  const isMaintenanceOn = await parseMaintenanceEnabledCookie(enabledCookie)
  const { pathname } = request.nextUrl

  if (isMaintenanceOn && !isMaintenanceExemptPath(pathname)) {
    const messageCookie = request.cookies.get(MAINTENANCE_COOKIE_MESSAGE)?.value
    const message = formatMaintenanceMessage(
      parseMaintenanceMessageCookie(messageCookie) ?? MAINTENANCE_DEFAULT_MESSAGE,
    )
    const html = renderMaintenanceHtml(message, 503)
    const response = new NextResponse(html, {
      status: 503,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store, max-age=0',
        'x-uthena-request-id': requestId,
        // Maintenance pages are not indexable.
        'x-robots-tag': 'noindex, nofollow',
      },
    })
    applySecurityHeaders(response, pathname)
    return response
  }

  const response = NextResponse.next({
    request: { headers: forwardedHeaders },
  })

  // Echo the ID on the response so clients + support tooling can correlate.
  response.headers.set(REQUEST_ID_HEADER, requestId)

  applySecurityHeaders(response, pathname)
  return response
}

export const config = {
  // Skip static assets + the healthcheck. The /api/health route is also
  // a healthcheck — the middleware excludes both so neither gets a
  // header pass (the upstream load balancer probes them without TLS).
  matcher: ['/((?!_next/static|_next/image|favicon.ico|healthz|api/health).*)'],
}