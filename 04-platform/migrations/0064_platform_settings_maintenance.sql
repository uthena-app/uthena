-- P14.15 — Maintenance mode message + start timestamp on platform_settings.
-- ============================================================================
--
-- The Maintenance toggle on `/admin/settings → General` lets admins flip
-- `maintenance_mode = true` to take the public site offline. When the
-- toggle is on, the middleware (see `middleware.ts`) returns 503 for
-- every non-admin route, and the 503 body shows the admin-provided
-- message. When the toggle is off, the site is reachable as usual.
--
-- Per `01-specs/pages/admin-settings.md` line 19 + 123:
--   - `maintenance_mode` boolean toggle (already shipped in 0001_initial.sql)
--   - 503 for all non-admin routes
--   - admin route (`/admin/*`) remains accessible
--   - middleware reads the on/off + message via a 60s cookie cache
--     (see `updateMaintenanceAction.ts`)
--
-- Two new columns land here:
--   1. `maintenance_started_at timestamptz` — when the toggle was last
--      flipped to true (null when off). Used for the audit strip on
--      `/admin/settings` and the 503 page footer.
--   2. `maintenance_message text` — admin-provided customer-facing
--      message (max 500 chars enforced at the action layer; the DB
--      carries no length cap so the action can evolve the bound
--      without a migration).
--
-- The `maintenance_message` text length is capped at the action via
-- Zod (matches the spec's acceptance criteria: a friendly, scannable
-- message that fits on a single mobile screen). The DB column is
-- intentionally permissive so the constraint can move without a
-- migration.
--
-- Idempotent: information_schema guard + CREATE OR REPLACE pattern.
-- No new RLS needed — the existing platform_settings_admin_write +
-- platform_settings_public_read policies cover these columns.

-- ---------------------------------------------------------------------------
-- 1. Add the two new columns if missing.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'platform_settings'
      and column_name = 'maintenance_started_at'
  ) then
    alter table public.platform_settings
      add column maintenance_started_at timestamptz;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'platform_settings'
      and column_name = 'maintenance_message'
  ) then
    alter table public.platform_settings
      add column maintenance_message text;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Sanity check constraint — `maintenance_message` length cap.
--
-- Soft cap of 1000 chars at the DB layer (the action caps at 500; we
-- leave DB headroom so a future release can raise the bound without a
-- migration). The constraint name is deterministic so the migration
-- stays idempotent against accidental re-runs.
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'platform_settings_maintenance_message_length_check'
      and conrelid = 'public.platform_settings'::regclass
  ) then
    alter table public.platform_settings
      drop constraint platform_settings_maintenance_message_length_check;
  end if;
end $$;

alter table public.platform_settings
  add constraint platform_settings_maintenance_message_length_check
  check (
    maintenance_message is null
    or char_length(maintenance_message) <= 1000
  );

-- ---------------------------------------------------------------------------
-- 3. Sanity check constraint — `maintenance_started_at` is non-null when
--    `maintenance_mode` is true (data integrity).
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'platform_settings_maintenance_started_at_consistency_check'
      and conrelid = 'public.platform_settings'::regclass
  ) then
    alter table public.platform_settings
      drop constraint platform_settings_maintenance_started_at_consistency_check;
  end if;
end $$;

alter table public.platform_settings
  add constraint platform_settings_maintenance_started_at_consistency_check
  check (
    (maintenance_mode = false and maintenance_started_at is null)
    or (maintenance_mode = true and maintenance_started_at is not null)
    or (maintenance_mode = false)  -- allow "off but stale started_at" defensively
  );

-- ---------------------------------------------------------------------------
-- 4. Documentation comment.
-- ---------------------------------------------------------------------------
comment on column public.platform_settings.maintenance_started_at is
  'When maintenance_mode was last flipped to true. NULL when off. Drives the audit strip + the 503 page footer.';

comment on column public.platform_settings.maintenance_message is
  'Customer-facing maintenance message shown on the 503 page (P14.15). Admin-editable from /admin/settings → General. Max 500 chars at the action layer; DB column caps at 1000 for future headroom.';