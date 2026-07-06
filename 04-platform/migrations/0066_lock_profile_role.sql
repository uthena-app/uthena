-- SEC-1 [CRITICAL] — Lock down profiles.role / profiles.status against
-- self-escalation.
-- ============================================================================
--
-- Problem (see TODO-HARDENING.md SEC-1, AUDIT-2026-07-03.md):
--   `profiles_self_update` (supabase/migrations/0001_initial.sql ~line 241)
--   gates *which row* a user may update (`user_id = auth.uid()`) but not
--   *which columns*. Supabase grants the `authenticated` role table-level
--   UPDATE, gated only by RLS — so any logged-in customer can run, from the
--   browser with the anon client:
--     supabase.from('profiles').update({ role: 'admin' }).eq('user_id', me)
--   and become admin. `is_admin()` then unlocks every `*_admin_all` policy
--   (orders, refunds, payouts, library_grants, platform_settings). This is
--   directly exploitable and is a launch blocker.
--
-- Fix (ponytail — a BEFORE UPDATE trigger is the smallest robust option;
-- RLS policies can't see both OLD and NEW column values, only a trigger
-- can): raise an exception whenever `role` or `status` change UNLESS the
-- caller is an admin (`is_admin()`). Non-admins keep full ability to edit
-- every other self-service column (display_name, avatar_url, bio, locale,
-- timezone, ...) via `profiles_self_update` exactly as before — this
-- migration adds a second, independent gate, it does not touch the
-- existing RLS policy.
--
-- `security definer set search_path = public` matches every other helper
-- function in 0001_initial.sql (is_admin(), current_partner_id(), ...) —
-- required so the trigger can call `is_admin()` (which itself queries
-- `profiles`) regardless of the invoking role's own row-level visibility.
--
-- Idempotent: `create or replace function` + `drop trigger if exists`.
--
-- Reject-case demonstration (run manually against a non-admin session to
-- confirm the fix — NOT executed by the migration itself):
--   -- as an authenticated non-admin customer (own row):
--   update profiles set role = 'admin' where user_id = auth.uid();
--   -- ERROR:  not authorized to change role/status
--
--   -- the same customer editing an allowed column still succeeds:
--   update profiles set display_name = 'New Name' where user_id = auth.uid();
--   -- UPDATE 1
--
-- Verify: `06-quality/tests/rls/policies.ts` gains two new fixture rows
-- (see the diff in that file) covering the reject case (customer sets
-- role='admin' on own row → deny) and admin allow case. `pnpm check:rls`
-- is unaffected — this migration does not `create table`, so the static
-- coverage scan (04-platform/ci/scripts/check-rls-coverage.sh) has nothing
-- new to check; the pre-existing `alter table profiles enable row level
-- security` + policies in 0001_initial.sql already satisfy it.
-- ============================================================================

create or replace function forbid_self_role_change() returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (new.role is distinct from old.role or new.status is distinct from old.status)
     and not is_admin() then
    raise exception 'not authorized to change role/status';
  end if;
  return new;
end
$$;

drop trigger if exists profiles_lock_role on profiles;
create trigger profiles_lock_role before update on profiles
  for each row execute function forbid_self_role_change();

comment on function forbid_self_role_change() is
  'SEC-1 — BEFORE UPDATE guard on profiles. Raises unless role/status are unchanged or the caller is_admin(). Closes the column-level gap in profiles_self_update (which only gates the row, not the columns).';
