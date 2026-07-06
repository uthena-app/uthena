-- ============================================================================
-- 0001_initial.sql — Uthena v2 core data model
--
-- Every table that the buyer, partner, affiliate, and admin surfaces depend
-- on. Includes:
--   - auth-extension tables (profiles, partners, affiliates)
--   - catalog tables (categories, products, product_files, product_pricing,
--     product_assets)
--   - commerce tables (orders, order_items, refunds, coupons, cart_items,
--     payout_ledger)
--   - engagement tables (library_grants, file_downloads)
--   - platform tables (platform_settings, notification_preferences,
--     consent_log, processed_webhooks, admin_audit_log, api_tokens,
--     risk_signals, reports, dmca_takedowns, partner_uploads,
--     partner_onboarding_drafts, partner_admin_notes, affiliate_admin_notes,
--     customer_admin_notes)
--
-- Rules (per AGENTS.md + ADR-0004 + ADR-0005):
--   1. Every table has RLS enabled in this same file.
--   2. Every table has at least one policy in this same file.
--   3. Money is always bigint cents. No numeric. No floats.
--   4. Append-only ledger (payout_ledger, file_downloads, admin_audit_log)
--      have no UPDATE/DELETE policies — only INSERT + SELECT.
--   5. Royalty is per-partner (partners.royalty_pct_bps) with a global
--      default in platform_settings.default_royalty_pct_bps.
--   6. Soft delete via `status`, not `deleted_at`.
--   7. created_at + updated_at on every mutable table.
--   8. Idempotent: every CREATE uses IF NOT EXISTS; every enum uses
--      DO block to avoid "type already exists".
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------------
create extension if not exists "pgcrypto";   -- gen_random_uuid()
create extension if not exists "pg_trgm";    -- fuzzy search
-- Note: Supabase enables these by default but we declare them so the
-- migration is portable to a vanilla Postgres in CI.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
do $$ begin
  create type user_role as enum ('customer', 'partner', 'affiliate', 'admin', 'super_admin');
exception when duplicate_object then null; end $$;

do $$ begin
  create type user_status as enum ('active', 'suspended', 'banned');
exception when duplicate_object then null; end $$;

do $$ begin
  create type partner_status as enum ('pending', 'approved', 'suspended');
exception when duplicate_object then null; end $$;

