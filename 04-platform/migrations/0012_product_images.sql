-- ============================================================================
-- 0012_product_images.sql — Multi-image gallery for the product detail page.
-- The product page (P0.12) shows a 16:9 main image + up to 4 thumbnails.
-- The legacy `products.thumbnail_url` (single image) is kept as the
-- canonical cover for grids + product cards; `product_images` is the
-- gallery for the product detail page.
--
-- Why a separate table (and not a JSONB column on products)?
--   - Per-row RLS — same pattern as `product_files`. The product owner
--     can add/remove images, an admin can override, and the public
--     can only see images for published products.
--   - Indexable by (product_id, display_order) so the gallery query
--     is O(images_for_product) with no JSONB index cost.
--   - Future: Phase 12 partner portal can CRUD this directly without
--     touching the products row.
--   - Future: CDN pre-warm hooks can listen on INSERT to push to
--     Bunny's edge.
--
-- Why is_admin / current_partner_id in the policies (and not the
-- is_partner_of_product helper)?
--   - The product_files table uses the EXISTS subquery pattern for
--     partner write; we mirror it for symmetry. is_admin() and
--     current_partner_id() are already defined in 0001.
-- ============================================================================

create table if not exists product_images (
  id bigserial primary key,
  product_id bigint not null references products(id) on delete cascade,
  url text not null,
  alt text not null default '',
  -- gallery (default) | preview_video_thumb. The product detail page
  -- renders a special video-thumb slot when one row has this kind.
  -- The first non-video image is the gallery's "main" image.
  kind text not null default 'gallery'
    check (kind in ('gallery', 'preview_video_thumb')),
  display_order int not null default 0,
  created_at timestamptz not null default now()
);

alter table product_images enable row level security;

-- Public read for images on published products (mirrors product_files).
drop policy if exists "product_images_public_read_published" on product_images;
create policy "product_images_public_read_published" on product_images
  for select using (
    exists (
      select 1 from products p
      where p.id = product_images.product_id and p.status = 'published'
    )
  );

-- Partner can read their own product's images.
drop policy if exists "product_images_partner_read_own" on product_images;
create policy "product_images_partner_read_own" on product_images
  for select using (
    exists (
      select 1 from products p
      where p.id = product_images.product_id
        and p.partner_id = current_partner_id()
    )
  );

-- Partner can write their own product's images.
drop policy if exists "product_images_partner_write_own" on product_images;
create policy "product_images_partner_write_own" on product_images
  for all using (
    exists (
      select 1 from products p
      where p.id = product_images.product_id
        and p.partner_id = current_partner_id()
    )
  ) with check (
    exists (
      select 1 from products p
      where p.id = product_images.product_id
        and p.partner_id = current_partner_id()
    )
  );

-- Admin can do anything.
drop policy if exists "product_images_admin_all" on product_images;
create policy "product_images_admin_all" on product_images
  for all using (is_admin());

-- Composite index for the gallery read path: "all images for a product,
-- ordered by display_order, then by id (stable secondary sort for ties)".
-- Covering the `kind` filter so the preview-thumbnail lookup is also
-- index-only.
create index if not exists product_images_product_idx
  on product_images (product_id, display_order, id);

-- Targeted index for "find the preview thumbnail for a product"
-- (used by the product detail page to render the special video slot).
create index if not exists product_images_preview_idx
  on product_images (product_id)
  where kind = 'preview_video_thumb';

comment on table product_images is
  'Multi-image gallery for the product detail page (P0.12). The first row by display_order is the gallery main image. Pairs with products.thumbnail_url (single cover for grids) and products.preview_video_url (optional video preview).';
