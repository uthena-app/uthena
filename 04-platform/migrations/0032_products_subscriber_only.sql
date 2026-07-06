-- ---------------------------------------------------------------------------
-- 0032_products_subscriber_only.sql — P8.3 subscriber-only content
-- ---------------------------------------------------------------------------
-- P8.3 ships the "subscriber-only content" flag. A partner (or admin) can
-- mark a product as `subscriber_only = true` — when set, only users with
-- an active Personal Access subscription can purchase it (server-side gate
-- in `addToCartAction`, migration-territory gate via `has_active_subscription`
-- RPC from 0002_subscriptions.sql). Non-subscribers see an upgrade CTA on the
-- product detail page (P8.3 Slice 1) instead of the Add-to-cart flow.
--
-- Default `false` — every existing product row stays non-subscriber-only
-- without backfill. The column is nullable-free (boolean NOT NULL) so the
-- action + UI don't need coalesce() everywhere; the affirmative intent is
-- "make this subscriber-only" (opt-in flag, not opt-out).
--
-- RLS — no new policies needed:
--   - The column inherits the existing `products_public_read_published`
--     policy (anon sees `subscriber_only = true` on every published product
--     they can read — required for the PDP upgrade CTA to render).
--   - The partner's `products_partner_write_own` policy is row-level, not
--     column-level: a partner can update their own products, including the
--     new `subscriber_only` column. The admin tool (P8.3 Slice 2) uses
--     `products_admin_all` for admin override.
--   - The catalog / browse reads already select from `products` — adding
--     the column is a pure additive change.
--
-- IDEMPOTENT — `add column if not exists` + `create index if not exists`.
-- Safe to re-run.

-- ---------------------------------------------------------------------------
-- 1. Add the column
-- ---------------------------------------------------------------------------
alter table products
  add column if not exists subscriber_only boolean not null default false;

-- ---------------------------------------------------------------------------
-- 2. Partial index for the "subscriber-only catalog" admin filter
--    (P8.3 Slice 2 admin tool) + the future P8.3 Slice 2 catalog badge.
--    Matches the pattern from `coupons_subscriber_only_idx` (0028) — a
--    partial index on the rare subset to avoid bloating the index for
--    the 99% of products that aren't subscriber-gated.
-- ---------------------------------------------------------------------------
create index if not exists products_subscriber_only_idx
  on products(id) where subscriber_only = true;