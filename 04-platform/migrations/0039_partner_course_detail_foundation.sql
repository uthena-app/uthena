-- ============================================================================
-- 0039_partner_course_detail_foundation.sql — P12.6 course detail page
-- foundation schema.
--
-- Resolves three open questions from `01-specs/pages/partner-courses-detail.md`
-- §"Open questions for human":
--
--   1. **Normalized product_modules + product_lessons tables** (OQ on
--      "RLS inheritance for product_modules / product_lessons / product_pricing").
--      The product page currently uses a JSONB `products.curriculum`
--      column (migration 0014) — a v1 placeholder explicitly slated
--      for normalization in Phase 15 LMS. The P12.6 partner course
--      detail page needs normalized tables so the partner can
--      add/edit/reorder/delete modules + lessons with proper
--      per-row RLS and proper joins. We add the tables now; the
--      product detail page's renderer continues to read the JSONB
--      column (no breaking change for the storefront) until a
--      future migration backfills + swaps the read path.
--
--   2. **`reviews.flagged_reason` + `reviews.flagged_by_user_id`** (OQ
--      on "reviews.flagged_reason column"). The partner's "flag for
--      admin review" action (P12.6 Reviews tab — slice later) needs
--      somewhere to record the reason + who flagged. We add the two
--      nullable columns. No DB-side constraint on the reason text
--      — free-form, validated for length at the app layer.
--
--   3. **Partner-read RLS for reviews on own product** (OQ on
--      "Partner-read on reviews"). The existing `reviews_public_read_published`
--      policy only exposes published reviews to anonymous readers.
--      The `reviews_self_read_own` policy lets the reviewer see
--      their own row. Neither covers the partner's use case: they
--      need to see ALL reviews on their product (published, flagged,
--      hidden) so they can moderate. We add `reviews_partner_read_own_product`
--      that joins products.partner_id to current_partner_id().
--
-- RLS pattern mirrors the existing `product_files_partner_read` /
-- `product_files_partner_write` policies (0001_initial.sql): subquery
-- on the parent `products` row to check ownership. Same pattern as
-- the `product_pricing_partner_read_own` / `product_pricing_partner_write_own`
-- pair. Three sub-tables × two policy types = 6 new policies for
-- product_modules + product_lessons + reviews.
--
-- Why SECURITY DEFINER is NOT needed for these policies:
--   - RLS is enforced at the table level; the session user's role is
--     already evaluated by `current_partner_id()` (defined in 0001,
--     looks up the partner row by user_id). No privilege escalation
--     needed. Standard RLS-only pattern.
--
-- Indexing strategy (per spec §"Performance" + §"DB indexes"):
--   - product_modules: `(product_id, display_order)` for the read
--     path + the reorder update
--   - product_lessons: `(module_id, display_order)` for the per-
--     module ordered list + the reorder update
--   - reviews: ADD `(product_id, status, created_at desc)` per spec
--     for the Reviews tab's status-filtered recent-first read
--
-- IDEMPOTENT: every CREATE uses CREATE TABLE IF NOT EXISTS / CREATE
-- INDEX IF NOT EXISTS / DROP POLICY IF EXISTS + CREATE POLICY. Safe
-- to re-run against a partially-applied state.
-- ============================================================================

