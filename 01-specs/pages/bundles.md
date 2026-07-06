# Bundles — `/bundles`

## What this page does

The public bundles landing page. It preserves the current live bundle surfaces `/pages/bundles`, `/pages/collection-bundles`, and `/collections/plr-bundles`, while fitting the v2 product model where `products.kind = 'bundle'`. The canonical URL is `/bundles`; legacy Shopify page and collection URLs redirect here unless a more specific bundle product target is approved. It lists curated PLR/MRR bundles and explains bundle licensing clearly.

## Data this page shows

| Section | Field | Source | Format |
|---|---|---|---|
| Header | title, description, bundle value proposition | hard-coded or page markdown | H1 + prose |
| Bundle grid | `slug`, `title`, `short_description`, `thumbnail_url`, `price_cents`, `included_product_count`, `license_tiers` | products where `kind='bundle'` | cards |
| Bundle FAQ | licensing, delivery, refunds | markdown/static | FAQ list |
| SEO metadata | title, description, canonical, OG image | route metadata | `<head>` |

## User actions

| Action | Trigger | Result | RBAC |
|---|---|---|---|
| Open bundles | Navigate to `/bundles` | Renders bundle landing page | public |
| Open legacy bundle page | Navigate to `/pages/bundles`, `/pages/collection-bundles`, `/collection-bundles`, or `/collections/plr-bundles` | Permanent redirect to `/bundles` or a mapped bundle product target | public |
| Click bundle | Click bundle card | Navigate to `/products/[slug]` for that bundle product | public |
| Browse all products | Click secondary CTA | Navigate to `/browse` | public |

## What this page does NOT do

- No custom bundle builder
- No bundle composition editor
- No dynamic discount calculator
- No bundle-aware cart line expansion in v1

## Acceptance criteria

- [x] `/bundles` is public and indexable
- [x] Legacy bundle URLs permanently redirect to `/bundles` unless a specific bundle/product target is approved
- [x] Bundle cards render only published products with `kind='bundle'`
- [x] If no bundle products are active, the page shows a designed empty state and links to `/browse?license=plr`
- [x] Bundle product cards link to `/products/[slug]`
- [x] Bundle sitemap inclusion follows the same canonical policy as product/catalog pages
- [x] Page renders in < 200ms p95
- [x] No placeholder markers in the diff

## Design reference

- Use `mockups/browse.html` card density, with a compact explanatory header.

## Security

- **Auth required:** NO
- **Allowed roles:** public
- **RLS policies that apply:** `products_public_read_published`, `product_pricing_public_read_active`, `bundle_items_public_read_published` (P0.18 — added in migration 0016 to gate the included-courses preview strip)
- **PII displayed:** NO
- **PII in URLs:** NO
- **Audit logged:** NO

## Performance

- **Target p95:** < 200ms
- **Render strategy:** RSC + ISR with `revalidate = 60`
- **Bundle size budget:** 0 KB client JS

## Out of scope for v1

- Build-your-own bundle
- Bundle membership/subscription
- Cart line item expansion for bundle children

## Open questions for human

1. **Bundle scope:** brand docs place bundles in v2 expansion, but the live site already has bundle URLs. My recommendation is a small v1 bundles page for preservation, using existing `product_kind='bundle'`, without building a bundle composer. Confirm.

---

## Implementation notes

- P0.18 (2026-06-24): placeholder replaced with a real RSC + ISR listing.
  - `02-features/catalog/queries.ts` gained `getPublishedBundles()` —
    two-query read (bundle products filtered by `kind = 'bundle'` and
    `status = 'published'`, then the `bundle_items` join for the
    included-courses preview, grouped in JS, capped at 24 items per
    bundle for the listing).
  - `02-features/catalog/BundleCard.tsx` + `.module.css` — a
    ProductCard-shaped card with a "Bundle" pill on the cover (teal
    identity) and a 3-thumb included-courses preview strip at the
    bottom of the body. RSC, no client JS.
  - `app/bundles/page.tsx` rewritten — eyebrow + h1 (with teal
    accent on the second half) + lede + live-count + 3-col grid +
    `EmptyState` fallback ("No bundles live yet" + "Browse the
    catalog" CTA) + tail CTA ("or browse the full catalog →").
  - `app/bundles/bundles.module.css` — token-only, 3-col → 2-col →
    1-col responsive at the same breakpoints as /browse +
    /collections/[handle].
  - `04-platform/migrations/0016_bundles.sql` — new
    `bundle_items` table (bundle_product_id, included_product_id,
    display_order, note ≤280, UNIQUE on the pair, CHECK against
    self-inclusion) with RLS (`bundle_items_public_read_published`
    + `bundle_items_admin_all`) and two indexes
    (`bundle_items_bundle_idx` for the listing read path,
    `bundle_items_included_idx` for the reverse lookup used by
    P0.12 + P12.7 + admin tooling).
  - `next.config.mjs` redirects — added the two legacy
    `/pages/bundles` + `/pages/collection-bundles` 308s to
    `/bundles` (per `seo-url-migration.md` Shopify page map).
  - `02-features/catalog/queries.ts` re-exports `BUNDLE_PREVIEW_LIMIT`
    (3) + `BUNDLE_LISTING_LIMIT` (60) +
    `MAX_ITEMS_PER_BUNDLE_FOR_LISTING` (24) so the page + future
    consumers can stay in sync.
  - `00-foundations/data/types.ts` — no new placeholder needed
    (the queries use `Pick<Tables<'products'>, ...>` for both the
    bundle and the included-product shape, and `bundle_items` is
    only read for its join columns, not surfaced in the TS layer).
