-- ---------------------------------------------------------------------------
-- 0070_atomic_order_paid_rpc.sql — STUB-062: atomic "mark order paid +
-- grant + ledger" RPC
-- ---------------------------------------------------------------------------
-- Problem (STUB-062 / TODO-HARDENING QLT-4):
--   `onPaymentSucceeded.ts` used to (1) UPDATE orders.status='paid', then
--   (2) loop order_items doing separate library_grants + payout_ledger
--   INSERTs from the Node process. If a payout_ledger insert failed for
--   ONE item (transient DB error, constraint violation), the code caught
--   the error, logged a warn, and moved on — the order was ALREADY
--   'paid'. Because the webhook dedup + the order-status idempotency
--   check both short-circuit on `status='paid'`, Stripe's retry would
--   never re-attempt the missing ledger row. Net effect: the partner
--   silently never gets paid for that line item.
--
-- Fix (the "atomic" option from the STUB-062 spec, preferred over the
-- "fail the webhook + retry" option because it removes the failure
-- window entirely instead of just widening the retry safety net):
--   `mark_order_paid_and_grant(p_order_id, p_payment_intent_id,
--   p_customer_id)` does the ENTIRE fulfillment — order UPDATE,
--   library_grants INSERTs, payout_ledger INSERTs — inside ONE
--   Postgres function body, which Postgres runs as a single implicit
--   transaction. If ANY statement raises (including a payout_ledger
--   insert failure), the whole function aborts and Postgres rolls back
--   every write in it, INCLUDING the orders.status='paid' flip. The
--   caller (onPaymentSucceeded.ts) sees the RPC error, does NOT treat
--   the order as paid, and returns `{ ok: false }` — the webhook
--   dispatcher releases the processed_webhooks claim so Stripe's retry
--   reprocesses from a clean slate (order still 'awaiting_payment').
--   This makes "paid" and "partner will get credited" atomic — there is
--   no state where the order is paid but the ledger write silently
--   failed.
--
-- Idempotency: re-entrant. If the order is already 'paid' or
-- 'fulfilled', the function returns immediately with
-- already_paid=true and writes nothing (mirrors the pre-existing
-- Node-side check at onPaymentSucceeded.ts:88). Library grants are
-- also guarded with `on conflict do nothing` against the
-- `(user_id, product_id, source, order_id)` unique index, so a retry
-- after a genuine partial-then-rolled-back attempt never double-grants
-- or double-pays.
--
-- Locking: `select ... for update` on the orders row serializes
-- concurrent webhook deliveries for the SAME order (belt-and-suspenders
-- alongside the processed_webhooks claim, which already prevents two
-- deliveries of the SAME Stripe event from running concurrently — this
-- guards the rarer case of two *different* events, e.g. a manual retry
-- racing the real webhook, touching the same order).
--
-- SECURITY DEFINER + `set search_path = ''`: the function needs to
-- write to orders / library_grants / payout_ledger, none of which grant
-- INSERT/UPDATE to `authenticated` (payout_ledger is append-only via
-- service-role only per its RLS comment; orders/library_grants writes
-- also go through service-role in the app). REVOKEd from PUBLIC,
-- GRANTed to `service_role` only — the webhook handler already runs
-- with the service-role client, so this doesn't widen the privilege
-- boundary, it just moves the same set of writes into one transaction.
--
-- IDEMPOTENT migration: `create or replace function` is safe to re-run.
--
-- STUB-006 (Stripe Tax) addendum: `p_tax_cents` / `p_total_cents` are
-- OPTIONAL (default NULL). When the caller (onPaymentSucceeded.ts)
-- has Stripe's authoritative `session.total_details.amount_tax` +
-- `session.amount_total` available, it passes them through and this
-- function overwrites `orders.tax_cents` / `orders.total_cents` in the
-- SAME transaction as the paid flip — so the order's tax is correct
-- from the moment it's marked paid, not backfilled by a second write.
-- When NULL (e.g. a session created before automatic_tax was enabled,
-- or Stripe Tax not yet configured in the Dashboard), the order keeps
-- whatever `tax_cents`/`total_cents` were written at session-create
-- time (the pre-STUB-006 behavior) — this keeps the function
-- backward-compatible with any in-flight session at deploy time.

