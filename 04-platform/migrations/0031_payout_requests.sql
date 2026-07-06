-- 0031_payout_requests.sql
--
-- P6.6 — Partner payout request.
--
-- A new `payout_requests` table that captures a partner's explicit
-- "I want my available money now" intent. Before this table, the
-- `payout_ledger.status` enum had a `pending_payout` value but no
-- surface that grouped rows by request — an admin looking at
-- pending rows would see ungrouped entries with no "this is one
-- payout request" boundary.
--
-- This table is the explicit boundary. One row per request. The
-- ledger rows that are part of the request are identified by
-- `status='pending_payout'` + `partner_id` + `created_at` proximity
-- (the action sets them all atomically).
--
-- The payout method is SNAPSHOTTED onto the request row (the
-- masked PayPal email at request time). This is critical: the
-- partner could later change their PayPal email — the request row
-- remembers what was paid to at the time of approval. The admin
-- queue (P6.7) reads this snapshot; it does NOT join to `partners`
-- for the current email.
--
-- No INSERT policy for non-admin. The `requestPayoutAction` server
-- action uses the service-role client to insert + update the ledger
-- rows atomically. RLS-gated reads for partner (own rows) + admin
-- (all rows).
--
-- IDEMPOTENT — every CREATE / DROP POLICY / CREATE INDEX uses IF
-- [NOT] EXISTS so the migration is safe to re-run on databases
-- that already have the table.

-- ---------------------------------------------------------------------------
-- payout_requests — explicit "request payout" from a partner
-- ---------------------------------------------------------------------------
create table if not exists payout_requests (
  id bigserial primary key,
  partner_id bigint not null references partners(id) on delete restrict,
  amount_cents bigint not null check (amount_cents > 0),
  currency text not null default 'USD' check (char_length(currency) = 3),
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'denied', 'paid', 'failed', 'canceled')),
  -- Payout method snapshot at request time
  payout_method_kind text not null check (payout_method_kind in ('paypal')),
  payout_method_target_masked text not null,
  -- Admin processing
  denial_reason text,
  processed_at timestamptz,
  processed_by uuid references auth.users(id) on delete set null,
  -- Batch tracking (filled when admin processes via PayPal Mass Payout)
  paypal_payout_batch_id text,
  stripe_transfer_id text,
  -- Metadata — filters snapshot + counts for ops
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table payout_requests enable row level security;

-- Partner can read their own requests
drop policy if exists payout_requests_partner_read_own on payout_requests;
create policy payout_requests_partner_read_own on payout_requests
  for select using (partner_id = current_partner_id());

-- Admin can read all requests
drop policy if exists payout_requests_admin_read on payout_requests;
create policy payout_requests_admin_read on payout_requests
  for select using (is_admin());

-- Admin can update (approve / deny / mark paid) — needed for P6.7/P6.8
drop policy if exists payout_requests_admin_update on payout_requests;
create policy payout_requests_admin_update on payout_requests
  for update using (is_admin());

-- No INSERT / DELETE policy for non-admin roles. Writes go through
-- the service-role client (the requestPayoutAction server action).
-- This preserves the append-only invariant for partner-initiated
-- rows: the partner can only ever CREATE a row (via the action) —
-- they cannot UPDATE it (to game the system) or DELETE it.

-- Index: partner's own history, newest first
create index if not exists payout_requests_partner_idx
  on payout_requests(partner_id, created_at desc);

-- Index: admin queue, pending first then by created_at
create index if not exists payout_requests_pending_idx
  on payout_requests(created_at)
  where status = 'pending';

-- Index: admin queue, recently processed (for audit / reversal)
create index if not exists payout_requests_processed_idx
  on payout_requests(processed_at desc)
  where status in ('approved', 'denied', 'paid', 'failed', 'canceled');

-- updated_at trigger — keep it in sync with row mutations
create or replace function trg_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists payout_requests_set_updated_at on payout_requests;
create trigger payout_requests_set_updated_at
  before update on payout_requests
  for each row execute function trg_set_updated_at();

-- Note: the trg_set_updated_at() function may already exist from
-- another table's trigger. If so, the CREATE OR REPLACE above is a
-- no-op and the existing trigger is reused. Other tables' BEFORE
-- UPDATE triggers calling this function will keep working.