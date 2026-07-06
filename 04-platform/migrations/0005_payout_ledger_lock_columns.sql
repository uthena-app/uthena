-- ============================================================================
-- 0005_payout_ledger_lock_columns.sql — Add locked_until / available_at +
-- 'locked' and 'available' enum values to payout_ledger.
--
-- Why:
--   PH06's onPaymentSucceeded and PH08's release-locked-balances cron
--   both write/read `locked_until`, `available_at`, and `status='locked'`.
--   The original 0001 migration only had `'accruing', 'pending_payout',
--   'paid', 'void'` and no time columns. This is the fix.
--
-- Note on Postgres + enum + indexes:
--   ALTER TYPE … ADD VALUE makes the new value NOT safe to use in
--   the same transaction. Postgres 15+ enforces this strictly. The
--   `WHERE status='locked' / 'available'` indexes use the new values,
--   so they moved to 0026 (a follow-up file, formerly 0005b) so the
--   ADD VALUE transaction can commit independently.
-- ============================================================================

-- 1. Add the new enum values. ALTER TYPE ADD VALUE is idempotent in
--    IF NOT EXISTS only on PG 12+, which the spec targets.
do $$ begin
  alter type payout_ledger_status add value if not exists 'locked';
exception when duplicate_object then null; end $$;

do $$ begin
  alter type payout_ledger_status add value if not exists 'available';
exception when duplicate_object then null; end $$;

-- 2. Add the time columns. Nullable: the existing rows pre-PH08
--    (status='accruing') and the partner-revenue rows post-0004
--    (status='accruing' with partner_id set) don't have a lock window.
alter table payout_ledger
  add column if not exists locked_until timestamptz,
  add column if not exists available_at timestamptz;

