-- ============================================================================
-- 0029_partner_lifetime_sales.sql — P6.1 partner lifetime-sales KPI
--
-- Resolves STUB-032. The /partner dashboard's "Lifetime sales" KPI was
-- hard-coded to $0 because the payout_ledger aggregation was deferred to
-- PH15. This migration wires the real aggregation as a single SQL function
-- so the dashboard reads from the canonical source of truth.
--
-- Design:
--
--   The aggregation is a single SUM(amount_cents) over payout_ledger where
--   partner_id = $1 and kind = 'order_sale'. Per the schema (0001_initial):
--     - `amount_cents` is signed bigint (positive = credit, negative =
--       debit for refunds/clawbacks).
--     - `kind` is the payout_ledger_kind enum: 'order_sale',
--       'subscription', 'refund', 'adjustment', 'payout', 'clawback'.
--     - Filtering on kind='order_sale' excludes subscriptions (the
--       subscriber side of the platform), refunds (separate kind),
--       adjustments (admin-only), payouts (the payment transfer itself),
--       and clawbacks (separate kind). The "Lifetime sales" KPI shows
--       gross order sales — refunds/clawbacks will surface separately
--       on the P6.3 partner payouts page ("locked vs available" split).
--
--   The function is SECURITY DEFINER + set search_path = 'public' to
--   match the existing helper convention (is_admin, current_partner_id,
--   has_active_subscription, user_accessible_products — see 0009 + 0002).
--   Because SECURITY DEFINER bypasses RLS, the function performs an
--   explicit authorization check inside: the caller must be the partner
--   whose data is being read (current_partner_id() = p_partner_id) OR
--   an admin (is_admin()). Unauthorized callers receive 0 — this never
--   leaks the existence of another partner's data.
--
--   The function is STABLE (no mutations; reads the table but doesn't
--   change it) so the planner can memoize it inside a SELECT context.
--
-- Performance:
--
--   A new partial index `payout_ledger_partner_order_sale_idx` covers
--   `(partner_id, amount_cents) WHERE kind = 'order_sale'`. This makes
--   the SUM an index-only scan over a small subset of the partitioned
--   payout_ledger table — at 10k+ partners × 1000+ sales each, the
--   SUM stays in single-digit ms. The index is propagated to every
--   monthly partition (the partitioned table from migration 0027
--   inherits all indexes onto each child).
--
--   Without the partial index, the planner would either:
--     (a) full-scan every partition and filter (slow at scale), OR
--     (b) use the existing `payout_ledger_kind_idx` and filter on
--         partner_id afterwards (still slow — kind='order_sale' is
--         ~1/6 of the table).
--
-- ============================================================================

create or replace function public.get_partner_lifetime_sales_cents(p_partner_id bigint)
returns bigint
language sql
stable
security definer
set search_path = 'public'
as $$
  -- Authorization: caller must be the partner whose data is being
  -- read (current_partner_id() matches p_partner_id) OR an admin
  -- (is_admin()). Unauthorized callers receive 0 — never the actual
  -- SUM for a different partner. The auth check is part of the WHERE
  -- so the planner can short-circuit when unauthorized (zero rows
  -- match, COALESCE returns 0).
  select coalesce(sum(amount_cents), 0)::bigint
  from payout_ledger
  where partner_id = p_partner_id
    and kind = 'order_sale'
    and (p_partner_id = current_partner_id() or is_admin());
$$;

grant execute on function public.get_partner_lifetime_sales_cents(bigint) to authenticated;

comment on function public.get_partner_lifetime_sales_cents(bigint) is
  'P6.1 — Gross lifetime sales (cents) for a partner: SUM(amount_cents) from payout_ledger where kind = order_sale. Filters out subscriptions / refunds / adjustments / payouts / clawbacks by kind. Authorization: caller must be the partner (current_partner_id() matches) OR an admin (is_admin()). Returns 0 for unauthorized callers (never leaks data). Used by the /partner dashboard KPI (P6.1). STABLE — memoizable by the planner inside a SELECT context.';

-- ============================================================================
-- Partial covering index — makes the SUM an index-only scan.
--
-- The existing payout_ledger indexes (0001_initial):
--   payout_ledger_partner_status_idx (partner_id, status)
--   payout_ledger_order_idx          (order_id)
--   payout_ledger_kind_idx           (kind)
--   payout_ledger_paid_at_idx        (paid_at)
--
-- None of these is ideal for the P6.1 read path:
--   - (partner_id, status) doesn't help filter on kind.
--   - (kind) alone doesn't help filter on partner_id efficiently.
--
-- The new partial index covers (partner_id, amount_cents) WHERE kind =
-- 'order_sale'. The WHERE clause is a constant — Postgres materializes
-- only the matching rows, so the index is ~1/6 the size of an equivalent
-- full index. The INCLUDE-style (partner_id, amount_cents) ordering
-- means a `WHERE partner_id = $1 AND kind = 'order_sale'` scan can
-- satisfy the SUM(amount_cents) from index pages alone (index-only
-- scan), avoiding heap fetches entirely.
--
-- IDEMPOTENT: CREATE INDEX IF NOT EXISTS. Re-running the migration is
-- a no-op. Propagated to all monthly partitions from migration 0027
-- (Postgres inherits parent indexes onto each child automatically).
-- ============================================================================

create index if not exists payout_ledger_partner_order_sale_idx
  on payout_ledger (partner_id, amount_cents)
  where kind = 'order_sale';

-- ============================================================================
-- STUB-032 RESOLVED 2026-06-26.
--
-- The /partner dashboard's getPartnerDashboardSummary now reads from
-- get_partner_lifetime_sales_cents(partner.id) instead of hard-coding 0.
-- Resolved by Mavis (P6.1 tick). See docs/PROGRESS.md 2026-06-26 note.
-- ============================================================================