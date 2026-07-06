-- ---------------------------------------------------------------------------
-- 0028_coupons_subscriber_only.sql — P4.5 coupon support
-- ---------------------------------------------------------------------------
-- P4.5 ships the coupon code input on /checkout + enforcement of the four
-- coupon shapes the spec calls out: percentage, fixed, partner-restricted,
-- subscriber-only. The existing `coupons` table (0001_initial.sql) already
-- supports percentage + partner-restricted + product-restricted. This
-- migration adds the `subscriber_only` boolean so the action can gate the
-- "subscribers get X% off" coupon shape.
--
-- A subscriber_only coupon is only attachable to a user's cart when
-- `has_active_subscription(user_id)` (defined in 0002_subscriptions.sql)
-- returns true. The action reads this column + the existing `partner_id`
-- + `product_id` columns and decides eligibility at apply time.
--
-- Why boolean (not nullable):
--   - Default `false` covers every existing coupon row without backfill.
--   - "Subscriber-only" is the affirmative intent; nullable would force
--     a `coalesce(column, false)` everywhere.
--   - One partial index for the rare "list all subscriber-only coupons"
--     admin view (avoids bloating the index for the 99% of coupons that
--     aren't subscriber-gated).
--
-- IDEMPOTENT — `add column if not exists` + `drop constraint if exists`
-- + `create index if not exists`. Safe to re-run.

-- ---------------------------------------------------------------------------
-- 1. Add the column
-- ---------------------------------------------------------------------------
alter table coupons
  add column if not exists subscriber_only boolean not null default false;

-- ---------------------------------------------------------------------------
-- 2. CHECK constraint — subscriber-only + partner-restricted are mutually
--    exclusive with "global" coupons.
--
--    A subscriber-only coupon is meant to drive subscription adoption by
--    giving subscribers a perk; constraining it to a specific product or
--    partner defeats the purpose. The action layer also enforces this
--    (defense in depth) but the DB CHECK prevents a future admin write from
--    bypassing the constraint.
--
--    The constraint shape: (subscriber_only AND partner_id IS NULL AND
--    product_id IS NULL) OR (NOT subscriber_only).
-- ---------------------------------------------------------------------------
alter table coupons
  drop constraint if exists coupons_subscriber_only_scope_check;

alter table coupons
  add constraint coupons_subscriber_only_scope_check
  check (
    (subscriber_only = true AND partner_id IS NULL AND product_id IS NULL)
    OR subscriber_only = false
  );

-- ---------------------------------------------------------------------------
-- 3. Partial index for the admin "subscriber-only coupons" list page
-- ---------------------------------------------------------------------------
create index if not exists coupons_subscriber_only_idx
  on coupons(id) where subscriber_only = true;