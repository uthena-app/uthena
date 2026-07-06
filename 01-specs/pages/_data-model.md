# Data Model — `00-foundations/data/`

> The full database schema for Uthena v2. This is the source of truth for table structure, RLS policies, and relationships. Every page spec references entities from this doc.

**Read this before writing any feature spec.** If the spec says "show the buyer's library" and you don't know what `library_grants` is, you're going to guess wrong.

---

## Conventions

- **Table names:** plural, snake_case (`products`, `library_grants`).
- **Column names:** singular, snake_case (`title`, `price_cents`).
- **IDs:** `bigint` with `identity` (autoincrement). Never UUID. Public-facing slugs are separate from IDs.
- **Timestamps:** `created_at` and `updated_at` on every table. `created_at` defaults to `now()`. `updated_at` triggers on update.
- **Money:** always in cents. Always `bigint`. Never `numeric` (precision issues).
- **Soft delete:** `status` enum field, not a `deleted_at` column. We use `status = 'archived'` instead.
- **JSON blobs:** `jsonb` only when the shape is genuinely free-form. Prefer a typed table for anything you'll query.
- **Enums:** Postgres native enums in `00-foundations/data/schema.sql`. TypeScript unions in `00-foundations/data/types.ts` mirror them.

## Roles

Every user has exactly one role, stored in `profiles.role`:

| Role | Description | Default pages |
|---|---|---|
| `customer` | Default. Can browse, buy, access library. | `/`, `/browse`, `/collections/*`, `/products/*`, `/library`, `/checkout` |
| `partner` | Can upload courses, see their sales, request payouts. | `/partner/*` |
| `affiliate` | Can promote, see commissions, customize mini-shop. | `/affiliate/*` |
| `admin` | Can moderate, manage partners, see audit logs. | `/admin/*` |

A user can be `customer + partner` simultaneously (they buy from us AND sell to us). The role is a single value, but RBAC is checked per-action, not per-user.

**RBAC helper:** `requireRole(['partner'])` from `00-foundations/auth/guards.ts`. Throws on mismatch.

## Table index

| Section | Tables |
|---|---|
| Core | `auth.users` (Supabase), `profiles`, `partners`, `categories`, `products`, `product_files`, `product_modules`, `product_lessons`, `product_pricing`, `product_assets` |
| Commerce | `orders`, `order_items`, `payout_ledger`, `refunds`, `coupons`, `cart_items` |
| Engagement | `library_grants`, `progress`, `bookmarks`, `reviews`, `file_downloads`, `certificates` |
| Account | `notification_preferences` |
| Partner & admin | `partner_uploads`, `partner_onboarding_drafts`, `partner_admin_notes`, `affiliate_admin_notes`, `customer_admin_notes`, `admin_audit_log`, `processed_webhooks`, `reports`, `platform_settings`, `api_tokens`, `dmca_takedowns`, `risk_signals` |
| Affiliate | `affiliates`, `affiliate_links`, `affiliate_clicks`, `affiliate_commissions`, `affiliate_payouts`, `affiliate_onboarding_drafts`, `handle_reservations`, `handle_cool_off`, `affiliate_curated_products` |
| Views | `product_sales_daily` (materialized view, refreshed nightly + on write) |

---

## Core tables

### `auth.users` (managed by Supabase Auth)

Don't touch this. Supabase owns it. We extend it with `profiles` and `partners`.

### `profiles` — 1:1 with `auth.users`

```sql
create table profiles (
  id bigserial primary key,
  user_id uuid not null unique references auth.users(id) on delete cascade,
  role text not null check (role in ('customer', 'partner', 'affiliate', 'admin')) default 'customer',
  display_name text not null,
  avatar_url text,
  bio text,
  locale text default 'en',
  timezone text default 'UTC',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table profiles enable row level security;

create policy "profiles_self_read" on profiles
  for select using (true); -- public profiles are readable (for mini-shop authors, etc.)
create policy "profiles_self_update" on profiles
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "profiles_admin_all" on profiles
  for all using (exists (select 1 from profiles p where p.user_id = auth.uid() and p.role = 'admin'));
```

**Schema extensions for v1** (the additive ALTERs are documented under "Schema extensions for v1" below):
- The `role` check is extended to include `'super_admin'` (the platform owner; same visibility as admin in v1, but a distinct value so v2 can scope destructive actions).
- New columns: `status` (active/suspended/banned), `suspended_at`, `suspended_until`, `suspended_reason`, `banned_at`, `banned_reason`, `banned_by`, `warnings_count`. The ban/suspend state machine is in "Schema extensions for v1" §"`profiles` — ban / suspend state machine."

### `partners` — extends profiles

```sql
create table partners (
  id bigserial primary key,
  user_id uuid not null unique references auth.users(id) on delete cascade,
  status text not null check (status in ('pending', 'approved', 'suspended')) default 'pending',
  public_slug text unique, -- imported from legacy Shopify instructor/vendor collection handle when available
  bio text,
  website_url text,
  payout_method jsonb, -- {type: 'paypal', email: '...'} — encrypted at app layer
  tax_form_status text check (tax_form_status in ('none', 'pending', 'submitted', 'approved')) default 'none',
  kyc_status text check (kyc_status in ('none', 'pending', 'approved', 'rejected')) default 'none',
  approved_at timestamptz,
  approved_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table partners enable row level security;

create policy "partners_self_read" on partners
  for select using (user_id = auth.uid());
create policy "partners_self_update" on partners
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "partners_admin_all" on partners
  for all using (exists (select 1 from profiles where user_id = auth.uid() and role = 'admin'));
```

`public_slug` is optional in the partner dashboard, but required for any partner whose legacy Shopify instructor/vendor collection must redirect to a public filtered browse view. It is lowercase, hyphenated, globally unique, and reserved against top-level app routes (`admin`, `api`, `account`, `affiliate`, `partner`, `library`, `checkout`, `cart`, `browse`, `blogs`, `collections`, `products`, `pages`, `policies`, `faq`, `contact`, `bundles`, `terms`, `privacy`, `refunds`, `delivery`, `data-sharing-opt-out`, `instructor-application`, `apply-as-instructor`, `submit-new-course`, `update-course`, `dmca`). Partners may not self-change `public_slug` in v1; admin changes are audit-logged because they affect public URLs.

### `categories`

```sql
create table categories (
  id bigserial primary key,
  slug text not null unique,
  name text not null,
  description text,
  parent_id bigint references categories(id), -- for sub-categories (2 levels max)
  display_order int default 0,
  product_count_cache int default 0, -- updated by trigger on products
  created_at timestamptz not null default now()
);

alter table categories enable row level security;
-- Public read.
```

**Seeded data:** 17 top-level categories, matching the live Shopify navigation and collection sitemap unless the human approves a merge before launch. AI, Business, Marketing, Programming, Design, Finance, Health & Fitness, Hobby, Language, Photography, Productivity, Relationship, Technology, Cryptocurrency, Educational, Entrepreneurship, Mental Health.

Legacy Shopify category collection handles are preserved in the launch redirect map. The most important handles are `ai-courses`, `business-courses`, `cryptocurrency-courses`, `design-courses`, `educational-courses`, `entrepreneurship-courses`, `finance-courses`, `health-fitness-courses`, `hobby-courses`, `language-courses`, `marketing-courses`, `mental-health-courses`, `photography-courses`, `productivity-courses`, `programming-courses`, `relationship-courses`, and `technology-courses`.

### `products`

```sql
create type product_kind as enum ('video_course', 'ebook', 'template_pack', 'audio_course', 'bundle', 'asset_pack');

create table products (
  id bigserial primary key,
  slug text not null unique,
  title text not null,
  short_description text not null, -- shown on catalog cards
  long_description text not null,   -- shown on product page
  kind product_kind not null,
  status text not null check (status in ('draft', 'in_review', 'published', 'unpublished', 'archived')) default 'draft',
  category_id bigint not null references categories(id),
  partner_id bigint not null references partners(id),
  thumbnail_url text,
  preview_video_url text, -- signed at request time, never stored
  total_duration_seconds int default 0, -- sum of all lesson durations
  total_lesson_count int default 0,
  total_file_size_bytes bigint default 0,
  search_vector tsvector, -- populated by trigger for FTS
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index on products (status, published_at desc) where status = 'published';
create index on products (category_id) where status = 'published';
create index on products (partner_id);
create index on products using gin (search_vector);

alter table products enable row level security;

create policy "products_public_read_published" on products
  for select using (status = 'published');
create policy "products_partner_read_own" on products
  for select using (partner_id in (select id from partners where user_id = auth.uid()));
create policy "products_partner_write_own" on products
  for all using (partner_id in (select id from partners where user_id = auth.uid()));
create policy "products_admin_all" on products
  for all using (exists (select 1 from profiles where user_id = auth.uid() and role = 'admin'));
```

### `product_files`

```sql
create type file_kind as enum ('video', 'slides', 'transcript', 'graphics', 'audio', 'document', 'archive', 'other');

create table product_files (
  id bigserial primary key,
  product_id bigint not null references products(id) on delete cascade,
  kind file_kind not null,
  original_filename text not null,
  storage_path text not null, -- Bunny Storage key
  size_bytes bigint not null,
  duration_seconds int, -- for video/audio only
  mime_type text,
  checksum_sha256 text, -- for dedup detection
  scan_status text not null check (scan_status in ('pending', 'clean', 'infected', 'failed')) default 'pending', -- ClamAV result (00-foundations/files/scan.ts). Only 'clean' files can attach to a published product (enforced in the publish action AND a DB trigger). 'infected' = quarantined, never served.
  encoding_status text check (encoding_status in ('pending', 'processing', 'ready', 'failed')) default 'pending',
  encoding_progress int default 0, -- 0-100
  bunny_video_id text, -- populated when video encoding finishes
  hls_manifest_url text, -- populated when encoding finishes
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index on product_files (product_id, kind);
create index on product_files (checksum_sha256);

alter table product_files enable row level security;

-- Inherits read access from product. Partners can write their own product's files.
create policy "product_files_public_read_via_product" on product_files
  for select using (
    exists (select 1 from products where id = product_files.product_id and status = 'published')
  );
create policy "product_files_partner_write" on product_files
  for all using (
    exists (select 1 from products where id = product_files.product_id and partner_id in (select id from partners where user_id = auth.uid()))
  );
create policy "product_files_admin_all" on product_files
  for all using (exists (select 1 from profiles where user_id = auth.uid() and role = 'admin'));
```

### `product_modules` & `product_lessons`

```sql
create table product_modules (
  id bigserial primary key,
  product_id bigint not null references products(id) on delete cascade,
  display_order int not null,
  title text not null,
  summary text,
  created_at timestamptz not null default now()
);

create index on product_modules (product_id, display_order);

alter table product_modules enable row level security;
-- Inherits from product.

create table product_lessons (
  id bigserial primary key,
  module_id bigint not null references product_modules(id) on delete cascade,
  file_id bigint references product_files(id), -- the video/audio file for this lesson
  display_order int not null,
  title text not null,
  summary text,
  duration_seconds int not null,
  is_preview boolean default false, -- shown without purchase
  created_at timestamptz not null default now()
);

create index on product_lessons (module_id, display_order);
create index on product_lessons (file_id);

alter table product_lessons enable row level security;
-- Inherits from product.
```

