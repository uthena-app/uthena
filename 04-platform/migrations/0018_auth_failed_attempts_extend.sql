-- ---------------------------------------------------------------------------
-- 0018_auth_failed_attempts_extend.sql — extend kind enum for P1.3
-- ---------------------------------------------------------------------------
-- P1.3 password-reset UX (the set-new page at /update-password) needs
-- its own per-user rate limit distinct from the request-side limit.
-- The request page is bounded at 3/email/15min (preventing enumeration)
-- while the set-new page is bounded at 5/email/15min + 20/IP/15min
-- (preventing an attacker who somehow has a reset token from grinding
-- password guesses). The two are tracked separately in
-- `auth_failed_attempts.kind` so the counters don't bleed.
--
-- Schema change: the existing `kind` check constraint allows
-- 'signin' | 'signup' | 'reset_password'. We add 'update_password' for
-- the set-new page's rate-limit counter.
--
-- Index note: the existing `auth_failed_attempts_kind_time_idx` on
-- (kind, created_at desc) already covers the new kind's read path —
-- the planner does an index range scan on the prefix.
--
-- No new table — just one ALTER. The other columns (email_hash,
-- ip_hash, user_agent, reason) are reused as-is.

-- PG's auto-generated constraint name for an inline `kind text not null
-- check (...)` is `<table>_<column>_check` (auth_failed_attempts_kind_check).
-- We try that name first; if it doesn't exist (different PG version,
-- prior migration named it differently), we fall back to scanning the
-- pg_constraint catalog for the matching check constraint and dropping
-- it by oid. IDEMPOTENT.

do $$
declare
  v_constraint_name text;
  v_constraint_oid  oid;
begin
  -- Try the canonical name first
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
    check (kind in ('signin', 'signup', 'reset_password', 'update_password'));
end $$;
