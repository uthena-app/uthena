-- ============================================================================
-- 0011_product_review_aggregates.sql — Denormalized review aggregates on
-- products.avg_rating + products.review_count, maintained by a trigger
-- on the reviews table.
--
-- Why denormalize (and not compute in the catalog query)?
--   The product card (P0.7) renders stars + review count on every
--   product card in every grid. With 500+ products and 10k+ reviews, a
--   join-and-aggregate at read time is a per-card subquery that scales
--   as O(products × reviews). The denormalized approach is O(1) at
--   read time (already on the product row) and O(review_writes) at
--   write time — review writes are rare and bounded by user behavior
--   (not by traffic).
--
--   The product row is already read on every card; adding two ints + a
--   numeric is essentially free, while the alternative is a subquery
--   on every card on every page load.
--
-- Why a trigger (and not a recompute in the application)?
--   The application might call INSERT/UPDATE/DELETE from multiple
--   paths: the review submit form, the admin moderation queue, the
--   GDPR delete-my-account RPC, a bulk import script, a future webhook
--   from Gorse, etc. A single trigger covers all of them. Putting
--   the maintenance in the database is the contract: every code path
--   gets correct aggregates for free.
--
--   It also gives the data a single source of truth. A second
--   consumer (the product detail page's review rail, the catalog
--   filters, the search ranking signal in PH16) doesn't have to
--   trust that the catalog query is the only place that maintains
--   the value.
--
-- Why SECURITY DEFINER on the recompute function?
--   The function reads from `reviews` (where RLS only exposes
--   status='published' to anon + status='published' / 'pending' to
--   the owning user) and writes to `products` (where RLS is
--   role-restricted to admin/partner). The trigger fires from
--   inserts/updates/deletes that the calling user has already been
--   authorized for. SECURITY DEFINER lets the function update
--   `products.avg_rating` / `products.review_count` without
--   re-checking RLS on the products table for the original caller.
--   This is the standard Supabase pattern for "trigger fires
--   on a public table but needs to write to a restricted table".
-- ============================================================================

-- 1. Add the columns. Idempotent (ADD COLUMN IF NOT EXISTS is supported
--    on Postgres 9.6+). numeric(3,2) holds 0.00..9.99 but we constrain
--    to 0..5 at the application / trigger level (rating is 1..5).
alter table products
  add column if not exists avg_rating numeric(3, 2),
  add column if not exists review_count int not null default 0;

-- 2. The recompute function. Stable + SECURITY DEFINER. The function
--    is the single point that knows how to recompute both columns for
--    a given product_id.
create or replace function public.recompute_product_review_aggregates(p_product_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_avg numeric(3, 2);
  v_count int;
begin
  -- Only count published reviews. Pending / hidden / flagged are not
  -- shown on the public surface; including them in the aggregate
  -- would leak moderator state to the storefront.
  select count(*), coalesce(avg(rating), 0)::numeric(3, 2)
    into v_count, v_avg
    from reviews
    where product_id = p_product_id
      and status = 'published';

  update products
    set avg_rating  = v_avg,
        review_count = v_count
    where id = p_product_id;
end $$;

-- 3. The trigger function. Fires AFTER INSERT/UPDATE/DELETE on reviews.
--    We recompute both the new.product_id (if present) and the
--    old.product_id (if present) because either could have changed
--    (review reassigned to a different product, or status flipped
--    from published to hidden). On DELETE, only old is set; on INSERT,
--    only new.
create or replace function public.reviews_aggregate_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (tg_op = 'DELETE') then
    perform public.recompute_product_review_aggregates(old.product_id);
    return old;
  elsif (tg_op = 'UPDATE' and old.product_id is distinct from new.product_id) then
    -- Review moved to a different product: recompute BOTH.
    perform public.recompute_product_review_aggregates(old.product_id);
    perform public.recompute_product_review_aggregates(new.product_id);
    return new;
  else
    -- INSERT, or UPDATE that didn't change product_id: recompute new.
    perform public.recompute_product_review_aggregates(new.product_id);
    return new;
  end if;
end $$;

-- 4. Wire the trigger. Drop-then-create so this migration is safe to
--    re-run (the function bodies above are create-or-replace; the
--    trigger itself is not).
drop trigger if exists reviews_aggregate_sync on reviews;
create trigger reviews_aggregate_sync
  after insert or update or delete on reviews
  for each row execute function public.reviews_aggregate_trigger();

-- 5. Backfill existing data. The columns default to (NULL, 0); on
--    any environment that already has reviews, we want the aggregates
--    to match reality. This is a single sequential scan over
--    `products` and is fine for 500+ products.
do $$
declare
  r record;
begin
  for r in select id from products loop
    perform public.recompute_product_review_aggregates(r.id);
  end loop;
end $$;

-- 6. Grant. The function is internal — only the trigger should call
--    it. No external grants. (SECURITY DEFINER makes it safe to
--    invoke from a SECURITY DEFINER trigger; we don't need anon or
--    authenticated to be able to call it directly.)
-- (No explicit grant — the trigger runs as the function owner.)

-- 7. Lock down the product columns. They are denormalized state
--    maintained by the trigger; no application or user should be
--    able to write them directly. The cleanest way is a BEFORE
--    INSERT/UPDATE trigger that re-asserts the values, but the
--    simpler way is to revoke UPDATE on these columns from
--    non-superuser roles. We revoke from `anon` and
--    `authenticated`. The service_role (used by admin actions
--    and webhooks) keeps full access; if a future admin tool
--    needs to override the aggregates (e.g. seeding data without
--    reviews), it can do so as service_role.
revoke update (avg_rating, review_count) on products from anon, authenticated;

-- 8. Index for the (admin) "find products with no reviews" path,
--    the storefront filter "sort by rating", and the Gorse
--    cold-start popularity signal. We index review_count separately
--    from avg_rating; the common filters are "top rated" (avg desc,
--    then count desc) and "needs attention" (count = 0, sort by
--    published_at desc). Both are b-tree candidates.
create index if not exists products_avg_rating_idx
  on products (avg_rating desc)
  where avg_rating is not null;
create index if not exists products_review_count_idx
  on products (review_count desc);

comment on column products.avg_rating is
  'Denormalized. 0.00..5.00, average of published reviews. Maintained by trigger reviews_aggregate_sync. Application code MUST NOT write this directly.';
comment on column products.review_count is
  'Denormalized. Count of published reviews. Maintained by trigger reviews_aggregate_sync. Application code MUST NOT write this directly.';
