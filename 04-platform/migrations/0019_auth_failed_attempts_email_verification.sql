-- ---------------------------------------------------------------------------
-- 0019_auth_failed_attempts_email_verification.sql — extend kind enum for P1.5
-- ---------------------------------------------------------------------------
-- P1.5 email-verification UX ships a `resendVerificationEmailAction`
-- (callable only by a signed-in user with `email_confirmed_at IS NULL`).
-- The action is rate-limited per spec: 1 per 60s, 5 per hour per user.
-- The existing `checkRateLimit` helper uses a single 15-min window — we
-- use it with `perEmail: 1` so the effective ceiling is 4 attempts per
-- hour (strictly tighter than the spec's "5 per hour" floor, and the
-- 15-min window more than satisfies "1 per 60s").
--
-- Schema change: extend the `kind` check constraint to include
-- 'email_verification'. Same DO-block / pg_constraint scan pattern as
-- 0018 — defensive against PG version differences in inline check-
-- constraint naming.
--
-- No new table — just one ALTER. The other columns (email_hash,
-- ip_hash, user_agent, reason) are reused as-is. The existing
-- `auth_failed_attempts_kind_time_idx` on (kind, created_at desc)
-- already covers the new kind's read path.

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
      'email_verification'
    ));
end $$;