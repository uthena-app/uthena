# `00-foundations/structured-data` — JSON-LD structured data for SEO

## What this is

A single source of truth for schema.org JSON-LD structured data
across every page in the app. Three pure schema builders + one
`<JsonLd>` render component.

- **`buildOrganizationSchema()`** — site-wide `Organization`
  entity. Rendered once via `app/layout.tsx`.
- **`buildBreadcrumbSchema(items)`** — per-page `BreadcrumbList`
  entity. Pages with visible breadcrumbs (or a clear
  hierarchical context) emit this.
- **`buildProductSchema(product)`** — per-product `Product`
  entity. Emitted on `/products/[slug]`.
- **`<JsonLd data={...} />`** — server component that renders
  `<script type="application/ld+json">` with the JSON-stringified
  payload. Accepts a single schema object OR an array of schemas.

## Why a helper

Hand-rolling JSON-LD `<script>` tags is bug bait. Crawlers reject
schemas with even small errors (missing `@context`, wrong field
types, mismatched URLs), and debugging requires a separate tool.
The builders:

1. Force the correct `@context: 'https://schema.org'` + `@type`
   on every schema.
2. Resolve app-relative paths to absolute URLs (crawlers won't
   chase a `<base href>` tag).
3. Pick the right default pricing tier for `offers.availability`
   (mirrors the page's own default-tier picker).
4. Omit `aggregateRating` when there are zero reviews (Google
   guideline — never emit a rating with no reviews).
5. Escape `</` sequences in the JSON before injecting it
   (defense in depth against script-tag injection).

## When to use

| Page surface | Use |
|---|---|
| **Every page** (root layout) | `<JsonLd data={buildOrganizationSchema()} />` — emitted once globally |
| `/products/[slug]` | `<JsonLd data={[buildProductSchema(product), buildBreadcrumbSchema([...] )]} />` — Product + BreadcrumbList |
| `/collections/[handle]` | `<JsonLd data={buildBreadcrumbSchema([...]) } />` |
| `/browse` (when `?category=X` is set) | `<JsonLd data={buildBreadcrumbSchema([...]) } />` |
| `/bundles` | `<JsonLd data={buildBreadcrumbSchema([...]) } />` |
| `/contact`, `/faq`, `/newsletter` | `<JsonLd data={buildBreadcrumbSchema([...]) } />` |
| Legal pages (`/privacy`, `/terms`, etc.) | Existing `Article` schema stays (already wired). No BreadcrumbList — legal pages don't have a breadcrumb UI. |
| Authenticated surfaces (`/library`, `/account`, `/partner`, `/admin`) | **No** JSON-LD — those surfaces are already `noindex` (P0.21), structured data adds no SEO value and could leak internal structure. |

## Multiple schemas per page

The `<JsonLd>` component accepts either a single object or an
array. When a page emits multiple schemas (e.g. Product +
BreadcrumbList on the product detail page), pass an array — the
component renders one `<script>` tag per schema, which is easier
to debug than a single `@graph` tag.

```tsx
<JsonLd
  data={[
    buildProductSchema(product),
    buildBreadcrumbSchema([
      { name: 'Home', path: '/' },
      { name: 'AI courses', path: '/collections/ai-courses' },
      { name: 'Personal Branding 101', path: `/products/${product.slug}` },
    ]),
  ]}
/>
```

## Security

- The `<JsonLd>` component escapes every `</` sequence in the
  JSON payload before injecting it via `dangerouslySetInnerHTML`.
  Defense in depth against script-tag injection. Our data is
  server-controlled so a real injection requires a server-side
  compromise — but the escape is cheap and is the standard
  recommendation from Google's docs.
- All URLs are absolute + site-controlled (`https://uthena.com/...`).
  No user input ever reaches the payload.
- The script tag is a data island — nothing executes on the
  client. Crawlers parse it; browsers ignore it.

## Performance

- The JSON-LD payload adds ~500 bytes to the served HTML per
  schema. Two schemas on a page = ~1 KB. Negligible.
- Server-rendered. No client JS shipped. The `<JsonLd>` component
  is a server component that returns a `<script>` tag; no
  hydration.
- The payload is part of the page's ISR/SSG output, so it
  inherits the page's cache TTL (60s for product pages, 24h for
  legal pages).

## Notes

- **Why omit `aggregateRating` instead of emitting zero.**
  Google's guidelines explicitly warn against emitting a rating
  when there are no reviews — it's a misleading rich result that
  Google penalizes. The builder omits the field entirely when
  `review_count` is 0.
- **Why hardcode the `sku` format.** The `products` table
  doesn't have a real SKU column yet (P12.7 lands it via the
  partner wizard). For now the schema synthesizes
  `<LICENSE>-<id>` (e.g. `PLR-1284`) matching the on-page "ID
  #PLR-1284" badge from P0.12 Slice 1. When P12.7 lands, swap
  to the real SKU column.
- **Why no `WebSite` schema in the root layout.** Google's
  `WebSite.potentialAction` requires a real search endpoint that
  crawlers can call. P19.10 wires the real search backend;
  P19.x wires the `WebSite` schema after that.
- **Why no `FAQPage` schema.** Google dropped rich-result
  support for FAQPage in 2023. The FAQ page still emits
  `BreadcrumbList` (when the FAQ page is added to the breadcrumb
  trail).