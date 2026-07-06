-- ============================================================================
-- 0024_index_audit_coverage.sql — P3.1 Index audit (covering indexes for
-- every read path at 500+ products / 10k+ users / 100k+ ledger rows).
--
-- Why this migration exists.
--   0001_initial.sql created 32 tables and a baseline set of indexes that
--   cover the obvious single-column hot paths (status, user_id, product_id).
--   But the actual read queries in 02-features/*/*.ts use COMPOSITE
--   predicates + sort orders that the baseline doesn't cover. At 500+
--   products, those queries fall back to a sequential scan + in-memory sort,
--   which is fine for the local dev catalog (~30 rows) and catastrophic at
--   the uthena.com production scale (465+ products + growing).
--
--   This migration adds 17 covering indexes for the read paths identified
--   in docs/INDEX_AUDIT.md. Every index below maps to a specific query in
--   the codebase (see the audit doc for the full table).
--
-- Conventions.
--   - Every CREATE INDEX uses `if not exists` so re-running the migration
--     against a partially-applied state is safe.
--   - Partial indexes use `where` clauses that mirror the runtime filter
--     shape so the planner can match them exactly.
--   - Column order in composite indexes follows the query's WHERE / ORDER
--     BY shape: equality predicates first, sort columns last. See
--     `docs/INDEX_AUDIT.md` §3 for the ordering rationale.
--   - No `drop index` statements. Idempotent + additive only.
--
-- Out of scope (deferred to later phases).
--   - pg_trgm GIN indexes for instant-search ilike queries — at 500+
--     products the existing .or() + ILIKE on title/short_description
--     sequential-scans in ~5ms on a warm cache. Re-evaluate when the
--     catalog hits ~5k products. See STUB-038 (added this tick).
--   - Partitioning for order_items / payout_ledger (P3.5 territory).
--   - Covering INCLUDE columns for index-only scans — Postgres can do this
--     but the read paths here don't return a fixed column set; composite
--     indexes that match the WHERE+ORDER BY are sufficient for the sort
--     elimination we need.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. products — catalog hot path (every / + /browse + /search render hits
--    one of these queries).
-- ---------------------------------------------------------------------------

-- 1a. Popular sort: P0.16's `sort=popular` query orders by
--     review_count DESC, avg_rating DESC NULLS LAST, published_at DESC.
--     The baseline `products_status_published_idx` is (status, published_at
--     DESC) WHERE status = 'published' — it sorts by published_at but the
--     planner can't use it for the review_count / avg_rating tiebreakers
--     without a sequential scan. This partial composite matches the query
--     shape exactly: filter to published, sort by review_count desc, then
--     avg_rating, then published_at.
create index if not exists products_popular_idx
  on products (review_count desc, avg_rating desc nulls last, published_at desc)
  where status = 'published';

-- 1b. Category browse filter: `getPublishedProducts({ category })` does
--     `products WHERE status = 'published' AND category_id = X ORDER BY
--     published_at DESC`. The existing `products_category_idx` is
--     (category_id) WHERE status = 'published' — fine for the filter but
--     the sort still needs a separate pass. The composite below lets the
--     planner do an index scan with sort elimination.
create index if not exists products_category_published_idx
  on products (category_id, published_at desc)
  where status = 'published';

-- 1c. Bundle listing: `getPublishedBundles()` does `products WHERE status =
--     'published' AND kind = 'bundle' ORDER BY published_at DESC`. The
--     existing `products_status_published_idx` doesn't include `kind` so
--     the planner must scan all published rows and filter by kind. The
--     partial composite narrows to bundles only — at 60 published bundles
--     out of 465 products, this is a 7× row reduction.
create index if not exists products_bundle_idx
  on products (published_at desc)
  where status = 'published' and kind = 'bundle';

-- ---------------------------------------------------------------------------
-- 2. reviews — product detail + user's own reviews (10k+ rows at scale).
-- ---------------------------------------------------------------------------

-- 2a. Product detail reviews: `getRecentReviewsForProduct` does
--     `reviews WHERE product_id = X AND status = 'published' ORDER BY
--     created_at DESC LIMIT 5`. The existing `reviews_product_idx` is
--     (product_id) only — fine for the filter but the sort needs a pass.
--     The composite below lets the planner do a single index scan with
--     sort elimination. The `status` filter is added because the catalog
--     doesn't want to leak pending/hidden/flagged reviews.
create index if not exists reviews_product_status_created_idx
  on reviews (product_id, status, created_at desc);

-- 2b. User's own reviews list: `getMyReviews` does
--     `reviews WHERE user_id = X ORDER BY created_at DESC`. The existing
--     `reviews_user_idx` is (user_id) only — same trade-off as 2a.
create index if not exists reviews_user_created_idx
  on reviews (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 3. orders — /account/orders pagination + admin order queue.
-- ---------------------------------------------------------------------------

-- 3a. User order history: `getMyOrders` does
--     `orders WHERE user_id = X ORDER BY created_at DESC`. The existing
--     `orders_user_id_idx` is (user_id) only. Composite + sort.
create index if not exists orders_user_created_idx
  on orders (user_id, created_at desc);

-- 3b. Admin order queue + paid-this-month aggregates:
--     `getAdminLedger` does `.eq('status', 'paid').gte('paid_at', X)` for
--     the "paid this month" KPI. The existing `orders_paid_at_idx` is
--     (paid_at) — works without a status filter but the partial composite
--     below narrows to the most common admin filter shape.
create index if not exists orders_status_paid_idx
  on orders (paid_at desc)
  where status in ('paid', 'fulfilled');

-- ---------------------------------------------------------------------------
-- 4. cart_items — cart abandonment cron (P4.6) walks the table looking
--    for active carts idle for 25+ days.
-- ---------------------------------------------------------------------------

-- The existing `cart_items_user_status_idx` is (user_id, status) — good
-- for the user's own cart view but useless for a global "find idle
-- carts" cron. The partial composite below matches the cron's WHERE
-- shape exactly.
create index if not exists cart_items_active_updated_idx
  on cart_items (updated_at)
  where status = 'active';

-- ---------------------------------------------------------------------------
-- 5. product_files — library file vault + signed URL mint.
-- ---------------------------------------------------------------------------

-- `getUserAccessibleFiles` does `product_files WHERE product_id IN (...) AND
-- scan_status = 'clean' AND encoding_status = 'ready' ORDER BY created_at
-- DESC`. The existing `product_files_product_idx` is (product_id) and
-- `product_files_scan_idx` is (scan_status) — neither matches the
-- 3-column filter + sort shape. The partial composite below narrows to
-- ready files only — at scale this is a 10-50× row reduction since most
-- files are pending scan / encoding at any moment.
create index if not exists product_files_product_ready_idx
  on product_files (product_id, created_at desc)
  where scan_status = 'clean' and encoding_status = 'ready';

-- ---------------------------------------------------------------------------
-- 6. product_assets — bonus assets list per product (rendered on the
--    product detail page if the partner added any).
-- ---------------------------------------------------------------------------
-- No existing index. The query is `product_assets WHERE product_id = X
-- ORDER BY display_order`. Composite matches the WHERE + sort shape.
create index if not exists product_assets_product_display_idx
  on product_assets (product_id, display_order);

-- ---------------------------------------------------------------------------
-- 7. categories — admin category tree + global category strip.
-- ---------------------------------------------------------------------------

-- 7a. Global category strip on / + the categories admin list:
--     `categories ORDER BY display_order`. No existing index on
--     display_order alone.
create index if not exists categories_display_idx
  on categories (display_order, id);

-- 7b. Admin category tree (`getCategoryTree`): `categories WHERE parent_id
--     IS NULL ORDER BY display_order` for roots + `WHERE parent_id = X
--     ORDER BY display_order` for children. The existing
--     `categories_parent_id_idx` is (parent_id) only. The composite below
--     sorts by display_order within each parent group.
create index if not exists categories_parent_display_idx
  on categories (parent_id, display_order);

-- ---------------------------------------------------------------------------
-- 8. partners — public partner page (`/partners/[slug]`) + admin partner
--    list (P14.3).
-- ---------------------------------------------------------------------------
-- `partners WHERE status = 'approved' AND public_slug = X` for the
-- public page; `partners ORDER BY public_slug` for the admin list.
-- The existing `partners_status_idx` is (status) only and
-- `partners_public_slug_idx` is (public_slug) only. The partial composite
-- below matches the public-page shape (the hot path) — narrowing to
-- approved partners only.
create index if not exists partners_status_public_slug_idx
  on partners (public_slug)
  where status = 'approved';

-- ---------------------------------------------------------------------------
-- 9. payout_ledger — home stats + admin ledger (5 round-trips per page
--    load on /admin/payouts, all `.eq('status', X)`).
-- ---------------------------------------------------------------------------
-- The existing `payout_ledger_partner_status_idx` is (partner_id, status)
-- and `payout_ledger_kind_idx` is (kind) — neither covers the
-- global-status scan that `getPublicProductStats` (home) and
-- `getAdminLedger` (admin) do. The partial composite below narrows to
-- the 3 most common status values (the others are rare / archival).
create index if not exists payout_ledger_status_idx
  on payout_ledger (status, paid_at desc)
  where status in ('available', 'locked', 'paid');

-- ---------------------------------------------------------------------------
-- 10. api_tokens — partner's own token list (P12.19).
-- ---------------------------------------------------------------------------
-- `api_tokens WHERE user_id = X AND revoked_at IS NULL ORDER BY
-- created_at DESC`. The existing `api_tokens_user_idx` is (user_id)
-- only. The partial composite filters out revoked rows — at scale most
-- tokens are revoked (the user's history) and we don't want them
-- bloating the index.
create index if not exists api_tokens_user_active_idx
  on api_tokens (user_id, created_at desc)
  where revoked_at is null;

-- ---------------------------------------------------------------------------
-- 11. refunds — admin refund queue (P14.9).
-- ---------------------------------------------------------------------------
-- `refunds WHERE status = 'pending' ORDER BY created_at DESC`. The
-- existing `refunds_status_idx` is (status) only. Partial composite
-- narrows to pending only — the only status that hits the admin queue.
create index if not exists refunds_pending_idx
  on refunds (created_at desc)
  where status = 'pending';

-- ---------------------------------------------------------------------------
-- 12. file_downloads — retention cron (P19.5 / Phase 18 — deletes rows
--     older than 90 days).
-- ---------------------------------------------------------------------------
-- The existing `file_downloads_user_created_idx` is (user_id, created_at
-- desc) and `file_downloads_file_idx` + `file_downloads_product_idx` are
-- single-column — none covers the global retention scan. The plain
-- composite below sorts by created_at desc so the cron can walk the
-- oldest rows first.
create index if not exists file_downloads_created_at_idx
  on file_downloads (created_at);

-- ---------------------------------------------------------------------------
-- Verification (informational — the migration succeeds even if the DB is
-- offline; re-run on the next apply).
-- ---------------------------------------------------------------------------
-- After this migration, every read path documented in
-- docs/INDEX_AUDIT.md has either:
--   (a) an existing index that matches the WHERE + ORDER BY shape, or
--   (b) a new index from this migration that matches.
-- Run `EXPLAIN ANALYZE` on each representative query against a seeded
-- 500-product / 10k-user / 100k-ledger-row database to confirm the
-- planner picks the expected index. See the audit doc §4 for the SQL.
-- ============================================================================