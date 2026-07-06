# Structured Data (JSON-LD) — site-wide (P0.22)

<!--
P0.22 covers JSON-LD structured data for SEO crawlers. Cross-cutting
spec — multiple page surfaces consume it.
-->

## What this surface does

Every page emits `<script type="application/ld+json">` blocks with
schema.org structured data so search-engine crawlers (Google, Bing,
DuckDuckGo) can render rich results. The site ships three schema
types in this phase:

1. **`Organization`** — site-wide, rendered once in the root
   `<body>` via `app/layout.tsx`. Tells crawlers the canonical
   company / brand entity behind the site.
2. **`BreadcrumbList`** — on every page that has a visible
   breadcrumb UI (or a clear hierarchical context). Tells
   crawlers the page's position in the site hierarchy so the
   SERP shows a breadcrumb trail under the result.
3. **`Product`** — on every `/products/[slug]` page. Tells
   crawlers the product's name, description, image, price,
   currency, availability, aggregate rating, and review count
   so the SERP can render a product card with price + stars.

The work lives in one new module — `00-foundations/structured-data/`
— that exposes pure schema-builders + a single `<JsonLd>` render
component. Pages import the builder, pass it data, and drop the
component into JSX.

## Data this surface shows

### `Organization` (site-wide)

| Field | Source | Format |
|---|---|---|
| `@type` | constant | `'Organization'` |
| `name` | `SITE_NAME` constant from `@foundations/metadata` | `'Uthena'` |
| `url` | `SITE_ORIGIN` constant | `'https://uthena.com'` |
| `logo` | `SITE_ORIGIN + '/og?title=Uthena&subtitle=...' ` | absolute URL |
| `description` | root layout's `description` metadata | string ≤ 200 chars |
| `sameAs` | empty array | `[]` — populated when social handles land (P19.16) |
| `contactPoint` | empty array | `[]` — populated when support contact info lands |

### `BreadcrumbList` (per-page)

| Field | Source | Format |
|---|---|---|
| `@type` | constant | `'BreadcrumbList'` |
| `itemListElement` | array of `{ position, name, item }` | length 1..N |

Each `ListItem` has:
- `position: number` (1-indexed)
- `name: string` (the link text)
- `item: string` (absolute URL — `SITE_ORIGIN + <path>`)

The last item is the current page; its `item` is still included
so crawlers can map the URL → title directly (Google's docs
recommend this).

### `Product` (per product page)

| Field | Source | Format |
|---|---|---|
| `@type` | constant | `'Product'` |
| `name` | `product.title` | string ≤ 200 chars |
| `description` | `product.short_description` | string ≤ 5000 chars (Google max) |
| `image` | `product.thumbnail_url` (or first `product.images[0].url`) | absolute URL |
| `sku` | synthesized as `<LICENSE>-<id>` (e.g. `PLR-1284`) | string |
| `brand` | hardcoded to `Organization` reference | `{ @type: 'Brand', name: 'Uthena' }` |
| `offers` | derived from `defaultTier` + currency | `{ @type: 'Offer', price, priceCurrency, availability, url }` |
| `aggregateRating` | `product.avg_rating` + `product.review_count` | `{ @type: 'AggregateRating', ratingValue, reviewCount, bestRating, worstRating }` |
| `category` | `product.category.name` (when present) | string |

`offers.availability` is `'https://schema.org/InStock'` when the
product has at least one active pricing tier; `'https://schema.org/OutOfStock'`
otherwise. `offers.url` is the canonical product URL (matches the
`alternates.canonical` from `buildPageMetadata`).