### `product_pricing`

```sql
create type license_tier as enum ('whitelabel', 'plr', 'plr_mrr');

create table product_pricing (
  id bigserial primary key,
  product_id bigint not null references products(id) on delete cascade,
  tier license_tier not null,
  price_cents bigint not null check (price_cents > 0),
  currency text not null default 'USD',
  partner_share_pct int not null default 60 check (partner_share_pct between 0 and 100),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (product_id, tier, currency)
);

create index on product_pricing (product_id) where active = true;

alter table product_pricing enable row level security;
-- Inherits from product.
```

### `product_assets` (sales materials)

```sql
create type asset_kind as enum ('landing_page', 'email_swipe', 'ad_copy', 'graphics_pack', 'social_post');

create table product_assets (
  id bigserial primary key,
  product_id bigint not null references products(id) on delete cascade,
  kind asset_kind not null,
  title text not null,
  storage_path text not null, -- Bunny Storage key for the asset file
  size_bytes bigint not null,
  mime_type text not null,
  created_at timestamptz not null default now()
);

create index on product_assets (product_id, kind);

alter table product_assets enable row level security;
-- Inherits from product.
```

---

## Commerce

### `orders`

```sql
create type order_status as enum ('pending', 'paid', 'refunded', 'partially_refunded', 'failed', 'fraudulent');

create table orders (
  id bigserial primary key,
  stripe_checkout_session_id text unique,
  stripe_payment_intent_id text unique,
  customer_id uuid not null references auth.users(id),
  status order_status not null default 'pending',
  subtotal_cents bigint not null,
  total_cents bigint not null,
  tax_cents bigint default 0,
  currency text not null default 'USD',
  coupon_id bigint references coupons(id),
  affiliate_id bigint references affiliates(id), -- set if buyer came via affiliate link
  ip_address inet, -- for fraud detection; encrypted at app layer
  user_agent text,
  refunded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index on orders (customer_id, created_at desc);
create index on orders (status, created_at desc);
create index on orders (affiliate_id, created_at desc);
create index on orders (stripe_checkout_session_id);

alter table orders enable row level security;

create policy "orders_self_read" on orders
  for select using (customer_id = auth.uid());
create policy "orders_admin_all" on orders
  for all using (exists (select 1 from profiles where user_id = auth.uid() and role = 'admin'));
```

### `order_items`

```sql
create table order_items (
  id bigserial primary key,
  order_id bigint not null references orders(id) on delete cascade,
  product_id bigint not null references products(id),
  pricing_id bigint not null references product_pricing(id),
  tier license_tier not null,
  unit_price_cents bigint not null,
  quantity int not null default 1 check (quantity > 0),
  partner_share_cents bigint not null, -- snapshotted at purchase time
  platform_share_cents bigint not null,
  refunded_cents bigint default 0,
  created_at timestamptz not null default now()
);

create index on order_items (order_id);
create index on order_items (product_id, created_at desc);

alter table order_items enable row level security;
-- Inherits from order.
```

### `payout_ledger` — the immutable financial source of truth

```sql
create type ledger_kind as enum ('order_credit', 'refund_debit', 'payout_paid', 'adjustment');
create type ledger_status as enum ('pending', 'locked', 'available', 'paid', 'reversed');

create table payout_ledger (
  id bigserial primary key,
  partner_id bigint not null references partners(id),
  kind ledger_kind not null,
  order_id bigint references orders(id),
  amount_cents bigint not null, -- positive = credit, negative = debit
  currency text not null default 'USD',
  status ledger_status not null default 'pending',
  locked_until timestamptz, -- within refund window
  available_at timestamptz, -- when this can be paid out
  external_id text, -- PayPal payout batch ID once paid
  external_metadata jsonb,
  description text not null,
  created_at timestamptz not null default now()
);

create index on payout_ledger (partner_id, created_at desc);
create index on payout_ledger (status, available_at) where status = 'available';
create index on payout_ledger (order_id);

alter table payout_ledger enable row level security;

create policy "payout_ledger_partner_read_own" on payout_ledger
  for select using (partner_id in (select id from partners where user_id = auth.uid()));
create policy "payout_ledger_admin_all" on payout_ledger
  for all using (exists (select 1 from profiles where user_id = auth.uid() and role = 'admin'));
-- No UPDATE/DELETE policy: this is append-only.
```

**Rules for this table:**
- **No UPDATE allowed at the app layer.** Only INSERT. If something is wrong, insert a corrective `adjustment` entry.
- **No DELETE.** Ever. If you need to remove a row, insert a reversing entry.
- The `order_id` is set for `order_credit`, `refund_debit`. It's null for `payout_paid` and `adjustment`.
- Every row must have a human-readable `description`.

### `refunds`

```sql
create type refund_status as enum ('requested', 'approved', 'rejected', 'processed');

create table refunds (
  id bigserial primary key,
  order_id bigint not null references orders(id),
  reason text,
  status refund_status not null default 'requested',
  amount_cents bigint not null,
  stripe_refund_id text unique,
  requested_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references auth.users(id),
  resolution_notes text
);

create index on refunds (order_id);
create index on refunds (status, requested_at);

alter table refunds enable row level security;

create policy "refunds_self_read" on refunds
  for select using (
    exists (select 1 from orders where id = refunds.order_id and customer_id = auth.uid())
  );
create policy "refunds_admin_all" on refunds
  for all using (exists (select 1 from profiles where user_id = auth.uid() and role = 'admin'));
```

### `coupons`

```sql
create type discount_type as enum ('percent', 'fixed');

create table coupons (
  id bigserial primary key,
  code text not null unique,
  discount_type discount_type not null,
  discount_value int not null, -- percent (1-100) or fixed cents
  max_redemptions int,
  redemptions_count int default 0,
  valid_from timestamptz not null,
  valid_until timestamptz,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table coupons enable row level security;
-- Public read of active coupons. Admin write.
```

### `cart_items` — the user's cart (auth-required; anon cart lives in a signed cookie)

```sql
create table cart_items (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  product_id bigint not null references products(id) on delete cascade,
  tier license_tier not null,
  added_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, product_id, tier) -- one row per (user, product, tier) — "increase quantity" becomes a tier change
);

create index on cart_items (user_id, updated_at desc);
create index on cart_items (product_id);

alter table cart_items enable row level security;

create policy "cart_items_self_all" on cart_items
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
```

**Rules for this table:**
- **No anonymous rows.** Unauthenticated users get a signed-cookie `cart_session` (see `cart.md` Open Questions). The cookie's content is the source of truth for anon carts; on sign-in we merge into this table. The schema is auth-only.
- **Unique on `(user_id, product_id, tier)`** prevents duplicates. Adding the same `(product, tier)` twice is a no-op (increments `updated_at` only if a server action chooses to). Quantity is always 1.
- **Tiers are not fungible.** A `whitelabel` and a `plr` of the same product are two separate cart rows.
- **No `quantity` column** in v1. The PLR reseller who wants "5 copies" is a v2 feature.
- **On order completion** the cart rows are deleted in a server action (one DELETE per `(user, product, tier)` from the order items) inside the same transaction as the order insert. Failures roll back the order.
- **Deletable by user only.** No admin delete policy in v1. Admins use service role for refund-driven cleanup if needed (rare path).

---

## Engagement

### `library_grants` — what the user owns

```sql
create type grant_source as enum ('purchase', 'admin_grant', 'free_promotion', 'bundle', 'refund_reversal');

create table library_grants (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  product_id bigint not null references products(id) on delete cascade,
  tier license_tier not null,
  source grant_source not null,
  order_id bigint references orders(id), -- null for free grants
  granted_at timestamptz not null default now(),
  revoked_at timestamptz, -- if user refunded, we revoke but keep the record
  expires_at timestamptz, -- null = lifetime
  unique (user_id, product_id, tier) -- one grant per (user, product, tier) combo
);

create index on library_grants (user_id, granted_at desc);
create index on library_grants (product_id);

alter table library_grants enable row level security;

create policy "library_grants_self_read" on library_grants
  for select using (user_id = auth.uid());
create policy "library_grants_partner_read_product_buyers" on library_grants
  for select using (
    exists (
      select 1 from products p
      join partners pa on pa.id = p.partner_id
      where p.id = library_grants.product_id and pa.user_id = auth.uid()
    )
  );
create policy "library_grants_admin_all" on library_grants
  for all using (exists (select 1 from profiles where user_id = auth.uid() and role = 'admin'));
```

### `progress` — lesson watching progress

```sql
create table progress (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  product_id bigint not null references products(id) on delete cascade,
  lesson_id bigint not null references product_lessons(id) on delete cascade,
  position_seconds int not null default 0,
  completed boolean not null default false,
  completed_at timestamptz,
  last_watched_at timestamptz not null default now(),
  unique (user_id, lesson_id)
);

create index on progress (user_id, product_id);
create index on progress (user_id, last_watched_at desc);

alter table progress enable row level security;
-- Self only.
create policy "progress_self_all" on progress
  for all using (user_id = auth.uid());
```

### `bookmarks`

```sql
create table bookmarks (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  lesson_id bigint not null references product_lessons(id) on delete cascade,
  note text,
  created_at timestamptz not null default now(),
  unique (user_id, lesson_id)
);

alter table bookmarks enable row level security;
-- Self only.
```

### `reviews`

```sql
create type review_status as enum ('pending', 'approved', 'rejected', 'flagged');

create table reviews (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  product_id bigint not null references products(id) on delete cascade,
  rating int not null check (rating between 1 and 5),
  title text,
  body text not null,
  verified_buyer boolean not null default false, -- true if user has library_grant
  status review_status not null default 'pending',
  helpful_count int default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, product_id)
);

create index on reviews (product_id, status, created_at desc);
create index on reviews (status) where status = 'pending';

alter table reviews enable row level security;
create policy "reviews_public_read_approved" on reviews
  for select using (status = 'approved');
create policy "reviews_self_read_own" on reviews
  for select using (user_id = auth.uid());
create policy "reviews_self_write_own" on reviews
  for insert with check (user_id = auth.uid());
create policy "reviews_self_update_own" on reviews
  for update using (user_id = auth.uid());
create policy "reviews_admin_all" on reviews
  for all using (exists (select 1 from profiles where user_id = auth.uid() and role = 'admin'));
```

### `file_downloads` — audit log for all file access

```sql
create table file_downloads (
  id bigserial primary key,
  user_id uuid references auth.users(id) on delete set null, -- null for anon
  product_id bigint references products(id) on delete set null,
  file_id bigint references product_files(id) on delete set null,
  ip_address inet, -- streams only (raw IP needed for IP binding); NULL for downloads
  ip_hash text,    -- downloads: SHA-256(ip + daily_salt), same pattern as affiliate_clicks
  user_agent text,
  url_token_hash text, -- SHA-256 of the signed-URL token; joins to cdn_access_stats for abuse detection
  signed_url_expires_at timestamptz not null,
  downloaded_at timestamptz not null default now()
);
-- Retention: ip_address and ip_hash are nulled after 90 days (GDPR minimization);
-- the row stays for download history. Cron job in 04-platform/ci/scripts/cron/.

create index on file_downloads (url_token_hash);
create index on file_downloads (user_id, downloaded_at desc);
create index on file_downloads (file_id, downloaded_at desc);
create index on file_downloads (downloaded_at) where downloaded_at > now() - interval '90 days';

alter table file_downloads enable row level security;
-- Admin only for read (for abuse review).
-- User can see their own (last 90 days, for the "my downloads" view).
create policy "file_downloads_self_read_recent" on file_downloads
  for select using (user_id = auth.uid() and downloaded_at > now() - interval '90 days');
create policy "file_downloads_admin_all" on file_downloads
  for all using (exists (select 1 from profiles where user_id = auth.uid() and role = 'admin'));
```

