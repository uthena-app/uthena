# Security headers — cross-cutting spec

> **Source contract.** This is the cross-cutting surface for `P2.7` in
> `PHASES.md`. It defines the security headers applied to every response
> from the Next.js app, the per-route variants, and the test surface.
>
> **Status.** P2.7 — production-grade. Every response from the app carries
> the headers listed below. The list is enforceable in CI via the
> `check:security-headers` script (boots dev server, curls representative
> routes, asserts each header value).

---

## What this spec covers

Every HTTP response served by the Next.js app carries a baseline set of
security headers. Some headers are universal (every response), some are
HTML-page-only (CSP, COOP, CORP don't make sense for an image / binary /
XML response), and some are transport-only (HSTS is meaningless for a
healthcheck or webhook URL that doesn't serve a browser).

The middleware in `middleware.ts` is the single source of truth for
these headers. The `next.config.mjs` `headers()` block is reserved for
build-time defaults and no longer duplicates any of these.

## Why this exists

A 2026 baseline for an e-commerce + paid-content site:

- **CSP** stops cross-site scripting from stealing session cookies or
  rendering a phishing overlay. The current policy is a strict allowlist
  with `'unsafe-inline'` for `script-src` and `style-src` — this is a
  documented v1 trade-off (Next.js 15's server-action hydration uses
  inline scripts; nonce-based CSP would require a per-request nonce
  injected into every server component, which lands in a follow-up spec).
- **HSTS** tells compliant browsers to refuse to speak HTTP to this
  domain for 2 years. `preload` is the opt-in for Chrome's built-in
  HSTS preload list.
- **X-Frame-Options** + CSP `frame-ancestors 'none'` are the
  clickjacking defense.
- **X-Content-Type-Options: nosniff** prevents MIME sniffing — an
  attacker can't trick the browser into executing a `text/plain`
  response as JavaScript.
- **Referrer-Policy** stops leaking internal URLs to third-party
  sites via `Referer`.
- **Permissions-Policy** denies access to the browser features we
  don't use (camera, microphone, geolocation) plus the FLoC
  `interest-cohort` opt-out.
- **COOP** (`Cross-Origin-Opener-Policy: same-origin`) isolates the
  browsing context — defense against the Spectre side-channel family.
- **CORP** (`Cross-Origin-Resource-Policy: same-origin`) tells other
  origins they can't embed our resources (defense against Spectre
  via cross-origin reads).
- **Origin-Agent-Cluster: ?1** requests a dedicated agent cluster
  for this origin, isolating it from other same-site origins.

## Universal headers (every response)

| Header | Value | Why |
|---|---|---|
| `X-Content-Type-Options` | `nosniff` | No MIME sniffing |
| `X-DNS-Prefetch-Control` | `off` | We don't prefetch; saves a side channel |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | Internal paths don't leak |
| `Vary` | appended with `Accept-Encoding` (when not already set) | Cache correctness |
| `X-Powered-By` | unset | Don't leak the framework |

The `Vary` value is owned by the framework; we only verify it's set.

## HTML-page headers (every page route — `app/**/page.tsx`)

In addition to the universal headers:

| Header | Value | Why |
|---|---|---|
| `Content-Security-Policy` | the canonical CSP below | XSS defense |
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains; preload` | HSTS for 2 years + preload list |
| `X-Frame-Options` | `DENY` | Clickjacking defense |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=(), interest-cohort=()` | Feature denylist + FLoC opt-out |
| `Cross-Origin-Opener-Policy` | `same-origin` | Browsing-context isolation |
| `Cross-Origin-Resource-Policy` | `same-origin` | Cross-origin read isolation |
| `Origin-Agent-Cluster` | `?1` | Per-origin agent cluster |

### Canonical CSP

```
default-src 'self';
script-src 'self' 'unsafe-inline' https://eu.i.posthog.com;
style-src 'self' 'unsafe-inline';
img-src 'self' data: blob: https://*.b-cdn.net https://*.mediadelivery.net;
media-src 'self' blob: https://*.b-cdn.net https://*.mediadelivery.net;
font-src 'self' data:;
connect-src 'self' https://*.supabase.co https://eu.i.posthog.com https://api.stripe.com;
frame-ancestors 'none';
base-uri 'self';
form-action 'self';
object-src 'none';
upgrade-insecure-requests;
```

The `'unsafe-inline'` for scripts and styles is a documented v1
trade-off — Next.js 15's server-action runtime hydrates inline scripts
that we can't easily nonce without rewriting every server component.
This is tracked in `_followups.md` with a target of replacing with
per-request nonces in a follow-up spec.

## Per-route variants

Not every response should carry the full HTML-page set:

| Route kind | CSP? | HSTS? | X-Frame-Options? | Permissions-Policy? | COOP/CORP? |
|---|---|---|---|---|---|
| HTML page (`app/**/page.tsx`) | yes | yes | yes | yes | yes |
| `/og` (image generator, returns PNG) | no | yes | yes | no (image only — no scripts) | no |
| `/sitemap*.xml` (XML) | no | yes | yes | no (XML — no scripts) | no |
| `/robots.txt` (text) | no | yes | yes | no (text — no scripts) | no |
| `/api/files/[id]/download` (302 redirect to CDN) | no | no (CDN URL — different host) | no | no | no |
| `/api/files/[id]/stream` (302 redirect to CDN) | no | no | no | no | no |
| `/api/orders/[id]/grants` (JSON) | no | yes | yes | no | no |
| `/api/search` (JSON) | no | yes | yes | no | no |
| `/api/webhooks/stripe` (webhook) | no | no (webhook source — different host) | no | no | no |
| `/healthz`, `/api/health` (healthcheck) | no | no (load balancer probe) | no | no | no |
| `/auth/callback` (server-side OAuth exchange) | yes | yes | yes | yes | yes |
| `/_next/*` static assets | no (Next handles these) | no | no | no | no |

