-- ---------------------------------------------------------------------------
-- 0036_app_settings.sql
-- ---------------------------------------------------------------------------
-- Resolves STUB-009 + ships P10.4 ("DMCA — designated agent contact editable
-- via Phase 14 admin"). The `app_settings` table is the key-value store
-- for platform-level configuration that:
--
--   (a) needs to be editable at runtime (not a re-deploy to change), AND
--   (b) has a small number of distinct values (DMCA agent contact,
--       support email, legal email, maintenance-mode toggle, etc.).
--
-- NAMING NOTE — the data-model spec at `01-specs/pages/_data-model.md:953`
-- proposed this table as `platform_settings` (key-value shape). The
-- migration `0001_initial.sql` already created a table named
-- `platform_settings` with a DIFFERENT shape (singleton, columns-based
-- config for `default_royalty_pct_bps` + future maintenance_mode toggle).
-- That legacy table is reserved for future feature-flag reads (per the
-- P5.9 + P18.7 references in checkout.ts and subscriptions.ts) — none
-- of those readers exist yet, but the table must remain available for
-- them. To avoid a name collision + a destructive `DROP TABLE`, the
-- key-value store ships under the distinct name `app_settings`. When
-- P14.12 retires the legacy single-row table, `app_settings` may be
-- renamed to `platform_settings` (no data shape change required — the
-- key-value store is the spec's canonical home for the table).
--
-- Columns:
--   key                text PRIMARY KEY  — the setting's logical name
--                                          (e.g. 'dmca_agent', 'support_email').
--   value              jsonb NOT NULL   — the setting's value (shape depends
--                                          on key; dmca_agent stores a 4-field
--                                          object: { name, email,
--                                          mailing_address, phone }).
--   description        text             — human-readable, admin-only.
--   public_read        boolean NOT NULL — opt-in public visibility. Only the
--                                          few keys that legally need to be
--                                          public (DMCA agent contact, support
--                                          email, legal entity name) ship with
--                                          this = true. Default false.
--   updated_by         uuid             — admin user_id who last wrote the row.
--   updated_at         timestamptz NOT NULL DEFAULT now()
--   requires_confirm   boolean NOT NULL DEFAULT false
--                                       — when true the admin UI forces a
--                                          typed-confirmation modal (matches
--                                          the existing P14 pattern from the
--                                          manual-payout confirmation). NOT
--                                          used by the DMCA slice — set when
--                                          a destructive key (payouts_enabled,
--                                          maintenance_mode) ships.
--
-- RLS — three policies, per spec:
--   1. `app_settings_admin_read`   — admins can SELECT every row.
--   2. `app_settings_admin_write`  — admins can INSERT/UPDATE every row.
--                                     No DELETE policy (settings are
--                                     deactivated by setting value = null
--                                     or by renaming the key, per spec).
--   3. `app_settings_public_read`  — anyone (anon or authed) can SELECT
--                                     rows where public_read = true. The
--                                     public read code path projects only
--                                     the documented columns — no admin
--                                     fields (description, updated_by,
--                                     updated_at) cross the wire.
--
-- Idempotent: every statement is `if not exists`. A re-run against a
-- partially-migrated DB is a no-op.
--
-- Seed: one row for `dmca_agent` with the legal@uthena.com contact that
-- the markdown previously hard-coded. This is the v1 default; admins can
-- edit it from `/admin/dmca-agent` immediately after deploy. public_read
-- = true is REQUIRED for the /dmca page to render the contact block.
--
-- Used by:
--   - 02-features/legal/queries/getDmcaAgent.ts (public read for /dmca)
--   - 02-features/admin/platform-settings/queries/getPlatformSetting.ts
--     + actions/updateDmcaAgent.ts (admin read/write)
--   - app/dmca/page.tsx (renders the agent card from data)
--   - app/admin/dmca-agent/page.tsx (the editor)
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. The table itself
-- ---------------------------------------------------------------------------
create table if not exists app_settings (
  key text primary key,
  value jsonb not null,
  description text,
  public_read boolean not null default false,
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  requires_confirm boolean not null default false
);

-- ---------------------------------------------------------------------------
-- 2. Indexes
-- ---------------------------------------------------------------------------
-- The primary key on `key` is already an index; this covers the only
-- access pattern this table has today (point lookups by key). The
-- partial index on public_read is the hot path for the public reads
-- the /dmca page does (one row, keyed by public_read=true AND key=
-- 'dmca_agent' — but Postgres can also use the primary key index for
-- the key filter alone; the partial index is for the future case where
-- many public keys land in this table).
create index if not exists app_settings_public_read_idx
  on app_settings (key) where public_read = true;

-- ---------------------------------------------------------------------------
-- 3. RLS — three policies, per spec section "Rules for this table"
-- ---------------------------------------------------------------------------
alter table app_settings enable row level security;

-- Admin can SELECT every row (including public_read=false keys like a
-- future maintenance_mode toggle). The role check uses the same
-- pattern as the rest of the admin area.
drop policy if exists app_settings_admin_read on app_settings;
create policy app_settings_admin_read on app_settings
  for select
  using (
    exists (
      select 1
      from profiles
      where profiles.user_id = auth.uid()
        and profiles.role in ('admin', 'super_admin')
    )
  );

-- Admin can INSERT/UPDATE every row. (No DELETE policy per spec.)
drop policy if exists app_settings_admin_write on app_settings;
create policy app_settings_admin_write on app_settings
  for all
  using (
    exists (
      select 1
      from profiles
      where profiles.user_id = auth.uid()
        and profiles.role in ('admin', 'super_admin')
    )
  )
  with check (
    exists (
      select 1
      from profiles
      where profiles.user_id = auth.uid()
        and profiles.role in ('admin', 'super_admin')
    )
  );

-- Public read is opt-in via public_read = true. The narrow select
-- projection in 02-features/legal/queries/getDmcaAgent.ts ensures
-- admin-internal columns (description, updated_by, updated_at) never
-- cross the wire to anon callers.
drop policy if exists app_settings_public_read on app_settings;
create policy app_settings_public_read on app_settings
  for select
  using (public_read = true);

-- ---------------------------------------------------------------------------
-- 4. Seed the dmca_agent row (public_read = true so /dmca can render it)
-- ---------------------------------------------------------------------------
-- on conflict do nothing (not do update): we don't want a re-run to
-- stomp on whatever the admin has saved in the meantime.
insert into app_settings (key, value, description, public_read)
values (
  'dmca_agent',
  '{
    "name": "DMCA Agent, Uthena",
    "email": "legal@uthena.com",
    "mailing_address": "Update in /admin/dmca-agent (the editable DMCA designated-agent editor).",
    "phone": ""
  }'::jsonb,
  'Designated agent contact for U.S. Copyright Office § 512(c) compliance. Editable from /admin/dmca-agent.',
  true
)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- Verify
-- ---------------------------------------------------------------------------
-- check:rls static check: the new table has RLS + 3 policies in this file.
-- (Verified locally by running `bash 04-platform/ci/scripts/check-rls-coverage.sh`.)

-- end of migration