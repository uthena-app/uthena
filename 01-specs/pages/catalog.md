# Catalog (Browse) — `/browse`

## What this page does

The main browse page. Shows all published products with filters (price, license, length, format, rating, category) and sort options (popular, newest, price, rating). The default view is a 3-column grid of product cards. A list view is also available via the toolbar toggle. URL is the source of truth for filter/sort state, so any filter combination is shareable and back-button-friendly.

SEO migration requirement: the current Shopify store exposes catalog surfaces as `/collections/[handle]`, `/collections/all`, `/search`, and collection pagination/sort URLs. The live sitemap contains 81 collection URLs as of 2026-06-16. V2 uses `/browse` as the canonical all-products catalog route. Indexable category pages use `/collections/[handle]` so category equity is preserved. Every legacy collection handle must be mapped to `/browse`, a canonical `/collections/[handle]` category page, `/bundles`, or another explicit approved target before launch.

## Data this page shows

| Field | Source | Format | Filter/Sort |
|---|---|---|---|
| `slug` | products | URL slug | — |
| `title` | products | text | searchable |
| `short_description` | products | text (truncated to 2 lines) | — |
| `category.name`, `category.slug` | products → categories | text | filterable |
| `partner.display_name`, `partner.public_slug` | products → partners | text | filterable for legacy instructor collections |
| `thumbnail_url` | products | image, 16:9 | — |
| `price_cents` (lowest active tier) | products → product_pricing | number, formatted | filterable + sortable |
| `rating_avg` | products (computed from reviews) | number, 1 decimal | filterable + sortable |
| `sales_count` | products (cached) | integer | sortable |
| `total_lesson_count` | products | integer | — |
| `total_duration_seconds` | products | formatted as `Xh Ym` | filterable |
| `kind` | products | enum | filterable (in v2, hidden in v1 UI) |
| `badges` | derived | "Featured" (sales > 1000), "Hot" (sales > 500 in 30d), "New" (published < 14d) | — |
| `legacy_collection_handle` | Shopify import manifest / redirect map | server-only | legacy redirect lookup |

**Query:** `02-features/catalog/queries/getCatalog.ts` — `getCatalog({ category?, collection?, partner?, priceMin?, priceMax?, license?, lengthBucket?, format?, ratingMin?, sale?, sort, q, cursor })`. Returns paginated results, default 24 per page.

**Canonical query params:** `q`, `category`, `collection`, `partner`, `license`, `kind`, `priceMin`, `priceMax`, `length`, `rating`, `sale`, `sort`, `page`. Filter pages may be shareable, but only the default `/browse`, approved `/collections/[handle]` category pages, and approved collection landing pages are indexable. Sort, pagination beyond page 1, and stacked filters are canonicalized to their base page unless an SEO spec explicitly says otherwise.

**Legacy collection mapping:**

| Current Shopify URL type | Examples from live sitemap | V2 target |
|---|---|---|
| All products | `/collections/all` | `/browse` |
| Top-level categories | `/collections/ai-courses`, `/collections/business-courses`, `/collections/entrepreneurship-courses`, `/collections/mental-health-courses` | canonical `/collections/[handle]` category page |
| License collections | `/collections/plr`, `/collections/mrr` | `/browse?license=plr`, `/browse?license=plr_mrr` unless approved as indexable collection pages |
| Merchandising collections | `/collections/newest-online-courses-on-uthena`, `/collections/courses-with-discount`, `/collections/daily-deals`, `/collections/last-chance` | `/browse?collection=[handle]` with curated sort/filter, unless approved as indexable collection pages |
| Bundle collection | `/collections/plr-bundles` | `/bundles` |
| Instructor/vendor collections | `/collections/aamir-hussain`, `/collections/arbaz-khan`, `/collections/tj-walker` | `/browse?partner=[public_slug]` unless a public instructor page spec supersedes this |

## User actions

| Action | Trigger | Result | RBAC |
|---|---|---|---|
| Apply filter | Click any filter checkbox | URL updates with query param; list re-renders | public |
| Clear all filters | Click "Clear all filters" in sidebar | URL strips all filter params | public |
| Sort | Change sort dropdown | URL updates with `?sort=` | public |
| Change page | Click pagination button | URL updates with `?page=` | public |
| Toggle view | Click grid/list view toggle | Local state (not in URL) | public |
| Search | Type in nav search bar, press Enter | Navigate to `/browse?q=...` (existing filter pipeline) | public |
| Open legacy search URL | Visit `/search?q=...&type=product` | Permanent redirect to `/browse?q=...`; unsupported search params are dropped | public |
| Click category chip | Click any chip in category strip | URL updates with `?category=[slug]` | public |
| Open category collection URL | Visit `/collections/[handle]` for an approved category | Render the indexable category collection page with canonical `/collections/[handle]` | public |
| Open non-category legacy collection URL | Visit `/collections/[handle]` for license, sale, bundle, or instructor/vendor collections | Permanent redirect to the mapped `/browse`, `/bundles`, or approved target | public |
| Click product card | Click anywhere on a card | Navigate to `/products/[slug]` | public |
| Export CSV | Click "Export CSV" in header | Triggers a server action that returns a signed URL to a generated CSV (filtered to current view) | public (anonymous export allowed) |
| Sign in (for buy) | Click "Get started" / add to cart | Redirects to `/signup?next=/products/[slug]` if anon | public CTA, action requires auth |

