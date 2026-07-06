-- 0026_payout_ledger_lock_indexes.sql — Indexes for the new
-- 'locked' / 'available' enum values added in 0005. Lives in a
-- separate file so the ALTER TYPE … ADD VALUE in 0005 commits
-- independently; using new enum values in the same transaction
-- raises "unsafe use of new value" on Postgres 15+.
--
-- (Formerly 0005b_. Renamed to 0026 — the next free numeric slot —
-- to satisfy the NNNN_ migration-naming contract. These are
-- performance-only CREATE INDEX statements; they require only that
-- the 0005 enum values exist, so running later in the sequence is
-- safe and idempotent.)

-- Cron hot path: WHERE status='locked' AND available_at < now()
create index if not exists payout_ledger_release_idx
  on payout_ledger(available_at)
  where status = 'locked';

-- Partner "show me my available balance" path:
-- WHERE partner_id = $1 AND status = 'available'
create index if not exists payout_ledger_partner_available_idx
  on payout_ledger(partner_id)
  where status = 'available';
