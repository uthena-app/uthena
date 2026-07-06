# 404 Not Found — `/404` (route-level not-found)

## What this page does

The route-level "page not found" page. Renders when **no Next.js route matches the URL** (a user typed `/blah-blah`) OR when a server component calls `notFound()` (a route exists but the resource does not, e.g. a deleted product slug, an expired invite, a server-action that returns 404 for an ineligible user). This is the **global** 404 surface — every URL that does not resolve to a real page eventually renders this.

The page is a friendly, helpful dead-end: a large "404" display, a one-line explanation, a search bar (navigates to `/browse?q=...`), and two CTAs (home, browse catalog). The page is public, has no forms to submit, and ships minimal client JS (the search input). The page is RSC + SSR — **no ISR**. A 404 must always be fresh because the URL might have just stopped existing.

This page is the **route-level** 404. Individual feature pages that return 404 for "this product is no longer available" or "this lesson has been removed" should render the **same user-facing UI as this spec** but they are themed variants owned by each feature spec (the product spec owns its 404, the library spec owns its 404, etc.). The route-level 404 is the fallback when no feature owns the URL.

## Data this page shows

| Section | Field | Source | Format |
|---|---|---|---|
| Hero | large "404" | hard-coded | display heading, ~96px |
| Headline | "We can't find that page" | hard-coded | H1, mid-size |
| Subhead | "The page you're looking for may have moved, been retired, or never existed." | hard-coded | muted paragraph |
| Search bar | text input + "Search catalog" button | hard-coded (form action GETs `/browse?q=...`) | inline form |
| Primary CTA | "Go home" → `/` | hard-coded | primary button |
| Secondary CTA | "Browse catalog" → `/browse` | hard-coded link | secondary text link |
| Footer | "If you think this is a mistake, email support@uthena.com" | hard-coded | small muted text + `mailto:` |

**Server load:** none. The page is fully static. No DB reads, no auth checks (the page is for both auth and anon users).

**Soft 404 vs hard 404:** when a server component returns `notFound()`, Next.js renders this page with the correct HTTP status code (404). When no route matches the URL at all, Next.js also renders this page with 404. In both cases, the user-facing UI is identical. (We are NOT doing soft-404 — i.e. rendering 200 OK with a "not found" body. Every 404 returns the 404 status code for SEO and monitoring.)

**Migration boundary:** legacy Shopify URLs are not allowed to fall through to this page until the redirect map has been checked. Product, collection, page, blog, policy, search, account, cart, and agent-commerce legacy routes must either redirect to an approved v2 target or deliberately return 404/410 with a reason in the migration map.

**No client-side tracking beyond a Plausible page-view event** (with the URL path as the property, so we can see which missing URLs are most common — flag in Open Questions §2).

## User actions

| Action | Trigger | Result | RBAC |
|---|---|---|---|
| Open the page | Visit any unmatched URL, or trigger `notFound()` from a server component | Renders the 404 UI with HTTP status 404 | public |
| Search | Type in the search bar and submit | Navigates to `/browse?q=<query>` (a real route, not another 404) | public |
| Go home | Click "Go home" | Navigate to `/` | public |
| Browse catalog | Click "Browse catalog" | Navigate to `/browse` | public |
| Email support | Click support mailto | Opens mail client pre-filled with `?subject=Broken link on uthena.com` | public |

## What this page does NOT do