### `cdn_access_stats` — URL *access* aggregates from Bunny CDN logs (added 2026-06-12)

`file_downloads` records URL *generation*; actual access happens at Bunny's edge. This table holds privacy-preserving aggregates ingested every 15 minutes by `cdn-log-ingest.ts` (see `04-platform/observability/README.md` §"CDN log ingestion"). It powers the abuse flags ("same URL from >10 distinct IPs in a day", ">10 accesses in an hour").

```sql
create table cdn_access_stats (
  id bigserial primary key,
  url_token_hash text not null, -- joins to file_downloads.url_token_hash
  hour timestamptz not null,    -- truncated to the hour
  access_count int not null default 0,
  distinct_ip_hashes int not null default 0, -- count of distinct SHA-256(ip + daily_salt)
  unique (url_token_hash, hour)
);

create index on cdn_access_stats (url_token_hash, hour desc);
create index on cdn_access_stats (hour) where hour > now() - interval '90 days';

alter table cdn_access_stats enable row level security;
-- Admin only; written by the ingest job via service role.
create policy "cdn_access_stats_admin_read" on cdn_access_stats
  for select using (exists (select 1 from profiles where user_id = auth.uid() and role = 'admin'));
```

### `certificates` — course-completion certificates (dual identifier: internal `id` + public `certificate_code`)

```sql
create type certificate_status as enum ('active', 'revoked');

create table certificates (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  product_id bigint not null references products(id) on delete cascade,
  partner_id bigint references partners(id) on delete set null, -- denormalized for partner dashboard joins
  issued_at timestamptz not null default now(),
  certificate_code text not null unique, -- 8-char base-32, e.g. '7F2K9P4QX' — the PUBLIC identifier
  pdf_storage_path text not null, -- Bunny private bucket key
  status certificate_status not null default 'active',
  revoked_at timestamptz,
  revoked_reason text, -- 'refund', 'admin_action', etc.
  created_at timestamptz not null default now(),
  unique (user_id, product_id) -- one certificate per (user, product)
);

create index on certificates (user_id, issued_at desc);
create index on certificates (product_id);
create index on certificates (partner_id) where partner_id is not null;
create index on certificates (certificate_code);

alter table certificates enable row level security;

create policy "certificates_self_read" on certificates
  for select using (user_id = auth.uid());
create policy "certificates_admin_all" on certificates
  for all using (exists (select 1 from profiles where user_id = auth.uid() and role = 'admin'));
-- No self INSERT/UPDATE: issuance is a system action via service role.
-- No self DELETE: revocation sets status='revoked', not a delete.
```

**Rules for this table — the two-identifier model (reconciliation with `library.md`):**
- **Two identifiers coexist on purpose.** `id` (bigint) is the **internal buyer-side identifier** used by `/account/certificates` and the library page; `certificate_code` (8-char base-32, ~33 bits) is the **public identifier** used by `/verify/certificate/[code]`. The `/verify` page is anonymous, RLS-bypassed via service role, and looks up by `certificate_code` only — it never sees `id`.
- **Why both?** The bigint `id` is enumerable (predictable, sequential) — fine inside an authed session, dangerous in a public URL. The `certificate_code` is non-enumerable (random base-32) and is the right thing to put on a printed/embedded/shareable URL. Same row, two lookup keys.
- **Uniqueness** on `certificate_code` is what prevents collisions. The 33-bit space is plenty at our scale (~50K certificates/year ⇒ collision probability under 1e-5).
- **Issuance path.** System action only (service role). Triggered on (a) the server action that observes the last lesson of a product being completed (see `account-certificates.md`), and (b) a nightly cron that backfills any completions missed by the real-time path. Both write to the same table.
- **Revocation is a status, not a delete.** A refunded user has their certificate row set to `status='revoked'`, `revoked_at=now()`, `revoked_reason='refund'`. The PDF stays in Bunny (for audit); the public verify page renders it as "Revoked: refund" instead of the cert details.
- **Scope is `video_course` only in v1.** E-books, template packs, and audio courses don't have a `progress` table equivalent (no per-item "completed" signal). The issuance trigger is a no-op for non-video products. See `account-certificates.md` Open Questions §2.
- **`partner_id` is denormalized.** It exists for the partner dashboard's "view certificates I've issued" join. Source of truth is still `products.partner_id`; we copy at issuance time so a partner de-listing the product doesn't break the certificate view.
- **The `/verify/[code]` route is a separate spec** (`account-verify-static` track, not this one). It bypasses RLS via service role and returns only public-safe fields.

---

## Account

### `notification_preferences` — per-account email/notification settings

```sql
create type email_digest_freq as enum ('off', 'daily', 'weekly', 'monthly');

create table notification_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email_digest_freq email_digest_freq not null default 'weekly',
  transactional_opt_in boolean not null default true,  -- locked: never user-editable (legal emails must reach the user)
  newsletter_opt_in boolean not null default false,
  partner_updates_opt_in boolean not null default false,
  affiliate_updates_opt_in boolean not null default false,
  updated_at timestamptz not null default now()
);

alter table notification_preferences enable row level security;

create policy "notification_prefs_self_read" on notification_preferences
  for select using (user_id = auth.uid());
create policy "notification_prefs_self_insert" on notification_preferences
  for insert with check (user_id = auth.uid());
create policy "notification_prefs_self_update" on notification_preferences
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
-- No DELETE policy: prefs are deactivated, not deleted.
-- No admin policy in v1: admins don't see other users' notification prefs (PII-adjacent).
```

**Rules for this table:**
- **Locale and timezone are NOT in this table.** They live on `profiles.locale` and `profiles.timezone` (see `profiles` above) and are not part of `notification_preferences`. The two tables are joined on `user_id` when the email-renderer needs both.
- **`transactional_opt_in` is locked.** It defaults to `true` and the user cannot set it to `false`. Transactional emails (order confirmations, certificate issuance, payout failures, security alerts) are required for the platform to function and the user cannot opt out. The settings UI does not render this column as editable.
- **Email-marketing toggles are user-editable.** A user can flip `newsletter_opt_in`, `partner_updates_opt_in`, and `affiliate_updates_opt_in` freely. The "master switch" `marketing_opt_in` proposed in `account-settings.md` Open Questions is **NOT** in this v1 schema — see ADR-0007 for the deferred decision. The per-list toggles cover the "I don't want this" case in v1.
- **No preferences, no email.** A user with no row in this table is treated as "weekly digest, no marketing." The settings page auto-inserts a row on first save (with the defaults above).
- **Email-dispatch worker reads from this table** (`04-platform/emails/dispatch.ts`). The worker checks the relevant `*_opt_in` flag before sending any non-transactional email. Opt-outs are honored on the next dispatch cycle (no retroactive recall — emails already queued are sent).

---

## Partner & admin

### `partner_uploads` — submission workflow

```sql
create type upload_status as enum ('draft', 'submitted', 'in_review', 'returned', 'approved', 'rejected');

create table partner_uploads (
  id bigserial primary key,
  partner_id bigint not null references partners(id),
  product_id bigint references products(id), -- null until approved
  status upload_status not null default 'draft',
  draft_payload jsonb not null, -- entire draft state: title, desc, modules, lessons, files, pricing
  submitted_at timestamptz,
  reviewed_at timestamptz,
  reviewer_id uuid references auth.users(id),
  decision_notes text, -- visible to partner if returned/rejected
  quality_score jsonb, -- auto-checks: video_resolution, audio_levels, plagiarism, etc.
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index on partner_uploads (partner_id, status, created_at desc);
create index on partner_uploads (status) where status = 'submitted';
create index on partner_uploads (reviewer_id) where reviewer_id is not null;

alter table partner_uploads enable row level security;
create policy "partner_uploads_partner_read_own" on partner_uploads
  for select using (partner_id in (select id from partners where user_id = auth.uid()));
create policy "partner_uploads_partner_write_own" on partner_uploads
  for all using (partner_id in (select id from partners where user_id = auth.uid()));
create policy "partner_uploads_admin_all" on partner_uploads
  for all using (exists (select 1 from profiles where user_id = auth.uid() and role = 'admin'));
```

### `partner_onboarding_drafts` — wizard state for the partner application

```sql
create type partner_onboarding_step as enum (
  'welcome', 'profile', 'payout', 'tax', 'kyc', 'agreement', 'submit'
);

create table partner_onboarding_drafts (
  id bigserial primary key,
  user_id uuid not null unique references auth.users(id) on delete cascade,
  current_step partner_onboarding_step not null default 'welcome',
  -- Step payloads, written incrementally. Each step's payload is merged into this row on save.
  profile jsonb,            -- { display_name, bio, website_url, avatar_storage_path }
  payout jsonb,             -- { paypal_email } — NOT paypal_email_confirm, that is UI-only
  tax jsonb,                -- { country, tax_id, w9_storage_path }
  kyc jsonb,                -- { gov_id_front_storage_path, gov_id_back_storage_path } — null in v1 (deferred)
  agreement jsonb,          -- { tos_accepted, partner_agreement_accepted, accepted_at }
  submitted_at timestamptz, -- set on submit; null while drafting
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index on partner_onboarding_drafts (user_id) where submitted_at is null;
-- submitted drafts kept for 90 days for audit, then a janitor deletes them

alter table partner_onboarding_drafts enable row level security;
create policy "partner_drafts_self_all" on partner_onboarding_drafts
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
-- No admin read policy in v1: admins use the service role in the admin app.
```

**Rules for this table:**
- **One draft per user.** The unique on `user_id` is what enforces this. Re-onboarding after a rejection updates the same row (resets `submitted_at` to null) rather than creating a new one.
- **Per-step `jsonb` columns** (vs one big `payload jsonb`) are chosen for clearer per-step validation in code (Zod schemas keyed on step name). Trade-off: harder to add a new step (needs a migration) vs easier to query "all drafts at step 3" (each step column can be NULL-queried).
- **The `kyc` column is null in v1.** KYC is deferred to v2 (recommended in `partner-onboarding.md` Open Questions §1). The enum value `'kyc'` is kept so the schema doesn't need a v2 migration; the wizard simply skips the step.
- **Submitted drafts are retained for 90 days** for audit (admin can inspect what was submitted when), then a janitor cron (`04-platform/ci/scripts/cron/cleanup-onboarding-drafts.ts`) deletes them. The user's `partners` row is the long-lived artifact.
- **Submission is the only path to a `partners` row.** A successful submit calls an `submitApplication()` server action that creates a `partners` row (`status='pending'`) in the same transaction. Failures roll back the draft update.
- **Idempotency.** A double-submit (network retry) is handled by the unique on `user_id` plus an `INSERT ... ON CONFLICT DO NOTHING` pattern in the server action. Second call returns `{ ok: true, alreadySubmitted: true }`.

