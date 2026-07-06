-- ============================================================================
-- 0016_bundles.sql — Bundle → included-product join table.
--
-- A "bundle" in v2 is a product with `products.kind = 'bundle'`. The product
-- itself has a title, description, thumbnail, pricing, and curriculum like
-- any other product — bundles ARE products in the catalog, not a separate
-- entity. What bundles ALSO have is an ordered list of "included courses"
-- (the products that ship in the bundle when a buyer purchases it). That
-- relationship lives in the `bundle_items` join table.
--
-- The /bundles listing (P0.18) renders one card per published bundle with a
-- preview of the included products ("Includes 5 courses" + 3 thumbnails +
-- "+2 more"). The same join is reused by:
--   - P0.12 product detail page (slice 6/7) — show a "What you get" section
--     when a product is a bundle
--   - P12.7 partner course creation wizard — let the partner pick which
--     products go in the bundle
--   - P19.11 bundles configurator — the customer-facing configurator
--
-- Why a separate `bundle_items` table (and not a JSONB column on products)?
--   - The included-product list is a real "many to many" relationship:
--     products can be included in multiple bundles (e.g. a popular AI
--     course can be in three different themed bundles). JSONB would make
--     the "where else is this course included?" query scan-and-parse.
--   - RLS: we need a public-read-published policy that checks BOTH the
--     bundle and the included product are published. A join table makes
--     that policy a clean `exists(...) and exists(...)` predicate.
--   - Backfill / migration symmetry — the future Phase 15 LMS schema has
--     the same shape (`lessons` is referenced by `course_lessons`), so
--     the pattern is consistent.
--   - Admin can attach a `note` per row (e.g. "The flagship AI course in
--     this bundle"). Mirrors the `collection_products.note` pattern.
--
-- RLS:
--   - `bundle_items`: public read for rows where the bundle product AND
--     the included product are both published. Admin write only in v1
--     (P12.7 wires the partner-write-own path; partner bundle editing is
--     the same workflow as course editing).
--
-- Self-bundle prevention: a bundle cannot include itself. Enforced via a
-- CHECK constraint. (Partners who try this get a clear DB error instead
-- of an infinite render loop on the bundle page.)
--
-- Cycle prevention: a bundle cannot include another bundle. The
-- `is_bundle_or_includes_bundle` constraint is non-trivial — deferred to
-- a future hardening pass; v1 relies on partner tooling to validate at
-- write time and admin can clean up the (rare) bad row.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- bundle_items — join table between bundles (products where kind='bundle')
-- and the products included in each bundle.
-- ---------------------------------------------------------------------------
create table if not exists bundle_items (
  id bigserial primary key,
  -- The bundle product. Cascade so deleting a bundle cleans up its
  -- included-courses list automatically.
  bundle_product_id bigint not null references products(id) on delete cascade,
  -- The included product. Cascade so deleting an included product removes
  -- it from every bundle it was in (an admin with a stale row can re-add
  -- it to the bundles that should still include it).
  included_product_id bigint not null references products(id) on delete cascade,
  -- 0-based display order. Lower = appears first in the card preview.
  display_order int not null default 0,
  -- Optional admin note explaining why this product is in the bundle.
  -- Length cap mirrors collection_products.note.
  note text check (note is null or char_length(note) <= 280),
  added_at timestamptz not null default now(),
  -- A product can be included in a bundle at most once. UNIQUE is
  -- enforced at the DB level so partner tooling can't double-add.
  unique (bundle_product_id, included_product_id),
  -- No self-inclusion. If the partner tried to make a bundle that
  -- includes itself, the product detail page would render an infinite
  -- "What you get →" loop. CHECK constraint catches it at write time.
  check (bundle_product_id <> included_product_id)
);

alter table bundle_items enable row level security;

-- Public read only when BOTH the bundle product and the included product
-- are published. The exists-checks keep the policy honest — draft
-- bundles and unpublished included products must never leak through.
drop policy if exists "bundle_items_public_read_published" on bundle_items;
create policy "bundle_items_public_read_published" on bundle_items
  for select using (
    exists (
      select 1 from products b
      where b.id = bundle_items.bundle_product_id
        and b.status = 'published'
        and b.kind = 'bundle'
    )
    and exists (
      select 1 from products p
      where p.id = bundle_items.included_product_id
        and p.status = 'published'
    )
  );

-- Admin can do anything in v1. The partner-write-own path is wired by
-- Phase 12 P12.7 (course creation wizard) — partners can add their own
-- products to their own bundles.
drop policy if exists "bundle_items_admin_all" on bundle_items;
create policy "bundle_items_admin_all" on bundle_items
  for all using (is_admin());

-- Composite index for the /bundles listing read path: "all items in
-- a bundle, in display order". The page queries this for every
-- published bundle.
create index if not exists bundle_items_bundle_idx
  on bundle_items (bundle_product_id, display_order);

-- Reverse lookup index — "which bundles include this product?" Used by:
--   - P0.12 product detail (slice 6) — "Also included in: [X bundle]"
--   - Partner delete confirmation — warn before deleting a product
--     that's in one or more bundles
--   - Admin reporting — product inclusion map
create index if not exists bundle_items_included_idx
  on bundle_items (included_product_id);

comment on table bundle_items is
  'Join table for bundles (products where kind=''bundle'') → included products (P0.18). UNIQUE on (bundle_product_id, included_product_id). CHECK prevents self-inclusion. Public read only when both the bundle AND the included product are published. Admin write in v1; partner-write-own lands in P12.7.';
