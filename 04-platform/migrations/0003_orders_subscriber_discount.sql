-- ============================================================================
-- 0003_orders_subscriber_discount.sql — Add subscriber_discount_cents
-- to orders + order_items for the PH07 subscription discount engine.
-- ============================================================================

alter table orders
  add column if not exists subscriber_discount_cents bigint not null default 0
  check (subscriber_discount_cents >= 0);

alter table order_items
  add column if not exists subscriber_discount_cents bigint not null default 0
  check (subscriber_discount_cents >= 0);
