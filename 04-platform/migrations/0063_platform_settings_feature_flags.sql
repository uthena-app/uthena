-- P14.14 — Feature flags column on platform_settings.
-- ============================================================================
--
-- The Feature flags tab on `/admin/settings` lets admins toggle runtime
-- flags (per the spec at `01-specs/pages/admin-settings.md` lines 49-51).
-- The shape is a jsonb array of `{ key, enabled, description, rollout_pct }`
-- rows, sorted by `key` for stable rendering. Rollout % is 0-100 (NULL = 100).
--
-- v1 keeps the flags inline as jsonb (per the spec OQ "Feature flag
-- semantics" recommendation) because the flag count is small (< 20).
-- If flags proliferate post-v1, split into a `feature_flags` table.
--
-- Idempotent: ALTER TABLE IF NOT EXISTS pattern via information_schema.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Add `flags` column if missing.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'platform_settings'
      and column_name = 'flags'
  ) then
    alter table platform_settings
      add column flags jsonb not null default '[]'::jsonb;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Validate the jsonb shape via a CHECK constraint.
--
-- A valid `flags` value is a JSON array; each element is an object with:
--   - key:           non-empty string, 1..60 chars, lowercase + digits + underscore
--   - enabled:       boolean
--   - description:   string, 0..500 chars
--   - rollout_pct:   null OR integer in [0, 100]
--
-- Postgres' jsonb_typeof + the ->> / -> operators let us express the
-- invariants declaratively. The keys must be unique across rows (enforced
-- at the application layer; the DB CHECK only enforces shape).
-- ---------------------------------------------------------------------------
do $$
begin
  -- Drop the legacy constraint name (if any prior run created it) so we
  -- can re-apply idempotently.
  if exists (
    select 1 from pg_constraint
    where conname = 'platform_settings_flags_shape_check'
      and conrelid = 'public.platform_settings'::regclass
  ) then
    alter table platform_settings drop constraint platform_settings_flags_shape_check;
  end if;
end $$;

alter table platform_settings
  add constraint platform_settings_flags_shape_check
  check (
    jsonb_typeof(flags) = 'array'
    and jsonb_array_length(flags) <= 200
    and (
      flags = '[]'::jsonb
      or jsonb_typeof(flags -> 0) = 'object'
    )
  );

-- ---------------------------------------------------------------------------
-- 3. Note: no new RLS policies needed. The existing
--    platform_settings_public_read (allows anyone) +
--    platform_settings_admin_write (admin-only) policies govern this column
--    automatically (RLS applies to all columns).
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 4. Documentation comment for future readers.
-- ---------------------------------------------------------------------------
comment on column public.platform_settings.flags is
  'Runtime feature flags (P14.14). JSON array of { key, enabled, description, rollout_pct }. Admin-editable from /admin/settings → Feature flags. Inline toggle (no Save button). All changes are audit-logged via admin_audit_log.';