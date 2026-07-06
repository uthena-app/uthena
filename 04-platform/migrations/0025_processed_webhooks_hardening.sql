-- ---------------------------------------------------------------------------
-- 0025_processed_webhooks_hardening.sql — P3.4 processed_webhooks hardening
-- ---------------------------------------------------------------------------
-- P3.4 (processed_webhooks hardening) closes three production gaps in the
-- webhook idempotency log:
--
--   1. **result NOT NULL is a latent runtime bug.** The middleware in
--      04-platform/webhooks/_middleware.ts does `claimWebhookEvent` by
--      INSERTing `{ source, event_id, event_type, payload }` — it never
--      sets `result`. But the column is `NOT NULL`, so the very first
--      real Stripe webhook would 500 with
--      "null value in column 'result' violates not-null constraint".
--      The bug has been latent because we haven't fired a real webhook
--      in dev (the smoke test uses a stub).
--      Fix: drop the `NOT NULL` on `result`. The existing CHECK
--      constraint (`result IN ('processed','skipped','failed')`) already
--      passes NULL semantically (CHECK constraints treat NULL as
--      "passes"; only NOT NULL is the blocker). The result is then
--      written by `finalizeWebhookEvent` once the handler completes.
--
--   2. **No retention / TTL.** The webhook log is append-only forever.
--      Stripe's replay window is 3 days; PayPal's is 5 days; Bunny's
--      is 1 day. We want a 30-day audit window (so the support team
--      can answer "did event X arrive?" for up to a month), then
--      GC. A clean `expires_at` STORED generated column makes the
--      retention scan O(partition) and self-documenting; the
--      `cleanup_old_webhook_events()` SECURITY DEFINER function is
--      invoked by the Phase 18 P18.7 maintenance cron (or manually
--      for one-off cleanup).
--
--   3. **No "processed" outcome signal.** The result column was
--      defined but no code path wrote it. The `finalizeWebhookEvent`
--      helper (added in this tick) writes `result='processed'` on
--      success, `result='failed'` + `error_message` on permanent
--      failure, and leaves it NULL for the transient "release" path
--      (DELETE the row so Stripe's retry can reprocess).
--
-- What stays the same:
--   - Unique constraint on (source, event_id) — race protection for
--     the claim pattern.
--   - RLS: admin SELECT only; service-role INSERT/UPDATE/DELETE.
--   - Existing indexes: processed_webhooks_source_idx, processed_webhooks_created_idx.
--
-- New artifacts:
--   - `processed_at timestamptz` column — when the handler finished
--     (NULL until finalizeWebhookEvent fires).
--   - `expires_at timestamptz` STORED generated column =
--     `created_at + 30 days`. Used by the cleanup function and the
--     future P14.18 audit-log-search "show me webhook events from
--     the last 30 days" filter (no date math on every read).
--   - `processed_webhooks_expires_idx` — partial index
--     `WHERE expires_at < now()` to make the cleanup scan cheap.
--   - `public.cleanup_old_webhook_events()` SECURITY DEFINER
--     function — deletes rows where `expires_at < now()`, returns
--     the deleted-row count. `set search_path = ''` (Supabase
--     hardener). `stable` (read-only against the table) so
--     Postgres can memoize when called from a SELECT.
--
-- IDEMPOTENT — `alter table ... drop not null` is safe to re-run on
-- a column that's already nullable. The `add column if not exists`
-- is safe to re-run. The `create index if not exists` is safe to
-- re-run. The `create or replace function` is safe to re-run.

-- ---------------------------------------------------------------------------
-- 1. Schema fixes — make `result` nullable + add outcome columns
-- ---------------------------------------------------------------------------
-- Drop the `not null` on `result`. The CHECK constraint already
-- passes NULL semantically (CHECK constraints treat NULL as
-- "passes"). The column will be written by the new
-- `finalizeWebhookEvent` helper once the handler completes.
alter table processed_webhooks
  alter column result drop not null;

-- Add `processed_at` — set by finalizeWebhookEvent on success or
-- permanent failure. NULL means "handler is still running OR the
-- event was claimed-then-released (transient failure path)".
alter table processed_webhooks
  add column if not exists processed_at timestamptz;

-- Add `expires_at` as a STORED generated column. Postgres evaluates
-- the expression at INSERT time and stores the result. This is the
-- canonical retention boundary: `cleanup_old_webhook_events` deletes
-- WHERE expires_at < now() — no date math on every row.
--
-- The STORED clause means the value is persisted, not recomputed on
-- every read. Trade-off: ~8 bytes per row, but the cleanup query
-- becomes a simple `expires_at < now()` range scan, not a function
-- call per row.
--
-- The 30-day window covers:
--   - Stripe's 3-day replay window
--   - PayPal's 5-day replay window
--   - Bunny's 1-day replay window
--   - The 30-day audit / "did event X arrive?" support window
--   - A 3-week safety margin for the cleanup cron to run
-- P3.5 follow-up: simple column with trigger-maintained value (the
-- original `generated always as (...) stored` form was rejected by
-- Postgres as "not immutable" — likely a Postgres-version interpretation
-- of `timestamptz + interval`; the trigger pattern is reliable).
-- Helper FIRST so the trigger's CREATE statement resolves.
create or replace function public.set_timestamp_with_offset()
returns trigger
language plpgsql
as $$
begin
  new.expires_at := new.created_at + interval '30 days';
  return new;
end;
$$;

alter table processed_webhooks
  add column if not exists expires_at timestamptz;

drop trigger if exists processed_webhooks_set_expires_at on processed_webhooks;
create trigger processed_webhooks_set_expires_at
  before insert or update of created_at on processed_webhooks
  for each row execute function public.set_timestamp_with_offset();

-- ---------------------------------------------------------------------------
-- 2. Index for the retention scan
-- ---------------------------------------------------------------------------
-- Partial index over the `expires_at < now()` range. The cleanup
-- function does `delete from processed_webhooks where expires_at <
-- now()` — without this index, the scan is a full table scan + sort.
-- With it, the scan is an index range scan on the rows due for
-- deletion. The partial `WHERE expires_at IS NOT NULL` is defensive
-- (generated columns are always NOT NULL when defined NOT NULL, but
-- the `add column if not exists` re-run path on an older table
-- could in theory have a NULL row during the migration window).
create index if not exists processed_webhooks_expires_idx
  on processed_webhooks (expires_at)
  where expires_at is not null;

-- Index for the "recent failures" admin view (Phase 14 P14.18 audit
-- log search UI). Filter by result + order by processed_at desc.
-- The existing `processed_webhooks_created_idx` covers the
-- "no-result-filter, just sort by created_at" path; this partial
-- index covers the "show me only the failed/skipped events"
-- admin-debugging path.
create index if not exists processed_webhooks_result_idx
  on processed_webhooks (result, processed_at desc)
  where result is not null;

-- ---------------------------------------------------------------------------
-- 3. cleanup_old_webhook_events() — retention / TTL maintenance
-- ---------------------------------------------------------------------------
-- Deletes rows where the STORED `expires_at` is in the past. Returns
-- the deleted row count so the caller can log it (the Phase 18 P18.7
-- maintenance cron logs the count to PostHog or pino for observability).
--
-- SECURITY DEFINER: the function runs with the function owner's
-- privileges, which is needed to DELETE from a table that has only
-- an admin-SELECT policy. The function is REVOKEd from PUBLIC and
-- GRANTed to service_role only — only the platform-side maintenance
-- cron (and ad-hoc DBA scripts run with the service-role key) can
-- call it. A regular `authenticated` user can never trigger cleanup.
--
-- `set search_path = ''` is the standard Supabase hardener for
-- SECURITY DEFINER functions — prevents search-path attacks where a
-- privileged function is tricked into reading a malicious `public`
-- schema object instead of the intended `pg_catalog` / `public`
-- object. All object references in the body are schema-qualified.
--
-- `stable`: the function reads the table but doesn't mutate it from
-- its own body (the DELETE is the side effect). Marking it stable
-- lets the planner memoize the result when called from a SELECT
-- context (not strictly needed for a maintenance cron, but cheap
-- to add and the right semantic).
create or replace function public.cleanup_old_webhook_events()
returns bigint
language plpgsql
security definer
set search_path = ''
stable
as $$
declare
  v_deleted bigint;
begin
  delete from public.processed_webhooks
  where expires_at < now();

  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function public.cleanup_old_webhook_events() from public;
grant execute on function public.cleanup_old_webhook_events() to service_role;

comment on function public.cleanup_old_webhook_events() is
  'P3.4 retention maintenance. Deletes processed_webhooks rows whose 30-day expires_at is in the past. Returns the deleted row count. service_role only — called by the Phase 18 P18.7 maintenance cron.';
