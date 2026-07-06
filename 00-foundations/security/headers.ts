// Security headers — single source of truth.
//
// Every response from the Next.js app carries a baseline set of
// security headers. Some are universal (every response), some are
// HTML-page-only (CSP / Permissions-Policy / COOP / CORP don't make
// sense for an image / binary / XML response), some are transport-only
// (HSTS is meaningless for a healthcheck or webhook URL).
//
// `getSecurityHeaders(pathname, options?)` is the pure helper that the
// middleware uses. It's also the surface the unit tests cover end-to-end
// — every variant the middleware would apply is unit-tested here, so
// the test runs without booting Next.js.
//
// Spec: `01-specs/pages/security-headers.md`.
// Cross-references: `06-quality/checklists/security-audit.md`
// Infrastructure section.

/**
 * The canonical Content-Security-Policy directives, joined with `'; '`.
 *
 * `'unsafe-inline'` for `script-src` and `style-src` is a documented
 * v1 trade-off — Next.js 15's server-action runtime hydrates inline
 * scripts that we can't easily nonce without rewriting every server
 * component. The follow-up spec (per `_followups.md`) introduces
 * per-request nonces.
 *
 * `script-src` allows PostHog's snippet (hosted at `eu.i.posthog.com`).
 * `img-src` + `media-src` allow Bunny CDN + Bunny Stream. `connect-src`
 * allows Supabase + PostHog + Stripe. Everything else is `'self'`.
 *
 * `frame-ancestors 'none'` — defense in depth alongside
 * `X-Frame-Options: DENY`.
 * `object-src 'none'` — flash / java applets, both long dead.
 * `base-uri 'self'` — prevents `<base>` injection.
 * `form-action 'self'` — every form action must target our own origin.
 */
export const CSP_DIRECTIVES = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://eu.i.posthog.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://*.b-cdn.net https://*.mediadelivery.net",
  "media-src 'self' blob: https://*.b-cdn.net https://*.mediadelivery.net",
  "font-src 'self' data:",
  "connect-src 'self' https://*.supabase.co https://eu.i.posthog.com https://api.stripe.com",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
  'upgrade-insecure-requests',
] as const

export const CSP_VALUE = CSP_DIRECTIVES.join('; ')

/**
 * HSTS — 2 years + subdomains + preload list.
 *
 * The 2-year max-age is the upper bound most browsers honor without
 * warning. `includeSubDomains` covers api.uthena.com, app.uthena.com,
 * etc. `preload` is the opt-in for Chrome's built-in HSTS preload
 * list — once we're on it, every Chrome install refuses to speak
 * HTTP to this domain for the lifetime of the install.
 */
export const HSTS_VALUE = 'max-age=63072000; includeSubDomains; preload'

/**
 * Permissions-Policy — feature denylist + FLoC opt-out.
 *
 * The `=()` syntax means "denied for all origins, including self".
 * `interest-cohort` is the Topics API opt-out.
 */
export const PERMISSIONS_POLICY_VALUE =
  'camera=(), microphone=(), geolocation=(), interest-cohort=()'

/** Universal headers — applied to every response. */
export const UNIVERSAL_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-DNS-Prefetch-Control': 'off',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
} as const

/** Browser-facing transport headers — applied to HTML pages and any browser-initial response. */
export const HTML_PAGE_EXTRA_HEADERS = {
  'Content-Security-Policy': CSP_VALUE,
  'Strict-Transport-Security': HSTS_VALUE,
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': PERMISSIONS_POLICY_VALUE,
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Origin-Agent-Cluster': '?1',
} as const

/** The shape returned by `getSecurityHeaders`. */
export type SecurityHeaders = Readonly<Record<string, string>>

/** Optional inputs. */
export interface GetSecurityHeadersOptions {
  /**
   * Override the route classification. By default, the helper inspects
   * `pathname` and chooses the right variant. Tests pass an explicit
   * variant to exercise edge cases without setting up a real URL.
   *
   * One of:
   *  - `'html'` — full HTML-page header set (default for `/` and most pages)
   *  - `'image'` — `/og`, no CSP / Permissions-Policy / COOP / CORP
   *  - `'xml'` — `/sitemap*.xml`, same as `image` (no browser scripting)
   *  - `'text'` — `/robots.txt`, same as `image`
   *  - `'json'` — `/api/search`, `/api/orders/[id]/grants`, etc.
   *  - `'binary'` — `/api/files/[id]/download` + `/stream` (302 redirect to CDN)
   *  - `'webhook'` — `/api/webhooks/stripe` (no HSTS — different transport)
   *  - `'health'` — `/healthz`, `/api/health` (no HSTS — load balancer probe)
   *  - `'static'` — `/_next/static/*`, etc. (no headers; the middleware
   *                matcher excludes these so the helper never gets called)
   */
  variant?: SecurityHeaderVariant
}

export type SecurityHeaderVariant =
  | 'html'
  | 'image'
  | 'xml'
  | 'text'
  | 'json'
  | 'binary'
  | 'webhook'
  | 'health'

