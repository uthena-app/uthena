-- ============================================================================
-- 0004_payout_ledger_nullable_partner.sql — Allow payout_ledger.partner_id
-- to be NULL for subscription / adjustment rows.
--
-- Why:
--   PH08 ships the subscription ledger write path. Subscription revenue
--   belongs to the platform, not to any partner. The migration's
--   `partner_id bigint not null references partners(id)` was
--   correct for the v1 sale/refund/payout/clawback flow but blocks
--   the subscription and adjustment rows. We relax the NOT NULL on
--   partner_id; the app layer enforces "order_sale/refund/payout/
--   clawback rows MUST have a partner_id" (server action validation).
--
-- Rollback plan:
--   0005_rollback_payout_ledger_nullable_partner.sql would:
--     - update all NULL partner_id rows to a placeholder partner
--     - alter the column back to NOT NULL
--   v1 doesn't ship a rollback — forward-only is fine.
-- ============================================================================

alter table payout_ledger
  alter column partner_id drop not null;

-- Soft invariant: order_sale / refund / payout / clawback rows must
-- still have a partner_id (the app layer is the source of truth for
-- this, but a CHECK at the DB level catches direct service-role writes
-- that forgot the field).
alter table payout_ledger
  drop constraint if exists payout_ledger_partner_required_for_partner_kinds;
alter table payout_ledger
  add constraint payout_ledger_partner_required_for_partner_kinds
  check (
    (kind in ('order_sale', 'refund', 'payout', 'clawback') and partner_id is not null)
    or (kind in ('subscription', 'adjustment'))
  );

create index if not exists payout_ledger_partner_id_null_idx
  on payout_ledger(created_at desc)
  where partner_id is null;
