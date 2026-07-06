-- ============================================================================
-- 0015_collections.sql — Curated, team-managed product collections.
--
-- A "collection" is a hand-picked grouping of products, distinct from a
-- `category` (which is a broad subject taxonomy). Examples: "Best for
-- new affiliates", "PLR starter pack", "2026 instructor picks". The
-- /collections/[handle] page (P0.17) renders one collection per page:
-- header + description + product grid. The same /collections/[handle]
-- URL also serves the legacy Shopify collection-redirect URLs that
-- pointed at category slugs (e.g. `/collections/ai-courses` — see
-- `01-specs/pages/seo-url-migration.md`); the page tries collections
-- first, then falls back to the category lookup so legacy URLs keep
-- working.
--
-- Why a separate `collections` table (and not a flag on categories)?
--   - The two concepts are different: a category has a parent (tree),
--     is partner-visible in the admin taxonomy editor, and is used by
--     the browse sidebar. A collection is flat, team-curated, and
--     purely promotional ("hand-picked by Uthena").
--   - Sharing a single table would force a JOIN on every browse query
--     ("is this row a category OR a collection?") and complicate RLS.
--     Two tables = clean separation = one index per read path.
--   - The product grid + header layout is identical, so the page
--     composes the same `ProductCard` either way.
--
-- Why `collection_products` as a join table (and not a JSONB column)?
--   - Per-row RLS — partner visibility for a product-in-collection
--     mirrors the products table's "published only" read policy.
--   - Orderable (`display_order`) without JSONB-array gymnastics.
--   - Future partner suggestion system (Phase 12 P12.x) can add a
--     `suggested_by_partner_id` column without touching the products
--     row.
--   - Backed by a composite index for the "all products in a
--     collection, in display order" read path.
--
-- RLS:
--   - `collections`: public read for published rows (status =
--     'published'), partner + admin write. There is no per-partner
--     ownership — collections are platform-owned — so no partner
--     self-write policy.
--   - `collection_products`: public read for rows in published
--     collections referencing published products. Admin write.
--     Partners do NOT add their products to collections — collections
--     are team-curated, not partner-curated.
--
-- Conventions:
--   - All money fields are bigint cents; this table has no money
--     fields (collections are not sold directly).
--   - Slugs are lowercase, hyphenated, globally unique. Reserved
--     against top-level app routes per `01-specs/pages/_data-model.md`
--     §"Reserved handle list" — the admin tool must enforce this at
--     write time (the DB doesn't know about app routes).
--   - Soft delete via `status = 'archived'`, not `deleted_at`.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- collections
-- ---------------------------------------------------------------------------
create table if not exists collections (
  id bigserial primary key,
  slug text not null unique,
  name text not null,
  -- Short paragraph shown on the collection page below the h1.
  -- Nullable: a collection can opt out of showing a description
  -- (the page hides the block when null).
  description text,
  -- Optional hero image for the collection page. Stored as a Bunny
  -- Storage public URL; we don't try to resize/transform at the DB
  -- layer. The page falls back to a mockup-faithful teal-on-cream
  -- gradient banner when null.
  hero_image_url text,
  -- Pin a collection to the top of /collections index. Display_order
  -- is the secondary sort key. Both default to 0.
  is_featured boolean not null default false,
  display_order int not null default 0,
  -- 'draft' | 'published' | 'archived'. Draft collections are admin-
  -- only; the public catalog never sees them. The collection_products
  -- join is keyed on the collection id regardless of status, but the
  -- page only renders published rows.
  status text not null default 'draft'
    check (status in ('draft', 'published', 'archived')),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table collections enable row level security;

-- Public read for published rows. Matches the categories pattern.
drop policy if exists "collections_public_read_published" on collections;
create policy "collections_public_read_published" on collections
  for select using (status = 'published');

-- Admin can do anything. There is no partner self-write — collections
-- are team-curated, not partner-curated (Phase 14 P14.6 wires the
-- admin tool for this).
drop policy if exists "collections_admin_all" on collections;
create policy "collections_admin_all" on collections
  for all using (is_admin());

-- Slug is the public URL — already unique via the constraint above,
-- but the explicit index speeds up the by-slug lookup on the page.
create index if not exists collections_slug_idx on collections(slug);

-- Composite index for the /collections index page: "featured first,
-- then by display_order, only published rows". Partial index — we
-- never need to scan archived or draft collections for the public
-- index.
create index if not exists collections_index_idx
  on collections (is_featured desc, display_order, name)
  where status = 'published';

drop trigger if exists collections_set_updated_at on collections;
create trigger collections_set_updated_at before update on collections
for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- collection_products — join table between collections and products
-- ---------------------------------------------------------------------------
create table if not exists collection_products (
  id bigserial primary key,
  collection_id bigint not null references collections(id) on delete cascade,
  product_id bigint not null references products(id) on delete cascade,
  display_order int not null default 0,
  -- Optional admin note (e.g. "Why we picked this"). Nullable: most
  -- collection rows don't have one. Length cap mirrors the
  -- affiliate_curated_products column for symmetry.
  note text check (note is null or char_length(note) <= 280),
  added_at timestamptz not null default now(),
  -- A product can appear in a collection at most once. UNIQUE is
  -- enforced at the DB level so admin tooling can't double-add by
  -- accident.
  unique (collection_id, product_id)
);

alter table collection_products enable row level security;

-- Public read for rows in published collections referencing published
-- products. The exists-checks keep the policy honest: a draft
-- collection or an unpublished product must never leak through.
drop policy if exists "collection_products_public_read_published" on collection_products;
create policy "collection_products_public_read_published" on collection_products
  for select using (
    exists (
      select 1 from collections c
      where c.id = collection_products.collection_id
        and c.status = 'published'
    )
    and exists (
      select 1 from products p
      where p.id = collection_products.product_id
        and p.status = 'published'
    )
  );

-- Admin can do anything.
drop policy if exists "collection_products_admin_all" on collection_products;
create policy "collection_products_admin_all" on collection_products
  for all using (is_admin());

-- Composite index for the collection detail page read path:
-- "all products in a collection, in display order". Covers the
-- WHERE collection_id = ? ORDER BY display_order, p.published_at
-- DESC pattern the page will use.
create index if not exists collection_products_collection_idx
  on collection_products (collection_id, display_order);

-- Reverse lookup index — "which collections include this product?"
-- for the planned Phase 19 marketing-surface "Featured in" badge on
-- the product detail page. Cheap to maintain (small join table) and
-- makes that future query index-only.
create index if not exists collection_products_product_idx
  on collection_products (product_id);

comment on table collections is
  'Team-curated product collections (P0.17). Distinct from categories (taxonomy). Public read for status = ''published''. Admin write only — collections are platform-owned.';

comment on table collection_products is
  'Join table for collections → products (P0.17). UNIQUE on (collection_id, product_id). Public read only when both the collection AND the product are published. Admin write.';
