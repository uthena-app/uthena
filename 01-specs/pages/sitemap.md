# Sitemap — `/sitemap.xml`, `/sitemap-products.xml`, `/sitemap-collections.xml`, `/sitemap-pages.xml`

> **This spec is the P0.20 surface.** The cross-cutting launch contract
> (sitemap INDEX, robots.txt, legacy redirects, launch crawl) lives in
> [`seo-url-migration.md`](./seo-url-migration.md). This page spec owns
> the four sitemap routes only; the robots.txt route has its own spec at
> [`robots.md`](./robots.md); the legacy redirect map and launch crawl
> checklist remain with the cross-cutting spec.

## What this page does

The search-engine discovery surface for `uthena.com`. Returns four
public XML endpoints that crawlers consume:

| Route | Returns | Source |
|---|---|---|
| `/sitemap.xml` | Sitemap INDEX referencing the three children below | static route registry |
| `/sitemap-products.xml` | Every published product + bundle slug | `products` table |
| `/sitemap-collections.xml` | `/browse` + every published curated collection + every active category (legacy URL) | `collections` + `categories` |
| `/sitemap-pages.xml` | Home + browse surface + bundles + newsletter + every legal page | static route registry |

All four are public, cache 1 hour, and respond with
`Content-Type: application/xml; charset=utf-8`. No auth, no PII, no
secrets.

## Data this page shows

| Field | Source | Format | Sort/filter |
|---|---|---|---|
| `<loc>` | route URL registry + DB rows | absolute `https://uthena.com/...` | n/a |
| `<lastmod>` | `products.updated_at` / `collections.updated_at` / build timestamp for static pages | ISO-8601 timestamp | optional per `sitemaps.org` |
| `<changefreq>` / `<priority>` | omitted | n/a | optional — we keep the sitemap minimal |

**Why an INDEX and not a flat file (per the cross-cutting spec):**
- Each child sitemap is small + focused; easier for crawlers to parse.
- We can add/remove child sitemaps without rewriting the INDEX.
- Keeps each file comfortably under the 50,000-URL ceiling even at
  uthena.com's full catalog scale (465 products, 81 collections,
  ~20 static pages).
- Matches the launch requirement captured in
  [`seo-url-migration.md`](./seo-url-migration.md).

## User actions

This page has no UI. The "user" is a search-engine crawler.

| Action | Trigger | Result | RBAC |
|---|---|---|---|
| Crawl INDEX | `GET /sitemap.xml` | Returns `<sitemapindex>` referencing 3 children | public |
| Crawl products | `GET /sitemap-products.xml` | Returns `<urlset>` of every published `/products/[slug]` | public |
| Crawl collections | `GET /sitemap-collections.xml` | Returns `/browse` + every `/collections/[slug]` (curated + legacy category) | public |
| Crawl pages | `GET /sitemap-pages.xml` | Returns every static public page | public |

## What this page does NOT do

- **No authenticated pages.** Admin / account / cart / checkout / library
  / partner / affiliate dashboards are excluded — see robots.txt spec
  for the corresponding `Disallow` list.
- **No query-string variants.** Sort URLs, stacked-filter URLs, search
  results (`/search?q=...`), signed file URLs, and certificate
  verification URLs are all excluded — see the cross-cutting spec.
- **No blog URLs yet.** The blog surface (`/blog`, `/blog/[slug]`)
  lands in P19.5–P19.7. The sitemap does not emit blog URLs until
  `blog-index.md` + `blog-article.md` specs are approved.
- **No affiliate minishop URLs.** `/[handle]` (P13.8) and
  `/partners/[public_slug]` are not yet shipped. Excluded for now.
- **No hreflang.** Deferred to a future i18n surface.
- **No image sitemap.** Deferred — the launch spec marks this as
  "out of scope for v1."

## Acceptance criteria

- [ ] `GET /sitemap.xml` returns 200 with `Content-Type: application/xml; charset=utf-8`
- [ ] `/sitemap.xml` is a `<sitemapindex>`, NOT a flat `<urlset>`
- [ ] `/sitemap.xml` references exactly 3 children: `/sitemap-products.xml`, `/sitemap-collections.xml`, `/sitemap-pages.xml`
- [ ] Every `<loc>` in every sitemap is absolute, canonical, HTTPS, same-host
- [ ] `/sitemap-products.xml` contains one `<url>` per published product (incl. bundles, since bundles are products with `kind='bundle'`)
- [ ] `/sitemap-collections.xml` contains `/browse` plus one `<url>` per published curated collection slug
- [ ] `/sitemap-collections.xml` also contains one `<url>` per legacy category slug (categories with `product_count_cache > 0`) so the Shopify-era `/collections/<category>` URLs are preserved in the sitemap
- [ ] No duplicate slugs in `/sitemap-collections.xml` (curated + category share the namespace)
- [ ] `/sitemap-pages.xml` contains `/`, `/browse`, `/bundles`, `/newsletter`, `/contact`, `/faq`, `/terms`, `/privacy`, `/refund-policy`, `/delivery`, `/dmca`, `/data-sharing-opt-out`
- [ ] Each child sitemap emits no more than 5,000 `<url>` entries (sitemap protocol ceiling is 50,000 — we cap well below for safety)
- [ ] Every `<loc>` resolves to a real route that returns 200 (no `/pages/...`, no `/marketplace`, no `/agents.md`)
- [ ] All four responses include `Cache-Control: public, max-age=3600, s-maxage=3600`
- [ ] All four responses are revalidated hourly via Next.js ISR (`export const revalidate = 3600`)
- [ ] No auth required; no PII in XML body; no secrets leaked
- [ ] Every slugs is XML-escaped (defensive — current schema uses URL-safe slugs only)

## Design reference

N/A — infrastructure route returns XML. No mockup.

## Security

- **Auth required:** NO — all four routes are public.
- **Allowed roles:** public (crawlers).
- **RLS policies that apply:** the `products` RLS policy
  `products_public_read_published` already restricts anon reads to
  `status = 'published'`. The sitemap queries use the same anon-safe
  Supabase client as every other public catalog read.
- **PII displayed:** NO.
- **PII in URLs:** N/A — slugs are not PII.
- **Open redirect protection:** N/A — no redirect targets; only emits
  fixed canonical URLs.
- **Audit logged:** NO — public infrastructure route, no state change.

## Performance

- **Target p95:** sitemap INDEX < 100 ms, each child sitemap < 250 ms
- **Render strategy:** static / ISR-cached route handlers
- **Cache:** `Cache-Control: public, max-age=3600, s-maxage=3600`;
  `export const revalidate = 3600` for Next.js Data Cache.
- **Bundle size budget:** N/A — no client JS shipped.

## Out of scope for v1

- Image sitemap (deferred; cross-cutting spec marks this "out of scope for v1")
- Hreflang / multilingual sitemaps (deferred until i18n surface)
- Per-URL hit dashboard (deferred)
- Search Console submission API automation (deferred)

## Open questions for human

None for v1. The cross-cutting spec covers the launch-redirect and
sitemap-submission runbook.

---

## Implementation notes

- (filled by the building agent)