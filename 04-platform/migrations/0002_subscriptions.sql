-- ============================================================================
-- 0002_subscriptions.sql — Personal Access subscription
--
-- New table: subscriptions
-- New enum: subscription_status
-- New helper SQL function: has_active_subscription(uuid)
-- See 02-features/subscriptions/README.md for the design rationale.
-- ============================================================================

do $$ begin
  create type subscription_status as enum (
    'incomplete', 'incomplete_expired', 'trialing', 'active',
    'past_due', 'canceled', 'unpaid', 'paused'
  );
exception when duplicate_object then null; end $$;

create table if not exists subscriptions (
  id bigserial primary key,
  user_id uuid not null unique references auth.users(id) on delete cascade,
  stripe_customer_id text,
  stripe_subscription_id text unique,
  stripe_price_id text not null,
  status subscription_status not null default 'incomplete',
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  canceled_at timestamptz,
  cancel_reason text,
  trial_start timestamptz,
  trial_end timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists subscriptions_user_unique on subscriptions(user_id);
create unique index if not exists subscriptions_stripe_sub_unique
  on subscriptions(stripe_subscription_id) where stripe_subscription_id is not null;
create index if not exists subscriptions_stripe_customer_idx
  on subscriptions(stripe_customer_id) where stripe_customer_id is not null;
create index if not exists subscriptions_active_lookup_idx
  on subscriptions(user_id, status, current_period_end);

alter table subscriptions enable row level security;

drop policy if exists "subscriptions_self_read" on subscriptions;
create policy "subscriptions_self_read" on subscriptions
  for select using (user_id = auth.uid());

drop policy if exists "subscriptions_admin_all" on subscriptions;
create policy "subscriptions_admin_all" on subscriptions
  for all using (is_admin());

drop trigger if exists subscriptions_set_updated_at on subscriptions;
create trigger subscriptions_set_updated_at before update on subscriptions
  for each row execute function set_updated_at();

create or replace function has_active_subscription(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from subscriptions
    where user_id = p_user_id
      and status in ('active', 'trialing')
      and (current_period_end is null or current_period_end > now())
  );
$$;

grant execute on function has_active_subscription(uuid) to anon, authenticated;
