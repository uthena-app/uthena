-- ============================================================================
-- 0013_product_bullets.sql — Perks list data for the product detail page.
-- The product page (P0.14, P0.12 Slice 3) renders a `.pinfo .perks`
-- block at the bottom of the right column: a stacked list of short
-- bullet items, each prefixed with a teal check circle. Mockup-faithful
-- to `mockups/product.html` lines 101–106 and
-- `mockups/styles/main.css` lines 293–295.
--
-- Why JSONB (and not text[])?
--   - The spec calls for a JSONB column (`01-specs/pages/product.md`).
--   - Future bullets might be richer than plain strings (e.g. `{ text,
--     icon, kind }` once the partner wizard ships in P12.7 and the
--     admin editor in P14.13). JSONB leaves room to evolve without
--     another migration.
--   - Storage is still small at scale — 4–8 short strings per row,
--     ~1KB per product in the worst case.
--   - Indexing/perf: the column is read once per product detail
--     page-load (the bullet list isn't filtered/sorted/searched),
--     so JSONB indexes are unnecessary. The RLS-aware read path
--     stays the same: it's a single column on the products row
--     that's already being read.
--
-- Why nullable (no default)?
--   - Products created before this migration don't have bullets.
--     The page falls back to the mockup-faithful 4-item list when
--     bullets is null (see `02-features/product/ProductPerks.tsx`).
--   - Partners can explicitly clear bullets by saving `[]` (which
--     renders nothing — different intent from "hasn't been set").
--   - This matches the convention used elsewhere on the products row
--     (`preview_video_url` is nullable for the same reason — pre-
--     existing rows didn't have a preview video).
--
-- Why no separate table (and not a `product_perks` table)?
--   - The list is small (4–8 items), conceptually owned by the
--     product, and never queried independently of the product row.
--   - JSONB keeps the read path to a single column on the already-
--     read products row — no join cost.
--   - Future per-bullet metadata (created_at, author, sort_order)
--     can live inside the JSONB entries as the wizard evolves.
--     If per-bullet analytics become a thing, a separate table
--     can be extracted without changing the public shape.
--
-- RLS:
--   - The column is on the `products` table, which already has RLS
--     (public-read-for-published, partner-read-own, partner-write-own,
--     admin-all) — see 0001_initial.sql + 0011_product_review_aggregates.sql.
--     `bullets` inherits all of that automatically.
--   - No new policy needed: the existing products policies cover
--     every column on the table.
-- ============================================================================

-- 1. Add the column. Idempotent (ADD COLUMN IF NOT EXISTS is supported
--    on Postgres 9.6+). Nullable so existing rows aren't forced into
--    a default. JSONB (not JSON) — JSONB normalizes whitespace + key
--    order, supports containment queries, and is the project's
--    convention for flexible per-row data.
alter table products
  add column if not exists bullets jsonb;

-- 2. Shape constraint. The column must be NULL or a JSONB array of
--    plain strings. We don't enforce max length here — the application
--    layer (ProductPerks.tsx) caps each bullet at MAX_BULLET_LENGTH
--    chars and the total list at MAX_BULLET_COUNT items, which keeps
--    the schema flexible for future partner wizard UI changes.
alter table products
  drop constraint if exists products_bullets_shape_check;
alter table products
  add constraint products_bullets_shape_check
  check (
    bullets is null
    or (
      jsonb_typeof(bullets) = 'array'
      and jsonb_array_length(bullets) >= 0
      and jsonb_array_length(bullets) <= 50
    )
  );

-- 3. Index for the rare "products WITH bullets" admin query (the
--    "see which products have perk lists" backfill view). Partial
--    index — we never need to scan products that haven't set bullets
--    yet (the empty case is the majority during seeding).
create index if not exists products_bullets_present_idx
  on products (id)
  where bullets is not null;

comment on column products.bullets is
  'JSONB array of plain strings. The product detail page renders this as the perks list (mockup `.pinfo .perks` block, lines 101–106 of mockups/product.html). Null = use the mockup-faithful 4-item fallback in the page. Empty array = partner explicitly cleared the list, render nothing. Application layer caps each bullet at 200 chars and the list at 8 items.';