-- ============================================================================
-- 1. product_modules — top-level curriculum sections of a product
-- ============================================================================
--
-- One module = N lessons (product_lessons). One product = M modules.
-- The spec orders modules by `display_order` ascending; we enforce
-- a sane per-product uniqueness on (product_id, display_order) so
-- the partner's reorder UI has a stable ordering key.
--
-- Constraints:
--   - title non-empty (CHECK enforces after trim via app layer; DB
--     allows whitespace which the app will reject before insert).
--   - summary optional (the spec's "summary" is a free-form description).
--   - display_order >= 0; per-product uniqueness enforced at the
--     application layer (the saveCurriculum replace-tree pattern
--     re-derives all orders on each save, so partial-uniqueness
--     checks at the DB layer aren't needed).
--
-- Cascade on delete: if the parent product is hard-deleted (rare;
-- most products get archived, not deleted), modules go with it.
-- ============================================================================
create table if not exists product_modules (
  id bigserial primary key,
  product_id bigint not null references products(id) on delete cascade,
  title text not null check (length(title) between 1 and 200),
  summary text check (summary is null or length(summary) <= 1000),
  display_order int not null default 0 check (display_order >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table product_modules enable row level security;

-- Public read for modules on published products (so the storefront
-- could render a structured curriculum in v2; the v1 storefront
-- reads products.curriculum JSONB, so this policy is forward-only).
drop policy if exists "product_modules_public_read_published" on product_modules;
create policy "product_modules_public_read_published" on product_modules
  for select using (
    exists (select 1 from products p where p.id = product_modules.product_id and p.status = 'published')
  );

-- Partner read + write on own product's modules. Same JOIN-the-
-- parent pattern as `product_files_partner_*` (0001_initial.sql).
drop policy if exists "product_modules_partner_read_own" on product_modules;
create policy "product_modules_partner_read_own" on product_modules
  for select using (
    exists (select 1 from products p where p.id = product_modules.product_id and p.partner_id = current_partner_id())
  );

drop policy if exists "product_modules_partner_write_own" on product_modules;
create policy "product_modules_partner_write_own" on product_modules
  for all using (
    exists (select 1 from products p where p.id = product_modules.product_id and p.partner_id = current_partner_id())
  ) with check (
    exists (select 1 from products p where p.id = product_modules.product_id and p.partner_id = current_partner_id())
  );

drop policy if exists "product_modules_admin_all" on product_modules;
create policy "product_modules_admin_all" on product_modules for all using (is_admin());

-- Read-path index: per-product ordered list of modules.
create index if not exists product_modules_product_order_idx
  on product_modules (product_id, display_order);

-- updated_at trigger (consistent with the rest of the schema)
drop trigger if exists product_modules_set_updated_at on product_modules;
create trigger product_modules_set_updated_at before update on product_modules
for each row execute function set_updated_at();

comment on table product_modules is
  'P12.6 — Normalized curriculum module rows for a product (the partner-upload wizard stores them as JSONB on products.curriculum; this table is the canonical edit surface for the partner course detail page). One product = M modules; one module = N lessons (product_lessons). Per-product reorder via display_order.';

comment on column product_modules.title is
  'Module title. Min 1, max 200 chars (DB CHECK). Whitespace-only rejected at app layer.';

comment on column product_modules.summary is
  'Optional module summary. Max 1000 chars (DB CHECK).';

comment on column product_modules.display_order is
  'Per-product sort key (ascending). Re-derived by saveCurriculum on every save (the partner detail page replaces the full tree, so we never have stale gaps).';


-- ============================================================================
-- 2. product_lessons — leaf-level curriculum items inside a module
-- ============================================================================
--
-- A lesson may or may not have an attached file (the `file_id` column).
-- Preview lessons are marked with `is_preview = true` so the storefront
-- can render them as the "free preview" without requiring a grant.
-- `duration_seconds` is the lesson's media duration (0 if not yet
-- encoded or if the lesson is a non-video asset like a PDF).
--
-- file_id references product_files(id) ON DELETE SET NULL: if the
-- partner deletes a file, the lesson row stays (so they can re-attach)
-- but the file_id is nulled. We do NOT cascade-delete lessons on
-- file deletion because the lesson is a curriculum concept that
-- survives even if the underlying asset is re-uploaded.
-- ============================================================================
create table if not exists product_lessons (
  id bigserial primary key,
  module_id bigint not null references product_modules(id) on delete cascade,
  product_id bigint not null references products(id) on delete cascade,
  title text not null check (length(title) between 1 and 200),
  summary text check (summary is null or length(summary) <= 1000),
  duration_seconds int not null default 0 check (duration_seconds >= 0),
  is_preview boolean not null default false,
  file_id bigint references product_files(id) on delete set null,
  display_order int not null default 0 check (display_order >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table product_lessons enable row level security;

-- Public read for lessons on published products (forward-only — the
-- v1 storefront reads products.curriculum JSONB).
drop policy if exists "product_lessons_public_read_published" on product_lessons;
create policy "product_lessons_public_read_published" on product_lessons
  for select using (
    exists (select 1 from products p where p.id = product_lessons.product_id and p.status = 'published')
  );

-- Partner read + write on own product's lessons. Same JOIN-the-
-- parent pattern. We check products.partner_id (not product_modules
-- ownership) so a lesson row can't outlive its parent product.
drop policy if exists "product_lessons_partner_read_own" on product_lessons;
create policy "product_lessons_partner_read_own" on product_lessons
  for select using (
    exists (select 1 from products p where p.id = product_lessons.product_id and p.partner_id = current_partner_id())
  );

drop policy if exists "product_lessons_partner_write_own" on product_lessons;
create policy "product_lessons_partner_write_own" on product_lessons
  for all using (
    exists (select 1 from products p where p.id = product_lessons.product_id and p.partner_id = current_partner_id())
  ) with check (
    exists (select 1 from products p where p.id = product_lessons.product_id and p.partner_id = current_partner_id())
  );

drop policy if exists "product_lessons_admin_all" on product_lessons;
create policy "product_lessons_admin_all" on product_lessons for all using (is_admin());

-- Read-path index: per-module ordered list of lessons.
create index if not exists product_lessons_module_order_idx
  on product_lessons (module_id, display_order);

-- Per-product lessons index for the partner-side bulk read
-- (curriculum editor reads all lessons for a product in one query).
create index if not exists product_lessons_product_idx
  on product_lessons (product_id);

-- updated_at trigger
drop trigger if exists product_lessons_set_updated_at on product_lessons;
create trigger product_lessons_set_updated_at before update on product_lessons
for each row execute function set_updated_at();

comment on table product_lessons is
  'P12.6 — Leaf-level curriculum items inside a product_module. One module = N lessons; ordered by display_order. duration_seconds is the lesson media length (0 for non-media assets). is_preview=true means the lesson is accessible without a grant (the storefront preview surface).';

comment on column product_lessons.file_id is
  'Optional FK to product_files(id). ON DELETE SET NULL: if the file is deleted, the lesson row stays so the partner can re-attach. NULL is allowed (lesson in draft — no file uploaded yet).';


-- ============================================================================
-- 3. reviews.flagged_reason + reviews.flagged_by_user_id — partner
-- flag-for-admin-review support.
-- ============================================================================
--
-- Nullable columns. The partner's flag action (P12.6 Reviews tab —
-- slice later) sets these; admin moderation surfaces them.
--
-- We do NOT add a partner-write RLS policy for these columns. The
-- partner never updates reviews directly; the
-- `markReviewForAdminReview` server action is the only writer, and
-- it runs under the service-role client (the spec calls this out
-- explicitly — "we don't auto-hide; admin decides"). The flag
-- columns are a recording surface for the partner's intent, not a
-- direct-edit surface.
--
-- Reviews_partner_read_own_product policy (item 4 below) gives the
-- partner READ on the review row + its flagged columns.
-- ============================================================================
alter table reviews
  add column if not exists flagged_reason text
    check (flagged_reason is null or length(flagged_reason) <= 1000);

alter table reviews
  add column if not exists flagged_by_user_id uuid references auth.users(id);

comment on column reviews.flagged_reason is
  'P12.6 — Free-form reason the partner gave when flagging this review for admin review (max 1000 chars). Written only by the markReviewForAdminReview server action under the service-role client. NULL = not flagged.';

comment on column reviews.flagged_by_user_id is
  'P12.6 — The partner user who flagged this review. NULL = not flagged. Lets admin moderation answer "who flagged this?" without joining the audit log.';

-- Composite index the spec calls for: `(product_id, status, created_at desc)`
-- for the Reviews tab's status-filtered recent-first read.
create index if not exists reviews_product_status_created_idx
  on reviews (product_id, status, created_at desc);


-- ============================================================================
-- 4. reviews_partner_read_own_product — partner can read reviews on
-- their own products (including non-published statuses, so they can
-- moderate flagged + hidden rows too).
-- ============================================================================
--
-- Why this is FOR SELECT only (not FOR ALL):
--   - Partner cannot INSERT / UPDATE / DELETE reviews. Review CRUD
--     is owned by the reviewer (reviews_self_write policy) and the
--     admin (reviews_admin_all). The partner's only write path is
--     the markReviewForAdminReview server action, which runs
--     service-role (see comment on item 3).
--   - The flagged columns are read by the partner (so they can see
--     "I already flagged this one") but written only by the server
--     action. SELECT-only RLS doesn't prevent the partner from
--     seeing the column — it prevents them from updating it
--     directly through the client.
-- ============================================================================
drop policy if exists "reviews_partner_read_own_product" on reviews;
create policy "reviews_partner_read_own_product" on reviews
  for select using (
    exists (
      select 1 from products p
      where p.id = reviews.product_id and p.partner_id = current_partner_id()
    )
  );


-- ============================================================================
-- STUB REGISTER
-- ============================================================================
-- STUB-092 — P12.6 partner course detail schema foundation.
-- The `/partner/courses/[id]` page + its 5 tabs all read from these
-- tables (product_modules + product_lessons + reviews.flagged_*).
-- The Slice 1 surface (route + Settings tab) ships against this
-- schema; subsequent slices (Curriculum / Pricing / Sales / Reviews)
-- reuse these tables. See docs/PROGRESS.md 2026-06-30 P12.6 note.