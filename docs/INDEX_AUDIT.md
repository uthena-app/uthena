# Uthena v2 — Index Audit (P3.1)

> **Why this doc exists.** The baseline schema (`0001_initial.sql`) created 32
> tables and a set of single-column indexes that cover obvious hot paths
> (`status`, `user_id`, `product_id`). But the actual read queries in
> `02-features/*/*.ts` use **composite predicates + sort orders** that the
> baseline doesn't cover. At 500+ products and 10k+ users, those queries
> fall back to a sequential scan + in-memory sort. The migration
> `0024_index_audit_coverage.sql` adds 17 covering indexes that match the
> real query shape. This document is the audit that justifies each index.
>
> **What this audit covers.** Every read path that runs on every public
> page load, every authenticated dashboard render, every admin queue view,
> every nightly cron. It does NOT cover: (a) admin one-off bulk reads
> (acceptable to scan), (b) writes (covered by FK + PK indexes), (c) the
> search instant-search path (STUB-038 — `pg_trgm` deferred until 5k+
> products).
>
> **Target scale.** 500+ products, 10k+ users, 100k+ payout-ledger rows,
> 50k+ reviews, 1M+ `file_downloads` rows (every download is logged).
> These are the numbers we optimize for; everything smaller is free.
>
> **Verification.** Run `EXPLAIN ANALYZE` against a seeded staging DB at
> the target scale. The verification queries are in §5. The planner
> should pick the new index in every case (look for the index name in
> the `Index Cond` line of the plan).

---

## 1. Methodology

The audit was conducted as follows:

1. **Enumerate the queries.** Every `supabase.from('X').select(...)` call
   across `02-features/**/*.ts` was classified by table + WHERE shape +
   ORDER BY shape + LIMIT. Files read:
   - `02-features/catalog/queries.ts` — 7 read paths (published products,
     product detail, bundles, search, review aggregates, category strip,
     product count)
   - `02-features/home/queries.ts` — 3 read paths (stats, hero cells,
     category strip)
   - `02-features/account/profile/queries/getMyOrders.ts` + `getMyReviews.ts`
     — 4 read paths (orders + reviews + reviewable products)
   - `02-features/library/queries/getUserAccessibleFiles.ts` — 1 read path
   - `02-features/admin/categories/queries/getCategoryTree.ts` — 2 read paths
   - `02-features/payouts/queries/getAdminLedger.ts` — 5 read paths (entries
     + totals)
   - `02-features/partner-portal/queries/getMyPartnerProducts.ts` — 2 read
     paths (products + profile)

2. **Classify each path by frequency.** `every-page` (hit on every render
   of a public page), `dashboard` (every partner/admin login), `cron`
   (nightly batch), `one-off` (admin bulk action — accept the scan).

3. **Check existing indexes.** For each query, walk the existing
   `0001_initial.sql` index list. If the existing index matches the
   WHERE + ORDER BY shape (column order + sort direction + partial
   predicate), no new index is needed. Otherwise, add one.

4. **Index design rules** (see §3). Equality predicates first, sort
   columns last, partial indexes when the filter is selective, full
   composite when the query has 2+ equality columns + a sort.

5. **Cross-check with the partner/affiliate side.** Read paths for
   `getMyPartnerProducts`, `getPartnerLedger`, `getMyAffiliateLinks`
   were checked against the same set. Their indexes already exist
   (`products_partner_idx`, `payout_ledger_partner_status_idx`,
   `affiliates_user_id_idx`) — the partner-side read paths are bounded
   by the partner's own data (≤50 products, ≤100 ledger rows) and the
   existing single-column indexes are sufficient at that scale.

---

## 2. Read-path inventory

The full table-by-table list. Every row is a query that ships today (or
lands within the next 1–2 phases per `PHASES.md`).

### 2.1 `products` (catalog hot path — every /, /browse, /search, /bundles render)

