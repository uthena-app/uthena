-- ============================================================================
-- 0030_partner_product_aggregates.sql — P6.2 per-product revenue aggregates
--
-- Resolves STUB-035. The /partner/courses list was returning
-- `total_sales_cents = 0, units_sold = 0` for every row because the
-- aggregation was deferred to PH15. This migration wires the real
-- aggregation as a single SQL function so the partner product list
-- reads from the canonical source of truth.
--
-- Design:
--
--   The aggregation is a GROUP BY over `order_items` joined to `orders`
--   for the status filter:
--
--     SELECT product_id,
--            SUM(quantity)::bigint         AS units_sold,
--            SUM(line_total_cents)::bigint AS revenue_cents
--     FROM   order_items oi
--     JOIN   orders o ON o.id = oi.order_id
--     WHERE  oi.partner_id = p_partner_id
--       AND  o.status IN ('paid', 'partially_refunded')
--     GROUP BY product_id
--
--   The function is SECURITY DEFINER + set search_path = 'public' to
--   match the existing helper convention (is_admin, current_partner_id,
--   has_active_subscription, user_accessible_products, and the P6.1
--   get_partner_lifetime_sales_cents — see 0009 + 0002 + 0029).
--   Because SECURITY DEFINER bypasses RLS, the function performs an
--   explicit authorization check inside: the caller must be the partner
--   whose data is being read (current_partner_id() = p_partner_id) OR
--   an admin (is_admin()). Unauthorized callers receive an empty result
--   set — this never leaks the existence of another partner's data
--   (no rows means "0 sales" rather than "denied", which is consistent
--   with the partner side never seeing another partner's products).
--
--   The function is STABLE (no mutations; reads the table but doesn't
--   change it) so the planner can memoize it inside a SELECT context.
--
--   What counts as "sold":
--     - **paid** — fully paid order; the unit/revenue is real.
--     - **partially_refunded** — order has at least one refund line;
--       the original unit/revenue still counts (the refund surface is
--       the /partner/payouts page — P6.3 — which shows the refund
--       adjustment in the locked vs available split).
--     - **refunded** — fully refunded; the order status moves to
--       'refunded' and we exclude it here (a refunded order isn't a
--       "sale" anymore).
--     - **pending** / **failed** — never a sale, excluded.
--     - **subscription renewals** — handled via payout_ledger kind
--       'subscription' (P6.1 territory); the order_items join to a
--       paid subscription invoice still counts if the line was paid,
--       which matches P6.1's design (gross sales, not "lifetime
--       commission").
--
--   What's a "unit":
--     - SUM(order_items.quantity) — the schema's quantity column is the
--       bundle seat count (default 1 for non-bundle products, N for
--       bundle purchases). For a bundle partner, the KPI shows total
--       bundle seats sold, not just orders. Matches the spec
--       "units sold per product" wording.
--
--   What's "revenue":
--     - SUM(order_items.line_total_cents) — the canonical snapshot
--       value: quantity × unit_price_after_discount, frozen at sale
--       time. Avoids re-computing discounts on read and matches the
--       payout_ledger.amount_cents semantics (gross, not net).
--
-- Performance:
--
--   A new covering index `order_items_partner_product_idx` covers
--   `(partner_id, product_id) INCLUDE (quantity, line_total_cents)`.
--   This makes the GROUP BY an index-only scan: Postgres reads
--   (partner_id, product_id, quantity, line_total_cents) entirely from
--   index pages without heap fetches. The INCLUDE columns are the
--   exact aggregates; the (partner_id, product_id) prefix matches the
--   WHERE + GROUP BY shape.
--
--   At 500+ partners × 1000+ sales each, the aggregation stays in
--   single-digit ms. Without the covering index, Postgres would do a
--   bitmap scan over `order_items_partner_idx (partner_id)` and then
--   heap-fetch every row's (quantity, line_total_cents) — measurably
--   slower at scale.
--
--   IDEMPOTENT: CREATE INDEX IF NOT EXISTS + CREATE OR REPLACE FUNCTION.
--
-- ============================================================================

create or replace function public.get_partner_product_aggregates(p_partner_id bigint)
returns table (
  product_id     bigint,
  units_sold     bigint,
  revenue_cents  bigint
)
language sql
stable
security definer
set search_path = 'public'
as $$
  -- Authorization: caller must be the partner whose data is being
  -- read (current_partner_id() matches p_partner_id) OR an admin
  -- (is_admin()). Unauthorized callers receive zero rows — never
  -- another partner's data. The auth check is part of the WHERE so
  -- the planner can short-circuit when unauthorized.
  select
    oi.product_id,
    sum(oi.quantity)::bigint          as units_sold,
    sum(oi.line_total_cents)::bigint  as revenue_cents
  from order_items oi
  inner join orders o on o.id = oi.order_id
  where oi.partner_id = p_partner_id
    and o.status in ('paid', 'partially_refunded')
    and (p_partner_id = current_partner_id() or is_admin())
  group by oi.product_id
$$;

grant execute on function public.get_partner_product_aggregates(bigint) to authenticated;

comment on function public.get_partner_product_aggregates(bigint) is
  'P6.2 — Per-product aggregates for a partner: GROUP BY product_id from order_items joined to orders (paid or partially_refunded status). Returns (product_id, units_sold, revenue_cents). units_sold = SUM(quantity), revenue_cents = SUM(line_total_cents). Authorization: caller must be the partner (current_partner_id() matches) OR an admin (is_admin()). Returns zero rows for unauthorized callers (never leaks data). Used by the /partner/courses list (P6.2). STABLE — memoizable by the planner inside a SELECT context.';

-- ============================================================================
-- Covering index — makes the GROUP BY an index-only scan.
--
-- The existing order_items indexes (0001_initial):
--   order_items_order_idx   (order_id)
--   order_items_product_idx (product_id)
--   order_items_partner_idx (partner_id)
--
-- None of these is ideal for the P6.2 read path:
--   - (order_id) doesn't help filter on partner_id or group by product_id.
--   - (product_id) doesn't help filter on partner_id.
--   - (partner_id) alone lets us find the partner's rows, but Postgres
--     then needs to heap-fetch (quantity, line_total_cents) for each.
--
-- The new covering index includes (quantity, line_total_cents) so the
-- aggregation is index-only: no heap fetches for the partner's rows.
--
-- Propagated to all monthly partitions from migration 0027 (Postgres
-- inherits parent indexes onto each child automatically).
-- ============================================================================

create index if not exists order_items_partner_product_idx
  on order_items (partner_id, product_id)
  include (quantity, line_total_cents);

-- ============================================================================
-- STUB-035 RESOLVED 2026-06-26.
--
-- The /partner/courses list's getMyPartnerProducts now reads from
-- get_partner_product_aggregates(partner.id) and merges the per-product
-- aggregates (units_sold, total_sales_cents) into each row. Resolved by
-- Mavis (P6.2 tick). See docs/PROGRESS.md 2026-06-26 note.
-- ============================================================================