- No "report a broken link" form (mailto is the v1 channel; a form is a v2 follow-up)
- No "did you mean...?" auto-suggest (no fuzzy matching; the user types and we route to `/browse?q=...`)
- No "popular pages" or "recently viewed" widgets (anonymous users have no history; auth users might, but we don't have that signal on a 404 — flag in Open Questions §3)
- No login prompt (a 404 should not feel like a paywall)
- No Sentry client-side error reporting (the 404 itself is not an error; it's an expected response)
- No PII displayed (no email, no user_id, no IP)
- No third-party widgets (the search bar is a form, not an Algolia / Typeahead widget in v1)
- No 404 counter on the page ("you are visitor #1,234 to this 404")
- No "this is a known 404" cache (a fresh 404 every time — no ISR)

## Acceptance criteria

- [ ] Page is publicly accessible; no auth required
- [ ] The route-level `not-found.tsx` file exists at the app root (`03-app/not-found.tsx`) and is registered with Next.js as the global 404
- [ ] Visiting any unmatched URL (e.g. `/this-does-not-exist`, `/products/foo/bar/baz`) renders the 404 UI with HTTP status 404 (not 200)
- [ ] Before launch, the full Shopify sitemap export is crawled against v2 and no URL from the export reaches this 404 unless it is explicitly marked `gone` or `no replacement` in the migration map
- [ ] No legacy product, collection, blog, page, or policy URL redirects to `/` as a catch-all
- [ ] A server component calling `notFound()` (e.g. a product page where the slug does not resolve) renders the same 404 UI with HTTP status 404
- [ ] The HTTP response status is 404 in both cases (verified via `curl -I` and via the Next.js response object)
- [ ] The "Search catalog" form submits to `/browse?q=<input>` (GET method)
- [ ] "Go home" routes to `/`; "Browse catalog" routes to `/browse`
- [ ] The page is RSC + SSR; no ISR; every request is fresh (no `revalidate` directive on the page)
- [ ] No PII is displayed; no PII is logged (404s are logged with the URL path only, not the user's identity)
- [ ] No `TODO` / `FIXME` in the diff
- [ ] No Sentry / error reporting fires when this page renders (a 404 is an expected response, not an error)
- [ ] Open Graph tags fall through to the default site tags (no per-404 OG image in v1)
- [ ] No client-side JS is shipped for the search interaction beyond a small inline form (verify via the Next.js bundle analyzer — < 2 KB)
- [ ] A 404 never redirects (it returns 404 with the UI; the user is not bounced to a different URL)

## Design reference

- Mockup: not yet built — to be created during the error-pages feature build
- Components: `00-foundations/ui/NotFoundHero.tsx` (404 display + headline + subhead), `00-foundations/ui/SearchBar.tsx` (compact, 1-field form), `00-foundations/ui/CTAStack.tsx` (primary + secondary buttons)
- Tokens: `00-foundations/design/tokens.css`
- Theme: dark (default) + light

## Security

- **Auth required:** NO
- **Allowed roles:** public
- **RLS policies that apply:** N/A — no DB access
- **PII displayed:** NO — the page has no user data
- **PII in URLs:** the unmatched URL is in the address bar but is not echoed back into the page body. We do not reflect the URL in the headline ("The page `/foo/bar` was not found") because that would help an attacker probe for valid paths. Instead, we show a generic message and let the user search.
- **Open redirect:** the search form GETs `/browse?q=...`. The query string is a search term, not a redirect target. There is no server-side redirect on this page.
- **CSRF:** N/A — no state-changing actions
- **Rate limiting:** standard edge rate limit is sufficient. If a specific IP triggers > 1000 404s in 5 minutes, the edge layer (Cloudflare) returns a 429 — that's a configuration, not a code change.
- **404 enumeration attacks:** the page intentionally does NOT differentiate "this product exists but is not yours" from "this product does not exist". Both render the same 404 UI. This is the same enumeration-leak protection pattern used in `account-refund.md` and `account-certificates.md`. The information leak is in the **URL itself**, not the response — knowing `/admin/refunds` 404s tells you the route exists, but our 404 UI does not.
- **Audit logged:** NO — 404s are an expected response, not a security event. We log aggregate metrics (Plausible page-view with the path as a property) but not per-request audit rows.
- **Email injection / header injection:** N/A — no emails sent from this page
- **Third-party scripts:** none beyond the standard Plausible page-view tag (in the root layout)

## Performance

- **Target p95:** < 100ms (fully static, no DB, no auth)
- **Render strategy:** RSC + SSR. **No ISR.** Every 404 is rendered fresh.
- **Cache:** the page is intentionally **not cached** at the edge. Each request is a fresh render. (Caching 404s would be a soft-404 pattern, which we do not want — see Soft 404 vs hard 404 above.)
- **DB load:** zero
- **Bundle size budget:** < 2 KB added to client bundle (the search input is a tiny form; no JS framework needed)
- **Image loading:** N/A — no images on this page

## Out of scope for v1

- "Report a broken link" form (mailto only)
- "Did you mean...?" auto-suggest
- "Popular pages" or "recently viewed" widgets
- Per-404 OG image
- A 404 counter or "you are visitor #N" widget
- A "this is a known 404" cache (every 404 is fresh)
- 404 with a "go back" button (browser back is built-in; adding a button is redundant)
- A themed 404 for major holidays (a v2 follow-up)

## Open questions for human

1. **Soft 404 vs hard 404.** Some platforms return 200 OK with a "not found" body for SEO reasons (Google deprioritizes soft-404s, but a 200 OK can keep the URL in the index longer). My recommendation: **hard 404** (return the 404 status code, no index) — this is the correct behavior for a fresh spec, and Google deindexes 404 URLs over time. If SEO retention of legacy URLs is a concern (e.g. `/old-product-slug` should stay indexed for 6 months), the answer is **301 redirect**, not 200 OK. Confirm hard 404.
2. **Plausible page-view property.** We log a Plausible event for every 404 with `props: { path: <the unmatched URL> }`. This is aggregate, no PII, and helps us see which missing URLs are most common (so we can add 301 redirects for the top offenders). My recommendation: **yes, log the path** (no PII; the path is already in the server logs anyway). Confirm.
3. **Auth-aware "popular pages" for auth users.** Auth users hitting a 404 could see a "your recently visited products" widget. We don't have that data on hand at 404-render time without a DB read, and the v1 404 is public/static. My recommendation: **defer to v2**. The v1 404 has no auth-aware widgets. Confirm defer.
4. **Feature-owned 404s vs route-level 404.** Some features (e.g. the product page) might want a themed 404 with a "browse similar products" rail instead of the generic "search catalog" bar. My recommendation: **keep the route-level 404 as the global fallback**, and let features opt-in to a themed variant by rendering their own `notFound()` UI from within the feature. The product feature can ship a themed 404 in a follow-up; the route-level 404 stays in place for any URL no feature owns. Confirm the layered model.
5. **410 for deliberately removed content.** For legacy URLs with no safe replacement, should we return 404 or 410? My recommendation: 410 for intentionally removed products/articles after human review, 404 for unknown/unmapped paths. Confirm.

---

## Implementation notes

- **P0.23 tick — 2026-06-24.** The route-level 404 was previously
  shipped (P0.21) with full inline styles. P0.23 refactored it to a
  token-only CSS module (`app/not-found.module.css` — same inode in
  `03-app/` per the dual-tree convention). The page is RSC, uses
  `buildPageMetadata` for OG + Twitter + noindex, and renders the
  search form + `Button` primitive CTAs (Go home / Browse catalog).
  Zero inline `style="` attributes on the rendered HTML.
- **Inherits Organization JSON-LD** from the root layout (1 valid
  `<script type="application/ld+json">` tag on every 404 response;
  verified `JSON.parse`-able).
- **Same surface for `notFound()` calls.** `/products/missing`
  returns HTTP 404 with the identical 404 copy + CTAs as
  `/this-route-does-not-exist` (Next.js's `notFound()` integration
  routes through this page).