### `admin_audit_log` — append-only, polymorphic actor (admin OR partner OR system)

```sql
create table admin_audit_log (
  id bigserial primary key,
  -- Polymorphic actor: exactly one of (admin_id, partner_id, system_source) is set.
  -- For v1 the typical cases are admin_id (admin UI actions) and partner_id
  -- (partner-initiated self-service actions like creating/revoking an api_token).
  -- `system_source` is a free-text identifier for cron / webhook handlers
  -- (e.g. 'cron:daily-payout-batch', 'webhook:stripe').
  admin_id uuid references auth.users(id),
  partner_id uuid references auth.users(id),
  system_source text,
  action text not null, -- 'view_user', 'approve_product', 'reject_refund', 'create_api_token', 'gdpr_deletion_decision', etc.
  target_table text,
  target_id text,
  before jsonb,
  after jsonb,
  ip_address inet,
  at timestamptz not null default now(),
  -- The CHECK enforces "at least one actor, and they're distinct" without making the
  -- polymorphic pattern ambiguous in queries.
  check (
    (admin_id is not null)::int + (partner_id is not null)::int + (system_source is not null)::int = 1
  )
);

create index on admin_audit_log (admin_id, at desc) where admin_id is not null;
create index on admin_audit_log (partner_id, at desc) where partner_id is not null;
create index on admin_audit_log (system_source, at desc) where system_source is not null;
create index on admin_audit_log (target_table, target_id, at desc);
create index on admin_audit_log (action, at desc);

alter table admin_audit_log enable row level security;
-- Admin reads all. No UPDATE. No DELETE. Append-only.
create policy "admin_audit_log_admin_read" on admin_audit_log
  for select using (exists (select 1 from profiles where user_id = auth.uid() and role = 'admin'));
-- Partner reads ONLY their own actions (so the partner audit panel on /partner/settings works).
-- The policy excludes admin-actor rows by requiring partner_id = auth.uid(); admin rows fall through.
create policy "admin_audit_log_partner_read_own" on admin_audit_log
  for select using (partner_id = auth.uid());
-- No self INSERT policy: every write goes through a server action that uses
-- the service-role client (the table is append-only, the actor is server-side).
```

**Rules for this table — the polymorphic actor model:**
- **The table name is preserved as `admin_audit_log` for v1** even though it's really `audit_log` with a polymorphic actor. Renaming is a v2 housekeeping task; the existing references in 30+ specs would all need to be updated, and the migration cost isn't worth it for a name change.
- **Actor-identification convention** (the `action` string prefix):
  - `admin_actor:` → `admin_id` is set
  - `partner_actor:` → `partner_id` is set
  - `system:` → `system_source` is set
  - The prefix is the **app-layer convention**; the DB CHECK constraint enforces the structural invariant.
