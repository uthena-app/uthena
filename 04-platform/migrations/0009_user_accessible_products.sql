-- ============================================================================
-- 0009_user_accessible_products.sql — Single SQL function that returns
-- the set of products a user has access to, unioned across:
--   (a) active library_grants (purchase / admin_grant / free_promo)
--   (b) active subscription (has_active_subscription)
--
-- Why:
--   PH09 ships the /library page. With 500+ products and 10k+ users,
--   the access check MUST be a single roundtrip, not a join in JS
--   or a UNION ALL materialized in the application layer. The
--   /library page reads the user's owned products in one query
--   (this function) and renders them.
--
--   The function is SECURITY DEFINER so the subscription check
--   (has_active_subscription, which itself is SECURITY DEFINER)
--   composes correctly without RLS friction. The caller is the
--   server, and the server passes the user_id explicitly; the
--   function never reads auth.uid().
--
--   Returns: TABLE of product rows the user can access. Joins
--   against products + the latest non-revoked grant (for
--   license / granted_at metadata) + the partner for the product
--   card. Note: this function does NOT check the file-level
--   permissions — files are a child of products, and if the
--   user has access to the product, they have access to the
--   product's files. (Future: partner-uploaded extras that are
--   not in the product bundle; PH13 territory.)
-- ============================================================================

create or replace function user_accessible_products(p_user_id uuid)
returns table (
  product_id bigint,
  slug text,
  title text,
  thumbnail_url text,
  kind product_kind,
  short_description text,
  total_lesson_count int,
  total_duration_seconds int,
  partner_id bigint,
  partner_slug text,
  access_source text,    -- 'purchase' | 'admin_grant' | 'free_promo' | 'subscription'
  granted_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  -- Union: explicit grants (purchase / admin_grant / free_promo) AND
  -- subscription access. Each branch is small. The whole query is
  -- index-driven via (user_id) on library_grants + (user_id, status,
  -- current_period_end) on subscriptions.
  select
    p.id as product_id,
    p.slug,
    p.title,
    p.thumbnail_url,
    p.kind,
    p.short_description,
    p.total_lesson_count,
    p.total_duration_seconds,
    p.partner_id,
    pa.public_slug as partner_slug,
    lg.source::text as access_source,
    lg.created_at as granted_at
  from library_grants lg
  join products p on p.id = lg.product_id
  left join partners pa on pa.id = p.partner_id
  where lg.user_id = p_user_id
    and lg.revoked_at is null
    and (lg.expires_at is null or lg.expires_at > now())
    and p.status = 'published'
  union
  select
    p.id as product_id,
    p.slug,
    p.title,
    p.thumbnail_url,
    p.kind,
    p.short_description,
    p.total_lesson_count,
    p.total_duration_seconds,
    p.partner_id,
    pa.public_slug as partner_slug,
    'subscription'::text as access_source,
    s.created_at as granted_at
  from products p
  left join partners pa on pa.id = p.partner_id
  cross join (select has_active_subscription(p_user_id) as sub) gate
  cross join lateral (
    select s.created_at
    from subscriptions s
    where s.user_id = p_user_id
      and s.status in ('active', 'trialing')
      and (s.current_period_end is null or s.current_period_end > now())
    order by s.created_at desc
    limit 1
  ) s
  where gate.sub = true
    and p.status = 'published'
  order by granted_at desc;
$$;

grant execute on function user_accessible_products(uuid) to anon, authenticated;
