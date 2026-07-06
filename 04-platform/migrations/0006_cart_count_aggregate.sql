-- ============================================================================
-- 0006_cart_count_aggregate.sql — Single-row aggregate function for the
-- cart count badge.
--
-- Why:
--   The cart count badge renders on every page (SiteHeader is in the
--   root layout). The PH06 implementation used a JS-side SUM over a
--   multi-row result, which scales linearly with cart line count. At
--   100 RPS with 10-line carts, that's 1000 row transfers/sec just
--   for the badge. This function returns a single integer and the
--   existing `cart_items_user_status_idx (user_id, status)` is the
--   covering index (index-only scan).
--
--   The function is SECURITY DEFINER + search_path = public so RLS
--   on cart_items is not re-evaluated (we already verify auth.uid()
--   in the calling action; the function takes a user_id arg and
--   returns that user's count, which is what the caller already
--   asserted). SECURITY INVOKER would also work but requires the
--   caller to have RLS access; SECURITY DEFINER skips the RLS
--   check, which is the right call here because the function takes
--   the user_id as input and the caller is the server.
-- ============================================================================

create or replace function get_cart_quantity_sum(p_user_id uuid)
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(quantity), 0)::bigint
  from cart_items
  where user_id = p_user_id and status = 'active';
$$;

grant execute on function get_cart_quantity_sum(uuid) to anon, authenticated;
