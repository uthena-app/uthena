-- ---------------------------------------------------------------------------
-- 0020_auth_failed_attempts_oauth_signin.sql — extend kind enum for P1.6
-- ---------------------------------------------------------------------------
-- P1.6 OAuth UX ships a `signInWithOAuthAction` that the user triggers by
-- clicking "Continue with Google" / "Continue with Apple" on /login and
-- /signup. The action is rate-limited per spec: 5 attempts per email per
-- 15 min + 10 attempts per IP per 15 min (the same per-IP ceiling as the
-- signin flow — a real user wouldn't click 5+ OAuth buttons in 15 min, so
-- the limit is keyed on the IP).
--
-- Schema change: extend the `kind` check constraint to include
-- 'oauth_signin'. Same DO-block / pg_constraint scan pattern as 0018 +
-- 0019 — defensive against PG version differences in inline check-
-- constraint naming.
--
-- No new table — just one ALTER. The other columns (email_hash,
-- ip_hash, user_agent, reason) are reused as-is. The existing
-- `auth_failed_attempts_kind_time_idx` on (kind, created_at desc)
-- already covers the new kind's read path.
--
-- IDEMPOTENT — re-running this migration is a no-op once the kind
-- enum has been extended.

do $$
declare
  v_constraint_name text;
  v_constraint_oid  oid;
begin
  -- Try the canonical name first; fall back to scanning pg_constraint.
  select conname, oid
    into v_constraint_name, v_constraint_oid
    from pg_constraint
   where conrelid = 'auth_failed_attempts'::regclass
     and contype = 'c'
     and pg_get_constraintdef(oid) like '%kind%=%';

  if v_constraint_name is not null then
    execute format('alter table auth_failed_attempts drop constraint %I', v_constraint_name);
  end if;

  alter table auth_failed_attempts
    add constraint auth_failed_attempts_kind_check
    check (kind in (
      'signin',
      'signup',
      'reset_password',
      'update_password',
      'email_verification',
      'oauth_signin'
    ));
end $$;
