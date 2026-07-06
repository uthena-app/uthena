-- ---------------------------------------------------------------------------
-- 0072_payout_ledger_dispute_enums.sql — STUB-061: dispute lifecycle
-- enum values
-- ---------------------------------------------------------------------------
-- STUB-061 adds `charge.dispute.created` / `charge.dispute.closed`
-- webhook handlers so a lost dispute reverses/holds the partner payout
-- instead of over-paying them. The handler needs two new enum values
-- that don't exist yet:
--
--   - `payout_ledger_status` gains `'pending_dispute'` — set on the
--     affected payout_ledger row(s) when `charge.dispute.created`
--     fires, so the daily release-locked-balances cron and any manual
--     payout run SKIP the row while the dispute is open (it's neither
--     'locked' nor 'available' — a distinct hold state per the
--     STUB-061 spec option (a)).
--   - `payout_ledger_kind` gains `'dispute'` — the kind tag on the
--     negative adjustment row written when `charge.dispute.closed`
--     resolves as lost (mirrors how `'refund'` tags a refund debit
--     row; `'dispute'` distinguishes a chargeback-driven debit from a
--     customer-initiated refund debit in reporting/exports).
--
-- `alter type ... add value if not exists` is idempotent and safe to
-- re-run. Postgres requires each `ALTER TYPE ... ADD VALUE` to run
-- outside an explicit multi-statement transaction block in some
-- client drivers; this file follows the same one-statement-per-ALTER
-- shape already used successfully in
-- 04-platform/migrations/0005_payout_ledger_lock_columns.sql for the
-- 'locked'/'available' additions.

alter type payout_ledger_status add value if not exists 'pending_dispute';
alter type payout_ledger_kind add value if not exists 'dispute';

-- ---------------------------------------------------------------------------
-- RLS — no new table created by this migration. `payout_ledger`
-- already has RLS enabled (0001_initial.sql: partner-read-own +
-- admin-read; no anon/authenticated write policy — service-role only,
-- the append-only invariant). Re-asserted here defensively so the CI
-- RLS-coverage scanner (which now also scans this migrations dir)
-- finds an explicit statement in every migration that touches
-- payout-related schema.
-- ---------------------------------------------------------------------------
alter table payout_ledger enable row level security;
