-- ---------------------------------------------------------------------------
-- 0022_auth_failed_attempts_oauth_callback.sql — extend enums for P1.9
-- ---------------------------------------------------------------------------
-- P1.9 ships the auth callback handler (`app/auth/callback/route.ts`)
-- with per-IP rate limiting + suspicious-pattern detection. The
-- callback is the choke point for three Supabase flows:
--
--   1. OAuth provider redirect (Google, Apple)
--   2. Email verification link click
--   3. Password reset link click
--
-- We track every callback hit in `auth_failed_attempts` so the
-- rate-limit helper can compute sliding-window counts without
-- holding state in memory. The table is reused (not a new one)
-- because the auth-rate-limit helper already operates on it; the
-- P1.9 helper just queries a different `kind`.
--
-- Schema changes:
--   - Extend `kind` check constraint to include 'oauth_callback'
--   - Extend `reason` check constraint to include 'success' (the
--     existing reasons cover all the failure modes — the new
--     value lets us record successful flows so the suspicious-
--     pattern detector can count "successful flows / IP / 10 min")
--
-- Index note: the existing `auth_failed_attempts_ip_window_idx` on
-- `(ip_hash, created_at desc) WHERE ip_hash IS NOT NULL` covers the
-- new kind's rate-limit read path (`kind='oauth_callback' AND
-- ip_hash=X AND created_at >= windowStart`). The planner picks the
-- IP-window index (more selective than the kind-only index because
-- the per-IP count is the dominant filter), then applies the kind
-- filter in the heap. The kind filter is cheap — the IP-window
-- index already narrows to a single IP.
--
-- IDEMPOTENT — both DO blocks scan pg_constraint for the matching
-- check constraint by OID (no hardcoded name) so re-running this
-- migration is a no-op once the enum has been extended. Same
-- defensive pattern as 0018 / 0019 / 0020.

do $$
declare
  v_kind_constraint text;
begin
  -- Drop the existing kind check constraint (whatever its name is).
  select conname
    into v_kind_constraint
    from pg_constraint
   where conrelid = 'auth_failed_attempts'::regclass
     and contype = 'c'
     and pg_get_constraintdef(oid) like '%kind%=%';

  if v_kind_constraint is not null then
    execute format('alter table auth_failed_attempts drop constraint %I', v_kind_constraint);
  end if;

  alter table auth_failed_attempts
    add constraint auth_failed_attempts_kind_check
    check (kind in (
      'signin',
      'signup',
      'reset_password',
      'update_password',
      'email_verification',
      'oauth_signin',
      'oauth_callback'
    ));
end $$;

do $$
declare
  v_reason_constraint text;
begin
  -- Drop the existing reason check constraint.
  select conname
    into v_reason_constraint
    from pg_constraint
   where conrelid = 'auth_failed_attempts'::regclass
     and contype = 'c'
     and pg_get_constraintdef(oid) like '%reason%=%';

  if v_reason_constraint is not null then
    execute format('alter table auth_failed_attempts drop constraint %I', v_reason_constraint);
  end if;

  alter table auth_failed_attempts
    add constraint auth_failed_attempts_reason_check
    check (reason in (
      'invalid_credentials',
      'rate_limited',
      'email_not_verified',
      'unknown_user',
      'malformed_input',
      'server_error',
      -- P1.9 — the callback handler records one row per hit with
      -- reason='success' so the suspicious-pattern detector can
      -- count "successful OAuth flows / IP / 10 min". All failure
      -- reasons (invalid_code, no_code, provider_error, server_error,
      -- rate_limited) flow through the existing reasons above.
      'success'
    ));
end $$;