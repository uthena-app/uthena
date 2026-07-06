# SEO Meta — `OpenGraph` + `Twitter Card` — site-wide (P0.21)

<!--
P0.21 covers every page's social-share preview. Cross-cutting
spec — multiple pages consume it.
-->

## What this surface does

Every page in the Uthena app emits a complete `<head>` block
with `OpenGraph` + `Twitter Card` meta so a link pasted into
iMessage, Slack, Twitter, LinkedIn, Discord, etc. renders a
correct preview card with the page's title, description, image,
and canonical URL.

The work lives in two places:

1. **`00-foundations/metadata/buildPageMetadata.ts`** — pure
   helper that returns a Next.js `Metadata` object given a
   page's title, description, path, and optional image. Used
   by 30+ pages.
2. **`app/og/route.tsx`** — dynamic OG image generator. Uses
   Next.js's built-in `next/og` (`ImageResponse`) to render a
   1200×630 PNG with the Uthena brand chrome. Used as the
   default OG image for pages without their own.

## Data this surface shows

| Field | Source | Format | Notes |
|---|---|---|---|
| `title` | Page constant | string | Set per page. The root layout's `title.template` adds " · Uthena" suffix. |
| `description` | Page constant | string ≤ 200 chars | Reused for `<meta name="description">`, OG description, Twitter description. |
| `alternates.canonical` | `SITE_ORIGIN + path` | absolute URL | Always `https://uthena.com/<path>`. |
| `openGraph.url` | Same as canonical | absolute URL | Identical to canonical; Next.js surfaces both. |
| `openGraph.siteName` | `'Uthena'` | constant | |
| `openGraph.locale` | `'en_US'` | constant | |
| `openGraph.type` | `'website'` (default) / `'article'` (blog posts) | constant | `'product'` is allowed by OG spec but crawlers treat it like `website`; not currently emitted. |
| `openGraph.images[0].url` | Page `image` prop OR `/og?title=<title>` | absolute URL | 1200×630 PNG with `<title>` rendered into it. |
| `openGraph.images[0].width` | `1200` | constant | Standard social-share card aspect. |
| `openGraph.images[0].height` | `630` | constant | |
| `openGraph.images[0].alt` | `<title>` | string | Accessibility — every OG image has alt text. |
| `twitter.card` | `'summary_large_image'` | constant | Larger cards get more cold-share CTR. |
| `twitter.title` | `<title>` | string | |
| `twitter.description` | `<description>` | string | |
| `twitter.images[0]` | Same as OG image | URL | Twitter reuses the OG image — no separate render needed. |
| `robots` | `noindex` flag | `{ index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } }` | Set on every authenticated / sensitive surface. |

## User actions

| Action | Trigger | Result | RBAC |
|---|---|---|---|
| Share a page link | Paste URL into Slack / iMessage / Twitter | Preview card renders with title + description + image + brand | public |
| Browse to a sensitive page (e.g. `/cart`) | Navigate or paste URL | Page is rendered for the authenticated user but excluded from Google indexing via `robots: noindex` | authenticated |
| Save an OG image (server-side) | `GET /og?title=…&subtitle=…` | Returns a 1200×630 PNG with the brand chrome + the requested title | public (no auth required) |

## What this surface does NOT do

- Does not set `twitter.site` or `twitter.creator` (Uthena has
  no Twitter handle defined yet — future P19.16 social surface).
- Does not set `<link rel="alternate" hreflang="…">` (no i18n
  surface yet — future P19.x).
- Does not dynamically generate per-product OG images with the
  product cover baked in (P19.4 OpenGraph image generator
  builds that later; for now, product pages pass
  `image: product.thumbnail_url` to the helper so the existing
  product cover IS the OG image — crawlers render it directly).
- Does not set `<link rel="icon">` or `<link rel="apple-touch-icon">`
  (those are favicons, owned by P0.10 / general polish).
- Does not set `<meta name="theme-color">` (the root layout
  already sets `themeColor` in the `viewport` export).

## Acceptance criteria

