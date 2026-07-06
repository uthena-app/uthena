-- 0033_notification_preferences_v2.sql
-- P9.7 — Notification preferences (granular per category)
--
-- The original notification_preferences table (migration 0001) modeled
-- preferences as 7 boolean columns (weekly_digest_email, marketing_email,
-- product_updates_email, and 4 transactional booleans). That schema was
-- too coarse for the spec's per-list opt-ins and the email-frequency
-- spectrum (off / daily / weekly / monthly).
--
-- This migration ADDS the new columns the spec calls for and backfills
-- them from the legacy booleans. The legacy columns are NOT dropped —
-- they still drive the transactional emails the user always-on gets
-- (order / refund / payout / security alerts). A future migration can
-- drop them once we've confirmed transactional sends are wired off the
-- new `transactional_opt_in` column.
--
-- Idempotent: every ADD COLUMN is guarded with IF NOT EXISTS so a
-- re-run against a partially-migrated DB is a no-op.

-- ---------------------------------------------------------------------------
-- New columns
-- ---------------------------------------------------------------------------

alter table notification_preferences
  add column if not exists email_digest_freq text not null default 'weekly';

alter table notification_preferences
  add column if not exists transactional_opt_in boolean not null default true;

alter table notification_preferences
  add column if not exists marketing_opt_in boolean not null default false;

alter table notification_preferences
  add column if not exists newsletter_opt_in boolean not null default false;

alter table notification_preferences
  add column if not exists partner_updates_opt_in boolean not null default false;

alter table notification_preferences
  add column if not exists affiliate_updates_opt_in boolean not null default false;

-- ---------------------------------------------------------------------------
-- CHECK constraints (added separately so they can be added without
-- rewriting the column defaults — DO-block guard against a re-run)
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'notification_preferences_email_digest_freq_check'
      and conrelid = 'notification_preferences'::regclass
  ) then
    alter table notification_preferences
      add constraint notification_preferences_email_digest_freq_check
      check (email_digest_freq in ('off','daily','weekly','monthly'));
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Backfill from the legacy booleans (one-shot, idempotent)
--
-- Strategy:
--   email_digest_freq   ← 'weekly'  if weekly_digest_email was true
--                          'off'    otherwise (preserves opt-out)
--   marketing_opt_in    ← marketing_email (preserve the user's explicit choice)
--   newsletter_opt_in   ← marketing_email (best-effort — old schema had one
--                          "marketing" toggle, so we treat it as the
--                          master "anything marketing" signal)
--   partner/affiliate   ← false (no signal in old schema; the user can
--                          opt in explicitly)
--   transactional_opt_in← true (always; the legacy schema defaulted every
--                          transactional column to true and never exposed
--                          an off switch)
-- ---------------------------------------------------------------------------

update notification_preferences
set
  email_digest_freq = case
    when weekly_digest_email then 'weekly'
    else 'off'
  end,
  transactional_opt_in = true,
  marketing_opt_in = coalesce(marketing_email, false),
  newsletter_opt_in = coalesce(marketing_email, false),
  partner_updates_opt_in = false,
  affiliate_updates_opt_in = false
where
  -- Idempotency guard: only backfill rows where the new cols are still
  -- at their default (i.e. never user-edited). Once a row has been
  -- touched by the new code path, the backfill leaves it alone.
  email_digest_freq = 'weekly'
  and transactional_opt_in = true
  and marketing_opt_in = false
  and newsletter_opt_in = false
  and partner_updates_opt_in = false
  and affiliate_updates_opt_in = false;

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

-- The query path is always "by user_id" (RLS enforces equality), and
-- user_id already has a UNIQUE constraint that backs an implicit btree
-- index. No new index is needed for the v2 read paths.

-- ---------------------------------------------------------------------------
-- RLS — unchanged.
--
-- The existing `notification_prefs_self_read` + `notification_prefs_self_write`
-- policies on the table cover all v1 + v2 columns (the policies use
-- `user_id = auth.uid()` and don't enumerate columns). No new policy
-- is required; this section is a deliberate no-op marker so future
-- readers don't add a redundant policy.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Verify
-- ---------------------------------------------------------------------------

-- check:rls static check requires RLS + at least one policy. The static
-- check only verifies the table itself, which already has both.
-- This migration adds no new table — only columns on the existing one.

-- end of migration