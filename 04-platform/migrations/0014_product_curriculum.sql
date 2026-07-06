-- ============================================================================
-- 0014_product_curriculum.sql — Curriculum data for the product detail page.
-- The product page (P0.15, P0.12 Slice 4) renders a `.curric` block
-- inside the Curriculum tab: an ordered list of `{index, name,
-- duration_seconds}` rows. Mockup-faithful to `mockups/product.html`
-- lines 131–133 and `mockups/styles/main.css` lines 307–311:
--
--   .curric { display: flex; flex-direction: column; gap: 0;
--             margin-top: var(--s-3); }
--   .curric .row { display: grid;
--                  grid-template-columns: 32px 1fr 80px;
--                  gap: var(--s-3);
--                  align-items: center;
--                  padding: var(--s-3) 0;
--                  border-top: 1px solid var(--line);
--                  font-size: 13px; }
--   .curric .row .idx  { font-family: var(--font-mono);
--                        color: var(--text-faint); font-size: 11px; }
--   .curric .row .nm   { color: var(--heading); }
--   .curric .row .dur  { font-family: var(--font-mono);
--                        color: var(--text-soft); text-align: right;
--                        font-size: 11px; }
--
-- Why JSONB (and not a separate `lessons` table)?
--   - The PHASES.md spec calls for a JSONB column on the product row
--     for v1 (`01-specs/pages/product.md` references `P0.15
--     curriculum JSONB`).
--   - Phase 15 LMS migration will normalize this to a proper `lessons`
--     table (with `lesson_progress` + `bookmarks` per the spec). The
--     JSONB shape is a v1 placeholder — the Phase 15 migration will
--     backfill the lessons table from the JSONB and drop the column
--     (or keep it as a denormalized read cache, TBD).
--   - The list is small (4–30 modules per product, the mockup has 12)
--     and is never queried independently of the product row.
--   - The product row is already read on every PDP load; adding one
--     more column is essentially free. A join to a `lessons` table
--     would be a second round-trip in the worst case.
--
-- Why nullable (no default)?
--   - Products created before this migration don't have a curriculum.
--     The Slice 4 component (when it ships) will fall back to the
--     mockup-faithful 12-item list (lines 132 of mockups/product.html)
--     when the column is null — same pattern as `products.bullets`
--     (P0.14, migration 0013) and the `ProductPerks` 4-item fallback.
--   - Partners can explicitly clear curriculum by saving `[]` — the
--     Slice 4 component will render nothing for that intent
--     (different from "hasn't been set").
--
-- Why this shape (`{index, name, duration_seconds}`)?
--   - Matches the mockup's `.curric .row` columns (`.idx`, `.nm`,
--     `.dur`) one-for-one.
--   - Durations in seconds match the existing schema convention
--     (`products.total_duration_seconds`, `products.total_lesson_count`).
--     The application layer (Slice 4 component) formats the display
--     as "12m" / "1h 23m" — the DB stores the canonical unit.
--   - Future Phase 15 lessons table will use the same field names
--     so the JSONB→lessons backfill is a straight copy.
--
-- RLS:
--   - The column is on the `products` table, which already has RLS
--     (public-read-for-published, partner-read-own, partner-write-own,
--     admin-all) — see 0001_initial.sql + 0011/0012/0013 migrations.
--     `curriculum` inherits all of that automatically.
--   - No new policy needed: the existing products policies cover
--     every column on the table. (The `check:rls` script doesn't scan
--     ALTER TABLE; it only scans for new CREATE TABLE statements,
--     which is the right pattern: new columns on an RLS-protected
--     table don't need new policies.)
-- ============================================================================

-- 1. Add the column. Idempotent (ADD COLUMN IF NOT EXISTS is supported
--    on Postgres 9.6+). Nullable so existing rows aren't forced into
--    a default. JSONB (not JSON) — JSONB normalizes whitespace + key
--    order, supports containment queries, and is the project's
--    convention for flexible per-row data.
alter table products
  add column if not exists curriculum jsonb;

-- 2. Shape constraint. The column must be NULL or a JSONB array of
--    objects with the exact {index, name, duration_seconds} keys.
--    We don't enforce max length or non-empty `name` at the DB
--    layer — the application layer (Slice 4 component) caps the
--    list at MAX_CURRICULUM_ENTRIES items and the name at
--    MAX_CURRICULUM_NAME chars, which keeps the schema flexible
--    for future partner wizard UI changes.
alter table products
  drop constraint if exists products_curriculum_shape_check;
alter table products
  add constraint products_curriculum_shape_check
  check (
    curriculum is null
    or (
      jsonb_typeof(curriculum) = 'array'
      and jsonb_array_length(curriculum) >= 0
      and jsonb_array_length(curriculum) <= 200
    )
  );

-- 3. Partial index for the rare "products WITH curriculum" admin
--    query (the "see which products have lesson lists" backfill
--    view). Partial index — we never need to scan products that
--    haven't set curriculum yet (the empty case is the majority
--    during seeding). Same pattern as 0013's
--    products_bullets_present_idx.
create index if not exists products_curriculum_present_idx
  on products (id)
  where curriculum is not null;

comment on column products.curriculum is
  'JSONB array of {index, name, duration_seconds} objects. The product detail page''s Curriculum tab (P0.12 Slice 4) renders this as the `.curric` block (lines 131–133 of mockups/product.html). Null = use the mockup-faithful 12-item fallback. Empty array = partner explicitly cleared the list, render nothing. Application layer caps entries at MAX_CURRICULUM_ENTRIES (TBD in Slice 4) and name length at MAX_CURRICULUM_NAME (TBD). Phase 15 LMS migration will normalize this to a proper `lessons` table.';