- **`action` strings are dot-namespaced** for queryability: `admin.approve_submission`, `partner.create_api_token`, `partner.revoke_api_token`, `admin.gdpr_deletion_decision`, `admin.suspend_user`, `admin.ban_user`, `admin.unban_user`, `admin.update_role`, `system.cron.daily_payout_batch`, `system.webhook.stripe.payment_succeeded`. The first segment is the actor class.
- **Retention is the same for all actors** (indefinite, with GDPR Article 17 redacting the user's PII from the `before`/`after` JSON, not deleting the row). See `admin-customer-detail.md` Open Questions §2 on the GDPR vs 7-year-ledger escalation; this ADR is the canonical source for the audit-log model, but the GDPR reconciliation is its own future ADR (flagged in the v2 work section of `0008-admin-area-rbac.md`).
- **`target_id` is `text`**, not `bigint`, because the actor pattern is polymorphic (some targets are `bigint` rows, some are UUIDs like a `subscription_id`). The application layer is responsible for the type safety of the lookup.
- **The system_source column is free-form but structured** — `<category>:<name>`, e.g. `cron:daily-payout-batch`, `webhook:stripe`, `webhook:paypal`, `webhook:bunny`, `worker:email-dispatch`. New system actors are added by typing the new source string; no enum or migration needed.
- **No UPDATE / DELETE policies.** The table is append-only forever. Corrections are new rows with an `after` field that points to the corrected state and a `parent_audit_log_id` (see v2 work below) — or, more commonly, the `before`/`after` JSON of a single row tells the whole story.

### `processed_webhooks` — idempotency for Stripe/PayPal

```sql
create table processed_webhooks (
  id bigserial primary key,
  source text not null check (source in ('stripe', 'paypal', 'bunny')),
  event_id text not null,
  event_type text not null,
  payload jsonb not null,
  processed_at timestamptz not null default now(),
  unique (source, event_id)
);

create index on processed_webhooks (source, processed_at desc);

alter table processed_webhooks enable row level security;
-- Admin only.
```

### `reports` — user-submitted content reports (admin moderation queue)

```sql
create type report_kind as enum ('product', 'review');
create type report_reason as enum (
  'ip_violation', 'low_quality', 'misleading_description', 'wrong_category',
  'spam', 'abuse', 'fake', 'other'
);
create type report_status as enum ('open', 'investigating', 'resolved', 'dismissed');

create table reports (
  id bigserial primary key,
  kind report_kind not null,
  reason report_reason not null,
  target_table text not null,         -- 'products' or 'reviews' (denormalized for indexing)
  target_id bigint not null,          -- id into products or reviews
  reporter_user_id uuid references auth.users(id) on delete set null,
  body text,                          -- reporter's free-text explanation
  status report_status not null default 'open',
  resolved_by uuid references auth.users(id),
  resolved_at timestamptz,
  resolution_notes text,              -- admin's internal note
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index on reports (status, created_at asc) where status in ('open', 'investigating');
create index on reports (kind, status);
create index on reports (reporter_user_id);
create index on reports (target_table, target_id);

alter table reports enable row level security;

-- Admin sees and writes all.
create policy "reports_admin_all" on reports
  for all using (exists (select 1 from profiles where user_id = auth.uid() and role = 'admin'));
-- Authed reporter can insert (any logged-in user can file a report).
create policy "reports_self_insert" on reports
  for insert with check (reporter_user_id = auth.uid());
-- No self-read policy: a reporter does NOT see their report status in v1.
-- (Add a self-read policy in v2 if support asks.)
```

**Rules for this table:**
- **`kind` is `('product', 'review')` in v1**, not the broader `('product', 'review', 'affiliate', 'partner')` set the original prompt proposed. Per the `admin-reports.md` Open Questions §1, the v1 scope is product + review (the two content kinds users encounter in the catalog). Affiliate and partner reports come in v2 — the `target_table` column is open to extending the enum when those arrive.
- **`target_table` + `target_id` is polymorphic.** Postgres doesn't enforce FK across tables for this pattern; we trust the server action to validate that the target exists and is of the right `kind`. The admin UI re-validates on view.
- **No `reporter_user_id` for anonymous reports in v1.** The column is nullable for forward-compat (v2 may allow anon reports with rate-limiting + a CAPTCHA), but v1 only accepts authed reporters (the `with check` clause enforces `reporter_user_id = auth.uid()`).
- **Resolutions are an admin status flip, not a self-update.** The reporter can't withdraw a report. The admin marks it `resolved` or `dismissed` and writes an `admin_audit_log` row explaining why.
- **The "open" + "investigating" partial index** drives the admin queue: every active report is one row in the index, queryable in O(active_count). The partial index is the hot path.
- **72h SLA** is enforced by a soft badge on the admin UI (not a hard trigger; the report is just stale if missed). See `admin-reports.md` Security / Performance for the SLA commitment.

### `platform_settings` — global platform config (admin-only, with explicit public_read opt-in)

```sql
create table platform_settings (
  key text primary key,
  value jsonb not null,
  description text,            -- human-readable, rendered in the admin UI
  public_read boolean not null default false,  -- true ONLY for keys that must be visible to the public (e.g. 'dmca_agent')
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  requires_confirm boolean not null default false  -- true for destructive settings (e.g. 'payouts_enabled', 'maintenance_mode')
);

create index on platform_settings (key);
create index on platform_settings (public_read) where public_read = true;

alter table platform_settings enable row level security;

-- Admin-only read of ALL keys (including public_read=false ones).
create policy "platform_settings_admin_read" on platform_settings
  for select using (exists (select 1 from profiles where user_id = auth.uid() and role = 'admin'));
-- Admin-only write of all keys.
create policy "platform_settings_admin_write" on platform_settings
  for all using (exists (select 1 from profiles where user_id = auth.uid() and role = 'admin'));
-- Public read is opt-in via the public_read column. A row with public_read=true is
-- readable by anyone (anon or authed) — typically the DMCA agent contact info,
-- support email, legal email, etc.
create policy "platform_settings_public_read" on platform_settings
  for select using (public_read = true);
-- No DELETE policy: settings are deactivated by setting value = null or by renaming the key, not by deletion.
```

**Rules for this table:**
- **Default is admin-only.** The `public_read` flag is opt-in per key. Out of the box, every setting is admin-only. The only keys that ship with `public_read=true` are the ones the public legally needs (DMCA designated agent, support email, legal entity name).
- **Secrets are not in this table.** API keys, signing secrets, database URLs, etc. are in Doppler / env, not the DB. The server action that writes to this table rejects any save whose `key` matches the secret-keys allowlist in `00-foundations/auth/secret-keys.ts`. The page UI also never renders an input for secret keys.
- **`requires_confirm = true`** keys trigger a typed-confirmation modal in the admin UI (e.g. "type DISABLE to disable payouts"). The pattern is the same as the manual-payout confirmation in `admin-payouts.md`.
- **No DELETE.** A typo in a key name is fixed by a follow-up migration, not by a row delete. The history of "what was the value 6 months ago" is not preserved here (we'd need an `admin_audit_log` mirror for that), but the current value is.
- **Settings that need change-audit** (e.g. fee percentages, payout thresholds) are better stored elsewhere with full audit (e.g. as a column on `admin_audit_log` rather than here). `platform_settings` is for "config" that changes rarely and whose history doesn't need replaying.
- **The same table serves `/admin/settings`, `dmca.md`, and the public transparency page** — the dmca agent's contact info lives here with `public_read=true`. This is the v1 "unified platform settings" decision; per the dmca spec OQ §2, this table is canonical for both the admin's settings page and the DMCA page's public rendering.

### `api_tokens` — partner API tokens (HMAC-pepper hashed at rest, scoped, revocable)

```sql
create type api_token_scope as enum ('read_sales', 'read_payouts', 'read_products');
create type api_token_status as enum ('active', 'revoked', 'expired');

create table api_tokens (
  id bigserial primary key,
  partner_id bigint not null references partners(id) on delete cascade,
  name text not null,                                        -- human label, e.g. "Zapier integration"
  token_hash text not null unique,                           -- hmac_sha256(pepper, plaintext_token); pepper is in env
  scopes api_token_scope[] not null default '{}',           -- array of scopes
  status api_token_status not null default 'active',
  created_at timestamptz not null default now(),
  expires_at timestamptz,                                    -- null = never expires
  last_used_at timestamptz,
  last_used_at_persisted_at timestamptz,                     -- debounce: don't write last_used_at on every call
  last_used_ip inet,                                         -- raw for partner (small, trusted cohort); masked in UI
  revoked_at timestamptz,
  revoked_reason text,
  created_ip inet,
  usage_count int not null default 0,
  usage_count_reset_at timestamptz not null default now()
);

create index on api_tokens (partner_id, status, created_at desc);
create index on api_tokens (partner_id) where status = 'active';
create unique index on api_tokens (token_hash);

alter table api_tokens enable row level security;

-- Partner can read their own tokens (name, scopes, status, last_used, expires_at — NEVER the hash).
-- The hash is excluded by a column-level grant on the table.
create policy "api_tokens_partner_read_own" on api_tokens
  for select using (partner_id in (select id from partners where user_id = auth.uid()));
-- Partner can create their own tokens (insert). Note: this is one of the few tables where
-- the partner has INSERT rights — the server action still validates the partner_id match.
create policy "api_tokens_partner_insert_own" on api_tokens
  for insert with check (partner_id in (select id from partners where user_id = auth.uid()));
-- Partner can revoke their own tokens (update status, revoked_at, revoked_reason).
-- They cannot change the partner_id, token_hash, or scopes after creation.
create policy "api_tokens_partner_revoke_own" on api_tokens
  for update using (partner_id in (select id from partners where user_id = auth.uid()))
  with check (partner_id in (select id from partners where user_id = auth.uid()));
-- Admin sees all.
create policy "api_tokens_admin_all" on api_tokens
  for all using (exists (select 1 from profiles where user_id = auth.uid() and role = 'admin'));
-- Column-level grant: revoke SELECT on token_hash from non-service roles.
-- (Implemented as a separate REVOKE statement in the same migration.)
```

**Rules for this table — the "no plaintext at rest" contract:**
- **Hash function: HMAC-SHA256 with an env pepper** (`00-foundations/security/api-token-pepper.ts` reads `UTHENA_API_TOKEN_PEPPER` from env). The DB stores only the HMAC; the pepper is in Doppler. A DB leak gives hashes only; brute-forcing requires the env. Trade-off: rotating the pepper is a breaking event for all tokens (we'd need a mass re-issue, or a re-hash-on-first-use flow). v1 has few enough partners that mass re-issue is acceptable if we ever need to rotate. This is the `partner-settings-api.md` Open Questions §"Token hashing approach" Option B.
- **Plaintext token is shown exactly once** at creation (in the API response: `{ "token": "uth_live_...", "id": 42 }`). After that, the server only stores `token_hash`. There is no "reveal plaintext" endpoint.
- **`token_hash` is unique** so the API auth middleware (`02-features/partner/api-auth.ts`) can look up by hash directly: `select id, partner_id, scopes from api_tokens where token_hash = hmac_sha256($pepper, $1) and status = 'active' and (expires_at is null or expires_at > now())`. The lookup is O(1) thanks to the unique index.
- **Scopes are a typed `api_token_scope[]` enum array**, not free-form text. The set is small (3 values in v1) and the API auth check is a single `scopes @> ARRAY['read_sales'::api_token_scope]` containment query. Adding a new scope is an `ALTER TYPE ... ADD VALUE` migration.
- **The status enum is a triple** — `active` / `revoked` / `expired` — so the partner's UI can render the right copy ("Revoke", "Expired on YYYY-MM-DD") without computing it from `revoked_at` and `expires_at` in app code. A cron (`04-platform/ci/scripts/cron/expire-api-tokens.ts`) flips `active` → `expired` daily.
- **Revocation is irreversible in v1.** Setting `status='revoked'` is the only state. There is no "unrevoke" — if a partner wants the token back, they create a new one. This is intentional: a leaked token is a security incident and we want the re-issue to be a deliberate action, not a "flip the bit" mistake.
- **`last_used_ip` is raw for v1** (the partner is a small, trusted cohort; we need it for abuse review; the UI masks the rendered IP). v2: hash if we get a privacy complaint. `last_used_at_persisted_at` is the debounce: the API auth middleware updates `last_used_at` only if it's been more than 5 minutes since the last write, to avoid hot-row contention.
- **`usage_count` + `usage_count_reset_at`** power the "X calls in the last 30 days" widget on `/partner/settings/api`. Reset to `now()` when the partner clicks "Reset counter" (a minor action; audit-logged).
- **Column-level GRANT** to strip `token_hash` from non-service-role SELECTs. The hash is needed by the server (API auth lookup), so the server uses the service-role client for the hash lookup. The partner's own session never sees the hash column.
- **Max 10 active tokens per partner** is enforced at the server action layer (not in the DB). The cap is in `00-foundations/auth/api-token-limits.ts`; if the cap changes, it's a one-line edit, not a migration.

### `dmca_takedowns` — DMCA notice log (admin-only, 6 required elements per §512(c)(3))

```sql
create type dmca_takedown_status as enum (
  'received', 'in_review', 'removed', 'restored', 'counter_noticed', 'dismissed'
);

create table dmca_takedowns (
  id bigserial primary key,
  product_id bigint not null references products(id) on delete restrict,
  notice_date timestamptz not null default now(),            -- when the notice was received
  notice_body jsonb not null,                                -- the 6 required elements per 17 USC §512(c)(3)
  removed_at timestamptz,                                    -- when the product was taken down
  restored_at timestamptz,                                   -- when the product was restored (14d after counter, absent lawsuit)
  counter_notice_at timestamptz,                             -- when the partner filed a counter-notice
  counter_notice_deadline timestamptz,                       -- notice_date + 14 days (conservative bound; statute uses business days 10-14)
  status dmca_takedown_status not null default 'received',
  resolution_notes text,                                     -- admin-only; never shown publicly
  resolved_by uuid references auth.users(id),                -- admin who closed it
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index on dmca_takedowns (status);
create index on dmca_takedowns (product_id);
create index on dmca_takedowns (notice_date desc) where notice_date > now() - interval '90 days';
create index on dmca_takedowns (counter_notice_deadline) where status = 'counter_noticed';

alter table dmca_takedowns enable row level security;

-- Admin only. No UPDATE/DELETE policy: rows are append-only for compliance.
-- (A takedown that's later reversed gets a new row with status='restored' or 'dismissed',
-- not an UPDATE on the original.)
create policy "dmca_takedowns_admin_all" on dmca_takedowns
  for all using (exists (select 1 from profiles where user_id = auth.uid() and role = 'admin'));
```

**Rules for this table — the §512(c)(3) compliance contract:**
- **The 6 required elements** (per 17 USC §512(c)(3)) are stored in `notice_body` as a jsonb with these keys:
  1. `signature` — physical or electronic signature of the copyright holder
  2. `claimed_work` — identification of the copyrighted work claimed to have been infringed
  3. `infringing_material` — identification of the infringing material and its location on our site
  4. `contact_info` — address, phone, email of the complaining party
  5. `good_faith_statement` — statement that the use is unauthorized
  6. `accuracy_and_authority_statement` — statement that the info is accurate and the complaining party is authorized to act
- **Missing-element detection** is a server action (`02-features/admin/validateDmcaNotice()`) called BEFORE the row is inserted. The action returns a list of missing elements; the admin UI displays them. An incomplete notice is not stored (this is to keep the audit trail clean: a stored notice is a complete notice).
- **The `status` enum has 6 values** to cover the full lifecycle: `received` (notice came in, not yet reviewed) → `in_review` (admin is actively investigating) → `removed` (product taken down) → `counter_noticed` (partner filed a counter-notice) → `restored` (14d passed without lawsuit; product back) OR `dismissed` (notice rejected as facially invalid, no removal).
- **The 14-day counter-notice window** is enforced by a daily cron (`04-platform/ci/scripts/cron/dmca-counter-window.ts`) that moves `counter_noticed` rows to `restored` when `counter_notice_deadline` has elapsed without a lawsuit being filed. The `counter_notice_deadline` column is the SQL-truth source for the deadline; the cron reads it, not the `notice_date + interval` computed in code.
- **`delete restrict` on `product_id`** — we never cascade-delete a product that has a takedown history. The takedown log is forever; the product can be un-published but the row stays.
- **The public transparency page** (a future v2 follow-up) reads from this table via a server action that projects only `(notice_date, product.title)` — never `notice_body`, `resolution_notes`, or `resolved_by`. The data is in the row, but the public read code path is a strict allowlist.
- **No partner RLS read policy.** The partner sees their own takedowns through the partner dashboard, which uses a server action with explicit `product.partner_id = auth.uid()` filtering. This keeps the takedown log (which may contain complainant PII) off-limits to direct DB queries.

---

## Affiliate

### `affiliates`

```sql
create type affiliate_status as enum ('pending', 'approved', 'suspended');

create table affiliates (
  id bigserial primary key,
  user_id uuid not null unique references auth.users(id) on delete cascade,
  handle text not null unique, -- used in uthena.com/[handle]
  bio text,
  status affiliate_status not null default 'pending',
  payout_method jsonb,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table affiliates enable row level security;
create policy "affiliates_self_read" on affiliates
  for select using (user_id = auth.uid());
create policy "affiliates_public_read_approved" on affiliates
  for select using (status = 'approved');
create policy "affiliates_self_update" on affiliates
  for update using (user_id = auth.uid());
create policy "affiliates_admin_all" on affiliates
  for all using (exists (select 1 from profiles where user_id = auth.uid() and role = 'admin'));
```

### `affiliate_links`

```sql
create table affiliate_links (
  id bigserial primary key,
  affiliate_id bigint not null references affiliates(id) on delete cascade,
  product_id bigint references products(id) on delete cascade, -- null = global link
  code text not null, -- short code used in URL
  target_path text not null, -- '/products/ai-personal-branding' or '/browse'
  utm_source text,
  utm_medium text,
  utm_campaign text,
  clicks_count int default 0,
  conversions_count int default 0,
  created_at timestamptz not null default now(),
  unique (affiliate_id, code)
);

create index on affiliate_links (code);
create index on affiliate_links (affiliate_id);

alter table affiliate_links enable row level security;
-- Affiliate self + admin.
```

### `affiliate_clicks` — privacy-respecting analytics

```sql
create table affiliate_clicks (
  id bigserial primary key,
  link_id bigint not null references affiliate_links(id) on delete cascade,
  ip_hash text not null, -- SHA-256(ip + daily_salt), not raw IP
  ua_hash text not null,  -- SHA-256(user_agent + daily_salt)
  referer text,
  at timestamptz not null default now()
);

create index on affiliate_clicks (link_id, at desc);
create index on affiliate_clicks (at) where at > now() - interval '90 days';

alter table affiliate_clicks enable row level security;
-- Affiliate self (aggregated) + admin.
```

### `affiliate_commissions`

```sql
create type commission_status as enum ('pending', 'locked', 'available', 'paid', 'reversed');

create table affiliate_commissions (
  id bigserial primary key,
  affiliate_id bigint not null references affiliates(id),
  link_id bigint references affiliate_links(id),
  order_id bigint not null references orders(id),
  order_item_id bigint not null references order_items(id),
  commission_cents bigint not null,
  currency text not null default 'USD',
  status commission_status not null default 'pending',
  locked_until timestamptz not null, -- refund window
  available_at timestamptz,
  created_at timestamptz not null default now(),
  unique (order_item_id) -- one commission per order item
);

create index on affiliate_commissions (affiliate_id, status, created_at desc);
create index on affiliate_commissions (status) where status = 'available';

alter table affiliate_commissions enable row level security;
-- Affiliate self + admin.
```

### `affiliate_payouts`

```sql
create table affiliate_payouts (
  id bigserial primary key,
  affiliate_id bigint not null references affiliates(id),
  amount_cents bigint not null,
  currency text not null default 'USD',
  paypal_batch_id text,
  status text not null check (status in ('pending', 'sent', 'paid', 'failed')) default 'pending',
  commission_count int not null,
  period_start timestamptz not null,
  period_end timestamptz not null,
  created_at timestamptz not null default now()
);

alter table affiliate_payouts enable row level security;
-- Affiliate self + admin.
```

### `affiliate_onboarding_drafts` — wizard state for the affiliate application

```sql
create type affiliate_onboarding_step as enum (
  'welcome', 'handle_bio', 'payout', 'promo_methods', 'agreement', 'submit'
);

create table affiliate_onboarding_drafts (
  id bigserial primary key,
  user_id uuid not null unique references auth.users(id) on delete cascade,
  current_step affiliate_onboarding_step not null default 'welcome',
  handle_bio jsonb,         -- { handle, bio, avatar_storage_path }
  payout jsonb,             -- { paypal_email }
  promo_methods jsonb,      -- { methods: ['twitter','youtube',...], other_text? }
  agreement jsonb,          -- { affiliate_terms_accepted, tos_accepted, accepted_at }
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index on affiliate_onboarding_drafts (user_id) where submitted_at is null;
-- submitted drafts kept for 90 days for audit, then janitor deletes

alter table affiliate_onboarding_drafts enable row level security;
create policy "affiliate_drafts_self_all" on affiliate_onboarding_drafts
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
```

**Rules for this table** mirror the partner variant above. Differences:
- **One fewer step.** 6 steps (no `tax` / no `kyc` — affiliates are 1099 contractors but we don't collect W-9 in v1; we collect it in v2 at the first payout over the reporting threshold).
- **The `handle_bio` step** is the first user-visible step. Submitting the handle also creates a row in `handle_reservations` (see below). If the handle is taken, the step is rejected before the wizard advances.

### `handle_reservations` — race-safe handle uniqueness during affiliate onboarding

```sql
create table handle_reservations (
  handle text primary key,                            -- the reserved handle, lowercased
  user_id uuid not null references auth.users(id) on delete cascade,
  draft_id bigint not null references affiliate_onboarding_drafts(id) on delete cascade,
  created_at timestamptz not null default now()
);

create index on handle_reservations (user_id);
create index on handle_reservations (created_at);    -- for janitor: drop reservations older than 7 days

alter table handle_reservations enable row level security;
create policy "handle_reservations_self_all" on handle_reservations
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
-- Race-safety: the primary key on (handle) is the arbiter;
-- INSERT ... ON CONFLICT DO NOTHING is the only allowed insert pattern.
```

**Rules for this table — the race-safety contract:**
- **Why a separate table?** `affiliates.handle` is the long-lived artifact (a row there means "this handle is permanently taken by an approved affiliate"). The reservation table is the soft-hold ("this handle is in use by a wizard that may or may not finish"). If we put reservations on `affiliates` directly, an abandoned wizard would block the handle for the lifetime of the abandoned row.
- **Lowercased on insert.** The wizard UI normalizes handles to lowercase ASCII before calling the server action. The unique index is therefore case-insensitive in practice (no `handle = 'Alice'` AND `handle = 'alice'` collisions).
- **7-day TTL.** A janitor cron (`04-platform/ci/scripts/cron/cleanup-handle-reservations.ts`) drops reservations older than 7 days. The user has a week to finish the wizard before the handle is released.
- **On submit success**, the reservation is transferred (in a transaction: insert into `affiliates`, delete the reservation). The transaction also creates a unique index check on `affiliates.handle` to ensure no double-allocation.
- **The reserved-handle list** (`admin`, `api`, `app`, `auth`, `billing`, `browse`, `cdn`, `collections`, `dashboard`, `dmca`, `help`, `login`, `logout`, `products`, `partner`, `affiliate`, `static`, `support`, `verify`, `www`, …) lives in `00-foundations/auth/reserved-handles.ts` — checked at the server action layer, not the DB. The DB just enforces uniqueness.
- **No public read.** Only the owner and admin can see reservations.

---

## Schema extensions for v1 (additive ALTERs to existing tables)

These are columns, enums, and indexes added to tables that already exist in the v1 schema. They are documented here so the spec body is the single source of truth, even though the migration lands as one or more `ALTER TABLE` files in `04-platform/migrations/`.

### `profiles` — ban / suspend state machine + `super_admin` role

```sql
-- Add the new role value. The role check constraint is a no-op for existing rows.
alter table profiles
  add column status text not null default 'active'
    check (status in ('active', 'suspended', 'banned')),
  add column suspended_at timestamptz,
  add column suspended_until timestamptz,        -- null = indefinite suspend
  add column suspended_reason text,
  add column banned_at timestamptz,
  add column banned_reason text,
  add column banned_by uuid references auth.users(id),
  add column warnings_count int not null default 0;  -- denormalized counter for the "warn" action

-- Extend the role enum to include super_admin. Postgres requires ALTER TYPE for enum changes.
alter type ... -- (the role is text, not a real enum — see below)
```

**Note on `role`:** the existing `profiles.role` is a `text` with a CHECK constraint (not a Postgres enum), which is why it was easy to extend. The new `super_admin` value is added by `alter table profiles drop constraint profiles_role_check, add constraint profiles_role_check check (role in ('customer', 'partner', 'affiliate', 'admin', 'super_admin'))`.

**State machine (per ADR-0008 and `admin-customer-detail.md`):**

```
active (default)
  ├── suspended (admin action; reversible; optional until-date; reason logged)
  │     └── active (admin lift; reason logged)
  └── banned (admin action; IRREVERSIBLE in v1 without manual DB intervention by the platform owner)
        └── (no recovery path in v1; banned user cannot re-register with same email)
```

**Rules:**
- **The status check covers all three user types** (customer, partner, affiliate). The same `profiles.status` is the source of truth; the partner/affiliate-specific status fields (e.g. `partners.status` for onboarding flow) are separate.
- **Banned users cannot log in.** The guard is in the auth flow (a banned user's `profiles.status='banned'` is checked at session creation). RLS on `auth.users` is not possible (Supabase owns it), so the auth layer is the enforcement point.
- **Banned users can still have their financial data preserved** (required for 7-year retention; the GDPR-deletion workflow redacts PII but keeps the row shape for the audit trail). See ADR-0008 §"v2 work" for the GDPR-vs-7-year-ledger escalation candidate.
- **`warnings_count` is the denormalized counter** for the "warn reporter" admin action. A nightly cron re-derives it from `admin_audit_log` (where `action='report_warned' and target_id = user_id`) as a backstop; the denormalized read is the hot path for the customers list page.

### `partners` — KYC + tax + partner.status extensions

```sql
-- Extend partners.status to include 'banned'
alter table partners
  drop constraint partners_status_check,
  add constraint partners_status_check
    check (status in ('pending', 'approved', 'suspended', 'banned'));

-- KYC columns (collected in v1 by the partner settings page; reviewed by admin)
alter table partners
  add column kyc_reviewed_at timestamptz,
  add column kyc_reviewed_by uuid references auth.users(id),
  add column kyc_rejection_reason text,
  add column gov_id_front_storage_path text,   -- Bunny private bucket key
  add column gov_id_back_storage_path text;

-- Tax columns (encrypted at app layer, see partner-settings.md)
alter table partners
  add column tax_country text,
  add column tax_id_encrypted bytea,           -- AES-256-GCM ciphertext; key in env
  add column tax_form_storage_path text;       -- Bunny private bucket key for the W-9 / W-8BEN PDF
```

**Rules:**
- **KYC is collected in v1** (the partner uploads the gov ID from the partner settings page), but the dual-control "second admin must approve to view" flow is v2. In v1, a single admin can view a partner's gov ID; the view is logged to `admin_audit_log` with `action='partner.view_kyc'`.
- **Tax ID is encrypted at the app layer** with the same AES-256-GCM helper as `partners.payout_method` (see `00-foundations/security/encryption.ts`). The DB never sees plaintext.
- **`partners.status` mirrors the same 4-value state machine as `profiles.status`** (pending/approved/suspended/banned). A partner's onboarding status (pending/approved) and their moderation status (suspended/banned) are on the same enum to keep the query simple. A partner is `banned` if either `profiles.status='banned'` OR `partners.status='banned'`.
- **The KYC image storage path is admin-visible** (the admin reviews the image). The KYC image is **NOT** publicly visible — the partner's own profile shows only `kyc_status` and not the path. The `gov_id_*_storage_path` columns are scoped by RLS: partner can read their own (to render the existing image), admin can read all (to do the review).

### `affiliates` — ban status extension + KYC (deferred)

```sql
alter table affiliates
  drop constraint affiliates_status_check,
  add constraint affiliates_status_check
    check (status in ('pending', 'approved', 'suspended', 'banned'));
```

**Rules:**
- **No KYC on affiliates in v1.** Affiliates are 1099 contractors but we don't collect W-9 in v1; the first payout over the reporting threshold triggers the v2 KYC flow. The schema is forward-compat: `affiliates.kyc_status` is added in v2 (the column doesn't exist in v1).
- **`affiliates.status` mirrors the same 4-value state machine** as `profiles.status` and `partners.status`. The state machine and the ban/suspend semantics are uniform across all three user types.

### `reviews` — `flagged_*` columns (partner flag-for-review)

```sql
alter table reviews
  add column flagged_reason text,
  add column flagged_by_user_id uuid references auth.users(id),
  add column flagged_at timestamptz;
```

**Rules:**
- **The partner's "flag for admin review" action** sets these three columns. The admin reviews queue (`/admin/review` for submissions, `/admin/reports` for content reports) shows flagged reviews under a separate tab.
- **RLS:** a partner can flag a review on their own product (write to `flagged_*` columns), and admin can read/clear them. Add a new RLS policy:

```sql
create policy "reviews_partner_flag_own_product" on reviews
  for update using (
    exists (select 1 from products where id = reviews.product_id
            and partner_id in (select id from partners where user_id = auth.uid()))
  )
  with check (
    exists (select 1 from products where id = reviews.product_id
            and partner_id in (select id from partners where user_id = auth.uid()))
  );
-- The partner can ONLY update the flagged_* columns. The application layer is responsible
-- for the column allowlist; a DB trigger or CHECK function could enforce it, but v1
-- relies on the Zod schema in the server action.
```

### `affiliate_links` — `active`, `last_clicked_at`, `disabled_at`, `deleted_at`

```sql
alter table affiliate_links
  add column active boolean not null default true,           -- partner-side disable toggle
  add column last_clicked_at timestamptz,                   -- updated by the click-tracking endpoint
  add column disabled_at timestamptz,                       -- soft-disable (preserves attribution history)
  add column deleted_at timestamptz;                        -- soft-delete (trash bin with 7-day restore)
```

**Rules:**
- **Four booleans/timestamps that look redundant but aren't.** `active=false` = the partner disabled the link (toggle in the UI). `disabled_at` = admin disabled the link (via the admin's view). `deleted_at` = partner soft-deleted (trash; 7-day restore window per `affiliate-links.md` OQ §3). `last_clicked_at` is the click-tracking updated by the public click endpoint.
- **Click tracking updates `last_clicked_at` on every click** (no debounce in v1; the row is hot for active links but the index is on `(affiliate_id, last_clicked_at desc)` and writes are O(1)). If a single link becomes a hotspot at v2 scale, debounce in the click handler.
- **The partner's read of their own links** excludes `deleted_at is not null` rows by default; a `?show=deleted` filter surfaces them for the 7-day restore window. Implemented in the query, not in the policy (the partner owns the link, so they can read all their own rows; the UI just hides the deleted ones).

### `payout_ledger` — `paused_product_takedown` enum value

```sql
-- The existing ledger_status enum gains one new value.
-- (Implemented as ALTER TYPE ... ADD VALUE in a migration.)
alter type ledger_status add value 'paused_product_takedown';
```

**Rules:**
- **New status value for the partner's unpublish flow.** When a partner un-publishes a product, any pending payout_ledger entries for that product (status='pending' or 'available') are moved to `status='paused_product_takedown'`. The amounts are preserved (the sales were real); the entries are paused until either (a) the partner re-publishes (entries go back to 'available'), (b) admin manually releases them, or (c) 30 days pass and the entries are reversed (clawback if no republish). The 30-day auto-clawback is v2; v1 leaves the entries paused indefinitely.
- **No `super_admin` enforcement gate on the v2 clawback** — the v1 spec just marks them paused; the v2 cron adds the timeout.

### `product_sales_daily` — materialized view for partner sales dashboards

```sql
create materialized view product_sales_daily as
select
  p.id as product_id,
  p.partner_id,
  date_trunc('day', o.created_at)::date as sale_date,
  count(distinct oi.id) as units,
  sum(oi.unit_price_cents) as revenue_cents,
  sum(oi.partner_share_cents) as partner_share_cents,
  count(distinct r.id) filter (where r.id is not null) as refund_count,
  coalesce(sum(r.amount_cents) filter (where r.id is not null), 0) as refund_cents,
  -- country breakdown as a jsonb; null = no GeoIP
  jsonb_object_agg(
    coalesce(o.ip_country, 'Unknown'),
    count(*)
  ) filter (where o.id is not null) as country_breakdown
from products p
left join order_items oi on oi.product_id = p.id
left join orders o on o.id = oi.order_id and o.status in ('paid', 'partially_refunded', 'refunded')
left join refunds r on r.order_id = o.id
group by p.id, p.partner_id, date_trunc('day', o.created_at);

create unique index on product_sales_daily (product_id, sale_date desc);
create index on product_sales_daily (partner_id, sale_date desc);

-- The view is refreshed:
--   1. Nightly at 02:00 UTC (cron: 04-platform/ci/scripts/cron/refresh-product-sales-daily.ts)
--   2. After every order / refund write (trigger: see 02-features/partner/sales-aggregates.ts)
```

**Rules:**
- **This is a materialized VIEW, not a table.** It's the partner-courses-sales tab's hot path. The partner reads from the view, not from raw `order_items` (which is behind service-role per the privacy boundary in `partner-courses-sales.md` OQ).
- **GeoIP is stored on `orders.ip_country`** (nullable ISO-3166-1 alpha-2). The raw IP is retained for 90 days per the data retention rule, then dropped; the `ip_country` survives the drop. If the IP can't be resolved, the row is bucketed as `'Unknown'`.
- **The view is refreshed nightly and on write** (a trigger fires on `orders` and `refunds` insert/update to call `REFRESH MATERIALIZED VIEW CONCURRENTLY product_sales_daily`). The concurrent refresh is non-blocking; the view is briefly stale between the write and the next refresh, which is fine for a 24-hour-granular dashboard.
- **The view is RLS-inherited.** The partner sees only the rows where `partner_id = their own partner.id`; the application query adds the `where partner_id = $1` filter. The view itself has no RLS (it's a derived table, not a base table), so the application filter is the security boundary.

### RLS policy gaps surfaced by the round-2 specs (additive policies)

The following RLS policies are **not new tables** — they are new policies on existing tables. Listed here for the same "single source of truth" reason.

#### `categories_admin_all` (for `/admin/categories` CRUD)

```sql
create policy "categories_admin_all" on categories
  for all using (
    exists (select 1 from profiles where user_id = auth.uid() and role in ('admin', 'super_admin'))
  );
-- The existing "public read" pattern stays. The new policy is the admin write.
```

#### `reviews_partner_read_own_product` (for `/partner/courses/[id]` reviews tab)

```sql
create policy "reviews_partner_read_own_product" on reviews
  for select using (
    exists (
      select 1 from products p
      join partners pa on pa.id = p.partner_id
      where p.id = reviews.product_id and pa.user_id = auth.uid()
    )
  );
-- The partner can see all reviews (regardless of status) on their own product, so the
-- /partner/courses/[id] reviews tab can show "pending" reviews that are awaiting admin
-- approval, not just the public-facing "approved" reviews.
```

#### `affiliate_commissions_admin_all` (for `/admin/refunds` + `/admin/order-detail` reversal lookups)

```sql
create policy "affiliate_commissions_admin_all" on affiliate_commissions
  for all using (
    exists (select 1 from profiles where user_id = auth.uid() and role in ('admin', 'super_admin'))
  );
-- The partner and affiliate already have their own policies (in the original spec).
-- The admin policy is the missing piece; /admin/refunds and /admin/order-detail both
-- need to read commission rows to compute "if we refund this order, what commission
-- gets reversed."
```

#### `product_modules`, `product_lessons`, `product_pricing` — explicit RLS (was implicit)

The original data model said "Inherits from product" but didn't spell out the policies. The pattern is the same as `product_files`:

```sql
-- product_modules: public read via product, partner write own, admin all
create policy "product_modules_public_read_via_product" on product_modules
  for select using (
    exists (select 1 from products where id = product_modules.product_id and status = 'published')
  );
create policy "product_modules_partner_write_own" on product_modules
  for all using (
    exists (select 1 from products
            where id = product_modules.product_id
            and partner_id in (select id from partners where user_id = auth.uid()))
  );
create policy "product_modules_admin_all" on product_modules
  for all using (
    exists (select 1 from profiles where user_id = auth.uid() and role in ('admin', 'super_admin'))
  );

-- product_lessons: same pattern (the public read includes is_preview=true lessons on
-- published products even without a library_grant; the partner write covers the same)
create policy "product_lessons_public_read_via_product" on product_lessons
  for select using (
    exists (select 1 from product_modules m
            join products p on p.id = m.product_id
            where m.id = product_lessons.module_id and p.status = 'published')
  );
create policy "product_lessons_partner_write_own" on product_lessons
  for all using (
    exists (select 1 from product_modules m
            join products p on p.id = m.product_id
            where m.id = product_lessons.module_id
            and p.partner_id in (select id from partners where user_id = auth.uid()))
  );
create policy "product_lessons_admin_all" on product_lessons
  for all using (
    exists (select 1 from profiles where user_id = auth.uid() and role in ('admin', 'super_admin'))
  );

-- product_pricing: public read of active pricing on published products, partner write own, admin all
create policy "product_pricing_public_read_via_product" on product_pricing
  for select using (
    active = true and
    exists (select 1 from products where id = product_pricing.product_id and status = 'published')
  );
create policy "product_pricing_partner_write_own" on product_pricing
  for all using (
    exists (select 1 from products
            where id = product_pricing.product_id
            and partner_id in (select id from partners where user_id = auth.uid()))
  );
create policy "product_pricing_admin_all" on product_pricing
  for all using (
    exists (select 1 from profiles where user_id = auth.uid() and role in ('admin', 'super_admin'))
  );

-- product_assets: same pattern (sales materials — landing pages, email swipes, ad copy)
-- is public-readable so an unauthed visitor can preview the swipes via the partner's
-- mini-shop
create policy "product_assets_public_read_via_product" on product_assets
  for select using (
    exists (select 1 from products where id = product_assets.product_id and status = 'published')
  );
create policy "product_assets_partner_write_own" on product_assets
  for all using (
    exists (select 1 from products
            where id = product_assets.product_id
            and partner_id in (select id from partners where user_id = auth.uid()))
  );
create policy "product_assets_admin_all" on product_assets
  for all using (
    exists (select 1 from profiles where user_id = auth.uid() and role in ('admin', 'super_admin'))
  );
```

---

## New tables: admin notes (per-target, polymorphic-actor)

### `partner_admin_notes` — internal admin notes on a partner

```sql
create table partner_admin_notes (
  id bigserial primary key,
  partner_id bigint not null references partners(id) on delete cascade,
  author_id uuid not null references auth.users(id),     -- must be admin (CHECK below)
  body text not null check (length(body) between 1 and 4000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,                                -- soft delete (notes are not immutable)
  check (exists (select 1 from profiles where user_id = author_id and role in ('admin', 'super_admin')))
);

create index on partner_admin_notes (partner_id, created_at desc) where deleted_at is null;

alter table partner_admin_notes enable row level security;

create policy "partner_admin_notes_admin_all" on partner_admin_notes
  for all using (
    exists (select 1 from profiles where user_id = auth.uid() and role in ('admin', 'super_admin'))
  );
-- No partner read. No public read. Admin-only.
```

**Rules:**
- **Notes are NOT immutable.** The author can edit for 24h (after that, the edit window closes; the note is then read-only). Soft-delete via `deleted_at` rather than hard delete. The audit trail is on `admin_audit_log` (`action='partner.note_edit'`, `before`/`after`); the note table is the readable form.
- **Per `admin-partner-detail.md` Open Questions §3:** notes are preferred over reusing `admin_audit_log` because notes need edit-by-author and admin_audit_log is append-only.

### `affiliate_admin_notes` — same shape, `affiliate_id` instead of `partner_id`

```sql
create table affiliate_admin_notes (
  id bigserial primary key,
  affiliate_id bigint not null references affiliates(id) on delete cascade,
  author_id uuid not null references auth.users(id),
  body text not null check (length(body) between 1 and 4000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (exists (select 1 from profiles where user_id = author_id and role in ('admin', 'super_admin')))
);

create index on affiliate_admin_notes (affiliate_id, created_at desc) where deleted_at is null;

alter table affiliate_admin_notes enable row level security;
create policy "affiliate_admin_notes_admin_all" on affiliate_admin_notes
  for all using (
    exists (select 1 from profiles where user_id = auth.uid() and role in ('admin', 'super_admin'))
  );
```

### `customer_admin_notes` — same shape, `customer_id` (= `auth.users.id`) instead of `partner_id`

```sql
create table customer_admin_notes (
  id bigserial primary key,
  customer_id uuid not null references auth.users(id) on delete cascade,
  author_id uuid not null references auth.users(id),
  body text not null check (length(body) between 1 and 4000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (exists (select 1 from profiles where user_id = author_id and role in ('admin', 'super_admin')))
);

create index on customer_admin_notes (customer_id, created_at desc) where deleted_at is null;

alter table customer_admin_notes enable row level security;
create policy "customer_admin_notes_admin_all" on customer_admin_notes
  for all using (
    exists (select 1 from profiles where user_id = auth.uid() and role in ('admin', 'super_admin'))
  );
```

**Rules (apply to all three):**
- **Per `admin-customer-detail.md` Open Questions §3:** the spec author considered one unified `admin_notes` table with a polymorphic `(target_table, target_id)` FK. The per-target table is chosen instead, because (a) it preserves per-target RLS granularity (e.g. `affiliate_admin_notes_admin_all` is unambiguous about the actor's scope), and (b) the schemas are identical and migrations are additive. v2 may consolidate.
- **All three notes tables are admin-only.** The partner / affiliate / customer never sees their own notes (those are "internal" — the partner sees the partner_admin_notes-shaped admin's view of them, but not the notes about them).
- **Edit window of 24h** is enforced at the application layer (server action checks `created_at > now() - interval '24 hours'`). After 24h, edits are blocked; the note is read-only. A future migration could add a DB trigger to enforce the 24h window, but the application-layer check is enough for v1.

---

## New tables: risk + curation

### `risk_signals` — source data for the customer risk score

```sql
create type risk_signal_type as enum (
  'multiple_cards',          -- > 3 different cards in 1h
  'multiple_devices',        -- > 5 different devices in 24h
  'unusual_country',         -- login from a country not seen before for this user
  'high_velocity_refunds',   -- > 3 refunds in 7d
  'chargeback_filed',        -- a Stripe chargeback
  'manual_flag'              -- an admin marked this user for review
);

create table risk_signals (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  signal_type risk_signal_type not null,
  severity int not null check (severity between 1 and 5),
  source text,                  -- 'auto' for system-generated, 'admin:<user_id>' for manual
  metadata jsonb,               -- signal-specific context (e.g. { card_count: 5, window: '1h' })
  created_at timestamptz not null default now()
);

create index on risk_signals (user_id, created_at desc);
create index on risk_signals (signal_type, created_at desc);
create index on risk_signals (severity, created_at desc);

alter table risk_signals enable row level security;
create policy "risk_signals_admin_all" on risk_signals
  for all using (
    exists (select 1 from profiles where user_id = auth.uid() and role in ('admin', 'super_admin'))
  );
-- No public read. No user read. Admin-only.
```

**Rules:**
- **Risk score formula** (per `admin-customers.md` Open Questions §1):
  - Refund contribution: `min(40, refund_count * 8)`
  - Dispute contribution: `min(40, dispute_count * 20)`
  - Unusual-activity contribution: `min(20, sum of signal_severity)` from this table
  - Total: clamped to 0-100
- **The signals are written by background jobs** (`04-platform/ci/scripts/background-jobs/detect-risk-signals.ts`) that watch for the trigger events (new payment from a new card, new login from a new country, etc.). The jobs use the service-role client to insert.
- **ML-based risk scoring is v2.** v1 is a deterministic formula over the signals.

### `affiliate_curated_products` — affiliate's mini-shop curation

```sql
create table affiliate_curated_products (
  id bigserial primary key,
  affiliate_id bigint not null references affiliates(id) on delete cascade,
  product_id bigint not null references products(id) on delete cascade,
  is_featured boolean not null default false,
  why_i_picked_this text check (why_i_picked_this is null or char_length(why_i_picked_this) <= 280),
  note text check (note is null or char_length(note) <= 280),  -- alias used by affiliate-shop.md
  added_at timestamptz not null default now(),
  unique (affiliate_id, product_id),
  -- partial unique index: at most one featured product per affiliate (enforced at DB level)
  unique (affiliate_id) where is_featured = true
);

create index on affiliate_curated_products (affiliate_id, is_featured desc, added_at desc);
create index on affiliate_curated_products (product_id);

alter table affiliate_curated_products enable row level security;

-- Public read of the curation grid, but only for approved affiliates.
create policy "affiliate_curated_public_read" on affiliate_curated_products
  for select using (
    exists (select 1 from affiliates where id = affiliate_curated_products.affiliate_id and status = 'approved')
  );
-- Affiliate self read (in case the affiliate wants to see their own grid via /affiliate/shop edit mode)
create policy "affiliate_curated_self_read" on affiliate_curated_products
  for select using (
    affiliate_id in (select id from affiliates where user_id = auth.uid())
  );
-- Affiliate self write (add / remove / feature)
create policy "affiliate_curated_self_write" on affiliate_curated_products
  for all using (
    affiliate_id in (select id from affiliates where user_id = auth.uid())
  ) with check (
    affiliate_id in (select id from affiliates where user_id = auth.uid())
  );
-- Admin / super_admin all
create policy "affiliate_curated_admin_all" on affiliate_curated_products
  for all using (
    exists (select 1 from profiles where user_id = auth.uid() and role in ('admin', 'super_admin'))
  );
```

**Rules:**
- **Conflict resolution** (per `affiliate-shop.md` OQ §4): admin's force-feature takes precedence. The admin's action writes directly via `service_role`; the affiliate's next page load reflects the admin's choice. The affiliate can override by clicking "Set as featured" on a different product. Both actions are audit-logged.
- **The `why_i_picked_this` and `note` columns are aliases** (the two specs use different field names — `admin-affiliate-detail.md` calls it `why_i_picked_this`, `affiliate-shop.md` calls it `note`). v1 keeps both columns; v2 will pick one and migrate. The CHECK constraint covers both.
- **The partial unique index enforces "at most one featured" at the DB level.** The "set as featured" server action must unset the old featured product in the same transaction; otherwise the unique index rejects the new featured row.

### `handle_cool_off` — 30-day cool-off after admin force-handle-change

```sql
create table handle_cool_off (
  handle text primary key,                          -- the cool-off'd handle, lowercased
  original_affiliate_id bigint not null references affiliates(id) on delete cascade,
  forced_by_admin_id uuid not null references auth.users(id),
  forced_at timestamptz not null default now(),
  cool_off_until timestamptz not null               -- forced_at + 30 days
);

create index on handle_cool_off (cool_off_until);   -- for janitor

alter table handle_cool_off enable row level security;
create policy "handle_cool_off_admin_read" on handle_cool_off
  for select using (
    exists (select 1 from profiles where user_id = auth.uid() and role in ('admin', 'super_admin'))
  );
-- No public read. The janitor job uses service_role to clean expired rows.
```

**Rules:**
- **The `handle_reservations` table is for the in-flight wizard; `handle_cool_off` is for the post-recovery window.** They serve different purposes: a reservation says "this handle is held by an in-progress wizard" (TTL 7 days, user-initiated); a cool-off says "this handle is blocked for 30 days because we took it from an affiliate" (admin-initiated).
- **The 30-day cool-off** gives the original affiliate a chance to change their handle themselves, and prevents immediate re-registration by the squatter (if the squatter was using the original affiliate's identity, this is a security backstop).
- **Janitor** (`04-platform/ci/scripts/cron/cleanup-handle-cool-offs.ts`) drops rows where `cool_off_until < now()`. After the cool-off expires, the handle is free to be reserved/registered again by anyone (admin or affiliate).

---

## What we deliberately DON'T do in v1

- No event sourcing. We have `payout_ledger` (immutable) and `admin_audit_log` (append-only) for the two things that legally need it.
- No microservices. One Next.js app, one Postgres.
- No Kafka / Redis Streams. We use Supabase Realtime for in-app live updates and a Postgres-backed job queue for everything else.
- No comments / Q&A table. That's v2. (For now, support is via email.)
- No multi-currency. USD only in v1. The schema has `currency` columns to make adding multi-currency in v2 easier, but we don't act on it.
- No watermarking. That's v2. (The infra for it is non-trivial; the architecture doc §12 covers it.)
- No SOC 2. Not before year 2.
- No DPA flow. Standard contract, not self-serve.
- No "sub-admin" / "moderator" / scoped admin role. v1 has a single `admin` role (and a `super_admin` role for the platform owner only, with the same visibility — no scoped sub-roles). Sub-roles and least-privilege scoping are deferred to v2 (see ADR-0008).
- No dual-control (two-person rule) on admin actions in v1. Every action is single-admin + audit-logged. Dual-control for high-value actions (e.g. >$5K payouts) is deferred to v2 (see ADR-0008).
- No "master marketing opt-in" switch. `notification_preferences` has per-list opt-in toggles in v1; a single `marketing_opt_in` kill-switch is a v2 follow-up (see ADR-0007).
- No anonymous content reports in v1. `reports.reporter_user_id` is nullable for forward-compat, but v1 enforces authed reporters in the server action. Anon + CAPTCHA is a v2 follow-up.
- No anon cart in the DB. Anonymous carts live in a signed cookie (`cart_session`). The `cart_items` table is auth-only.
- No cart "quantity" in v1. One row per `(user, product, tier)`. Quantity ≥ 2 is a v2 follow-up.
- No KYC at partner signup in v1. `partner_onboarding_drafts.kyc` column exists for forward-compat; the wizard skips the step. Gov ID is collected at first payout over the threshold in v2.
- No affiliate reports in v1. `reports.kind` is `('product', 'review')` only. Reports against affiliates / partners come in v2 (the `target_table` column is open to extension; the enum doesn't need to change).
- No KYC on affiliates in v1. `affiliates.kyc_status` column doesn't exist; KYC collection for affiliates is v2 (triggered by the first payout over the reporting threshold).
- No auto-clawback of `paused_product_takedown` ledger entries. The 30-day timeout that flips `paused` → `clawback` is v2.
- No per-admin rate limits / quotas. v1 has the global action-class rate limits in ADR-0008; per-admin quotas (e.g. "admin A can approve max 20 submissions/day") are v2.
- No unified `admin_notes` table. v1 has three per-target tables (`partner_admin_notes`, `affiliate_admin_notes`, `customer_admin_notes`) with identical schemas. Consolidation is a v2 housekeeping task.
- No ML-based risk scoring. v1 uses a deterministic formula over `risk_signals`. ML is v2.
- No `auth.users.banned` column. v1 puts the ban flag on `profiles.status` and enforces the login block at the auth-flow layer. RLS on `auth.users` is not possible (Supabase owns it).

---

## When you add a table

1. Add it to this spec (the SQL block, RLS policies, indexes, and any "rules" or "notes" subsection).
2. Add the table to the **Table index** at the top of this file.
3. Add a migration in `04-platform/migrations/` with the next available number.
4. Add RLS in the same migration (not in a follow-up).
5. Add the corresponding type to `00-foundations/data/types.ts` (regenerate from schema; don't hand-write).
6. Add the corresponding Zod schema in `00-foundations/data/schemas.ts` (for any free-form `jsonb` columns).
7. Update the relevant page specs to reference the new table.
8. If the table is a non-trivial addition (new entity, new workflow, or a new feature in itself), write an ADR under `01-specs/decisions/` (or extend an existing one) explaining why the table is in v1. Don't bury new entities in a silent PR.
9. If the table has a "rules" or "notes" section, copy that text into a comment on the table in the migration (`COMMENT ON TABLE ... IS '...'`).

If you add a table without RLS, the PR is blocked. No exceptions.