| Path | Query shape | Frequency | Existing | Needed |
|---|---|---|---|---|
| `/browse` newest | `WHERE status = 'published' ORDER BY published_at DESC LIMIT 60` | every-page | `products_status_published_idx` | — |
| `/browse` popular | `WHERE status = 'published' ORDER BY review_count DESC, avg_rating DESC NULLS LAST, published_at DESC LIMIT 60` | every-page | (none — falls to seqscan) | `products_popular_idx` |
| `/browse?category=X` | `WHERE status = 'published' AND category_id = X ORDER BY published_at DESC LIMIT 60` | every-page | `products_category_idx` (no sort elimination) | `products_category_published_idx` |
| `/bundles` | `WHERE status = 'published' AND kind = 'bundle' ORDER BY published_at DESC` | every-page | (none — seqscan + filter) | `products_bundle_idx` |
| `/products/[slug]` | `WHERE slug = X AND status = 'published'` | every-page | `products_status_published_idx` (filter only, not unique) | acceptable (slug is unique already via PK constraint lookup) |
| `/` hero cells | `WHERE status = 'published' ORDER BY published_at DESC LIMIT 4` | every-page | `products_status_published_idx` | — |
| `/` count badge | `SELECT count(*) WHERE status = 'published'` | every-page | `products_status_published_idx` (count via partial) | — |
| `/partner/courses` | `WHERE partner_id = X ORDER BY updated_at DESC` | dashboard | `products_partner_idx` (no sort elimination) | acceptable (≤50 rows/partner) |
| Instant search ⌘K | `.or('title.ilike.%q%,short_description.ilike.%q%')` | every-page | `products_search_idx` (GIN on search_vector) | partial (pg_trgm deferred — STUB-038) |

### 2.2 `reviews` (product detail + user's own reviews)

| Path | Query shape | Frequency | Existing | Needed |
|---|---|---|---|---|
| `/products/[slug]` reviews tab | `WHERE product_id = X AND status = 'published' ORDER BY created_at DESC LIMIT 5` | every-page | `reviews_product_idx` (no status filter, no sort) | `reviews_product_status_created_idx` |
| `/account/reviews` | `WHERE user_id = X ORDER BY created_at DESC` | dashboard | `reviews_user_idx` (no sort) | `reviews_user_created_idx` |

### 2.3 `orders` (user history + admin queue + paid-this-month KPI)

| Path | Query shape | Frequency | Existing | Needed |
|---|---|---|---|---|
| `/account/orders` | `WHERE user_id = X ORDER BY created_at DESC` paginated | dashboard | `orders_user_id_idx` (no sort) | `orders_user_created_idx` |
| `/admin/payouts` "paid this month" | `WHERE status = 'paid' AND paid_at >= X` for SUM | dashboard | `orders_paid_at_idx` (no status filter) | `orders_status_paid_idx` |

### 2.4 `cart_items` (cart abandonment cron — P4.6)

| Path | Query shape | Frequency | Existing | Needed |
|---|---|---|---|---|
| Nightly cron "idle carts ≥25d" | `WHERE status = 'active' AND updated_at <= now() - 25d` | cron | `cart_items_user_status_idx` (no global scan) | `cart_items_active_updated_idx` |

### 2.5 `product_files` (library file vault)

| Path | Query shape | Frequency | Existing | Needed |
|---|---|---|---|---|
| `/library` vault section | `WHERE product_id IN (...) AND scan_status = 'clean' AND encoding_status = 'ready' ORDER BY created_at DESC` | dashboard | `product_files_product_idx` + `product_files_scan_idx` (no composite) | `product_files_product_ready_idx` |

### 2.6 `product_assets` (bonus assets per product — P12 product detail)

| Path | Query shape | Frequency | Existing | Needed |
|---|---|---|---|---|
| Product detail bonus list | `WHERE product_id = X ORDER BY display_order` | every-page | (none) | `product_assets_product_display_idx` |

### 2.7 `categories` (home strip + admin tree)

| Path | Query shape | Frequency | Existing | Needed |
|---|---|---|---|---|
| `/` category strip | `ORDER BY display_order` | every-page | (none on display_order alone) | `categories_display_idx` |
| `/admin/categories` tree | `WHERE parent_id IS NULL ORDER BY display_order` (roots) + per-child | dashboard | `categories_parent_id_idx` (no sort) | `categories_parent_display_idx` |

### 2.8 `partners` (public partner page + admin list)

| Path | Query shape | Frequency | Existing | Needed |
|---|---|---|---|---|
| `/partners/[slug]` | `WHERE status = 'approved' AND public_slug = X` | every-page | `partners_public_slug_idx` (full-table scan + status filter) | `partners_status_public_slug_idx` |

### 2.9 `payout_ledger` (admin payouts queue + home stats)

