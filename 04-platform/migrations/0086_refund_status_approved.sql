-- ---------------------------------------------------------------------------
-- 0086_refund_status_approved.sql — refund_status gains 'approved'
-- ---------------------------------------------------------------------------
-- The TS enum contract (00-foundations/data/enums.ts, RefundStatus) and
-- the admin refunds UI (02-features/admin/refunds/, P14.9 queue, stats
-- cards) already use 'approved' — the "admin committed, Stripe call in
-- flight, webhook hasn't confirmed 'succeeded' yet" state in the spec
-- vocabulary (spec `approved` ↔ DB `approved`). The enums.ts comment
-- attributed the DB value to "migration 0059", but 0059 never landed
-- (the numbering sequence has gaps: …0046, 0060…), so the database
-- enum was still ('pending','succeeded','failed','canceled') and the
-- bi-directional check-enum-coverage.sh gate failed. This migration
-- closes the gap on the DB side.
--
-- `alter type ... add value if not exists` is idempotent and safe to
-- re-run — same one-statement shape as 0072_payout_ledger_dispute_enums.sql.

alter type refund_status add value if not exists 'approved';

-- ---------------------------------------------------------------------------
-- RLS — no new table created by this migration. `refunds` already has
-- RLS enabled (0001_initial.sql: owner-read-own + admin policies;
-- writes go through service-role paths). Re-asserted defensively so the
-- CI RLS-coverage scanner finds an explicit statement in every
-- migration that touches refund schema.
-- ---------------------------------------------------------------------------
alter table refunds enable row level security;
