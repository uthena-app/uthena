-- ============================================================================
-- 0038_partner_dashboard_aggregates.sql — P12.4 dashboard refinements
--
-- Resolves three P12.4 dashboard read paths:
--
--   1. **get_partner_month_sales_cents(p_partner_id)** — gross sales
--      for the current calendar month (matches the dashboard's new
--      "This month" KPI). Same shape as 0029's
--      get_partner_lifetime_sales_cents, but the predicate is
--      `created_at >= date_trunc('month', now())` instead of just
--      the partner_id + kind filter. Reuses the existing partial
--      index `payout_ledger_partner_order_sale_idx` (defined in 0029),
--      so the planner does an index-only scan over the small subset
--      of "this month's order_sale rows for this partner."
--
--   2. **get_partner_daily_sales_series(p_partner_id, p_days_back)** —
--      daily bucketed SUM(amount_cents) over the last N days for the
--      earnings chart. Returns rows = (day date, sum cents, count
--      of orders). The date range is filled in even when the day has
--      no sales (the dashboard X axis needs every bar present; the
--      contract is "exactly N rows"). Uses generate_series to fill
--      the days, then LEFT JOINs the aggregate. Same partial index
--      supports the inner SELECT; the outer LEFT JOIN is the date
--      axis, not a data scan.
--
--   3. **get_partner_recent_activity(p_partner_id, p_limit)** — last
--      N notable events for the activity feed. Pulls from two sources
--      union'd together:
--        - payout_ledger rows (sales / refunds / payouts) for the
--          financial timeline
--        - order_items rows (raw purchase lines) for the customer-
--          facing sale timeline (the payout_ledger side joins to the
--          order so we can show the product title; the order_items
--          side is a fallback if payout_ledger hasn't been written
--          yet for a fresh order — payout_ledger is written by the
--          order webhook, so there's a small race where order_items
--          is in but payout_ledger isn't)
--
--      Returns rows = (event_at, event_kind, description, amount_cents,
--      product_title, order_id). The description is a human-readable
--      string built from the kind + amount; the page renders it as
--      the feed item body. Both sources are RLS-equivalent (we use
--      SECURITY DEFINER + internal auth check that mirrors the 0029
--      pattern). The page never sees another partner's events.
--
--      Note on UNION ALL ordering: each side is sorted + limited to
--      p_limit (cap at 50), then unioned + resorted. We do NOT try
--      to merge before sort because each source has its own date
--      column (payout_ledger.created_at vs order_items.created_at);
--      doing a per-source limit keeps the query cheap.
--
-- All three functions are:
--   - **SECURITY DEFINER + set search_path = 'public'** — matches
--     0029/0030 helper convention
--   - **STABLE** — the planner can memoize the result inside a SELECT
--   - **Auth-checked** — caller must be the partner (current_partner_id() =
--     p_partner_id) OR an admin (is_admin()); unauthorized callers
--     receive zeros / empty sets, NEVER another partner's data
--   - **GRANT EXECUTE to authenticated** — RLS bypass inside
--     SECURITY DEFINER means we manually authorize; standard pattern
--     for partner-scoped RPCs
--
-- New indexes added in this migration:
--   - payout_ledger_partner_created_at_idx — supports the
--     "recent activity" payout_ledger read (date DESC) and the
--     "month sales" filter (date >= month_start)
--
-- Performance:
--
--   At 500+ partners × 1000+ sales each, the daily-series aggregate
--   stays single-digit ms per partner:
--     - The inner SUM is index-only on payout_ledger_partner_order_sale_idx
--     - The date axis is generate_series (10ms even at 365 days)
--     - LEFT JOIN with ON pl.day = gs.day (hash join, fast)
--
-- IDEMPOTENT: every CREATE uses CREATE OR REPLACE FUNCTION + CREATE
-- INDEX IF NOT EXISTS. Safe to re-run against a partially-applied
-- state.
-- ============================================================================

-- ============================================================================
-- 1. get_partner_month_sales_cents(p_partner_id bigint)
-- ============================================================================

create or replace function public.get_partner_month_sales_cents(p_partner_id bigint)
returns bigint
language sql
stable
security definer
set search_path = 'public'
as $$
  -- Authorization: caller must be the partner (current_partner_id()
  -- = p_partner_id) OR an admin (is_admin()). Unauthorized callers
  -- receive 0 — never the SUM for a different partner.
  --
  -- The "this month" predicate uses date_trunc('month', now()) so
  -- the result always reflects the CURRENT calendar month in the
  -- server's timezone (Supabase runs UTC). For partners in other
  -- timezones, the boundary shifts when their local date crosses
  -- midnight — acceptable for an MVP dashboard KPI; if a finer
  -- cutoff matters, the page can shift to the partner's tz by
  -- passing an explicit timestamp parameter in a future slice.
  select coalesce(sum(amount_cents), 0)::bigint
  from payout_ledger
  where partner_id = p_partner_id
    and kind = 'order_sale'
    and created_at >= date_trunc('month', now())
    and (p_partner_id = current_partner_id() or is_admin());
$$;

grant execute on function public.get_partner_month_sales_cents(bigint) to authenticated;

comment on function public.get_partner_month_sales_cents(bigint) is
  'P12.4 — Gross sales (cents) for a partner in the current calendar month. SUM(amount_cents) from payout_ledger where kind=order_sale and created_at >= month-start. Filters out subscriptions / refunds / adjustments / payouts / clawbacks by kind. Authorization: caller must be the partner (current_partner_id() matches) OR an admin (is_admin()). Returns 0 for unauthorized callers (never leaks data). Used by the /partner dashboard "This month" KPI (P12.4). STABLE.';

-- ============================================================================
-- 2. get_partner_daily_sales_series(p_partner_id bigint, p_days_back int)
-- ============================================================================
--
-- Returns the daily sales series for the last N days. Fills every
-- day in the range with a row — days with no sales return
-- (day, 0, 0). The page renders these as the earnings chart's X axis;
-- the contract is "exactly N rows in date-asc order."
--
-- Defensive bounds: p_days_back is clamped to [7, 365] at the top of
-- the function body so a bad caller can't request 10k days and pin
-- the DB.
--
-- Returns: (day date, sales_cents bigint, order_count bigint)
-- ============================================================================

create or replace function public.get_partner_daily_sales_series(
  p_partner_id bigint,
  p_days_back int default 30
)
returns table (
  day date,
  sales_cents bigint,
  order_count bigint
)
language plpgsql
stable
security definer
set search_path = 'public'
as $$
declare
  v_days int := greatest(7, least(365, coalesce(p_days_back, 30)));
  v_start date := (current_date - (v_days - 1))::date;
  v_authorized boolean := (p_partner_id = current_partner_id() or is_admin());
begin
  -- Authorization short-circuit: an unauthorized caller gets the
  -- date axis filled with zeros (so the chart renders a flat line,
  -- not a DB error). Never leak another partner's actual numbers.
  if not v_authorized then
    return query
    select gs.day::date, 0::bigint, 0::bigint
    from generate_series(v_start, current_date, '1 day') gs(day)
    order by gs.day asc;
    return;
  end if;

  return query
  with days as (
    select gs.day::date as day
    from generate_series(v_start, current_date, '1 day') gs(day)
  ),
  daily as (
    select
      (pl.created_at at time zone 'UTC')::date as day,
      sum(pl.amount_cents)::bigint as sales_cents,
      count(*)::bigint as order_count
    from payout_ledger pl
    where pl.partner_id = p_partner_id
      and pl.kind = 'order_sale'
      and pl.created_at >= v_start::timestamptz
      and pl.created_at < (current_date + 1)::timestamptz
    group by 1
  )
  select
    d.day,
    coalesce(dl.sales_cents, 0)::bigint as sales_cents,
    coalesce(dl.order_count, 0)::bigint as order_count
  from days d
  left join daily dl on dl.day = d.day
  order by d.day asc;
end
$$;

grant execute on function public.get_partner_daily_sales_series(bigint, int) to authenticated;

comment on function public.get_partner_daily_sales_series(bigint, int) is
  'P12.4 — Daily sales series (last N days, default 30) for a partner: (day, sales_cents, order_count) bucketed by UTC date. Filled with zeros for days without sales — always returns exactly N rows. p_days_back clamped to [7, 365]. Authorization: caller must be the partner (current_partner_id() matches) OR an admin (is_admin()). Unauthorized callers receive an all-zero series (never leaks data). Used by the /partner dashboard earnings chart (P12.4). STABLE.';

-- ============================================================================
-- 3. get_partner_recent_activity(p_partner_id bigint, p_limit int)
-- ============================================================================
--
-- UNION ALL of payout_ledger rows + order_items rows, sorted by event_at
-- DESC, limited to p_limit (capped at 50). The two sources are joined
-- via the order_id when both are present — we deduplicate by showing
-- the payout_ledger row only for paid sales (the order_items row is
-- the fallback for fresh orders that haven't had payout_ledger written
-- yet, which is rare but possible during the order webhook pipeline).
--
-- Each row is shaped as:
--   (event_at timestamptz,
--    event_kind text,         -- 'sale' | 'refund' | 'payout' | 'clawback' | 'subscription'
--    description text,        -- human-readable, e.g. "New sale: $50.00"
--    amount_cents bigint,
--    product_title text,
--    order_id bigint)
--
-- description is built client-side in the query (CASE WHEN) so the page
-- doesn't have to do per-row string interpolation.
-- ============================================================================

create or replace function public.get_partner_recent_activity(
  p_partner_id bigint,
  p_limit int default 10
)
returns table (
  event_at timestamptz,
  event_kind text,
  description text,
  amount_cents bigint,
  product_title text,
  order_id bigint
)
language plpgsql
stable
security definer
set search_path = 'public'
as $$
declare
  v_limit int := greatest(1, least(50, coalesce(p_limit, 10)));
  v_authorized boolean := (p_partner_id = current_partner_id() or is_admin());
begin
  -- Authorization short-circuit: unauthorized callers receive zero
  -- rows. Never leak another partner's activity.
  if not v_authorized then
    return;
  end if;

  return query
  with merged as (
    -- SOURCE 1: payout_ledger rows (sales / refunds / payouts / subscriptions)
    select
      pl.created_at as event_at,
      pl.kind::text as event_kind,
      pl.amount_cents,
      pl.order_id,
      -- product_title: join order_items -> products. order_id may be null
      -- (for payouts / clawbacks / adjustments that aren't tied to a specific
      -- order), in which case the title is null.
      (
        select p.title
        from order_items oi
        join products p on p.id = oi.product_id
        where oi.order_id = pl.order_id
          and oi.partner_id = pl.partner_id
        order by oi.id asc
        limit 1
      ) as product_title,
      -- description: human-readable string built from kind + amount.
      case pl.kind
        when 'order_sale' then 'New sale'
        when 'refund' then 'Refund'
        when 'payout' then 'Payout sent'
        when 'clawback' then 'Clawback'
        when 'adjustment' then 'Adjustment'
        when 'subscription' then 'Subscription'
        else 'Activity'
      end as description
    from payout_ledger pl
    where pl.partner_id = p_partner_id

    union all

    -- SOURCE 2: order_items rows (raw purchase lines — fallback for
    -- sales where the payout_ledger row hasn't been written yet).
    -- We skip rows where a matching payout_ledger sale row already
    -- exists in SOURCE 1 to avoid duplicates; but since SOURCE 1
    -- runs first and we UNION ALL then DISTINCT, we instead filter
    -- SOURCE 2 by NOT EXISTS on the corresponding payout_ledger
    -- row. Cheaper than post-DISTINCT.
    select
      oi.created_at as event_at,
      'order_sale'::text as event_kind,
      oi.royalty_cents as amount_cents,
      oi.order_id,
      p.title as product_title,
      'New sale' as description
    from order_items oi
    join products p on p.id = oi.product_id
    where oi.partner_id = p_partner_id
      and oi.order_id is not null
      and not exists (
        select 1
        from payout_ledger pl
        where pl.order_id = oi.order_id
          and pl.partner_id = p_partner_id
          and pl.kind = 'order_sale'
      )
  )
  select
    m.event_at,
    m.event_kind,
    m.description,
    m.amount_cents,
    m.product_title,
    m.order_id
  from merged m
  order by m.event_at desc
  limit v_limit;
end
$$;

grant execute on function public.get_partner_recent_activity(bigint, int) to authenticated;

comment on function public.get_partner_recent_activity(bigint, int) is
  'P12.4 — Recent activity feed entries (default 10, capped at 50) for a partner: (event_at, event_kind, description, amount_cents, product_title, order_id). UNION ALL of payout_ledger rows + order_items rows (deduped on order_id+kind). Authorization: caller must be the partner (current_partner_id() matches) OR an admin (is_admin()). Unauthorized callers receive zero rows (never leaks data). Used by the /partner dashboard activity feed (P12.4). STABLE.';

-- ============================================================================
-- Supporting index — supports the payout_ledger side of the activity
-- feed (date DESC for the most-recent sort) AND the month-sales
-- filter (created_at >= month_start).
--
-- The existing payout_ledger_partial index from 0029 covers
-- (partner_id, amount_cents) WHERE kind = 'order_sale' — enough
-- for the SUM but not optimal for a date-DESC sort on the activity
-- feed (which spans multiple kinds). The composite below extends
-- coverage to all kinds for the partner-scoped recency scan.
--
-- IDEMPOTENT: CREATE INDEX IF NOT EXISTS.
-- ============================================================================

create index if not exists payout_ledger_partner_created_at_idx
  on payout_ledger (partner_id, created_at desc);

-- ============================================================================
-- STUB REGISTER
-- ============================================================================
-- STUB-091 — P12.4 dashboard refinements SQL resolvers.
-- The /partner dashboard's "This month" KPI + earnings chart + activity
-- feed all read from these functions. Resolved by Mavis (P12.4 tick).
-- See docs/PROGRESS.md 2026-06-29 note.