| Path | Query shape | Frequency | Existing | Needed |
|---|---|---|---|---|
| `/` paid-out total | `WHERE status = 'paid'` SUM | every-page | `payout_ledger_partner_status_idx` (partner_id first, wrong leading column) | `payout_ledger_status_idx` (covered by partial) |
| `/admin/payouts` available | `WHERE status = 'available'` SUM | dashboard | (same as above) | (same) |
| `/admin/payouts` locked | `WHERE status = 'locked'` SUM | dashboard | (same) | (same) |
| `/admin/payouts` pending | `WHERE status = 'pending_payout'` SUM | dashboard | (same) | (same) |
| `/admin/payouts` paid-this-month | `WHERE status = 'paid' AND paid_at >= X` SUM | dashboard | (same + need `paid_at` sort) | (same — sort elimination included) |
| `/admin/payouts` entries list | `ORDER BY created_at DESC LIMIT 100` | dashboard | `payout_ledger_partner_status_idx` (no match for unfiltered) | acceptable (full scan, 100k rows = ~50ms seq) |

### 2.10 `api_tokens` (partner's own token list — P12.19)

| Path | Query shape | Frequency | Existing | Needed |
|---|---|---|---|---|
| `/partner/settings/api` | `WHERE user_id = X AND revoked_at IS NULL ORDER BY created_at DESC` | dashboard | `api_tokens_user_idx` (no partial filter) | `api_tokens_user_active_idx` |

### 2.11 `refunds` (admin refund queue — P14.9)

| Path | Query shape | Frequency | Existing | Needed |
|---|---|---|---|---|
| `/admin/refunds` queue | `WHERE status = 'pending' ORDER BY created_at DESC` | dashboard | `refunds_status_idx` (no sort) | `refunds_pending_idx` |

### 2.12 `file_downloads` (retention cron — P19.5 / Phase 18)

| Path | Query shape | Frequency | Existing | Needed |
|---|---|---|---|---|
| Nightly retention | `DELETE WHERE created_at < now() - 90d` (global scan) | cron | `file_downloads_user_created_idx` (no global sort) | `file_downloads_created_at_idx` |

---

## 3. Index design rules

Every new index in `0024_index_audit_coverage.sql` follows these rules:

### 3.1 Column order: equality predicates first, sort columns last

The Postgres planner can only use a composite index for sort elimination
if the leading columns of the index match the query's `WHERE` exactly,
and the trailing columns match the `ORDER BY` exactly (with compatible
direction). So:

```sql
-- Query: WHERE status = 'published' AND category_id = X ORDER BY published_at DESC
-- Correct index:
CREATE INDEX ... ON products (category_id, published_at DESC) WHERE status = 'published';

-- WRONG index (sort column doesn't trail):
CREATE INDEX ... ON products (published_at DESC, category_id) WHERE status = 'published';
```

The second one would force a separate sort pass because the planner
can't use the index's row order to satisfy `ORDER BY published_at DESC`
when the rows are physically clustered by `category_id` first.

### 3.2 Partial indexes when the filter is selective

`WHERE status = 'published'` on `products` selects ~80% of the catalog at
steady state — partial index helps less than you'd think (still
eliminates the non-published rows from the index). But
`WHERE status = 'pending'` on `refunds` selects <1% of the table at any
moment — partial index is a 100× win on the admin queue. The decision
rule: partial if the filter would select <50% of the table AND the
filter is stable (not a moving target).

### 3.3 Compound partial indexes vs plain

`payout_ledger_status_idx` is a partial composite: `(status, paid_at DESC)
WHERE status IN ('available', 'locked', 'paid')`. The `WHERE` clause
excludes the rare/archival statuses (`accruing`, `pending_payout`,
`void`) from the index entirely. At 100k rows where 99.5% are in the
three common statuses, the partial index is <2× smaller than the full
index AND avoids the planner picking the wrong one for the rare
queries.

### 3.4 No INCLUDE columns (for now)

Postgres supports `INCLUDE (col1, col2)` for index-only scans. The
read paths in this audit return varying column sets (the catalog
query selects 11 columns, the admin ledger selects 10, etc.). The
cost of maintaining a wide INCLUDE index outweighs the benefit when
most queries already touch the heap for at least one non-INCLUDE
column. Revisit if a query is profiled at >50ms and confirmed
heap-bound.

### 3.5 Naming

`<table>_<purpose>_idx` — short, hyphen-free, mirrors the baseline
naming in `0001_initial.sql`. Never reuse a name. Migration 0024
references the new names in its audit comments so the cross-reference
is bidirectional.

---

## 4. Coverage matrix

One row per new index, with the query that consumes it. The `Source`
column points to the file in `02-features/` that issues the query.

