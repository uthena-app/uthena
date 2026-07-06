-- ---------------------------------------------------------------------------
-- 0021_user_sessions_rpc.sql — P1.8 session list + per-session sign-out RPC
-- ---------------------------------------------------------------------------
-- P1.8 (Session management) ships the per-device sessions list on
-- /account/settings. The list is shown to the user so they can sign out
-- individual devices; "Sign out everywhere" stays as the bulk escape hatch.
--
-- The PostgREST API exposes the `public` schema only — `auth.sessions` is
-- not reachable from a regular query. We need a SECURITY DEFINER Postgres
-- function in `public` that:
--   1. Reads `auth.sessions` on behalf of the calling user.
--   2. Filters to rows owned by `auth.uid()` (defense in depth — even
--      with SECURITY DEFINER we never want to return another user's
--      sessions).
--   3. Returns only the columns we need (defensive — never expose
--      `refreshed_at` or other internal columns to the application).
--
-- Two functions in this migration:
--   - public.list_user_sessions()     → list active sessions for caller
--   - public.delete_user_session(uuid)→ sign out a single session by id
--
-- Both functions are SECURITY DEFINER + `set search_path = ''` (the
-- standard Supabase hardener for SECURITY DEFINER functions). Both are
-- REVOKED from PUBLIC + GRANTED to authenticated only. Both check
-- `auth.uid()` and raise an exception when called by an anonymous user.
--
-- IDEMPOTENT — `create or replace function` is safe to re-run. The
-- GRANT + REVOKE statements are also idempotent.

-- ---------------------------------------------------------------------------
-- 1. list_user_sessions() — return active sessions for the calling user
-- ---------------------------------------------------------------------------
create or replace function public.list_user_sessions()
returns table (
  id uuid,
  created_at timestamptz,
  updated_at timestamptz,
  user_agent text,
  ip inet,
  aal text,
  not_after timestamptz
)
language plpgsql
security definer
set search_path = ''
stable
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  return query
  select
    s.id,
    s.created_at,
    s.updated_at,
    s.user_agent,
    s.ip,
    (s.aal)::text as aal,
    s.not_after
  from auth.sessions s
  where s.user_id = auth.uid()
  order by s.created_at desc;
end;
$$;

revoke all on function public.list_user_sessions() from public;
grant execute on function public.list_user_sessions() to authenticated;

-- ---------------------------------------------------------------------------
-- 2. delete_user_session(uuid) — sign out a single session by id
-- ---------------------------------------------------------------------------
-- Returns `true` if a row was deleted, `false` if the session didn't
-- exist or didn't belong to the calling user. The caller (server action)
-- is responsible for NOT calling this with the current session id —
-- "sign out this device" uses `supabase.auth.signOut()` instead (which
-- also clears the cookie).
--
-- The function is SECURITY DEFINER so it can DELETE from `auth.sessions`
-- (which is not normally writable by the `authenticated` role). The
-- `user_id = auth.uid()` filter is the second line of defense — even
-- if a future refactor accidentally exposes the function, a user can
-- never delete another user's session.
create or replace function public.delete_user_session(p_session_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_deleted boolean;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  delete from auth.sessions
  where id = p_session_id
    and user_id = v_user_id;

  get diagnostics v_deleted = row_count;
  return v_deleted > 0;
end;
$$;

revoke all on function public.delete_user_session(uuid) from public;
grant execute on function public.delete_user_session(uuid) to authenticated;
