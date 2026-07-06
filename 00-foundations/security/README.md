# 00-foundations/security/

Security headers — single source of truth for the HTTP headers applied
to every response from the Next.js app. Lives here because it's a
shared primitive used by the edge middleware and tested in isolation.

## Files

- **`headers.ts`** — the canonical surface.
  - `CSP_DIRECTIVES` — the canonical CSP directive list, `as const`.
  - `CSP_VALUE` — the joined CSP string (`; `-separated).
  - `HSTS_VALUE` — the canonical `Strict-Transport-Security` value.
  - `PERMISSIONS_POLICY_VALUE` — the canonical `Permissions-Policy`
    value.
  - `UNIVERSAL_HEADERS` — headers applied to every response
    (`X-Content-Type-Options`, `X-DNS-Prefetch-Control`, `Referrer-Policy`).
  - `HTML_PAGE_EXTRA_HEADERS` — headers added for HTML-page variants
    (CSP, HSTS, X-Frame-Options, Permissions-Policy, COOP, CORP,
    Origin-Agent-Cluster).
  - `classifyPath(pathname)` — pure function, returns the
    `SecurityHeaderVariant` for a given pathname.
  - `getSecurityHeaders(pathname, options?)` — pure function, returns
    the header set as a `Record<string, string>`. Pure w.r.t. the
    arguments; no I/O.
  - `applySecurityHeaders(response, pathname, options?)` — applies
    the headers to a `NextResponse`. Side effect: the `headers.set`
    calls.
  - Types: `SecurityHeaders`, `SecurityHeaderVariant`,
    `GetSecurityHeadersOptions`.

- **`headers.test.ts`** — unit tests covering every variant, the
  classifier, the canonical values, and the `applySecurityHeaders`
  helper. Pure-function tests; no fixtures. Runs in milliseconds.

- **`index.ts`** — barrel re-export.

## Public surface

```ts
import {
  classifyPath,
  getSecurityHeaders,
  applySecurityHeaders,
  CSP_DIRECTIVES,
  CSP_VALUE,
  HSTS_VALUE,
  PERMISSIONS_POLICY_VALUE,
} from '@foundations/security'

// Classifier — used in middleware.ts.
classifyPath('/')                          // 'html'
classifyPath('/og')                        // 'image'
classifyPath('/sitemap.xml')               // 'xml'
classifyPath('/robots.txt')                // 'text'
classifyPath('/api/search')                // 'json'
classifyPath('/api/files/1/download')      // 'binary'
classifyPath('/api/files/1/stream')        // 'binary'
classifyPath('/api/webhooks/stripe')       // 'webhook'
classifyPath('/healthz')                   // 'health'
classifyPath('/api/health')                // 'health'

// Header builder.
const headers = getSecurityHeaders('/')
// {
//   'X-Content-Type-Options': 'nosniff',
//   'X-DNS-Prefetch-Control': 'off',
//   'Referrer-Policy': 'strict-origin-when-cross-origin',
//   'Content-Security-Policy': '...',
//   'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
//   'X-Frame-Options': 'DENY',
//   'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
//   'Cross-Origin-Opener-Policy': 'same-origin',
//   'Cross-Origin-Resource-Policy': 'same-origin',
//   'Origin-Agent-Cluster': '?1',
// }

// Variant override (for tests + rare middleware cases).
getSecurityHeaders('/whatever', { variant: 'json' })

// Applier — used in middleware.ts.
import { NextResponse } from 'next/server'
const response = NextResponse.next()
applySecurityHeaders(response, request.nextUrl.pathname)
```

## Per-route variants

| Route kind | CSP | HSTS | X-Frame-Options | Permissions-Policy | COOP/CORP |
|---|---|---|---|---|---|
| HTML page (`/`, `/products/[slug]`, etc.) | yes | yes | yes | yes | yes |
| `/og` (PNG) | no | yes | yes | no | no |
| `/sitemap*.xml` | no | yes | yes | no | no |
| `/robots.txt` | no | yes | yes | no | no |
| `/api/files/[id]/download` (302 to CDN) | no | no | no | no | no |
| `/api/files/[id]/stream` (302 to CDN) | no | no | no | no | no |
| `/api/search`, `/api/orders/[id]/grants` | no | yes | yes | no | no |
| `/api/webhooks/stripe` | no | no | no | no | no |
| `/healthz`, `/api/health` | no | no | no | no | no |
| `/_next/static/*` (matcher excludes) | no | no | no | no | no |

Universal headers (`X-Content-Type-Options`, `X-DNS-Prefetch-Control`,
`Referrer-Policy`) apply to every variant.

## CSP — v1 trade-off

The CSP currently includes `'unsafe-inline'` for `script-src` and
`style-src`. This is a documented v1 trade-off — Next.js 15's
server-action runtime injects inline scripts that we can't easily
nonce without rewriting every server component. The follow-up spec
(per `01-specs/pages/_followups.md`) introduces per-request nonces.

The CSP also allows `https://eu.i.posthog.com` for PostHog's snippet
script and `https://*.b-cdn.net` + `https://*.mediadelivery.net` for
Bunny CDN + Bunny Stream. Everything else is `'self'`.

## Adding a new header

1. Add the constant to `headers.ts` (the named export pattern: every
   value is a named constant, not an inline string).
2. Add the header to either `UNIVERSAL_HEADERS` (every response) or
   `HTML_PAGE_EXTRA_HEADERS` (HTML pages only), or extend the
   `switch` block for a new variant.
3. Add a unit test in `headers.test.ts` covering every variant that
   changes.
4. Update the per-route table in this README + the spec at
   `01-specs/pages/security-headers.md`.
5. Add the header to the CI script's assertion list
   (`04-platform/ci/scripts/check-security-headers.sh`).

## Adding a new route variant

1. Add the variant name to the `SecurityHeaderVariant` union.
2. Add the classification rule to `classifyPath()`.
3. Add the `case` to the `switch` block in `getSecurityHeaders()`.
4. Add tests covering the new variant + the classifier.
5. Update the per-route table in this README + the spec.
6. Add a representative URL to the CI script's curl list.

## Testing

```bash
pnpm test headers           # just the headers tests
pnpm check:security-headers # boots dev server, curls, asserts
```

The unit tests cover the full HTML-page header set, the image / XML /
text variant, the binary / API variant, the webhook variant, the
healthcheck variant, and the classifier's dispatch logic. No fixtures,
no I/O — runs in milliseconds.

The CI script (`check:security-headers.sh`) boots `pnpm dev` on port
3101, curls 7 representative routes (`/`, `/products/missing`,
`/sitemap.xml`, `/og?title=Test`, `/api/health`,
`/api/files/1/download`, `/api/webhooks/stripe`), and asserts each
expected header value. Wired into `pnpm check:all`.

## Cross-references

- **Spec**: `01-specs/pages/security-headers.md` — full acceptance
  criteria + per-route variant table + out-of-scope items.
- **Middleware**: `middleware.ts` — the only consumer. Uses
  `applySecurityHeaders()` to set the headers.
- **Security audit**: `06-quality/checklists/security-audit.md`
  §"Infrastructure" — references this module.
- **CI**: `04-platform/ci/scripts/check-security-headers.sh` —
  boots the dev server and asserts the headers via curl.