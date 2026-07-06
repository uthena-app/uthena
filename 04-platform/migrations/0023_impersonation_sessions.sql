-- ---------------------------------------------------------------------------
-- 0023_impersonation_sessions.sql — P1.10 account switcher (super_admin)
-- ---------------------------------------------------------------------------
-- P1.10 ships the foundation for admin-side impersonation. The flow:
--   1. Super_admin opens /admin/account-switcher, searches for a user
--   2. Picks the user; the server action calls
--      `supabase.auth.admin.generateLink({ type: 'magiclink', email, ... })`
--      and stores the resulting `action_link` + metadata in this table.
--   3. Admin's browser opens the magic link in a NEW tab (the original tab
--      is unaffected). The new tab establishes a session for the target
--      user via the existing /auth/callback exchange.
--   4. Every `start` is audit-logged to admin_audit_log. The row in this
--      table is the durable record of the impersonation — admins see it
--      in the "Recent sessions" list on the page.
--
-- Why we store the action_link: Supabase's magic link is one-time-use +
-- short-lived (5 min default). Storing it lets us regenerate the audit
-- trail if the admin reopens the link, and lets us time-out the link
-- without re-pinging Supabase on every page render.
--
-- The PostgREST API exposes the `public` schema only. We:
--   - keep RLS ON (only admins can SELECT)
--   - INSERT/UPDATE/DELETE happens only via the service-role client
--   - is_super_admin() gates the page that reads from this table
--
-- IDEMPOTENT — `create table if not exists` + `create or replace function`
-- are safe to re-run. GRANT/REVOKE statements are also idempotent.

-- ---------------------------------------------------------------------------
-- 0. is_super_admin() — SECURITY DEFINER helper
-- ---------------------------------------------------------------------------
-- Distinct from is_admin() (which returns true for both admin and
-- super_admin). Used by the account-switcher page + the startImpersonation
-- action to gate a destructive privilege. Returns false for everyone else.
create or replace function public.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from profiles
    where user_id = auth.uid() and role = 'super_admin'
  );
$$;

revoke all on function public.is_super_admin() from public;
grant execute on function public.is_super_admin() to authenticated;

-- ---------------------------------------------------------------------------
-- 1. impersonation_sessions table
-- ---------------------------------------------------------------------------
create table if not exists public.impersonation_sessions (
  -- The token id. Same value is embedded in the magic link's redirectTo
  -- as `?impersonation=<id>` so the callback can correlate the open.
  id uuid primary key default gen_random_uuid(),

  -- The super_admin who initiated the switch.
  admin_id uuid not null references auth.users(id) on delete cascade,

  -- The target user being impersonated.
  target_user_id uuid not null references auth.users(id) on delete cascade,

  -- The Supabase magic-link URL (one-time use, 5-min TTL by default).
  -- We store it so we can:
  --   (a) regenerate the audit trail if the admin reopens the link,
  --   (b) re-display the link in the recent-sessions list,
  --   (c) time-out the link without re-pinging Supabase.
  action_link text not null,

  -- When the magic link expires (Supabase default is 5 min; we set 5 min).
  expires_at timestamptz not null,

  -- When the admin actually opened the link (set by /auth/callback or by
  -- the start action's window.open callback). NULL = link never opened.
  consumed_at timestamptz,

  -- When the admin returned to admin context (set by endImpersonation
  -- action in Slice 2). NULL = still impersonating (or never opened).
  ended_at timestamptz,

  -- Reason text the admin typed when starting the impersonation. Required
  -- for audit trail ("User reported charge they don't recognize" etc.).
  reason text not null default '',

  -- Audit context — same shape as the rest of the audit log.
  ip text,
  user_agent text,

  created_at timestamptz not null default now(),

  -- Defense: an admin can never impersonate themselves, and the row must
  -- carry a forward-looking expiry.
  constraint impersonation_sessions_no_self_check
    check (admin_id <> target_user_id),
  constraint impersonation_sessions_expires_after_created_check
    check (expires_at > created_at)
);

alter table public.impersonation_sessions enable row level security;

-- Admins can read the full table (for the Recent sessions list + audit
-- log search). Non-admins see nothing.
drop policy if exists "impersonation_sessions_admin_read" on public.impersonation_sessions;
create policy "impersonation_sessions_admin_read" on public.impersonation_sessions
  for select using (is_admin());

-- No INSERT/UPDATE/DELETE policies — writes happen only via the
-- service-role client (the server action). RLS-wise this is a
-- SELECT-only table for non-service-role callers.

-- Indexes for the two read paths:
--   (a) Recent sessions for one admin (the page's main list)
--   (b) All sessions targeting one user (for the future admin-customer-detail
--       "impersonation history" tab — Slice 3)
create index if not exists impersonation_sessions_admin_idx
  on public.impersonation_sessions(admin_id, created_at desc);
create index if not exists impersonation_sessions_target_idx
  on public.impersonation_sessions(target_user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 2. add_super_admin_policies — extend RLS on profiles for super_admin read
-- ---------------------------------------------------------------------------
-- Profiles are public-readable by default (for minishop authors + partner
-- bios). The existing `profiles_public_read` policy already covers
-- super_admin. No new policies needed.
--
-- However, the account-switcher SEARCH query filters out other
-- super_admin users at the application layer (privilege separation —
-- a super_admin cannot impersonate another super_admin). That filter
-- happens in `02-features/admin/account-switcher/queries/searchUsersForImpersonation.ts`,
-- NOT in RLS. RLS stays simple (read-everything-for-admins, no extra
-- complexity for the rare super_admin case).