do $$ begin
  create type product_kind as enum (
    'video_course', 'ebook', 'template_pack', 'audio_course', 'bundle', 'asset_pack'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type product_status as enum (
    'draft', 'in_review', 'published', 'unpublished', 'archived'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type file_kind as enum (
    'video', 'slides', 'transcript', 'graphics', 'audio', 'document', 'archive', 'other'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type scan_status as enum ('pending', 'clean', 'infected', 'failed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type encoding_status as enum ('pending', 'processing', 'ready', 'failed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type license_type as enum ('plr', 'mrr', 'rr', 'personal');
exception when duplicate_object then null; end $$;

do $$ begin
  create type order_status as enum (
    'pending', 'awaiting_payment', 'paid', 'fulfilled', 'refunded', 'partially_refunded',
    'failed', 'canceled', 'fraudulent'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type refund_status as enum ('pending', 'succeeded', 'failed', 'canceled');
exception when duplicate_object then null; end $$;

do $$ begin
  create type cart_status as enum ('active', 'converted', 'abandoned', 'expired');
exception when duplicate_object then null; end $$;

do $$ begin
  create type payout_ledger_kind as enum (
    'order_sale', 'subscription', 'refund', 'adjustment', 'payout', 'clawback'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type payout_ledger_status as enum (
    'accruing', 'pending_payout', 'paid', 'void'
  );
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- profiles — 1:1 with auth.users (created FIRST so helper functions
-- can reference it without parse-time errors)
-- ---------------------------------------------------------------------------
create table if not exists profiles (
  id bigserial primary key,
  user_id uuid not null unique references auth.users(id) on delete cascade,
  role user_role not null default 'customer',
  display_name text not null,
  avatar_url text,
  bio text,
  locale text default 'en',
  timezone text default 'UTC',
  status user_status not null default 'active',
  suspended_at timestamptz,
  suspended_until timestamptz,
  suspended_reason text,
  banned_at timestamptz,
  banned_reason text,
  banned_by uuid references auth.users(id),
  warnings_count int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- updated_at trigger helper (generic; must exist before profile trigger)
create or replace function set_updated_at() returns trigger
language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

drop trigger if exists profiles_set_updated_at on profiles;
create trigger profiles_set_updated_at before update on profiles
for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- partners — extends profiles (instructors / sellers)
-- ---------------------------------------------------------------------------
create table if not exists partners (
  id bigserial primary key,
  user_id uuid not null unique references auth.users(id) on delete cascade,
  status partner_status not null default 'pending',
  public_slug text unique,
  bio text,
  website_url text,
  payout_method jsonb,
  tax_form_status text check (tax_form_status in ('none', 'pending', 'submitted', 'approved')) default 'none',
  kyc_status text check (kyc_status in ('none', 'pending', 'approved', 'rejected')) default 'none',
  -- Royalty: per-partner override in basis points (1500 = 15%). If null,
  -- fall back to platform_settings.default_royalty_pct_bps at order time.
  royalty_pct_bps int check (royalty_pct_bps is null or (royalty_pct_bps >= 0 and royalty_pct_bps <= 10000)),
  approved_at timestamptz,
  approved_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists partners_set_updated_at on partners;
create trigger partners_set_updated_at before update on partners
for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- affiliates — extends profiles (promoters)
-- ---------------------------------------------------------------------------
create table if not exists affiliates (
  id bigserial primary key,
  user_id uuid not null unique references auth.users(id) on delete cascade,
  handle text not null unique,
  status text not null check (status in ('pending', 'approved', 'suspended')) default 'pending',
  bio text,
  payout_method jsonb,
  -- Commission: per-affiliate override in basis points.
  commission_pct_bps int check (commission_pct_bps is null or (commission_pct_bps >= 0 and commission_pct_bps <= 10000)),
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists affiliates_set_updated_at on affiliates;
create trigger affiliates_set_updated_at before update on affiliates
for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- Helper functions — defined AFTER profiles/partners/affiliates exist so
-- Postgres can resolve table references at function-creation time.
-- ---------------------------------------------------------------------------
create or replace function is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from profiles
    where user_id = auth.uid() and role in ('admin', 'super_admin')
  );
$$;

create or replace function current_partner_id()
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select id from partners where user_id = auth.uid() limit 1;
$$;

create or replace function current_affiliate_id()
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select id from affiliates where user_id = auth.uid() limit 1;
$$;

-- ---------------------------------------------------------------------------
-- RLS policies for the auth-extension tables
-- ---------------------------------------------------------------------------
alter table profiles enable row level security;

drop policy if exists "profiles_public_read" on profiles;
create policy "profiles_public_read" on profiles
  for select using (true); -- public profiles for minishop, partner bios

drop policy if exists "profiles_self_update" on profiles;
create policy "profiles_self_update" on profiles
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "profiles_self_insert" on profiles;
create policy "profiles_self_insert" on profiles
  for insert with check (user_id = auth.uid());

drop policy if exists "profiles_admin_all" on profiles;
create policy "profiles_admin_all" on profiles
  for all using (is_admin());

create index if not exists profiles_user_id_idx on profiles(user_id);
create index if not exists profiles_role_idx on profiles(role);
create index if not exists profiles_status_idx on profiles(status);

alter table partners enable row level security;

drop policy if exists "partners_public_read_approved" on partners;
create policy "partners_public_read_approved" on partners
  for select using (status = 'approved');

drop policy if exists "partners_self_read" on partners;
create policy "partners_self_read" on partners
  for select using (user_id = auth.uid());

drop policy if exists "partners_self_update" on partners;
create policy "partners_self_update" on partners
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "partners_admin_all" on partners;
create policy "partners_admin_all" on partners for all using (is_admin());

create index if not exists partners_user_id_idx on partners(user_id);
create index if not exists partners_status_idx on partners(status);
create index if not exists partners_public_slug_idx on partners(public_slug);

alter table affiliates enable row level security;

drop policy if exists "affiliates_public_read_approved" on affiliates;
create policy "affiliates_public_read_approved" on affiliates
  for select using (status = 'approved');

drop policy if exists "affiliates_self_read" on affiliates;
create policy "affiliates_self_read" on affiliates
  for select using (user_id = auth.uid());

drop policy if exists "affiliates_self_update" on affiliates;
create policy "affiliates_self_update" on affiliates
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "affiliates_admin_all" on affiliates;
create policy "affiliates_admin_all" on affiliates for all using (is_admin());

create index if not exists affiliates_user_id_idx on affiliates(user_id);
create index if not exists affiliates_handle_idx on affiliates(handle);

-- ---------------------------------------------------------------------------
-- partners — extends profiles (instructors / sellers)
-- ---------------------------------------------------------------------------
create table if not exists partners (
  id bigserial primary key,
  user_id uuid not null unique references auth.users(id) on delete cascade,
  status partner_status not null default 'pending',
  public_slug text unique,
  bio text,
  website_url text,
  payout_method jsonb,
  tax_form_status text check (tax_form_status in ('none', 'pending', 'submitted', 'approved')) default 'none',
  kyc_status text check (kyc_status in ('none', 'pending', 'approved', 'rejected')) default 'none',
  -- Royalty: per-partner override in basis points (1500 = 15%). If null,
  -- fall back to platform_settings.default_royalty_pct_bps at order time.
  royalty_pct_bps int check (royalty_pct_bps is null or (royalty_pct_bps >= 0 and royalty_pct_bps <= 10000)),
  approved_at timestamptz,
  approved_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table partners enable row level security;

drop policy if exists "partners_public_read_approved" on partners;
create policy "partners_public_read_approved" on partners
  for select using (status = 'approved');

drop policy if exists "partners_self_read" on partners;
create policy "partners_self_read" on partners
  for select using (user_id = auth.uid());

drop policy if exists "partners_self_update" on partners;
create policy "partners_self_update" on partners
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "partners_admin_all" on partners;
create policy "partners_admin_all" on partners
  for all using (is_admin());

create index if not exists partners_user_id_idx on partners(user_id);
create index if not exists partners_status_idx on partners(status);
create index if not exists partners_public_slug_idx on partners(public_slug);

drop trigger if exists partners_set_updated_at on partners;
create trigger partners_set_updated_at before update on partners
for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- affiliates — extends profiles (promoters)
-- ---------------------------------------------------------------------------
create table if not exists affiliates (
  id bigserial primary key,
  user_id uuid not null unique references auth.users(id) on delete cascade,
  handle text not null unique,
  status text not null check (status in ('pending', 'approved', 'suspended')) default 'pending',
  bio text,
  payout_method jsonb,
  -- Commission: per-affiliate override in basis points.
  commission_pct_bps int check (commission_pct_bps is null or (commission_pct_bps >= 0 and commission_pct_bps <= 10000)),
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table affiliates enable row level security;

drop policy if exists "affiliates_public_read_approved" on affiliates;
create policy "affiliates_public_read_approved" on affiliates
  for select using (status = 'approved');

drop policy if exists "affiliates_self_read" on affiliates;
create policy "affiliates_self_read" on affiliates
  for select using (user_id = auth.uid());

drop policy if exists "affiliates_self_update" on affiliates;
create policy "affiliates_self_update" on affiliates
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "affiliates_admin_all" on affiliates;
create policy "affiliates_admin_all" on affiliates
  for all using (is_admin());

create index if not exists affiliates_user_id_idx on affiliates(user_id);
create index if not exists affiliates_handle_idx on affiliates(handle);

drop trigger if exists affiliates_set_updated_at on affiliates;
create trigger affiliates_set_updated_at before update on affiliates
for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- categories
-- ---------------------------------------------------------------------------
create table if not exists categories (
  id bigserial primary key,
  slug text not null unique,
  name text not null,
  description text,
  parent_id bigint references categories(id),
  display_order int default 0,
  product_count_cache int default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table categories enable row level security;

drop policy if exists "categories_public_read" on categories;
create policy "categories_public_read" on categories for select using (true);

drop policy if exists "categories_admin_write" on categories;
create policy "categories_admin_write" on categories for all using (is_admin());

create index if not exists categories_parent_id_idx on categories(parent_id);
create index if not exists categories_slug_idx on categories(slug);

drop trigger if exists categories_set_updated_at on categories;
create trigger categories_set_updated_at before update on categories
for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- products
-- ---------------------------------------------------------------------------
create table if not exists products (
  id bigserial primary key,
  slug text not null unique,
  title text not null,
  short_description text not null,
  long_description jsonb not null,           -- TipTap JSON, not markdown
  kind product_kind not null,
  status product_status not null default 'draft',
  category_id bigint not null references categories(id),
  partner_id bigint not null references partners(id),
  thumbnail_url text,
  preview_video_url text,
  total_duration_seconds int default 0,
  total_lesson_count int default 0,
  total_file_size_bytes bigint default 0,
  search_vector tsvector,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table products enable row level security;

drop policy if exists "products_public_read_published" on products;
create policy "products_public_read_published" on products
  for select using (status = 'published');

drop policy if exists "products_partner_read_own" on products;
create policy "products_partner_read_own" on products
  for select using (partner_id = current_partner_id());

drop policy if exists "products_partner_write_own" on products;
create policy "products_partner_write_own" on products
  for all using (partner_id = current_partner_id()) with check (partner_id = current_partner_id());

drop policy if exists "products_admin_all" on products;
create policy "products_admin_all" on products for all using (is_admin());

create index if not exists products_status_published_idx on products(status, published_at desc) where status = 'published';
create index if not exists products_category_idx on products(category_id) where status = 'published';
create index if not exists products_partner_idx on products(partner_id);
create index if not exists products_search_idx on products using gin(search_vector);

drop trigger if exists products_set_updated_at on products;
create trigger products_set_updated_at before update on products
for each row execute function set_updated_at();

-- updated search vector on insert/update
create or replace function products_refresh_search() returns trigger
language plpgsql as $$
begin
  new.search_vector :=
    setweight(to_tsvector('english', coalesce(new.title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(new.short_description, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(new.long_description::text, '')), 'C');
  return new;
end;
$$;

drop trigger if exists products_refresh_search on products;
create trigger products_refresh_search before insert or update on products
for each row execute function products_refresh_search();

-- ---------------------------------------------------------------------------
-- product_files
-- ---------------------------------------------------------------------------
create table if not exists product_files (
  id bigserial primary key,
  product_id bigint not null references products(id) on delete cascade,
  kind file_kind not null,
  original_filename text not null,
  storage_path text not null,
  size_bytes bigint not null check (size_bytes >= 0),
  duration_seconds int check (duration_seconds is null or duration_seconds >= 0),
  mime_type text,
  checksum_sha256 text,
  scan_status scan_status not null default 'pending',
  encoding_status encoding_status default 'pending',
  encoding_progress int default 0 check (encoding_progress between 0 and 100),
  bunny_video_id text,
  hls_manifest_url text,
  display_order int default 0,
  is_preview boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table product_files enable row level security;

-- Files inherit visibility from their product. Public-read for files on
-- published products; partner-read for own products; admin-all.
drop policy if exists "product_files_public_read_published" on product_files;
create policy "product_files_public_read_published" on product_files
  for select using (
    exists (
      select 1 from products p
      where p.id = product_files.product_id and p.status = 'published'
    )
  );

drop policy if exists "product_files_partner_read_own" on product_files;
create policy "product_files_partner_read_own" on product_files
  for select using (
    exists (select 1 from products p where p.id = product_files.product_id and p.partner_id = current_partner_id())
  );

drop policy if exists "product_files_partner_write_own" on product_files;
create policy "product_files_partner_write_own" on product_files
  for all using (
    exists (select 1 from products p where p.id = product_files.product_id and p.partner_id = current_partner_id())
  ) with check (
    exists (select 1 from products p where p.id = product_files.product_id and p.partner_id = current_partner_id())
  );

drop policy if exists "product_files_admin_all" on product_files;
create policy "product_files_admin_all" on product_files for all using (is_admin());

create index if not exists product_files_product_idx on product_files(product_id);
create index if not exists product_files_scan_idx on product_files(scan_status);

drop trigger if exists product_files_set_updated_at on product_files;
create trigger product_files_set_updated_at before update on product_files
for each row execute function set_updated_at();

-- Only files with scan_status = 'clean' may attach to a published product.
-- This is enforced both in the publish action AND in a DB trigger, per
-- the data model spec.
create or replace function enforce_clean_file_on_publish() returns trigger
language plpgsql as $$
begin
  if new.status = 'published' and old.status <> 'published' then
    if exists (
      select 1 from product_files f
      where f.product_id = new.id and f.scan_status <> 'clean'
    ) then
      raise exception 'cannot publish product %: at least one file has scan_status <> clean', new.id;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists products_enforce_clean_on_publish on products;
create trigger products_enforce_clean_on_publish
  before update of status on products
  for each row execute function enforce_clean_file_on_publish();

-- ---------------------------------------------------------------------------
-- product_pricing — license tiers (PLR / MRR / RR / Personal)
-- ---------------------------------------------------------------------------
create table if not exists product_pricing (
  id bigserial primary key,
  product_id bigint not null references products(id) on delete cascade,
  license license_type not null,
  price_cents bigint not null check (price_cents >= 0),
  compare_at_cents bigint check (compare_at_cents is null or compare_at_cents >= 0),
  -- Subscriber discount basis points (e.g. 1500 = 15% off for active
  -- personal_access subscribers). Default comes from
  -- platform_settings.plr_subscriber_discount_pct_bps at order time;
  -- the per-product override wins when present.
  subscriber_discount_bps int check (subscriber_discount_bps is null or (subscriber_discount_bps >= 0 and subscriber_discount_bps <= 10000)),
  is_default boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (product_id, license)
);

alter table product_pricing enable row level security;

drop policy if exists "product_pricing_public_read" on product_pricing;
create policy "product_pricing_public_read" on product_pricing
  for select using (
    exists (select 1 from products p where p.id = product_pricing.product_id and p.status = 'published')
  );

drop policy if exists "product_pricing_partner_read_own" on product_pricing;
create policy "product_pricing_partner_read_own" on product_pricing
  for select using (
    exists (select 1 from products p where p.id = product_pricing.product_id and p.partner_id = current_partner_id())
  );

drop policy if exists "product_pricing_partner_write_own" on product_pricing;
create policy "product_pricing_partner_write_own" on product_pricing
  for all using (
    exists (select 1 from products p where p.id = product_pricing.product_id and p.partner_id = current_partner_id())
  );

drop policy if exists "product_pricing_admin_all" on product_pricing;
create policy "product_pricing_admin_all" on product_pricing for all using (is_admin());

create index if not exists product_pricing_product_idx on product_pricing(product_id);
create index if not exists product_pricing_default_idx on product_pricing(product_id) where is_default;

drop trigger if exists product_pricing_set_updated_at on product_pricing;
create trigger product_pricing_set_updated_at before update on product_pricing
for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- product_assets — additional downloadable assets (e.g. bonus files)
-- ---------------------------------------------------------------------------
create table if not exists product_assets (
  id bigserial primary key,
  product_id bigint not null references products(id) on delete cascade,
  label text not null,
  storage_path text not null,
  size_bytes bigint not null,
  mime_type text,
  display_order int default 0,
  created_at timestamptz not null default now()
);

alter table product_assets enable row level security;

drop policy if exists "product_assets_public_read_published" on product_assets;
create policy "product_assets_public_read_published" on product_assets
  for select using (
    exists (select 1 from products p where p.id = product_assets.product_id and p.status = 'published')
  );

drop policy if exists "product_assets_partner_write_own" on product_assets;
create policy "product_assets_partner_write_own" on product_assets
  for all using (
    exists (select 1 from products p where p.id = product_assets.product_id and p.partner_id = current_partner_id())
  );

drop policy if exists "product_assets_admin_all" on product_assets;
create policy "product_assets_admin_all" on product_assets for all using (is_admin());

-- ---------------------------------------------------------------------------
-- coupons
-- ---------------------------------------------------------------------------
create table if not exists coupons (
  id bigserial primary key,
  code text not null unique,
  description text,
  discount_bps int not null check (discount_bps between 0 and 10000),
  -- Restrict to specific product/partner; null = applies to anything
  product_id bigint references products(id),
  partner_id bigint references partners(id),
  -- Usage limits
  max_redemptions int,
  redemptions_count int not null default 0,
  -- Validity window
  starts_at timestamptz,
  ends_at timestamptz,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at is null or starts_at is null or ends_at > starts_at)
);

alter table coupons enable row level security;

drop policy if exists "coupons_public_read_active" on coupons;
create policy "coupons_public_read_active" on coupons
  for select using (is_active = true);

drop policy if exists "coupons_admin_all" on coupons;
create policy "coupons_admin_all" on coupons for all using (is_admin());

drop trigger if exists coupons_set_updated_at on coupons;
create trigger coupons_set_updated_at before update on coupons
for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- cart_items
-- ---------------------------------------------------------------------------
create table if not exists cart_items (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  product_id bigint not null references products(id) on delete cascade,
  license license_type not null,
  quantity int not null default 1 check (quantity between 1 and 99),
  coupon_id bigint references coupons(id),
  status cart_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, product_id, license)
);

alter table cart_items enable row level security;

drop policy if exists "cart_items_self_read" on cart_items;
create policy "cart_items_self_read" on cart_items
  for select using (user_id = auth.uid());

drop policy if exists "cart_items_self_write" on cart_items;
create policy "cart_items_self_write" on cart_items
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "cart_items_admin_all" on cart_items;
create policy "cart_items_admin_all" on cart_items for all using (is_admin());

create index if not exists cart_items_user_status_idx on cart_items(user_id, status);
create index if not exists cart_items_product_idx on cart_items(product_id);

drop trigger if exists cart_items_set_updated_at on cart_items;
create trigger cart_items_set_updated_at before update on cart_items
for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- orders + order_items
-- ---------------------------------------------------------------------------
create table if not exists orders (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete restrict,
  email text not null,
  status order_status not null default 'pending',
  -- Money (all bigint cents)
  subtotal_cents bigint not null check (subtotal_cents >= 0),
  discount_cents bigint not null default 0 check (discount_cents >= 0),
  tax_cents bigint not null default 0 check (tax_cents >= 0),
  total_cents bigint not null check (total_cents >= 0),
  currency text not null default 'USD',
  -- Stripe
  stripe_checkout_session_id text,
  stripe_payment_intent_id text,
  stripe_customer_id text,
  -- Subscription, if this order is a subscription purchase
  subscription_id text,
  -- Affiliate attribution
  affiliate_id bigint references affiliates(id),
  affiliate_handle text,
  -- Coupon used
  coupon_id bigint references coupons(id),
  -- Billing
  billing_address jsonb,
  -- Refund state
  refunded_cents bigint not null default 0 check (refunded_cents >= 0),
  -- IP + UA for fraud (raw IP only retained for 90d, see privacy policy)
  ip text,
  user_agent text,
  -- Metadata
  metadata jsonb not null default '{}'::jsonb,
  paid_at timestamptz,
  fulfilled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table orders enable row level security;

drop policy if exists "orders_self_read" on orders;
create policy "orders_self_read" on orders
  for select using (user_id = auth.uid());

drop policy if exists "orders_admin_all" on orders;
create policy "orders_admin_all" on orders for all using (is_admin());

create index if not exists orders_user_id_idx on orders(user_id);
create index if not exists orders_status_idx on orders(status);
create index if not exists orders_stripe_session_idx on orders(stripe_checkout_session_id);
create index if not exists orders_stripe_pi_idx on orders(stripe_payment_intent_id);
create index if not exists orders_subscription_idx on orders(subscription_id);
create index if not exists orders_affiliate_idx on orders(affiliate_id);
create index if not exists orders_paid_at_idx on orders(paid_at);

drop trigger if exists orders_set_updated_at on orders;
create trigger orders_set_updated_at before update on orders
for each row execute function set_updated_at();

create table if not exists order_items (
  id bigserial primary key,
  order_id bigint not null references orders(id) on delete cascade,
  product_id bigint not null references products(id) on delete restrict,
  partner_id bigint not null references partners(id) on delete restrict,
  license license_type not null,
  quantity int not null check (quantity >= 1),
  unit_price_cents bigint not null check (unit_price_cents >= 0),
  line_total_cents bigint not null check (line_total_cents >= 0),
  -- Royalty snapshot at sale time: bps used + computed cents. Frozen here
  -- so future royalty % changes don't rewrite history. payout_ledger
  -- pulls from this column.
  royalty_pct_bps int not null check (royalty_pct_bps between 0 and 10000),
  royalty_cents bigint not null check (royalty_cents >= 0),
  created_at timestamptz not null default now()
);

alter table order_items enable row level security;

drop policy if exists "order_items_self_read" on order_items;
create policy "order_items_self_read" on order_items
  for select using (
    exists (select 1 from orders o where o.id = order_items.order_id and o.user_id = auth.uid())
  );

drop policy if exists "order_items_partner_read_own" on order_items;
create policy "order_items_partner_read_own" on order_items
  for select using (partner_id = current_partner_id());

drop policy if exists "order_items_admin_all" on order_items;
create policy "order_items_admin_all" on order_items for all using (is_admin());

create index if not exists order_items_order_idx on order_items(order_id);
create index if not exists order_items_product_idx on order_items(product_id);
create index if not exists order_items_partner_idx on order_items(partner_id);

-- ---------------------------------------------------------------------------
-- refunds
-- ---------------------------------------------------------------------------
create table if not exists refunds (
  id bigserial primary key,
  order_id bigint not null references orders(id) on delete restrict,
  amount_cents bigint not null check (amount_cents > 0),
  reason text not null check (reason in (
    'duplicate', 'fraudulent', 'requested_by_customer',
    'product_not_received', 'product_unacceptable', 'other'
  )),
  notes text,
  status refund_status not null default 'pending',
  stripe_refund_id text,
  requested_by uuid references auth.users(id),
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table refunds enable row level security;

drop policy if exists "refunds_self_read" on refunds;
create policy "refunds_self_read" on refunds
  for select using (
    exists (select 1 from orders o where o.id = refunds.order_id and o.user_id = auth.uid())
  );

drop policy if exists "refunds_self_request" on refunds;
create policy "refunds_self_request" on refunds
  for insert with check (
    exists (select 1 from orders o where o.id = refunds.order_id and o.user_id = auth.uid())
  );

drop policy if exists "refunds_admin_all" on refunds;
create policy "refunds_admin_all" on refunds for all using (is_admin());

create index if not exists refunds_order_idx on refunds(order_id);
create index if not exists refunds_status_idx on refunds(status);

drop trigger if exists refunds_set_updated_at on refunds;
create trigger refunds_set_updated_at before update on refunds
for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- payout_ledger — APPEND-ONLY per ADR-0005
--
-- This is the source of truth for "what does Uthena owe each partner."
-- Every state change (sale, refund, clawback, payout) writes a new row.
-- We never UPDATE or DELETE rows here. Policies enforce that.
-- ---------------------------------------------------------------------------
create table if not exists payout_ledger (
  id bigserial primary key,
  partner_id bigint not null references partners(id) on delete restrict,
  order_id bigint references orders(id) on delete restrict,
  order_item_id bigint references order_items(id) on delete restrict,
  refund_id bigint references refunds(id) on delete restrict,
  kind payout_ledger_kind not null,
  status payout_ledger_status not null default 'accruing',
  amount_cents bigint not null,                   -- signed: positive = credit, negative = debit
  currency text not null default 'USD',
  -- Snapshot fields so we don't re-derive history
  royalty_pct_bps int,
  description text,
  -- PayPal Mass Payout tracking
  paypal_payout_batch_id text,
  paypal_payout_item_id text,
  -- Stripe Connect tracking (for partners that opt in)
  stripe_transfer_id text,
  paid_at timestamptz,
  created_at timestamptz not null default now()
);

alter table payout_ledger enable row level security;

drop policy if exists "payout_ledger_partner_read_own" on payout_ledger;
create policy "payout_ledger_partner_read_own" on payout_ledger
  for select using (partner_id = current_partner_id());

drop policy if exists "payout_ledger_admin_read" on payout_ledger;
create policy "payout_ledger_admin_read" on payout_ledger
  for select using (is_admin());

-- No insert/update/delete policies for anon/authenticated — writes go
-- through the service-role client only (the order webhook + admin payout
-- runner). This is the append-only invariant.

create index if not exists payout_ledger_partner_status_idx on payout_ledger(partner_id, status);
create index if not exists payout_ledger_order_idx on payout_ledger(order_id);
create index if not exists payout_ledger_kind_idx on payout_ledger(kind);
create index if not exists payout_ledger_paid_at_idx on payout_ledger(paid_at);

-- ---------------------------------------------------------------------------
-- library_grants — "this user can access this product (and its files)"
-- ---------------------------------------------------------------------------
create table if not exists library_grants (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  product_id bigint not null references products(id) on delete cascade,
  -- How the user got the grant
  source text not null check (source in ('purchase', 'subscription', 'admin_grant', 'free_promo')),
  -- For purchase grants, the originating order
  order_id bigint references orders(id) on delete set null,
  -- For subscription grants, the subscription id
  subscription_id text,
  -- License for purchase grants; null for subscription grants
  license license_type,
  -- Revocation
  revoked_at timestamptz,
  revoked_reason text,
  created_at timestamptz not null default now(),
  expires_at timestamptz, -- null = forever
  unique (user_id, product_id, source, order_id)
);

alter table library_grants enable row level security;

drop policy if exists "library_grants_self_read" on library_grants;
create policy "library_grants_self_read" on library_grants
  for select using (user_id = auth.uid() and (revoked_at is null));

drop policy if exists "library_grants_partner_read_own_product" on library_grants;
create policy "library_grants_partner_read_own_product" on library_grants
  for select using (
    exists (select 1 from products p where p.id = library_grants.product_id and p.partner_id = current_partner_id())
  );

drop policy if exists "library_grants_admin_all" on library_grants;
create policy "library_grants_admin_all" on library_grants for all using (is_admin());

create index if not exists library_grants_user_idx on library_grants(user_id) where revoked_at is null;
create index if not exists library_grants_product_idx on library_grants(product_id);
create index if not exists library_grants_order_idx on library_grants(order_id);
create index if not exists library_grants_subscription_idx on library_grants(subscription_id);

-- ---------------------------------------------------------------------------
-- file_downloads — APPEND-ONLY audit log for every download / stream
-- ---------------------------------------------------------------------------
create table if not exists file_downloads (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  file_id bigint references product_files(id) on delete set null,
  product_id bigint references products(id) on delete set null,
  -- What was generated
  kind text not null check (kind in ('download', 'stream')),
  -- URL lifetime snapshot
  url_expires_at timestamptz not null,
  -- For downloads: hashed IP (raw IP for streams only, see files/README).
  -- IP retention is 90 days then null'd by a cron (PH19).
  ip_hash text,
  ip_raw text,
  user_agent text,
  -- Range request metadata for 1GB+ downloads
  range_start bigint,
  range_end bigint,
  bytes_served bigint,
  -- CDN/PoP identifier (Bunny edge)
  edge_location text,
  created_at timestamptz not null default now()
);

alter table file_downloads enable row level security;

drop policy if exists "file_downloads_self_read" on file_downloads;
create policy "file_downloads_self_read" on file_downloads
  for select using (user_id = auth.uid());

drop policy if exists "file_downloads_admin_read" on file_downloads;
create policy "file_downloads_admin_read" on file_downloads
  for select using (is_admin());

-- Append-only: no update/delete policies. Writes via service-role only.

create index if not exists file_downloads_user_created_idx on file_downloads(user_id, created_at desc);
create index if not exists file_downloads_file_idx on file_downloads(file_id);
create index if not exists file_downloads_product_idx on file_downloads(product_id);

-- ---------------------------------------------------------------------------
-- platform_settings — single-row config table
-- ---------------------------------------------------------------------------
create table if not exists platform_settings (
  id int primary key default 1 check (id = 1), -- single-row constraint
  default_royalty_pct_bps int not null default 3000 check (default_royalty_pct_bps between 0 and 10000),
  plr_subscriber_discount_pct_bps int not null default 1500 check (plr_subscriber_discount_pct_bps between 0 and 10000),
  personal_access_price_cents bigint not null default 1900 check (personal_access_price_cents >= 0),
  default_currency text not null default 'USD',
  -- Feature flags (extend as needed)
  maintenance_mode boolean not null default false,
  allow_new_signups boolean not null default true,
  allow_new_partner_applications boolean not null default true,
  allow_new_affiliate_applications boolean not null default true,
  -- Marketing copy
  hero_title text,
  hero_subtitle text,
  -- Legal pointers
  terms_markdown text,
  privacy_markdown text,
  refund_policy_markdown text,
  dmca_markdown text,
  contact_email text,
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);

-- Seed the single row.
insert into platform_settings (id, default_royalty_pct_bps, plr_subscriber_discount_pct_bps, personal_access_price_cents, hero_title, hero_subtitle, contact_email)
values (
  1, 3000, 1500, 1900,
  'Premium video courses. 100% PLR rights.',
  'Buy once, rebrand, and resell. Built for instructors, affiliates, and resellers who want to keep the margin.',
  'support@uthena.com'
)
on conflict (id) do nothing;

alter table platform_settings enable row level security;

drop policy if exists "platform_settings_public_read" on platform_settings;
create policy "platform_settings_public_read" on platform_settings
  for select using (true);

drop policy if exists "platform_settings_admin_write" on platform_settings;
create policy "platform_settings_admin_write" on platform_settings
  for update using (is_admin());

drop trigger if exists platform_settings_set_updated_at on platform_settings;
create trigger platform_settings_set_updated_at before update on platform_settings
for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- notification_preferences
-- ---------------------------------------------------------------------------
create table if not exists notification_preferences (
  id bigserial primary key,
  user_id uuid not null unique references auth.users(id) on delete cascade,
  order_updates_email boolean not null default true,
  refund_updates_email boolean not null default true,
  payout_updates_email boolean not null default true,
  security_alerts_email boolean not null default true,
  marketing_email boolean not null default false,
  product_updates_email boolean not null default true,
  weekly_digest_email boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table notification_preferences enable row level security;

drop policy if exists "notification_prefs_self_read" on notification_preferences;
create policy "notification_prefs_self_read" on notification_preferences
  for select using (user_id = auth.uid());

drop policy if exists "notification_prefs_self_write" on notification_preferences;
create policy "notification_prefs_self_write" on notification_preferences
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop trigger if exists notification_prefs_set_updated_at on notification_preferences;
create trigger notification_prefs_set_updated_at before update on notification_preferences
for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- consent_log — GDPR cookie consent audit
-- ---------------------------------------------------------------------------
create table if not exists consent_log (
  id bigserial primary key,
  user_id uuid references auth.users(id) on delete set null,
  -- categories consented to
  essential boolean not null default true,
  analytics boolean not null default false,
  marketing boolean not null default false,
  ip_hash text,
  user_agent text,
  created_at timestamptz not null default now()
);

alter table consent_log enable row level security;

-- consent_log is admin-only for read; users can write their own (anon ok).
drop policy if exists "consent_log_public_insert" on consent_log;
create policy "consent_log_public_insert" on consent_log
  for insert with check (true);

drop policy if exists "consent_log_self_read" on consent_log;
create policy "consent_log_self_read" on consent_log
  for select using (user_id = auth.uid() or user_id is null);

drop policy if exists "consent_log_admin_read" on consent_log;
create policy "consent_log_admin_read" on consent_log
  for select using (is_admin());

create index if not exists consent_log_user_idx on consent_log(user_id);
create index if not exists consent_log_created_idx on consent_log(created_at desc);

-- ---------------------------------------------------------------------------
-- processed_webhooks — idempotency for Stripe / PayPal / Bunny webhooks
-- ---------------------------------------------------------------------------
create table if not exists processed_webhooks (
  id bigserial primary key,
  source text not null check (source in ('stripe', 'paypal', 'bunny', 'ses', 'clerk', 'supabase')),
  event_id text not null,
  event_type text,
  -- Outcome
  result text not null check (result in ('processed', 'skipped', 'failed')),
  error_message text,
  payload jsonb,
  created_at timestamptz not null default now(),
  unique (source, event_id)
);

alter table processed_webhooks enable row level security;

-- Read for admins, no one else.
drop policy if exists "processed_webhooks_admin_read" on processed_webhooks;
create policy "processed_webhooks_admin_read" on processed_webhooks
  for select using (is_admin());

-- Writes via service role only (the webhook handler).

create index if not exists processed_webhooks_source_idx on processed_webhooks(source);
create index if not exists processed_webhooks_created_idx on processed_webhooks(created_at desc);

-- ---------------------------------------------------------------------------
-- admin_audit_log — APPEND-ONLY record of every admin PII read / mutation
-- ---------------------------------------------------------------------------
create table if not exists admin_audit_log (
  id bigserial primary key,
  actor_id uuid not null references auth.users(id) on delete restrict,
  actor_email text not null,
  action text not null,                -- e.g. 'order.read', 'partner.approve', 'refund.create'
  target_kind text,                    -- e.g. 'order', 'partner', 'refund'
  target_id text,                      -- stringified id, can be bigint or uuid
  -- Diff / context
  metadata jsonb not null default '{}'::jsonb,
  ip text,
  user_agent text,
  created_at timestamptz not null default now()
);

alter table admin_audit_log enable row level security;

drop policy if exists "admin_audit_log_admin_read" on admin_audit_log;
create policy "admin_audit_log_admin_read" on admin_audit_log
  for select using (is_admin());

-- Append-only: no update/delete policies.

create index if not exists admin_audit_log_actor_idx on admin_audit_log(actor_id, created_at desc);
create index if not exists admin_audit_log_action_idx on admin_audit_log(action);
create index if not exists admin_audit_log_target_idx on admin_audit_log(target_kind, target_id);

-- ---------------------------------------------------------------------------
-- api_tokens — partner/affiliate programmatic access
-- ---------------------------------------------------------------------------
create table if not exists api_tokens (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  -- Hashed token; we never store the raw value. The plaintext is shown
  -- to the user ONCE on creation.
  token_hash text not null unique,
  token_prefix text not null,           -- e.g. 'uth_live_abc' for UI display
  scopes text[] not null default '{}',
  last_used_at timestamptz,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

alter table api_tokens enable row level security;

drop policy if exists "api_tokens_self_read" on api_tokens;
create policy "api_tokens_self_read" on api_tokens
  for select using (user_id = auth.uid());

drop policy if exists "api_tokens_self_write" on api_tokens;
create policy "api_tokens_self_write" on api_tokens
  for insert with check (user_id = auth.uid());

drop policy if exists "api_tokens_self_revoke" on api_tokens;
create policy "api_tokens_self_revoke" on api_tokens
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

create index if not exists api_tokens_user_idx on api_tokens(user_id);
create index if not exists api_tokens_token_hash_idx on api_tokens(token_hash);

-- ---------------------------------------------------------------------------
-- risk_signals — fraud/abuse detection
-- ---------------------------------------------------------------------------
create table if not exists risk_signals (
  id bigserial primary key,
  user_id uuid references auth.users(id) on delete set null,
  signal_kind text not null,           -- 'velocity', 'ip_mismatch', 'high_value_first', etc.
  severity text not null check (severity in ('info', 'warn', 'block')),
  context jsonb not null default '{}'::jsonb,
  resolved boolean not null default false,
  resolved_by uuid references auth.users(id),
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

alter table risk_signals enable row level security;

drop policy if exists "risk_signals_self_read" on risk_signals;
create policy "risk_signals_self_read" on risk_signals
  for select using (user_id = auth.uid());

drop policy if exists "risk_signals_admin_read" on risk_signals;
create policy "risk_signals_admin_read" on risk_signals
  for all using (is_admin());

create index if not exists risk_signals_severity_idx on risk_signals(severity, resolved);
create index if not exists risk_signals_user_idx on risk_signals(user_id);

-- ---------------------------------------------------------------------------
-- reports — user-submitted content reports (DMCA, abuse, etc.)
-- ---------------------------------------------------------------------------
create table if not exists reports (
  id bigserial primary key,
  reporter_id uuid references auth.users(id) on delete set null,
  target_kind text not null check (target_kind in ('product', 'review', 'user', 'comment')),
  target_id text not null,
  reason text not null check (reason in (
    'copyright', 'spam', 'fraud', 'harassment', 'illegal', 'other'
  )),
  details text,
  status text not null check (status in ('open', 'reviewing', 'actioned', 'dismissed')) default 'open',
  assigned_to uuid references auth.users(id),
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

alter table reports enable row level security;

drop policy if exists "reports_self_read" on reports;
create policy "reports_self_read" on reports
  for select using (reporter_id = auth.uid());

drop policy if exists "reports_public_insert" on reports;
create policy "reports_public_insert" on reports
  for insert with check (true);

drop policy if exists "reports_admin_all" on reports;
create policy "reports_admin_all" on reports for all using (is_admin());

-- ---------------------------------------------------------------------------
-- dmca_takedowns — DMCA notice + counter-notice workflow
-- ---------------------------------------------------------------------------
create table if not exists dmca_takedowns (
  id bigserial primary key,
  complainant_name text not null,
  complainant_email text not null,
  complainant_address text,
  -- What's being taken down
  target_kind text not null check (target_kind in ('product', 'product_file', 'review')),
  target_id text not null,
  -- Notice
  sworn_statement boolean not null default false,
  good_faith_statement boolean not null default false,
  authorized_statement boolean not null default false,
  notice_text text not null,
  signature text not null,
  -- Status
  status text not null check (status in (
    'received', 'acknowledged', 'product_removed', 'counter_notice_filed',
    'restored', 'rejected', 'court_action'
  )) default 'received',
  admin_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table dmca_takedowns enable row level security;

drop policy if exists "dmca_takedowns_admin_all" on dmca_takedowns;
create policy "dmca_takedowns_admin_all" on dmca_takedowns for all using (is_admin());

drop trigger if exists dmca_takedowns_set_updated_at on dmca_takedowns;
create trigger dmca_takedowns_set_updated_at before update on dmca_takedowns
for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- partner_uploads — Bunny tus direct-upload records, scan state
-- ---------------------------------------------------------------------------
create table if not exists partner_uploads (
  id bigserial primary key,
  partner_id bigint not null references partners(id) on delete cascade,
  -- Bunny tus upload session
  tus_upload_id text,
  -- File metadata
  original_filename text not null,
  size_bytes bigint not null,
  mime_type text,
  -- Scan state (ClamAV)
  scan_status scan_status not null default 'pending',
  scan_started_at timestamptz,
  scan_completed_at timestamptz,
  scan_result text,
  -- Encoding state (video)
  encoding_status encoding_status default 'pending',
  bunny_video_id text,
  -- Once attached, links to the product + product_file rows
  product_id bigint references products(id) on delete set null,
  product_file_id bigint references product_files(id) on delete set null,
  -- Failure tracking
  failure_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table partner_uploads enable row level security;

drop policy if exists "partner_uploads_self_read" on partner_uploads;
create policy "partner_uploads_self_read" on partner_uploads
  for select using (partner_id = current_partner_id());

drop policy if exists "partner_uploads_self_write" on partner_uploads;
create policy "partner_uploads_self_write" on partner_uploads
  for all using (partner_id = current_partner_id()) with check (partner_id = current_partner_id());

drop policy if exists "partner_uploads_admin_all" on partner_uploads;
create policy "partner_uploads_admin_all" on partner_uploads for all using (is_admin());

create index if not exists partner_uploads_partner_idx on partner_uploads(partner_id);
create index if not exists partner_uploads_scan_idx on partner_uploads(scan_status);

drop trigger if exists partner_uploads_set_updated_at on partner_uploads;
create trigger partner_uploads_set_updated_at before update on partner_uploads
for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- partner_onboarding_drafts — multi-step form persistence
-- ---------------------------------------------------------------------------
create table if not exists partner_onboarding_drafts (
  id bigserial primary key,
  user_id uuid not null unique references auth.users(id) on delete cascade,
  -- Form fields (snake_case keys)
  payload jsonb not null default '{}'::jsonb,
  current_step int not null default 1,
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table partner_onboarding_drafts enable row level security;

drop policy if exists "partner_onboarding_drafts_self_read" on partner_onboarding_drafts;
create policy "partner_onboarding_drafts_self_read" on partner_onboarding_drafts
  for select using (user_id = auth.uid());

drop policy if exists "partner_onboarding_drafts_self_write" on partner_onboarding_drafts;
create policy "partner_onboarding_drafts_self_write" on partner_onboarding_drafts
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "partner_onboarding_drafts_admin_read" on partner_onboarding_drafts;
create policy "partner_onboarding_drafts_admin_read" on partner_onboarding_drafts
  for select using (is_admin());

drop trigger if exists partner_onboarding_drafts_set_updated_at on partner_onboarding_drafts;
create trigger partner_onboarding_drafts_set_updated_at before update on partner_onboarding_drafts
for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- *_admin_notes — internal admin-only notes on a customer / partner / affiliate
-- ---------------------------------------------------------------------------
create table if not exists customer_admin_notes (
  id bigserial primary key,
  customer_id uuid not null references auth.users(id) on delete cascade,
  author_id uuid not null references auth.users(id) on delete restrict,
  body text not null,
  created_at timestamptz not null default now()
);

alter table customer_admin_notes enable row level security;
drop policy if exists "customer_admin_notes_admin_all" on customer_admin_notes;
create policy "customer_admin_notes_admin_all" on customer_admin_notes
  for all using (is_admin());

create table if not exists partner_admin_notes (
  id bigserial primary key,
  partner_id bigint not null references partners(id) on delete cascade,
  author_id uuid not null references auth.users(id) on delete restrict,
  body text not null,
  created_at timestamptz not null default now()
);

alter table partner_admin_notes enable row level security;
drop policy if exists "partner_admin_notes_admin_all" on partner_admin_notes;
create policy "partner_admin_notes_admin_all" on partner_admin_notes
  for all using (is_admin());

create table if not exists affiliate_admin_notes (
  id bigserial primary key,
  affiliate_id bigint not null references affiliates(id) on delete cascade,
  author_id uuid not null references auth.users(id) on delete restrict,
  body text not null,
  created_at timestamptz not null default now()
);

alter table affiliate_admin_notes enable row level security;
drop policy if exists "affiliate_admin_notes_admin_all" on affiliate_admin_notes;
create policy "affiliate_admin_notes_admin_all" on affiliate_admin_notes
  for all using (is_admin());

-- ---------------------------------------------------------------------------
-- Reviews — product reviews (used in PH16 but the table is core enough
-- to live here so RLS is correct from day one)
-- ---------------------------------------------------------------------------
create table if not exists reviews (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  product_id bigint not null references products(id) on delete cascade,
  rating int not null check (rating between 1 and 5),
  title text,
  body text not null check (length(body) between 10 and 5000),
  status text not null check (status in ('pending', 'published', 'hidden', 'flagged')) default 'published',
  helpful_count int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, product_id)
);

alter table reviews enable row level security;

drop policy if exists "reviews_public_read_published" on reviews;
create policy "reviews_public_read_published" on reviews
  for select using (status = 'published');

drop policy if exists "reviews_self_read_own" on reviews;
create policy "reviews_self_read_own" on reviews
  for select using (user_id = auth.uid());

drop policy if exists "reviews_self_write" on reviews;
create policy "reviews_self_write" on reviews
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "reviews_admin_all" on reviews;
create policy "reviews_admin_all" on reviews for all using (is_admin());

create index if not exists reviews_product_idx on reviews(product_id);
create index if not exists reviews_user_idx on reviews(user_id);

drop trigger if exists reviews_set_updated_at on reviews;
create trigger reviews_set_updated_at before update on reviews
for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- FAQ entries (used in PH11 — but the table is admin-managed from day 1)
-- ---------------------------------------------------------------------------
create table if not exists faq_entries (
  id bigserial primary key,
  question text not null,
  answer jsonb not null,               -- TipTap JSON
  category text,
  display_order int not null default 0,
  is_published boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table faq_entries enable row level security;

drop policy if exists "faq_public_read_published" on faq_entries;
create policy "faq_public_read_published" on faq_entries
  for select using (is_published = true);

drop policy if exists "faq_admin_all" on faq_entries;
create policy "faq_admin_all" on faq_entries for all using (is_admin());

create index if not exists faq_entries_published_idx on faq_entries(is_published, display_order);

drop trigger if exists faq_entries_set_updated_at on faq_entries;
create trigger faq_entries_set_updated_at before update on faq_entries
for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- Seed: the 17 top-level categories from the data model spec
-- ---------------------------------------------------------------------------
insert into categories (slug, name, display_order) values
  ('ai', 'AI', 1),
  ('business', 'Business', 2),
  ('marketing', 'Marketing', 3),
  ('programming', 'Programming', 4),
  ('design', 'Design', 5),
  ('finance', 'Finance', 6),
  ('health-fitness', 'Health & Fitness', 7),
  ('hobby', 'Hobby', 8),
  ('language', 'Language', 9),
  ('photography', 'Photography', 10),
  ('productivity', 'Productivity', 11),
  ('relationship', 'Relationship', 12),
  ('technology', 'Technology', 13),
  ('cryptocurrency', 'Cryptocurrency', 14),
  ('educational', 'Educational', 15),
  ('entrepreneurship', 'Entrepreneurship', 16),
  ('mental-health', 'Mental Health', 17)
on conflict (slug) do nothing;

-- ============================================================================
-- End of 0001_initial.sql
-- ============================================================================