## What this page does NOT do

- No infinite scroll (explicit pagination, easier to reason about, better for SEO and analytics)
- No saved searches (v2)
- No "recently viewed" (no auth on this page)
- No comparison view (v2)
- No bundle composition UI on the catalog (bundles either have their own page or appear as `kind=bundle` cards after `bundles.md` is approved)
- No full instructor profile pages from here. Legacy instructor collections are preserved as partner-filtered browse views unless a dedicated public instructor page is approved.

## Acceptance criteria

- [ ] Default load shows 24 published products in a 3-column grid
- [ ] Filter state is reflected in the URL (shareable links)
- [ ] The canonical query param names above are the only query params emitted by the UI
- [ ] Back button restores previous filter state correctly
- [ ] Active filter chips appear at the top with ✕ buttons to remove individually
- [ ] "Clear all filters" appears only when ≥ 1 filter is active
- [ ] All 4 sort options work and change the order
- [ ] `/search?q=<term>&type=product` permanently redirects to `/browse?q=<term>`
- [ ] `/collections/all` permanently redirects to `/browse`
- [ ] All 81 Shopify collection handles from the launch export are present in the redirect map before launch
- [ ] Approved category collection URLs render as canonical `/collections/[handle]` pages and never collapse to `/` or `/browse` by default
- [ ] License, sale, newest, daily-deal, last-chance, bundle, and instructor/vendor collections each map to an explicit target
- [ ] The category seed list includes every current top navigation category, including Entrepreneurship and Mental Health, or the launch notes document the approved merge target
- [ ] Pagination works: prev/next, page numbers, ellipsis for > 5 pages
- [ ] Switching to list view persists across page changes (localStorage, not URL)
- [ ] Category strip is sticky on scroll (only the top one, above the grid)
- [ ] Sidebar is sticky on scroll (only on desktop, > 960px)
- [ ] Empty state: when filters return 0 results, show a "No products match these filters" message with a "Clear all filters" CTA
- [ ] No results state has a helpful illustration or icon, not just text
- [ ] Page renders in < 250ms p95 (slightly higher than home because of filtering)
- [ ] No layout shift when products load
- [ ] All product images have proper alt text (title text)
- [ ] Keyboard nav: Tab through category chips, filters, sort, product cards
- [ ] Screen reader: filter changes announced via aria-live
- [ ] Collection/category landing metadata is not generic: title, description, H1, canonical, and OG copy include the category/collection name
- [ ] Browse/category sitemaps include `/browse` and canonical indexable `/collections/[handle]` URLs only; sort URLs and stacked filter URLs are excluded
- [ ] No `TODO` / `FIXME` in the diff

## Design reference

- Mockup: `mockups/browse.html` (dark) + `mockups/browse-light.html` (light)
- Design tokens: `00-foundations/design/tokens.css`
- Components: `00-foundations/ui/ProductCard.tsx`, `00-foundations/ui/SidebarFilter.tsx`, `00-foundations/ui/Pagination.tsx`, `00-foundations/ui/EmptyState.tsx`

## Security

- **Auth required:** no — public marketplace
- **Allowed roles:** anyone
- **RLS policies that apply:** `products` (public read where `status = 'published'`), `categories` (public read), `product_pricing` (public read where `active = true` and product is published)
- **PII displayed:** no
- **PII in URLs:** no — only slugs and filter codes
- **Audit logged:** no — read-only public page
- **Abuse protection:** CSV export has rate limiting (10/hour per IP, see `00-foundations/money/limits.ts`)
- **Legacy redirect safety:** collection/search redirect targets are generated from an allowlisted map, never from a user-provided `return_to`, `next`, or arbitrary URL param.
- **Third-party scripts:** none

## Performance

- **Target p95:** < 250ms (filtering adds latency vs. home)
- **Render strategy:** RSC + URL-driven (server reads searchParams, queries DB)
- **Cache:** RSC cache keyed on URL (full search string) with stale-while-revalidate. Top sellers / default-sort view has 60s ISR.
- **DB index:** `products (status, published_at desc) where status = 'published'` is the hot path
- **Bundle size budget:** N/A (RSC-only)
- **Legacy redirect performance:** non-rendered `/collections/[handle]` mappings and `/search` redirects target < 50ms p95 and do not run the full catalog query.

## Out of scope for v1

- Saved searches / search history (requires auth)
- Rich bundle builder or bundle composition
- Sticky "filter rail" toggle on mobile (filters live in a drawer in v2)
- Recently viewed
- "New arrivals" tab (sort=newest is enough)
- Trending algorithm (sales_count desc is enough for v1)

## Open questions for human

- **Instructor/vendor collections:** the current Shopify sitemap contains many instructor collection handles. My recommendation is to preserve them as `/browse?partner=[public_slug]` in v1, then add public instructor profile pages later only if analytics show meaningful traffic. Confirm.
- **Merchandising collections:** decide whether `/collections/daily-deals`, `/collections/last-chance`, and `/collections/courses-with-discount` remain real curated collections in v1 or redirect to sale/newest filters. My recommendation: keep them as explicit `collection` filters backed by a curated collection table, because these URLs likely have promotional backlinks.

---

## Implementation notes

- (filled by the building agent)
