-- SEC-3 / D3 [decided: Supabase-backed] — durable rate-limit storage.
-- ============================================================================
--
-- Per TODO-HARDENING.md SEC-3 + DECISIONS-NEEDED.md D3 + STUB-013 (grep
-- "rate_limit" in STUBS.md): every rate limiter in the app today is an
-- in-process `Map` (`00-foundations/files/rate-limit.ts`,
-- `02-features/admin/platform-settings/actions/maintenance.rate-limit.ts`,
-- +6 more per QLT-7) or nothing at all (`/api/errors/report`,
-- `/api/search`). In-process counters are per-instance — they reset on
-- deploy and don't hold across multiple Node instances behind a load
-- balancer, so a distributed caller can get N x (limit) throughput.
--
-- This migration lays the durable storage STUB-013 asks for: a generic
-- sliding-window-bucket table any limiter can read/write through the
-- service-role client. It does NOT itself replace the 8 existing
-- in-process limiters (out of scope for this pass — other agents may be
-- touching those files concurrently) — see the `ponytail:` seam in
-- `00-foundations/files/rate-limit-shared.ts` for the wiring point.
--
-- Shape: one row per (key, window_start) bucket. `key` is caller-defined
-- (e.g. `errors_report:<hashed-ip>` or `search:<hashed-ip>`) so a single
-- table serves every limiter without per-feature migrations. `window_start`
-- is the bucket's fixed-size window start (truncated to the limiter's
-- window size, e.g. minute-aligned) rather than a per-request timestamp —
-- this keeps the table small (one row per key per window, UPSERT +
-- increment) instead of one row per request.
--
-- RLS: enabled, service-role-only. No anon/authenticated policy at all —
-- rate-limit bookkeeping is infrastructure, never user-readable or
-- user-writable. The service-role client bypasses RLS for both the
-- limiter's reads and writes; there is deliberately no policy for any
-- other role (mirrors `analytics_daily`'s "computed, not user-editable"
-- pattern in 0065_analytics_daily.sql).
--
-- Idempotent: `create table if not exists` + `if not exists` policy guard.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. The table.
-- ---------------------------------------------------------------------------
-- `key` — caller-defined bucket identifier, e.g. `<route>:<hashed-ip>` or
--   `<route>:<user-id>`. Never raw PII (callers hash IPs before writing;
--   see the `ponytail:` comments in the two interim call sites).
-- `window_start` — the start of the fixed window this row counts (e.g.
--   truncated to the minute for a 1-minute sliding-window approximation).
-- `count` — hits recorded in this window so far.
-- ---------------------------------------------------------------------------
create table if not exists public.rate_limit_events (
  id bigserial primary key,
  key text not null,
  window_start timestamptz not null,
  count int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (key, window_start)
);

create index if not exists rate_limit_events_key_window_idx
  on public.rate_limit_events (key, window_start desc);

-- Cheap GC support — callers (or a future cron) can delete rows older
-- than the longest window in use without a table scan.
create index if not exists rate_limit_events_created_at_idx
  on public.rate_limit_events (created_at);

drop trigger if exists rate_limit_events_set_updated_at on public.rate_limit_events;
create trigger rate_limit_events_set_updated_at before update on public.rate_limit_events
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. RLS — service-role only. No policy for anon/authenticated/admin: the
--    service-role client bypasses RLS entirely, which is the only way
--    this table is ever read or written.
-- ---------------------------------------------------------------------------
alter table public.rate_limit_events enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'rate_limit_events'
      and policyname = 'rate_limit_events_service_role_only'
  ) then
    create policy rate_limit_events_service_role_only on public.rate_limit_events
      for all
      to service_role
      using (true)
      with check (true);
  end if;
end $$;

comment on table public.rate_limit_events is
  'SEC-3 / D3 / STUB-013 — durable sliding-window rate-limit buckets, shared by every limiter that opts in. service-role read/write only; never exposed to anon/authenticated. One row per (key, window_start).';

comment on column public.rate_limit_events.key is
  'Caller-defined bucket identifier, e.g. "errors_report:<hashed-ip>". Never raw IP/email — callers hash identifiers before writing.';

comment on column public.rate_limit_events.window_start is
  'Start of the fixed window this row counts (e.g. minute-truncated timestamp for a 1-minute window).';
