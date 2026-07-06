-- ============================================================================
-- 0044_partner_social_links_public.sql — P12.17: partner profile enrichment.
--
-- Adds TWO columns + ONE RLS policy update.
--
-- **partners.social_links jsonb** — public-facing social handles shown on
--   the partner profile (next to their bio on product pages + the future
--   partner-public-profile surface). Per the partner-settings spec
--   (`01-specs/pages/partner-settings.md` §"Profile" section, derived
--   from PHASES.md P12.17 "bio, headshot, social links, public profile"):
--   the JSON shape is a flat object with the well-known platform keys:
--     `{ "twitter": "handle", "linkedin": "slug", "youtube": "@handle",
--        "github": "user", "website": "https://..." }`
--   Each value is a string (handle / slug / URL); null means "not set".
--   The server action Zod-validates each field with the right regex
--   (Twitter: 1-15 alnum + underscore; LinkedIn: slug; YouTube: @
--   handle / channel / custom URL; GitHub: 1-39 alnum + hyphen; website:
--   SafeUrl).
--
--   Storage: jsonb, default `'{}'::jsonb` (empty object, not null —
--   keeps the read-path shape predictable). NULL values within the object
--   mean "field not set". The column is part of the public-read surface
--   (the existing `partners_public_read_approved` policy already gates
--   SELECT by `status = 'approved'`; nothing more to add here).
--
-- **partners.is_public boolean** — opt-in toggle for the partner's
--   public profile visibility. Default `false` (off — existing partners
--   are not auto-opted-in; they must explicitly toggle on). When `true`
--   AND `status = 'approved'`, the partner's profile (bio + website +
--   social links + headshot via profiles.avatar_url) is queryable from
--   the public profile surface that lands in P12.x follow-up.
--
--   This toggle does NOT change the `partners_public_read_approved`
--   policy — that policy already gates by status. Adding `is_public`
--   to the policy's USING clause would restrict the existing
--   partner-detail-page-on-PDP surface (where `is_public` doesn't
--   apply — every approved partner's bio is shown there per the spec
--   §"What this page does NOT do: No public profile preview"). The
--   future standalone /partner/[slug] public profile page (Phase 12
--   follow-up) is the surface that gates on `is_public AND status =
--   'approved'`; that page will use a NEW policy
--   `partners_public_read_is_public` added in that slice.
--
-- **RLS updates:** none to the existing `partners` policies — the
-- existing `partners_self_update` policy (user_id = auth.uid() check)
--   already covers writes to these new columns. `is_admin()` and
--   `is_partner()` helpers unchanged. No new policies on `partners`
--   in this migration (the new `partners_public_read_is_public`
--   policy lives in the public-profile page migration).
--
-- **Default values:**
--   - social_links = `'{}'::jsonb` (empty object; preserves the
--     "object, not null" shape the read path expects)
--   - is_public = `false` (off; opt-in only)
--
-- **CHECK constraints:**
--   - social_links is a jsonb — no constraint needed; Zod handles the
--     per-field shape at the application layer
--   - is_public is boolean — no extra CHECK needed
--
-- **No new indexes:** neither column is in any read-path WHERE/ORDER BY
-- today. The future public-profile-by-slug query (`WHERE slug = $1 AND
-- status = 'approved' AND is_public = true`) is covered by the existing
-- `partners_public_slug_idx` (status check is a planner-time filter, and
-- the result set is at most a few rows; an index on `is_public` would
-- only help if we ever scan for "all public partners", which we don't).
--
-- **IDEMPOTENT:** ADD COLUMN IF NOT EXISTS + DROP DEFAULT + SET DEFAULT
-- pattern (so re-runs are safe). DO-block guards the ADD COLUMN. The
-- ALTER COLUMN ... SET DEFAULT uses IF NOT EXISTS-equivalent semantics
-- (Postgres does not have ALTER COLUMN SET DEFAULT IF NOT EXISTS, so we
-- check via DO-block + information_schema).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. social_links jsonb — public social handles
-- ---------------------------------------------------------------------------
do $$ begin
  alter table partners add column social_links jsonb not null default '{}'::jsonb;
exception when duplicate_column then null; end $$;

-- Default guard: ensure the default is `'{}'::jsonb` if a previous
-- partial migration left a different default in place.
do $$
declare
  current_default text;
begin
  select column_default into current_default
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'partners'
    and column_name = 'social_links';
  if current_default is null or current_default not like '%{}%' then
    alter table partners alter column social_links set default '{}'::jsonb;
  end if;
end $$;

comment on column partners.social_links is
  'P12.17 — Public social handles for the partner profile (twitter / linkedin / youtube / github / website). JSON shape: `{ "twitter"?: string, "linkedin"?: string, "youtube"?: string, "github"?: string, "website"?: string }`. Each value is a string (handle / slug / URL); a missing key or null means "not set". Default `{}`. Server action Zod-validates each field with the platform-appropriate regex at the parse boundary; the column itself is permissive (jsonb) and trusts the app layer. Public-read surface: any approved partner''s social_links are queryable from the future /partner/[slug] surface (gated by is_public = true + status = ''approved''). The existing partners_public_read_approved policy already covers reads from the partner-detail-page-on-PDP context where is_public does NOT apply.';

-- ---------------------------------------------------------------------------
-- 2. is_public boolean — opt-in public profile toggle
-- ---------------------------------------------------------------------------
do $$ begin
  alter table partners add column is_public boolean not null default false;
exception when duplicate_column then null; end $$;

comment on column partners.is_public is
  'P12.17 — Opt-in toggle for the partner''s public profile visibility. Default `false` (off; existing partners are NOT auto-opted-in). When `true` AND `status = ''approved''`, the partner''s profile (bio + website + social_links + headshot via profiles.avatar_url) becomes queryable from the future standalone /partner/[slug] public profile page. This toggle does NOT change the existing partners_public_read_approved policy (which already gates the partner-detail-page-on-PDP surface where is_public doesn''t apply); the future page adds a new policy `partners_public_read_is_public` that gates on `is_public AND status = ''approved''`. Partners can flip the toggle themselves on /partner/settings.';

-- ---------------------------------------------------------------------------
-- STUB REGISTER
-- ---------------------------------------------------------------------------
-- (No STUBs filed in this migration — P12.17 ships the schema + the form
-- surface in one cron tick. The future standalone /partner/[slug] public
-- profile page is a separate slice that lands in Phase 12 follow-up work
-- and will add the `partners_public_read_is_public` policy at that time.)