`aggregateRating` is omitted (not included in the JSON-LD) when
`review_count` is 0 — Google's guidelines say never emit a
rating with no reviews (it's misleading).

## User actions

| Action | Trigger | Result |
|---|---|---|
| Crawl a page | Googlebot / Bingbot fetches `https://uthena.com/<path>` | Server-rendered HTML includes the JSON-LD script(s). Google's Rich Results Test tool passes. |
| Browse to a product in Google | User searches `site:uthena.com <course name>` | SERP shows the product title + price + stars + breadcrumb trail. |
| Browse to the site root in Google | User searches `uthena` | Knowledge panel / site links are anchored to the Organization entity. |

## What this surface does NOT do

- Does NOT emit `WebSite` schema with `potentialAction` (Google's
  sitelinks search box) — that requires a working `search` action
  endpoint that crawlers can call. P19.10 wires the real search
  backend; P19.x wires `WebSite` after that.
- Does NOT emit `LocalBusiness` / `Restaurant` schema (Uthena is
  digital-only — no physical address).
- Does NOT emit `FAQPage` schema on the FAQ page (Google dropped
  rich-result support for FAQPage in 2023; still emits
  `BreadcrumbList`).
- Does NOT emit `Course` schema (Google deprecated it; the
  `Product` schema with `category: "Course"` is the modern
  equivalent).
- Does NOT emit `sameAs` social handles (Uthena's Twitter/X,
  LinkedIn, etc. are not defined yet — P19.16 social surface).
- Does NOT emit `contactPoint` (support contact email is
  intentionally not in the schema until we have a real support
  inbox routing system).

## Acceptance criteria

- [ ] `00-foundations/structured-data/` module exists with
      `buildOrganizationSchema()`, `buildBreadcrumbSchema()`,
      `buildProductSchema()`, and a `<JsonLd>` render component
- [ ] `buildOrganizationSchema()` returns a valid `Organization`
      JSON-LD object with `@type`, `name`, `url`, `logo`, `description`,
      `sameAs: []`, `contactPoint: []`
- [ ] `buildBreadcrumbSchema(items)` returns a valid `BreadcrumbList`
      JSON-LD object with `itemListElement: [{ position, name, item }, ...]`
      where `position` is 1-indexed and `item` is an absolute URL
- [ ] `buildProductSchema(product)` returns a valid `Product`
      JSON-LD object with `name`, `description`, `image`, `sku`,
      `brand`, `offers`, and (when reviews exist) `aggregateRating`
- [ ] `buildProductSchema()` omits `aggregateRating` when the
      product has zero published reviews
- [ ] `buildProductSchema()` sets `offers.availability` to
      `'InStock'` when the product has at least one active pricing
      tier, otherwise `'OutOfStock'`
- [ ] `<JsonLd>` component renders a `<script type="application/ld+json">`
      tag with the JSON-stringified payload via
      `dangerouslySetInnerHTML`
- [ ] `<JsonLd>` escapes `</` sequences in the JSON to prevent
      script-tag injection (defense-in-depth even though our
      data is server-controlled)
- [ ] `<JsonLd>` accepts a single object OR an array of objects
      (when a page emits multiple schemas, e.g. Product +
      BreadcrumbList)
- [ ] Root layout renders `<JsonLd>` with the `Organization`
      schema exactly once per page render
- [ ] `/products/[slug]` page renders BOTH `<JsonLd>` for the
      `Product` schema AND `<JsonLd>` for the `BreadcrumbList`
      schema (Home > Category > Product)
- [ ] `/collections/[handle]` page renders `<JsonLd>` for the
      `BreadcrumbList` schema (Home > Collections > {handle})
- [ ] `/browse` page renders `<JsonLd>` for the `BreadcrumbList`
      schema when a category is filtered
      (Home > Browse > {category})
- [ ] `/bundles` page renders `<JsonLd>` for the `BreadcrumbList`
      schema (Home > Bundles)
- [ ] Every page's `<script type="application/ld+json">` payload
      parses as valid JSON when fed to `JSON.parse`
- [ ] The new `00-foundations/structured-data/` module has a
      README documenting when to use each schema
- [ ] No `TODO` / `FIXME` / `HACK` in any new file
- [ ] No PII (no `.email`, `password`, `token`, `secret`) in any
      console / log statement in the new module
- [ ] `pnpm typecheck` passes
- [ ] `pnpm lint` passes
- [ ] `pnpm check:no-todo` passes
- [ ] `pnpm check:pii` passes
- [ ] `pnpm check:specs` passes (no new routes from P0.22; new
      spec `structured-data.md` covers the cross-cutting surface)
- [ ] `pnpm check:rls` passes (no new tables from P0.22)
- [ ] `pnpm build` compiles cleanly
- [ ] `GET /` served HTML contains a valid `<script
      type="application/ld+json">` with an `Organization`
      schema
- [ ] `GET /products/<slug>` served HTML contains TWO
      `<script type="application/ld+json">` tags: one
      `BreadcrumbList`, one `Product`
- [ ] Google's Rich Results Test passes for the `Product`
      schema (manual verification, documented in the slice note)

## Design reference

- Mockup: `mockups/home.html` lines 1–17 (the `<head>` block —
  no JSON-LD today, but the brand chrome matches what we emit)
- Schema.org docs:
  - [Organization](https://schema.org/Organization)
  - [BreadcrumbList](https://schema.org/BreadcrumbList)
  - [Product](https://schema.org/Product)
- Google's
  [Structured Data General Guidelines](https://developers.google.com/search/docs/appearance/structured-data/intro-structured-data)
  + [Product structured data](https://developers.google.com/search/docs/appearance/structured-data/product)
  + [Breadcrumb structured data](https://developers.google.com/search/docs/appearance/structured-data/breadcrumb)

## Security

- **Auth required:** no. JSON-LD is public so crawlers can read it.
- **Allowed roles:** public.
- **RLS policies that apply:** none. P0.22 touches no tables.
- **PII displayed:** no. The Organization schema has the brand
  name + URL + logo only — no user data. The BreadcrumbList
  schema has page titles + URLs only — no user data. The Product
  schema has product-level public data (title, description,
  price, rating) — no user data.
- **PII in URLs:** no. All URLs are absolute + site-controlled
  (`https://uthena.com/...`). No query-string injection vectors
  (the `BreadcrumbList` items don't include search params).
- **XSS via `</script>` injection:** the `<JsonLd>` component
  replaces every `</` sequence with `<\/` in the JSON-stringified
  payload before injecting it. Defense in depth — our data is
  server-controlled so a real injection requires a server-side
  compromise, but the escape is the standard recommendation from
  Google's docs.
- **Audit logged:** no.
- **Third-party scripts:** none. JSON-LD is parsed by crawlers,
  not by client JS. The `<script>` tag is a data island; nothing
  executes on the client.

## Performance

- **Target p95:** zero added latency. The JSON-LD script is
  generated server-side as part of the page render. The script
  tag adds ~500 bytes to the served HTML (the JSON payload),
  which is negligible.
- **Render strategy:** RSC. The JSON-LD builders are pure
  functions; the `<JsonLd>` component is a server component.
- **Cache:** the JSON-LD payload is part of the page's
  ISR/SSG output, so it inherits the page's cache TTL
  (60s for product pages, 24h for legal pages).
- **Bundle size budget:** zero client JS. `<JsonLd>` is a
  server component that returns a `<script>` tag; no client
  hydration.

## Out of scope for v1

- `WebSite` schema with sitelinks search box (P19.10 wires the
  real search backend first).
- `FAQPage` schema (Google dropped rich-result support in 2023;
  no benefit).
- `Course` schema (deprecated by Google).
- `sameAs` social handles (P19.16 social surface).
- `contactPoint` schema (no support inbox yet).
- JSON-LD on authenticated surfaces (`/library`, `/account`,
  `/partner`, `/admin`) — those surfaces are already
  `noindex` (P0.21), so structured data adds no SEO value.
- JSON-LD for blog articles (`Article` schema) — Phase 19 P19.5
  + P19.6 wire the blog + admin TipTap editor, then the
  Article schema lands with that.
- Per-product variants (size / color / etc.) — Uthena products
  are digital; one Product entity per product. The pricing tier
  (PLR / MRR / RR) is encoded in the `sku` field, not as
  multiple `Offer` entries, because each tier is the same
  digital deliverable with different rights — not a variant
  product. A future refactor could emit multiple `Offer`s per
  tier if SEO testing shows it helps.

## Open questions for human

- **Social handles.** `sameAs` is an empty array today. When the
  brand's Twitter/X / LinkedIn / YouTube URLs are defined, add
  them as `next.config.mjs` env vars (or hardcoded constants in
  the Organization builder). Not blocking P0.22.
- **Brand name vs Trade name.** Uthena is the trade name; if the
  legal entity name differs (e.g. "Dantwah LLC" owns the
  Uthena brand), we'd emit both as `Organization.name` and
  `Organization.alternateName`. Today `name` = `'Uthena'`; flip
  when we have a real legal entity to point at.

---

## Implementation notes (filled in during/after build)

- **Why a separate module from `00-foundations/metadata/`.** Both
  modules output HTML `<head>` data, but `metadata` returns a
  `Metadata` object (typed by Next.js) and `structured-data`
  returns plain JSON-serializable objects + a `<JsonLd>`
  component. Different consumers, different API shapes. Keeping
  them in separate modules avoids forcing the metadata module
  to import a React component (which would break the
  server-only type contract some pages rely on).
- **Why a single `<JsonLd>` component (not one per schema type).**
  The script tag is the same for every schema type; the only
  difference is the payload. One component keeps the
  `</script>` escape logic in one place.
- **Why escape `</` even though our data is server-controlled.**
  Google's docs explicitly recommend the escape as defense in
  depth. If a future contributor adds a schema field that
  includes user-supplied data (e.g. user-generated product
  names), the escape prevents a script-tag injection. Cheap
  to add; expensive to forget.
- **Why omit `aggregateRating` instead of emitting zero.** Google's
  guidelines explicitly warn against emitting a rating when
  there are no reviews — it's a misleading rich result that
  Google penalizes. Better to render the Product schema without
  the rating block; Google will still pick up the other fields.
- **Why hardcode the `sku` format.** The `products` table doesn't
  have a SKU column yet (P12.7 adds it via the partner wizard).
  For now the schema synthesizes `<LICENSE>-<id>` (e.g. `PLR-1284`)
  matching the on-page "ID #PLR-1284" badge from P0.12 Slice 1.
  When P12.7 lands, swap to the real SKU column.
- **Why no `WebSite` schema in the root layout.** Google's
  `WebSite.potentialAction` requires a real search endpoint
  that crawlers can call. The current `/search?q=` page is RSC
  + ISR, not a JSON endpoint; emitting `WebSite.potentialAction`
  would point crawlers at a URL that 404s. P19.10 lands the
  real search endpoint; P19.x wires the WebSite schema after
  that.