- [ ] `app/layout.tsx` sets `metadataBase: new URL('https://uthena.com')` so relative `metadata.images[]` paths resolve correctly
- [ ] `app/layout.tsx` includes `openGraph` defaults: `siteName: 'Uthena'`, `locale: 'en_US'`, and a default `images` array pointing to `/og?title=Uthena&subtitle=Wholesale+PLR+Video+Courses`
- [ ] `app/layout.tsx` includes `twitter` defaults: `card: 'summary_large_image'`
- [ ] `app/og/route.tsx` exists, returns a valid 1200×630 PNG for `GET /og?title=…&subtitle=…`
- [ ] `app/og/route.tsx` caps `title` at 90 chars and `subtitle` at 60 chars (defensive against huge inputs)
- [ ] `app/og/route.tsx` sets `Cache-Control: public, max-age=3600, s-maxage=3600`
- [ ] `00-foundations/metadata/buildPageMetadata.ts` is a pure function that returns a complete `Metadata` object (title + description + canonical + OG + Twitter)
- [ ] Every public marketing page (home, browse, bundles, collections, search, newsletter, contact, FAQ, legal pages) emits a complete `Metadata` block via the helper OR via hand-rolled metadata with all required fields
- [ ] Every product detail page emits OG with `image: product.thumbnail_url` (already in P0.12; verified by P0.21 audit)
- [ ] Every authenticated / sensitive page (cart, checkout, login, signup, password reset, email verify, library, account/*, partner/*, admin/*, 404) sets `robots: { index: false, follow: false }` so the surface is excluded from search indexing
- [ ] No page imports `Metadata` types directly without emitting all the required OG + Twitter fields (the helper enforces this — if a page uses the helper, it's compliant by construction)
- [ ] `pnpm typecheck` passes
- [ ] `pnpm lint` passes
- [ ] `pnpm check:no-todo` passes (no `TODO` / `FIXME` / `HACK` in shipped code)
- [ ] `pnpm check:pii` passes (no `.email` / `password` / `token` / `secret` in console/log)
- [ ] `pnpm check:specs` passes (every route in `app/` has a spec; no new routes from P0.21)
- [ ] `pnpm check:rls` passes (no new tables from P0.21)
- [ ] `pnpm build` compiles cleanly
- [ ] `GET /og?title=AI+Personal+Branding` returns a 200 PNG (smoke test)
- [ ] `GET /og?title=…&subtitle=…` with very long inputs is capped defensively (no 500 error)

## Design reference

- Mockup: `mockups/home.html` lines 1–17 (the `<head>` block
  of the live uthena.com home page — used as the OG source of
  truth for brand voice + visual treatment)
- Design tokens: `00-foundations/design/tokens.css`
  (`--bg`, `--bg-elev-1`, `--accent` for the brand chrome;
  the OG image route uses literal hex because `next/og`'s
  `ImageResponse` doesn't resolve CSS variables — but the
  values match the tokens 1:1).
- Theme: dark (the OG image is always dark; the brand identity
  doesn't shift with light/dark theme).

## Security

- **Auth required:** no. The metadata route is public so
  crawlers can fetch the OG image.
- **Allowed roles:** public.
- **RLS policies that apply:** none. P0.21 touches no tables.
- **PII displayed:** no. The OG image renders the title +
  subtitle only; no user data, no email, no account info.
- **PII in URLs:** the `?title=` query param is rendered into
  the image as plain text. If a future page passes a
  user-controlled string as the title, that string would
  appear in the URL and the image. Pages should pass the
  page's static `title` constant, never user input.
- **Audit logged:** no.
- **Third-party scripts:** none. `next/og` is a built-in
  Next.js feature; no external service.

## Performance

- **Target p95:** the OG image route is generated server-side
  on first request, then cached at the edge for 1h. Cold
  render is ~150–250ms on a small VPS; warm cache hits are
  <10ms.
- **Render strategy:** Node.js runtime (Next.js 13.4+
  supports `next/og` on Node.js — no edge runtime needed).
- **Cache:** `Cache-Control: public, max-age=3600,
  s-maxage=3600`. Same TTL as the P0.20 sitemap routes.
- **Bundle size budget:** zero client JS shipped (the route
  is server-only). The OG image is a static-equivalent asset
  in the eyes of the browser.

## Out of scope for v1

- Per-product OG images with the product cover baked into
  the brand chrome (P19.4 OpenGraph image generator).
- `twitter.site` + `twitter.creator` (no Twitter handle
  defined — P19.16 social surface).
- `<link rel="alternate" hreflang="…">` for i18n (no i18n
  yet — P19.x future).
- `<link rel="icon">` and `<link rel="apple-touch-icon">`
  (general polish, not P0.21).
- Video OG / `<meta property="og:video">` for product
  preview videos (P9.2 Bunny signed stream URLs first;
  video OG surface later).
- Article structured data + JSON-LD (P0.22 owns that).

## Open questions for human

- **Twitter handle.** We don't set `twitter.site` because no
  handle is defined. If `@uthena` (or similar) is reserved
  for the brand, add it to `00-foundations/env.ts` as
  `NEXT_PUBLIC_TWITTER_HANDLE` and surface it in the helper.
  Defer until P19.16 or when social-sharing becomes a
  priority.
- **Per-page subtitle.** The dynamic OG image shows
  `<title>` + `Uthena` as a subtitle. Some pages (a specific
  product, a specific bundle) might want a custom subtitle
  ("PLR · 12 modules · 4h 38m" for a course, for example).
  The helper already supports passing a custom image URL,
  but the dynamic OG generator's `subtitle` param is
  currently always passed as `'Uthena'` from the default.
  Consider letting pages pass an `ogSubtitle` field in a
  follow-up tick if marketing wants per-page subtitles.
- **OG image aspect on Twitter.** Twitter recommends
  1200×600 (2:1) instead of 1200×630 (1.91:1) for cards.
  Most modern crawlers accept 1200×630; the difference is
  cosmetic. Leave as 1200×630 unless analytics show
  Twitter-specific cropping issues.

---

## Implementation notes (filled in during/after build)

- **Why a helper vs per-page hand-roll.** 30+ pages need
  the same shape; hand-rolling would mean 30+ files each
  with the same boilerplate, with subtle drift (one forgets
  `siteName`, another forgets `locale`, etc.). The helper
  enforces the contract.
- **Why `next/og` over a static PNG.** A static PNG would
  require generating 30+ per-page images OR a single
  brand-only image (no per-page title). Dynamic generation
  gives us per-page branded cards without binary asset
  maintenance. The cost is one file + one route handler +
  zero new dependencies.
- **Why no edge runtime.** Next.js 13.4+ supports
  `ImageResponse` on the Node.js runtime. Edge would be
  faster but adds deployment complexity (some VPS hosts
  don't have an edge runtime available). Node.js works
  everywhere we deploy.
- **Why `summary_large_image` not `summary`.** Larger cards
  get more cold-share click-through. Twitter's docs
  recommend `summary_large_image` for any link with a
  meaningful image.
- **Why hardcode `https://uthena.com` for canonicals.**
  Production origin is well-known. Dev previews
  (`localhost:3100`) intentionally use a different origin
  so we don't accidentally index dev URLs in production
  metadata.
- **Why `noindex` on `nocache: true`.** Defense in depth —
  crawlers should never serve a cached sensitive page
  snapshot. `nocache: true` asks them to refetch every time
  even if they have it (mostly a hint to intermediaries).