-- ============================================================================
-- 0002_profile_autocreate.sql — auto-create profiles + default notification prefs
--
-- Every new auth.users row gets a matching profiles row. The display_name
-- comes from the user's user_metadata (set during signup) or the email
-- local-part as a fallback.
--
-- The trigger runs as security definer so the inserting user doesn't need
-- INSERT permission on profiles directly.
-- ============================================================================

create or replace function handle_new_user() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_display_name text;
begin
  v_display_name := coalesce(
    nullif(trim(coalesce(new.raw_user_meta_data->>'display_name', '')), ''),
    split_part(new.email, '@', 1)
  );
  insert into public.profiles (user_id, role, display_name)
  values (new.id, 'customer', v_display_name)
  on conflict (user_id) do nothing;

  insert into public.notification_preferences (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ============================================================================
-- End of 0002_profile_autocreate.sql
-- ============================================================================