/**
 * Classify a pathname into a variant. Pure: no I/O. The middleware
 * matches `_next/*` etc. before this is called, so `static` is a
 * belt-and-suspenders fallback that returns an empty header set.
 */
export function classifyPath(pathname: string): SecurityHeaderVariant {
  // Strip query string (shouldn't be present here, but defensive).
  const path = pathname.split('?')[0]!

  // Healthchecks — never browser-initial, never TLS-terminated by us.
  if (path === '/healthz' || path === '/api/health') return 'health'

  // Webhooks — never browser-initial, signed by the source.
  if (path.startsWith('/api/webhooks/')) return 'webhook'

  // Binary file surface — /download does a 302 to a CDN URL (different
  // host, different TLS), so no CSP / HSTS / X-Frame-Options here. NOTE:
  // /stream returns JSON ({ url, expires_at }), NOT a redirect — it must
  // fall through to the 'json' variant below so it keeps HSTS +
  // X-Frame-Options like every other JSON API.
  if (path.startsWith('/api/files/') && path.endsWith('/download')) {
    return 'binary'
  }

  // JSON APIs (everything else under /api/* that wasn't classified above).
  if (path.startsWith('/api/')) return 'json'

  // Image generator.
  if (path === '/og') return 'image'

  // Sitemaps + robots.
  if (path === '/sitemap.xml' || path.endsWith('/sitemap.xml')) return 'xml'
  if (path === '/sitemap-pages.xml' || path.endsWith('/sitemap-pages.xml')) return 'xml'
  if (path === '/sitemap-products.xml' || path.endsWith('/sitemap-products.xml')) return 'xml'
  if (path === '/sitemap-collections.xml' || path.endsWith('/sitemap-collections.xml')) return 'xml'
  if (path === '/robots.txt') return 'text'

  // Default — HTML page.
  return 'html'
}

/**
 * Build the security header set for a given pathname (or explicit
 * variant). Pure: no I/O. The middleware applies the result via
 * `for (const [k, v] of Object.entries(headers)) response.headers.set(k, v)`.
 *
 * Per-route variants documented in `01-specs/pages/security-headers.md`.
 */
export function getSecurityHeaders(
  pathname: string,
  options: GetSecurityHeadersOptions = {},
): SecurityHeaders {
  const variant = options.variant ?? classifyPath(pathname)

  // Every variant gets the universal headers.
  const headers: Record<string, string> = { ...UNIVERSAL_HEADERS }

  switch (variant) {
    case 'html':
      // Full HTML-page set.
      Object.assign(headers, HTML_PAGE_EXTRA_HEADERS)
      // Dev-only CSP relaxation: Next.js 15 dev server uses eval()
      // for React Fast Refresh + HMR. Only `next dev` (NODE_ENV
      // 'development') needs it — production AND test keep the strict
      // CSP (no 'unsafe-eval'), so CI validates the shipped policy.
      if (process.env.NODE_ENV === 'development') {
        headers['Content-Security-Policy'] = headers['Content-Security-Policy']!
          .replace("script-src 'self' 'unsafe-inline'", "script-src 'self' 'unsafe-inline' 'unsafe-eval'")
      }
      break

    case 'image':
    case 'xml':
    case 'text':
      // Image / XML / text — browser may render them, but no scripting
      // context. Drop CSP + Permissions-Policy + COOP / CORP (they
      // don't apply). Keep HSTS + X-Frame-Options as transport-level
      // defenses.
      headers['Strict-Transport-Security'] = HSTS_VALUE
      headers['X-Frame-Options'] = 'DENY'
      break

    case 'json':
      // JSON API — browser may fetch via fetch() but doesn't render
      // scripts. Drop CSP + Permissions-Policy + COOP / CORP (they
      // don't apply to a JSON document). Keep HSTS + X-Frame-Options.
      headers['Strict-Transport-Security'] = HSTS_VALUE
      headers['X-Frame-Options'] = 'DENY'
      break

    case 'binary':
      // 302 redirect to a CDN URL — different host, different TLS.
      // Drop HSTS (the redirect target has its own) + X-Frame-Options
      // (the redirected URL's headers apply). Universal headers only.
      break

    case 'webhook':
      // Webhook endpoint — never browser-initial, no TLS to enforce.
      // Universal headers only.
      break

    case 'health':
      // Healthcheck — load balancer probe. No TLS, no browser.
      // Universal headers only.
      break
  }

  return headers
}

/**
 * Apply `getSecurityHeaders` to a `NextResponse` (or any object with
 * a `headers.set(key, value)` method). Returns the same response for
 * chaining. Pure w.r.t. the response shape — the side effect is the
 * `headers.set` calls.
 */
export function applySecurityHeaders(
  response: { headers: { set: (key: string, value: string) => void } },
  pathname: string,
  options?: GetSecurityHeadersOptions,
): void {
  const headers = getSecurityHeaders(pathname, options)
  for (const [key, value] of Object.entries(headers)) {
    response.headers.set(key, value)
  }
}