The principle: a header that protects a browser-facing surface
(CSP, Permissions-Policy, COOP, CORP) is dropped for non-HTML responses.
A header that's about transport (HSTS, X-Frame-Options) is dropped for
endpoints that are not browser-initiated (webhooks, healthchecks,
internal redirects).

## Where it lives

- **`00-foundations/security/headers.ts`** — the pure helper
  `getSecurityHeaders(pathname, options?)`. Pure function, no I/O,
  testable in isolation. Also exports the named constants (`CSP_DIRECTIVES`,
  `HSTS_VALUE`, `PERMISSIONS_POLICY_VALUE`, etc.) so the test can compare
  against the source of truth.
- **`00-foundations/security/index.ts`** — barrel re-export.
- **`00-foundations/security/README.md`** — module documentation, how to
  add a new header, how to add a new route variant.
- **`middleware.ts`** — uses the helper, attaches the right headers for
  the request URL. Single source of truth.
- **`04-platform/ci/scripts/check-security-headers.sh`** — boots the
  dev server, curls representative routes, asserts headers. Wired into
  `pnpm check:security-headers` and the `pnpm check:all` aggregate.

## Acceptance criteria

### Universal

- [ ] Every response from the app sets `X-Content-Type-Options: nosniff`.
- [ ] Every response sets `X-DNS-Prefetch-Control: off`.
- [ ] Every response sets `Referrer-Policy: strict-origin-when-cross-origin`.
- [ ] `X-Powered-By` is unset on every response.
- [ ] `next.config.mjs` does NOT duplicate any of these headers (the
      middleware is the single source of truth).

### HTML pages

- [ ] `app/page.tsx` (`/`) — full HTML-page header set, correct CSP.
- [ ] `app/products/[slug]/page.tsx` — full HTML-page header set.
- [ ] `app/account/layout.tsx` (every account/* route) — full HTML-page
      header set, including the layout's redirect target `/login`.
- [ ] `app/admin/*` (every admin route) — full HTML-page header set.
- [ ] `app/auth/callback/route.ts` — full HTML-page header set (it's a
      server-rendered redirect target; not browser-initial).

### Image / XML / text routes

- [ ] `/og?title=X` — no CSP, no Permissions-Policy, no COOP/CORP.
      Other universal headers + HSTS + X-Frame-Options still set.
- [ ] `/sitemap.xml` — no CSP, no Permissions-Policy, no COOP/CORP.
- [ ] `/sitemap-products.xml` — same.
- [ ] `/sitemap-collections.xml` — same.
- [ ] `/sitemap-pages.xml` — same.
- [ ] `/robots.txt` — no CSP, no Permissions-Policy.

### Binary / API routes

- [ ] `/api/files/[id]/download` — no CSP, no Permissions-Policy, no
      COOP/CORP, no HSTS, no X-Frame-Options. Universal headers only.
- [ ] `/api/files/[id]/stream` — same as download.
- [ ] `/api/orders/[id]/grants` — no CSP, no Permissions-Policy, no
      COOP/CORP. Universal + HSTS + X-Frame-Options.
- [ ] `/api/search` — same as orders/grants.
- [ ] `/api/webhooks/stripe` — no CSP, no Permissions-Policy, no
      COOP/CORP, no HSTS, no X-Frame-Options. Universal headers only.

### Healthcheck

- [ ] `/healthz` — no CSP, no Permissions-Policy, no COOP/CORP, no
      HSTS, no X-Frame-Options. Universal headers only.
- [ ] `/api/health` — same as /healthz.

### Static assets

- [ ] `/_next/static/*`, `/_next/image`, `/favicon.ico` — middleware
      matcher excludes these (no headers applied; Next.js's static
      handler ships its own headers).

### Test coverage

- [ ] Unit tests cover the full HTML-page header set, the image /
      XML / text variant, the binary / API variant, the healthcheck
      variant, and the webhook variant.
- [ ] CI script (`pnpm check:security-headers`) boots the dev server,
      curls 7 representative routes (`/`, `/products/missing`,
      `/sitemap.xml`, `/og?title=Test`, `/api/health`,
      `/api/files/1/download`, `/api/webhooks/stripe`), and asserts
      each expected header value.
- [ ] The CI script is wired into `pnpm check:all`.

### Spec + doc

- [ ] `01-specs/pages/security-headers.md` (this file) is checked in.
- [ ] `00-foundations/security/README.md` documents the module's
      public surface, the per-route variant table, and how to add
      a new header.
- [ ] `06-quality/checklists/security-audit.md` Infrastructure section
      references this spec.

## Out of scope (deferred to follow-ups)

- **Per-request CSP nonces** for `script-src` and `style-src`. Next.js
  15's server-action runtime injects inline scripts that we can't
  easily nonce without rewriting every server component. A follow-up
  spec will introduce a `nonce-{request-id}` injection + an
  `'unsafe-inline'` removal.
- **Subresource Integrity (SRI)** for the few third-party scripts
  (PostHog snippet). SRI is the right defense once we move to nonce-
  based CSP.
- **Reporting-Endpoints** for CSP violation telemetry. PostHog (or
  Sentry once it lands in P18.1) can be a CSP violation sink — wire
  when the analytics event shape lands in P2.9.
- **Permissions-Policy finer-grained allow list** (e.g. allowing
  camera on `/admin/account-switcher` for avatar capture). We don't
  use these features in v1.
- **CSP `report-uri` / `report-to`** for browser-side violation
  reporting. Will land alongside the violation sink.

## Open questions

None at P2.7 ship time. The v1 trade-off (inline-script CSP) is
documented in `_followups.md` as a deferred hardening.