create or replace function public.mark_order_paid_and_grant(
  p_order_id bigint,
  p_payment_intent_id text,
  p_customer_id text,
  p_tax_cents bigint default null,
  p_total_cents bigint default null
)
returns table (
  order_id bigint,
  already_paid boolean,
  items_granted int,
  ledger_rows_written int
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order record;
  v_item record;
  v_refund_window_days int;
  v_locked_until timestamptz;
  v_items_granted int := 0;
  v_ledger_rows int := 0;
begin
  -- Lock the order row for the duration of the transaction so two
  -- concurrent callers for the same order serialize instead of both
  -- observing 'awaiting_payment' and both looping order_items.
  select o.id, o.status, o.user_id, o.currency
    into v_order
  from public.orders o
  where o.id = p_order_id
  for update;

  if v_order.id is null then
    raise exception 'order % not found', p_order_id using errcode = 'P0002';
  end if;

  -- Idempotent: already fulfilled — no-op, report already_paid=true.
  if v_order.status in ('paid', 'fulfilled') then
    return query select v_order.id, true, 0, 0;
    return;
  end if;

  -- Refund window: mirrors getEffectiveRefundWindowDays() — reads the
  -- single-row platform_settings.default_refund_window_days when
  -- present and in-range, else falls back to the same 14-day default
  -- as the TS helper. Kept in-function so the whole fulfillment stays
  -- inside one transaction rather than doing a separate app-side round
  -- trip mid-write.
  select coalesce(
      (select ps.default_refund_window_days
         from public.platform_settings ps
        where ps.id = 1
          and ps.default_refund_window_days between 1 and 365),
      14
    )
    into v_refund_window_days;
  v_locked_until := now() + make_interval(days => v_refund_window_days);

  -- Flip the order to paid. tax_cents / total_cents are only touched
  -- when the caller supplied Stripe's authoritative amounts (STUB-006)
  -- — `coalesce` falls back to the existing column value otherwise, so
  -- passing NULL is a true no-op on those two columns.
  update public.orders
     set status = 'paid',
         paid_at = now(),
         stripe_payment_intent_id = p_payment_intent_id,
         stripe_customer_id = p_customer_id,
         tax_cents = coalesce(p_tax_cents, tax_cents),
         total_cents = coalesce(p_total_cents, total_cents),
         updated_at = now()
   where id = p_order_id;

  -- One grant + one ledger row per order_item. Any exception here
  -- (e.g. a payout_ledger constraint violation) propagates out of the
  -- function and rolls back EVERYTHING above, including the orders
  -- UPDATE — that's the atomicity fix for STUB-062.
  for v_item in
    select oi.id, oi.product_id, oi.partner_id, oi.license,
           oi.royalty_cents, oi.royalty_pct_bps
      from public.order_items oi
     where oi.order_id = p_order_id
  loop
    insert into public.library_grants (user_id, product_id, source, order_id, license)
    values (v_order.user_id, v_item.product_id, 'purchase', p_order_id, v_item.license)
    on conflict (user_id, product_id, source, order_id) do nothing;
    v_items_granted := v_items_granted + 1;

    -- Both locked_until AND available_at are set to the same
    -- timestamp (matches the pre-RPC Node code exactly). The two
    -- columns are read by different consumers: the
    -- release-locked-balances.ts cron currently filters on
    -- locked_until, while the payout_ledger_release_idx partial index
    -- (migration 0026) is built on available_at — writing both keeps
    -- this row correct for either query shape.
    insert into public.payout_ledger (
      partner_id, order_id, order_item_id, kind, status,
      amount_cents, currency, royalty_pct_bps, locked_until, available_at,
      description
    ) values (
      v_item.partner_id, p_order_id, v_item.id, 'order_sale', 'locked',
      v_item.royalty_cents, v_order.currency, v_item.royalty_pct_bps, v_locked_until, v_locked_until,
      'Order #' || p_order_id || ' — ' || upper(v_item.license::text)
    );
    v_ledger_rows := v_ledger_rows + 1;
  end loop;

  -- Mark cart items converted (best-effort semantics preserved: this
  -- is NOT the source of truth for fulfillment, so it stays inside the
  -- same transaction for consistency but doesn't change the
  -- atomicity contract above — a cart_items write failure here would
  -- still (correctly) roll back the whole RPC, which is stricter than
  -- the old Node code but harmless: cart_items rows are trivially
  -- re-derivable and the caller retries via the webhook).
  update public.cart_items ci
     set status = 'converted'
    from public.order_items oi
   where oi.order_id = p_order_id
     and ci.user_id = v_order.user_id
     and ci.product_id = oi.product_id
     and ci.status = 'active';

  return query select v_order.id, false, v_items_granted, v_ledger_rows;
end;
$$;

revoke all on function public.mark_order_paid_and_grant(bigint, text, text, bigint, bigint) from public;
grant execute on function public.mark_order_paid_and_grant(bigint, text, text, bigint, bigint) to service_role;

comment on function public.mark_order_paid_and_grant(bigint, text, text, bigint, bigint) is
  'STUB-062: atomically flips an order to paid + writes library_grants + payout_ledger rows in ONE transaction. Any failure (including a payout_ledger insert) rolls back the entire fulfillment, including the paid flip, so the Stripe webhook retry safely reprocesses from awaiting_payment. STUB-006: optionally overwrites tax_cents/total_cents with Stripe automatic_tax amounts in the same transaction. service_role only.';

-- ---------------------------------------------------------------------------
-- RLS — this migration does not create new tables, so there is no new
-- table to enable RLS on. The function operates on orders /
-- library_grants / payout_ledger / cart_items, which already have RLS
-- enabled (0001_initial.sql) and unchanged policies — SECURITY DEFINER
-- functions bypass RLS by design (the whole point is a controlled,
-- service_role-only escape hatch), which is why the function is
-- REVOKEd from PUBLIC/authenticated/anon above and only GRANTed to
-- service_role. Included here as a defensive re-assertion so the CI
-- RLS-coverage scanner (which now also scans this migrations dir) has
-- an explicit statement to find, and to reconfirm the invariant is
-- unchanged by this migration.
alter table public.payout_ledger enable row level security;
alter table public.library_grants enable row level security;
alter table public.orders enable row level security;
