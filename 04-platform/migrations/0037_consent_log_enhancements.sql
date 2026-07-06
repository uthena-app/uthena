-- ---------------------------------------------------------------------------
-- 0037_consent_log_enhancements.sql
-- ---------------------------------------------------------------------------
-- Resolves the P11.2 data-surface gap: the current consent_log table
-- (from 0001_initial.sql) holds the per-row consent decision but lacks
-- the supporting metadata that the cookie banner (and any future
-- analytics opt-out work) needs:
--
--   * `country`   — the ISO 3166-1 alpha-2 country code from the CDN
--                   geo header (when present). Records the visitor's
--                   EU/non-EU classification AT DECISION TIME so
--                   analytics can later answer "what % of EU visitors
--                   opted out of analytics." Nullable — geo header is
--                   not always set (private VPNs, internal crawls,
--                   direct curl smoke tests).
--
--   * `gpc`       — boolean flag, true when the request carried
--                   `Sec-GPC: 1` at decision time. Lets us answer
--                   "how many of our consents were GPC-driven" without
--                   joining the access log. Nullable for backward
--                   compatibility with rows from before this column
--                   shipped.
--
--   * `source`    — typed enum marking where the decision came from.
--                   `'banner_accept_all'` / `'banner_decline_non_essential'`
--                   / `'banner_save_preferences'` / `'page_save_preferences'`
--                   / `'gpc_auto_decline'` / `'auto_default'`. Lets the
--                   audit log answer "what surface is doing the work"
--                   without parsing free-text metadata. NOT NULL with
--                   a default of 'page_save_preferences' (the existing
--                   P11.1 callers land here via the default; P11.2
--                   callers pass the explicit source).
--
--   * `anon_id`   — the visitor-stable UUID from the `uthena_anon_id`
--                   cookie. Lets us correlate multiple anon decisions
--                   from the same browser session; survives the
--                   visitor's IP changing (wifi → cellular). Nullable
--                   — signed-in decisions carry `user_id` instead.
--
-- All four columns are ADDITIVE — the existing 0001_initial.sql row
-- shape remains compatible; RLS policies are unchanged (a row still
-- requires no auth to insert; users still read their own; admins read
-- everything). The migration is idempotent (every ALTER uses
-- `add column if not exists` + `if not exists` guards on the
-- constraint + the index).
--
-- Index strategy:
--   * The existing `consent_log_created_idx (created_at desc)` keeps
--     covering the bulk read path ("all consents for the GDPR export").
--   * The existing `consent_log_user_idx (user_id)` keeps covering
--     the signed-in path (`eq('user_id', x).order(created_at)`).
--   * NEW `consent_log_anon_idx (anon_id)` — covers the anon path
--     (`eq('anon_id', x).order(created_at)`) and the future
--     analytics-aggregation path
--     (`group by anon_id having max(gpc)`).
--   * NEW `consent_log_source_idx (source)` — covers the new
--     "by source" analytics question AND the GPC reporting path
--     (`where source = 'gpc_auto_decline'`).
--
-- Backfill: zero. Legacy rows carry NULL for the new columns by
-- definition; the constraint's default keeps new rows valid; the
-- reporting queries handle NULL gracefully.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. Schema additions
-- ---------------------------------------------------------------------------
alter table consent_log
  add column if not exists country text;

alter table consent_log
  add column if not exists gpc boolean;

alter table consent_log
  add column if not exists source text not null default 'page_save_preferences';

alter table consent_log
  add column if not exists anon_id text;

-- ---------------------------------------------------------------------------
-- 2. Constraint on `source`
-- ---------------------------------------------------------------------------
-- Idempotent: drop + recreate so re-running the migration on a table
-- that already has the constraint is a no-op.
alter table consent_log drop constraint if exists consent_log_source_check;
alter table consent_log add constraint consent_log_source_check
  check (
    source in (
      'banner_accept_all',
      'banner_decline_non_essential',
      'banner_save_preferences',
      'page_save_preferences',
      'gpc_auto_decline',
      'auto_default'
    )
  );

-- ---------------------------------------------------------------------------
-- 3. CHECK constraints on shape
-- ---------------------------------------------------------------------------
-- `country` is either NULL or a 2-letter ISO code.
alter table consent_log drop constraint if exists consent_log_country_check;
alter table consent_log add constraint consent_log_country_check
  check (country is null or country ~ '^[A-Z]{2}$');

-- `anon_id` is either NULL or a canonical UUID (any version).
alter table consent_log drop constraint if exists consent_log_anon_id_check;
alter table consent_log add constraint consent_log_anon_id_check
  check (
    anon_id is null
    or anon_id ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
  );

-- ---------------------------------------------------------------------------
-- 4. Indexes
-- ---------------------------------------------------------------------------
create index if not exists consent_log_anon_idx
  on consent_log (anon_id, created_at desc)
  where anon_id is not null;

create index if not exists consent_log_source_idx
  on consent_log (source, created_at desc);

create index if not exists consent_log_gpc_idx
  on consent_log (gpc)
  where gpc = true;

-- ---------------------------------------------------------------------------
-- End of migration.
-- ---------------------------------------------------------------------------
