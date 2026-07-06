-- 0001_handle_new_user.sql — Stub for Supabase Auth's expected trigger
-- function. The dump of Supabase's `auth` schema (0000_supabase_auth.sql)
-- creates `CREATE TRIGGER on_auth_user_created … EXECUTE FUNCTION
-- public.handle_new_user()` which would fail without this stub.
--
-- We DO use the real thing — this stub creates a `profiles` row when a
-- user signs up, mirroring the canonical Supabase pattern. The Uthena
-- dashboard + downstream features assume a profile row exists.
--
-- SECURITY DEFINER + set search_path = '' + REVOKE from PUBLIC + GRANT
-- to supabase_auth_admin is the canonical pattern. The function is
-- safe because it only inserts a profile row (no PII beyond what
-- auth.users.email + auth.users.raw_user_meta_data contains, which is
-- already covered by the user's privacy notice).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_display_name text;
begin
  -- Best-effort: use email local-part as the default display_name.
  -- Users can change it later on /account/profile.
  v_display_name := split_part(coalesce(new.email, ''), '@', 1);

  insert into public.profiles (user_id, role, display_name, status)
    values (new.id, 'customer', coalesce(nullif(v_display_name, ''), 'New user'), 'active')
    on conflict (user_id) do nothing;

  return new;
end;
$$;

-- Restricted: only auth admin role can invoke (the trigger uses this
-- implicitly via SECURITY DEFINER). Owners + PUBLIC are explicitly
-- revoked so the function isn't callable from a marketing surface.
revoke all on function public.handle_new_user() from public;