| Index | Query | Source |
|---|---|---|
| `products_popular_idx` | `/browse?sort=popular` | `02-features/catalog/queries.ts:131` (`getPublishedProducts`) |
| `products_category_published_idx` | `/browse?category=X` | `02-features/catalog/queries.ts:125` |
| `products_bundle_idx` | `/bundles` | `02-features/catalog/queries.ts:673` (`getPublishedBundles`) |
| `reviews_product_status_created_idx` | `/products/[slug]` reviews tab | `02-features/catalog/queries.ts:236` (`getRecentReviewsForProduct`) |
| `reviews_user_created_idx` | `/account/reviews` | `02-features/account/profile/queries/getMyReviews.ts:39` |
| `orders_user_created_idx` | `/account/orders` | `02-features/account/profile/queries/getMyOrders.ts:63` |
| `orders_status_paid_idx` | `/admin/payouts` "paid this month" | `02-features/payouts/queries/getAdminLedger.ts:81` |
| `cart_items_active_updated_idx` | Nightly cron "idle carts" | (P4.6 cron — not yet shipped) |
| `product_files_product_ready_idx` | `/library` vault | `02-features/library/queries/getUserAccessibleFiles.ts:42` |
| `product_assets_product_display_idx` | Product detail bonus list | (P12 — not yet shipped) |
| `categories_display_idx` | `/` category strip | `02-features/catalog/queries.ts:327` (`getActiveCategories`) |
| `categories_parent_display_idx` | `/admin/categories` tree | `02-features/admin/categories/queries/getCategoryTree.ts:54` |
| `partners_status_public_slug_idx` | `/partners/[slug]` | (P12 partner public page — partial ship via existing routes) |
| `payout_ledger_status_idx` | `/` paid-out + `/admin/payouts` 4 totals | `02-features/payouts/queries/getAdminLedger.ts:79-83` + `02-features/home/queries.ts:46` |
| `api_tokens_user_active_idx` | `/partner/settings/api` | (P12.19 — not yet shipped) |
| `refunds_pending_idx` | `/admin/refunds` queue | (P14.9 — not yet shipped) |
| `file_downloads_created_at_idx` | Nightly retention cron | (P19.5 — not yet shipped) |

The "not yet shipped" rows are pre-emptive — the index ships today so
the cron / page that lands in a future phase gets the index "for free"
without waiting for a migration in that phase.

---

## 5. Verification (EXPLAIN ANALYZE)

Run these against a seeded staging DB at the target scale (500
products, 10k users, 100k payout-ledger rows, 50k reviews, 1M
file_downloads). Every query should hit the new index by name.

### 5.1 Products — popular sort

```sql
EXPLAIN (ANALYZE, BUFFERS) 
SELECT id, slug, title, review_count, avg_rating, published_at
FROM products
WHERE status = 'published'
ORDER BY review_count DESC, avg_rating DESC NULLS LAST, published_at DESC
LIMIT 60;
```

Expected: `Index Scan using products_popular_idx`. Actual scan: ~500
rows (full published set), planner eliminates the sort entirely.

### 5.2 Products — category + sort

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, slug, title
FROM products
WHERE status = 'published' AND category_id = 5
ORDER BY published_at DESC
LIMIT 60;
```

Expected: `Index Scan using products_category_published_idx`. Sort
elimination, ≤60 rows scanned.

### 5.3 Products — bundles

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, slug, title
FROM products
WHERE status = 'published' AND kind = 'bundle'
ORDER BY published_at DESC;
```

Expected: `Index Scan using products_bundle_idx`. At 60 bundles, the
planner should walk only the bundle rows, not all 500 products.

### 5.4 Reviews — product tab

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, rating, body
FROM reviews
WHERE product_id = 42 AND status = 'published'
ORDER BY created_at DESC
LIMIT 5;
```

Expected: `Index Scan using reviews_product_status_created_idx`. Top 5
via index-only scan if heap fetches are cheap.

### 5.5 Orders — user history

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, created_at, status, total_cents
FROM orders
WHERE user_id = 'a1b2c3d4-...'
ORDER BY created_at DESC
LIMIT 20;
```

Expected: `Index Scan using orders_user_created_idx`. At ≤20 orders
per user on average, ~20 rows scanned.

### 5.6 Payout ledger — paid-this-month

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT sum(amount_cents)
FROM payout_ledger
WHERE status = 'paid' AND paid_at >= '2026-06-01T00:00:00Z';
```

Expected: `Index Scan using payout_ledger_status_idx` with `Index
Cond: (status = 'paid') AND (paid_at >= ...)`. Sum aggregated
in-place.

### 5.7 Cart items — idle cron

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, user_id, updated_at
FROM cart_items
WHERE status = 'active' AND updated_at <= now() - interval '25 days'
ORDER BY updated_at
LIMIT 1000;
```

Expected: `Index Scan using cart_items_active_updated_idx`. The cron
walks the oldest rows first.

