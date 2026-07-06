-- ============================================================================
-- 0007_payout_ledger_stripe_invoice_id.sql — Idempotency key for
-- subscription ledger rows.
--
-- Why:
--   PH08's appendSubscriptionLedgerEntry inserts one row per
--   `invoice.paid` event. Stripe retries webhooks on 5xx for up to
--   3 days; if our handler soft-fails (N4 fix below) we release
--   the processed_webhooks claim and Stripe re-fires the event.
--   Without idempotency, the second insert would create a duplicate
--   ledger row, inflating platform revenue.
--
--   The fix: store Stripe's invoice id on the ledger row, with a
--   partial unique index for the kind='subscription' subset. The
--   application uses upsert keyed on this column.
--
-- Rollback plan: 0008_rollback_payout_ledger_stripe_invoice_id.sql
--   would drop the column + index. Forward-only is fine — the
--   column is nullable and unused by any non-subscription row.
-- ============================================================================

alter table payout_ledger
  add column if not exists stripe_invoice_id text;

create unique index if not exists payout_ledger_stripe_invoice_unique
  on payout_ledger(stripe_invoice_id)
  where stripe_invoice_id is not null and kind = 'subscription';
