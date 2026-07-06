-- ============================================================================
-- 0008_update_cart_license_rpc.sql — Atomic license update for cart_items.
--
-- Why:
--   The PH06 updateLicense action does (1) read existing, (2) check
--   for collision, (3) delete, (4) insert. With two concurrent requests
--   from the same user, both can pass step 2 (the collision row hasn't
--   been inserted yet), then one delete races the other, and the
--   user ends up with the wrong state — sometimes two active rows,
--   sometimes a "could not change license" error on a no-op change.
--
--   The fix: a single SECURITY DEFINER RPC that takes the user_id and
--   the cart_item_id, locks the row(s) with FOR UPDATE, does the
--   collision check + delete-or-merge + insert inside a single
--   transaction, and returns the new row. The unique index on
--   (user_id, product_id, license) is the serialization point.
--
--   The RPC accepts p_user_id as an arg and is SECURITY DEFINER so
--   it can lock without RLS friction; the caller is the server, and
--   the action verifies auth.uid() === p_user_id before calling.
-- ============================================================================

create or replace function update_cart_license(
  p_user_id uuid,
  p_cart_item_id bigint,
  p_new_license license_type
)
returns table (id bigint, product_id bigint, license license_type, quantity int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_product_id bigint;
  v_quantity int;
  v_existing_license license_type;
  v_collision_id bigint;
  v_inserted_id bigint;
begin
  -- 1. Lock the source row.
  select ci.product_id, ci.quantity, ci.license
    into v_product_id, v_quantity, v_existing_license
    from cart_items ci
    where ci.id = p_cart_item_id
      and ci.user_id = p_user_id
      and ci.status = 'active'
    for update;
  if not found then
    raise exception 'cart line not found' using errcode = 'P0002';
  end if;
  if v_existing_license = p_new_license then
    -- no-op, return current
    return query select ci.id, ci.product_id, ci.license, ci.quantity
      from cart_items ci where ci.id = p_cart_item_id;
    return;
  end if;

  -- 2. Check for a collision: a different active row for the same
  --    (user, product, new_license). If it exists, we keep THAT
  --    row (it's the new state) and delete the old one.
  select id into v_collision_id
    from cart_items
    where user_id = p_user_id
      and product_id = v_product_id
      and license = p_new_license
      and status = 'active'
      and id <> p_cart_item_id
    limit 1;
  if v_collision_id is not null then
    -- Merge: delete the old line.
    delete from cart_items where id = p_cart_item_id and user_id = p_user_id;
    return query select ci.id, ci.product_id, ci.license, ci.quantity
      from cart_items ci where ci.id = v_collision_id;
    return;
  end if;

  -- 3. No collision. Delete the old row, insert the new one. The
  --    unique index on (user_id, product_id, license) is the
  --    serialization point — if a parallel call beat us to it,
  --    the unique violation aborts the transaction.
  delete from cart_items where id = p_cart_item_id and user_id = p_user_id;
  insert into cart_items (user_id, product_id, license, quantity, status)
    values (p_user_id, v_product_id, p_new_license, v_quantity, 'active')
    returning id into v_inserted_id;
  return query select v_inserted_id, v_product_id, p_new_license, v_quantity;
end;
$$;

grant execute on function update_cart_license(uuid, bigint, license_type) to authenticated;
