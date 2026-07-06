-- ---------------------------------------------------------------------------
-- 0071_orders_canceled_at.sql — STUB-063: payment-failure handlers need
-- a `canceled_at` timestamp
-- ---------------------------------------------------------------------------
-- STUB-063 adds Stripe webhook handlers for `payment_intent.payment_failed`,
-- `checkout.session.expired`, and `checkout.session.async_payment_failed`.
-- Per the STUB-063 spec, these flip the order to `status='canceled'`
-- (already a valid `order_status` enum value from 0001_initial.sql — no
-- enum change needed) AND set a `canceled_at` timestamp so support /
-- admin can see when + distinguish a payment-failure cancellation from
-- other terminal states. The column didn't exist before this migration
-- (orders only had `paid_at` / `fulfilled_at`).
--
-- IDEMPOTENT — `add column if not exists` is safe to re-run.

alter table orders
  add column if not exists canceled_at timestamptz;

-- Partial index for the "stale/failed checkout" admin surface
-- (Phase 14 admin tools territory per STUB-063's resolution path) —
-- cheap to add now, and it's exactly the shape
-- `where status = 'canceled' order by canceled_at desc` needs.
create index if not exists orders_canceled_at_idx
  on orders (canceled_at desc)
  where canceled_at is not null;

-- ---------------------------------------------------------------------------
-- RLS — no new table created by this migration. `orders` already has
-- RLS enabled with policies from 0001_initial.sql (self-read via
-- `user_id = auth.uid()`, admin read-all, service-role for writes).
-- Re-asserted here defensively so the CI RLS-coverage scanner (which
-- now also scans this migrations dir) finds an explicit statement.
-- ---------------------------------------------------------------------------
alter table orders enable row level security;
