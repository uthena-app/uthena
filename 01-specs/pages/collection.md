# Collections — `/collections` and `/collections/[handle]`

## What this page does

Two surfaces share the `/collections` namespace:

1. **`/collections`** (index) — lists every active category AND every
   published featured collection. RSC, ISR 60s.
2. **`/collections/[handle]`** (detail) — renders a single collection's
   header, description, and product grid. Falls back to a
   category-as-collection view for legacy Shopify redirect URLs.

A **collection** is a hand-picked, team-curated grouping of products
distinct from a **category** (which is the partner-facing taxonomy).

## Data this page shows

### `/collections` index

- Header (eyebrow + h1 + lede)
- "Featured collections" section (P0.17 new) — `collections` rows
  with `status = 'published'`, sorted featured-first then by
  `display_order`. Hidden entirely when no collections are published.
- "All categories" section — every category with at least one
  published product. Renders `EmptyState` when none exist.

### `/collections/[handle]` detail

- Header (eyebrow + h1 + description) for a curated collection
- Or header (eyebrow + h1 + lede) for a legacy category fallback
- Product grid (3-col desktop / 2-col tablet / 1-col mobile)
- Empty state ("This collection is being curated" / "No courses in
  this collection yet")

## User actions

- Click a category or collection card → navigate to `/collections/[handle]`
- Click a product card → navigate to `/products/[slug]`
- "See all collections" CTA inside the curated empty state → `/collections`

## Acceptance criteria

- [x] `/collections` index is an RSC, ISR 60s
- [x] `/collections` index lists published collections when any exist,
      then the categories list
- [x] `/collections/[handle]` is an RSC, ISR 60s
- [x] Curated collection lookup runs before the category fallback
- [x] Category fallback preserves `/collections/<category-slug>` URLs
      (legacy Shopify redirects)
- [x] Active categories only (product_count > 0) on the index
- [x] Sorted by `is_featured desc, display_order, name` (collections)
      and `display_order` (categories)
- [x] Empty state designed for both branches
- [x] Keyboard accessible — every card is a real `<Link>` with
      `:focus-visible` ring

## Data model

Two tables (migration `0015_collections.sql`):

- **`collections`** — `id`, `slug` (unique), `name`, `description`,
  `hero_image_url`, `is_featured`, `display_order`, `status`
  (draft/published/archived), `published_at`, `created_at`,
  `updated_at`.
- **`collection_products`** — `id`, `collection_id` (FK, cascade),
  `product_id` (FK, cascade), `display_order`, `note` (≤280 chars),
  `added_at`, UNIQUE(collection_id, product_id).

## Security

- **Auth.** Both routes are public (anon + auth). No data requires
  login to read.
- **RLS.** `collections_public_read_published` (anon read for status =
  'published'); `collections_admin_all` (admin write only).
  `collection_products_public_read_published` (anon read for rows in
  published collections referencing published products).
- **No secrets / no PII.** No `console.*` / `logger.*` calls in the
  page; Supabase error messages are logged at error level only.

## Performance

- Index `collections_index_idx` (partial, status='published', covers
  the index page query).
- Index `collections_slug_idx` (covers the by-slug detail lookup).
- Index `collection_products_collection_idx` (covers the detail
  page's products query).
- ISR 60s on both routes.
- p95 budget: ≤ 250ms (the index reads two cached queries; the
  detail reads one collection + one product join).

## Out of scope for v1

- Admin UI to CRUD collections (lands in Phase 14 — admin console,
  P14.6 content moderation queue + collection editor).
- Partner self-suggestion of products to collections (future).
- Featured-in badge on the product detail page (future Phase 19).
- Per-product note display on the collection detail page (the data
  is in `collection_products.note`; the v1 grid renders products
  flat without the note).

## Open questions

None.