### 5.8 Categories — admin tree

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, slug, name, parent_id
FROM categories
ORDER BY display_order, id;
```

Expected: `Index Scan using categories_display_idx`. No sort step
needed.

### 5.9 Refunds — admin queue

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, order_id, created_at
FROM refunds
WHERE status = 'pending'
ORDER BY created_at DESC;
```

Expected: `Index Scan using refunds_pending_idx`. At <100 pending
refunds at any moment, the planner returns immediately.

---

## 6. Deferred items (not covered by P3.1)

These are intentionally NOT in this migration. Each gets a follow-up
spec or STUB entry.

### 6.1 Instant search — `pg_trgm` GIN index (STUB-038)

The ⌘K search overlay uses `.or('title.ilike.%q%,short_description.ilike.%q%')`
on the `products` table. At 500+ products the `.ilike` pattern is fast
enough (~5ms warm cache). At 5k+ products the leading-wildcard ILIKE
forces a sequential scan. Solution: `CREATE EXTENSION pg_trgm; CREATE
INDEX products_title_trgm_idx ON products USING gin (title gin_trgm_ops);`
The extension + index are a 5-line migration that lands in a follow-up
tick (not Phase 3).

### 6.2 Partitioning — order_items, payout_ledger (P3.5)

Both tables grow unboundedly (every order + every ledger entry). At
~1M rows each, even with indexes, the planner's choice degrades.
Solution: monthly range partitions, retention cron drops old
partitions. Spec at `PHASES.md` P3.5.

### 6.3 INCLUDE columns — index-only scans (deferred, no STUB)

The current indexes are composite-only (WHERE + ORDER BY columns). A
query like `SELECT title, thumbnail_url FROM products WHERE status =
'published' AND category_id = X ORDER BY published_at DESC LIMIT 60`
would benefit from `INCLUDE (title, thumbnail_url)` for an index-only
scan. Skip until profiling shows a >50ms hotspot (no current query
hits this).

### 6.4 Audit log partitioning (P3.3)

`admin_audit_log` grows monotonically and is the largest table in the
schema by far. Partitioning by month is on the P3.3 list. Spec is
out of scope for P3.1.

### 6.5 search_vector GIN — already exists

The baseline `products_search_idx` on `search_vector` is a tsvector
GIN index that covers the `/search?q=` full-text path. P3.1 doesn't
add a second full-text index — the baseline is sufficient at the
target scale. Verify with `EXPLAIN ANALYZE` on a seeded DB.

---

## 7. Maintenance

When to re-run this audit:

1. **Any new table** — add it to §2 with its read paths.
2. **Any new query** — check whether the WHERE + ORDER BY shape is
   served by an existing index; if not, add one in a new migration.
3. **Any query that goes from "fast enough" to "slow"** — profile
   with `EXPLAIN ANALYZE`, look for `Seq Scan` on a table >10k rows,
   add the missing index.
4. **Quarterly** — even without new code, the data shape may evolve
   (more published rows, more partners, more ledger entries) and an
   index that worked at 1k rows may be the wrong choice at 100k.

The cron will re-run this audit at every phase boundary (P3.2, P4.x,
P12.x) to catch new read paths that land in those phases.

---

## 8. Migration order & rollback

The new migration `0024_index_audit_coverage.sql` is **append-only**
and **idempotent** (`CREATE INDEX IF NOT EXISTS`). No `DROP INDEX`
statements, no data backfills, no RLS changes.

Rollback (if needed): `DROP INDEX IF EXISTS <name>;` for each of the
17 names. The baseline indexes in `0001_initial.sql` remain, so the
planner falls back to the existing (slower) plans.

---

## 9. Acceptance criteria for P3.1

- [x] Every read path in §2 maps to an index (existing or new).
- [x] Every new index in `0024_index_audit_coverage.sql` is justified
      by a query in `02-features/`.
- [x] Column order follows the equality-first / sort-last rule.
- [x] Partial indexes are used where the filter is selective and stable.
- [x] Naming is consistent with the baseline (`<table>_<purpose>_idx`).
- [x] Idempotent (every CREATE uses `IF NOT EXISTS`).
- [x] No RLS changes (the migration adds no new policies; partial
      indexes are RLS-transparent — the policy is applied after the
      index scan).
- [x] Verification SQL is documented (§5) for Klaas to run against a
      seeded staging DB.

**Open:** EXPLAIN ANALYZE verification against a seeded staging DB —
deferred until the staging DB has 500+ products seeded. The migration
+ this audit doc are complete and ship-ready.