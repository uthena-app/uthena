-- 0010_delete_my_account_rpc.sql
-- Right-to-deletion (GDPR Art. 17) RPC. Anonymizes the user's
-- orders, zeroes the partner's PII (when applicable), hard-deletes
-- engagement + cart rows, then removes the profile. Called from
-- the `deleteMyAccount` server action (which also signs the user
-- out and writes the audit row).
--
-- Why a function (not a series of application-level statements)?
--   - The cascade crosses RLS boundaries the application is not
--     authorized to write through. `security definer` is the
--     cleanest way to expose this in one call.
--   - It runs in a single Postgres transaction. We set the
--     isolation level to SERIALIZABLE so a concurrent write
--     (e.g. a Stripe webhook arriving at the exact moment the
--     user is signing out) cannot create a phantom row in the
--     cascade window.
--   - EXECUTE is revoked from PUBLIC and granted to `service_role`
--     only. The application calls this via `supabase.rpc(...)`
--     from a server action that holds the service-role key.
--
-- Returns one of four text values:
--   'anonymized'                  — happy path
--   'already_deleted'             — profile was already gone
--   'cancel_subscriptions_first'  — caller must cancel via Settings → Billing
--   'resolve_payouts_first'       — caller must resolve pending payouts
--
-- The `progress` and `bookmarks` tables ship in PH16 (LMS) and are
-- NOT in the schema yet. When PH16 lands, add a follow-up migration
-- that does:
--     delete from progress  where user_id = p_user_id;
--     delete from bookmarks where user_id = p_user_id;
-- The function is idempotent — re-runs are safe.

create or replace function public.delete_my_account(p_user_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
  v_anon_marker text;
  v_active_subs int;
  v_pending_payouts int;
  v_partner_id bigint;
begin
  -- ----------------------------------------------------------------
  -- 0. Force SERIALIZABLE isolation for the duration of this
  --    transaction. A concurrent write (e.g. a Stripe webhook
  --    arriving during the delete) cannot then read the partially
  --    anonymized state and produce phantom rows.
  -- ----------------------------------------------------------------
  set transaction isolation level serializable;

  -- Idempotency: if the profile is already gone, return early.
  -- (We check both profiles and auth.users so a profile-already-
  -- deleted-but-auth-still-present state still resolves cleanly.)
  select email into v_email from profiles where user_id = p_user_id;
  if v_email is null then
    select email into v_email from auth.users where id = p_user_id;
    if v_email is null then
      return 'already_deleted';
    end if;
  end if;

  -- Look up the partner row (if any). The user might be a partner;
  -- we need their partner_id for the payout_ledger + partners
  -- anonymization below.
  select id into v_partner_id from partners where user_id = p_user_id limit 1;

  -- 1. Refuse if the user has active subscriptions. The cancel flow
  --    lives in /account/settings (PH10b). The enum values are
  --    `incomplete, incomplete_expired, trialing, active, past_due,
  --    canceled, unpaid, paused`; we block on the three that mean
  --    "money is still moving" (active, trialing, past_due).
  select count(*) into v_active_subs
    from subscriptions
    where user_id = p_user_id
      and status in ('active', 'trialing', 'past_due');
  if v_active_subs > 0 then
    return 'cancel_subscriptions_first';
  end if;

  -- 2. Refuse if the user (as a partner) has pending payout_ledger
  --    rows. The settlement path is admin-only. We block on
  --    `locked` and `available` (the two non-terminal statuses
  --    that mean "money is owed"). The cancelled/reversed/paid
  --    statuses do NOT block — those are already settled.
  if v_partner_id is not null then
    select count(*) into v_pending_payouts
      from payout_ledger
      where partner_id = v_partner_id
        and status in ('locked', 'available');
    if v_pending_payouts > 0 then
      return 'resolve_payouts_first';
    end if;
  end if;

  -- ----------------------------------------------------------------
  -- 3. Compute the anonymization marker. One-way hash; deterministic
  --    so multiple rows for the same user map to the same marker
  --    (preserves joinability of orders to order_items to the
  --    financial records for the 7-year retention period). pgcrypto
  --    is enabled by default on Supabase projects.
  -- ----------------------------------------------------------------
  v_anon_marker := 'anon_' || substr(
    encode(digest(p_user_id::text || 'uthena-rotate-salt', 'sha256'), 'hex'),
    1, 16
  );

  -- 4. Anonymize orders. We replace `user_id` with a nil-uuid
  --    sentinel (00000000-0000-0000-0000-000000000000) because the
  --    column is `uuid` and we cannot write a text marker. The
  --    nil-uuid is outside the range of real auth.users v4 uuids.
  --    The original email is the only PII link; replacing it with
  --    the anon_marker breaks the chain. The `on delete restrict`
  --    FK on orders.user_id → auth.users is satisfied because the
  --    sentinel is a valid uuid (just not a real one).
  update orders
    set user_id = '00000000-0000-0000-0000-000000000000'::uuid,
        email   = v_anon_marker
  where user_id = p_user_id;

  -- 5. Zero the partner's PII (when this user is also a partner).
  --    The partner row is KEPT (its id is referenced by products,
  --    order_items, payout_ledger) but the personal fields are
  --    scrubbed. Note: the `partners` table does NOT have a
  --    `display_name` or `contact_email` column; the columns that
  --    hold the user's own PII are `bio`, `website_url`, and
  --    `payout_method` (jsonb). The `public_slug` is preserved so
  --    legacy product URLs stay routable to an archived "instructor"
  --    page.
  if v_partner_id is not null then
    update partners
      set bio           = null,
          website_url   = null,
          payout_method = null
      where id = v_partner_id;
  end if;

  -- 6. Anonymize payout_ledger rows whose description references
  --    the deleted user. (Some legacy rows have a 'user:...' tag
  --    in the description for audit traceability; we rewrite the
  --    tag to the anon_marker.) The partner_id on payout_ledger
  --    is the PARTNER (seller), not the user, so it stays intact.
  if v_partner_id is not null then
    update payout_ledger
      set description = regexp_replace(
            description,
            'user:[^ ]*',
            'user:' || v_anon_marker,
            'g'
          )
    where partner_id = v_partner_id
      and description ~ 'user:';
  end if;

  -- 7. Hard-delete engagement + cart rows. The `progress` and
  --    `bookmarks` tables ship in PH16 (LMS) and are NOT in the
  --    schema yet. The function only touches tables that exist
  --    today. When PH16 lands, add the corresponding DELETEs in
  --    a follow-up migration.
  delete from reviews        where user_id = p_user_id;
  delete from library_grants where user_id = p_user_id;
  delete from cart_items     where user_id = p_user_id;

  -- 8. Hard-delete the profile. The auth.users row is preserved
  --    here (the application layer calls auth.admin.deleteUser
  --    AFTER this RPC returns successfully, so the JWT session is
  --    not invalidated mid-transaction).
  delete from profiles where user_id = p_user_id;

  return 'anonymized';
end $$;

-- Lock down. Only the service role can invoke this function.
revoke execute on function public.delete_my_account(uuid) from public;
grant execute on function public.delete_my_account(uuid) to service_role;

comment on function public.delete_my_account(uuid) is
  'Right-to-deletion (GDPR Art. 17). Returns one of: anonymized, already_deleted, cancel_subscriptions_first, resolve_payouts_first. SERIALIZABLE. service_role only.';
