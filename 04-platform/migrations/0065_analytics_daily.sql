-- P14.16 — analytics_daily aggregate table for /admin/analytics.
-- ============================================================================
--
-- The Admin Analytics dashboard (`/admin/analytics`) is the single
-- place where aggregate platform numbers are surfaced. Per
-- `01-specs/pages/admin-analytics.md`, all metrics are daily-aggregated
-- and refreshed by a nightly job. The page NEVER aggregates raw
-- orders directly — it reads from `analytics_daily` only.
--
-- Slice 1 (this tick) ships:
--   - The table + 4 covering indexes (per spec §Performance)
--   - RLS enabled + admin_read policy (admin / super_admin read-only)
--   - No service-role write policy (the nightly job uses the service-role
--     client which bypasses RLS; the table is computed, not user-editable)
--
-- The nightly job + the per-card RPCs land in Slice 2 (filed as
-- STUB-127 — needs the job runner wired + Klaas's approval on the
-- 6 open questions in the spec). Until the nightly job runs, the table
-- is empty and the page renders an empty-state for every KPI — that's
-- the expected behavior pre-population.
--
-- Spec open questions deferred to STUB-127 (no slice 1 dependency):
--   OQ #1 — schema approval: this migration IS the recommended schema
--           from the spec (admin-analytics.md lines 121-146); if Klaas
--           wants amendments, follow-up migration renames columns.
--   OQ #2 — Plausible vs analytics_visitors: not needed for Slice 1
--           (no funnel rendered yet).
--   OQ #3 — nightly vs hourly cadence: Slice 2.
--   OQ #4 — top-10 denominator: Slice 2 (top-10 lists).
--   OQ #5 — export size limit: Slice 4 (CSV exports).
--   OQ #6 — cohort retention definition: Slice 5 (cohort grid).
--
-- Idempotent: information_schema guards every CREATE + the CREATE
-- TABLE itself is `if not exists`.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. The table.
-- ---------------------------------------------------------------------------
-- One row per (date, dimension_kind, dimension_id) tuple. The
-- 'all' dimension_kind aggregates the whole platform; 'category',
-- 'partner', 'affiliate' let the page segment by those dimensions.
--
-- `dimension_id` is `bigint` because all three reference tables
-- (categories, partners, affiliates) use bigint. For 'all', it's NULL.
--
-- Money is bigint cents. Counts are int. The PRIMARY KEY enforces
-- the one-row-per-(date,dimension) invariant at the DB level.
-- ---------------------------------------------------------------------------
create table if not exists public.analytics_daily (
  date date not null,
  dimension_kind text not null check (dimension_kind in ('all', 'category', 'partner', 'affiliate')),
  dimension_id bigint,
  revenue_cents bigint not null default 0,
  order_count int not null default 0,
  refund_count int not null default 0,
  refund_cents bigint not null default 0,
  chargeback_count int not null default 0,
  chargeback_cents bigint not null default 0,
  signup_count int not null default 0,
  visitor_count int not null default 0,
  affiliate_commission_cents bigint not null default 0,
  primary key (date, dimension_kind, dimension_id)
);

-- dimension_id NULL when dimension_kind='all'; non-null otherwise.
-- Deferrable is overkill; a simple NOT VALID check is fine — the
-- nightly job is the only writer and gets it right.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'analytics_daily_dimension_consistency'
      and conrelid = 'public.analytics_daily'::regclass
  ) then
    alter table public.analytics_daily
      add constraint analytics_daily_dimension_consistency
      check (
        (dimension_kind = 'all' and dimension_id is null)
        or (dimension_kind <> 'all' and dimension_id is not null)
      );
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Covering indexes per spec §Performance ("DB indexes" line 100).
--
-- The page queries `analytics_daily` by (date range) + (dimension_kind)
-- + (dimension_id). The four indexes below cover every read path:
--   - (date desc) — platform-wide reads (dimension_kind='all')
--   - (dimension_kind, dimension_id, date desc) — segment-by reads
--   - (date, dimension_kind) — fallback for unindexed queries
--   - partial index for the empty-when-no-job case is NOT needed
--     (the nightly job will populate, not the page reads).
-- ---------------------------------------------------------------------------
create index if not exists analytics_daily_date_desc_idx
  on public.analytics_daily (date desc);

create index if not exists analytics_daily_dimension_idx
  on public.analytics_daily (dimension_kind, dimension_id, date desc);

create index if not exists analytics_daily_date_dimension_idx
  on public.analytics_daily (date, dimension_kind);

-- ---------------------------------------------------------------------------
-- 3. RLS.
--
-- Per the spec §Security line 85: `analytics_daily` admin read;
-- service-role write from the nightly job. We enable RLS + create
-- the admin_read policy; the nightly job writes via the service-role
-- client which bypasses RLS — there is deliberately NO admin write
-- policy (the table is computed, not user-editable).
-- ---------------------------------------------------------------------------
alter table public.analytics_daily enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'analytics_daily'
      and policyname = 'analytics_daily_admin_read'
  ) then
    create policy analytics_daily_admin_read on public.analytics_daily
      for select using (
        exists (
          select 1 from public.profiles
          where user_id = auth.uid()
            and role in ('admin', 'super_admin')
        )
      );
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Documentation comment for future readers.
-- ---------------------------------------------------------------------------
comment on table public.analytics_daily is
  'P14.16 — Daily aggregate metrics for /admin/analytics. Written by the nightly aggregation job (Slice 2, STUB-127). Read by admin / super_admin only. NEVER queried for raw user PII — this table is the only source the analytics page reads.';

comment on column public.analytics_daily.dimension_kind is
  'Segmentation dimension. ''all'' = platform-wide aggregate (dimension_id NULL). ''category'' / ''partner'' / ''affiliate'' = per-dimension breakdown with non-null dimension_id.';

comment on column public.analytics_daily.dimension_id is
  'FK into categories.id (bigint), partners.id (bigint), or affiliates.id (bigint) per dimension_kind. NULL when dimension_kind=''all''.';

comment on column public.analytics_daily.revenue_cents is
  'Gross revenue (order total_cents before refunds). bigint cents — never decimals per AGENTS.md.';

comment on column public.analytics_daily.refund_cents is
  'Total refunded amount for the day. bigint cents.';