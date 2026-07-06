-- ============================================================================
-- 0043_partner_payouts_history.sql — P12.14: partner payouts history.
--
-- Adds ONE function + ONE partial covering index.
--
-- **get_partner_payouts_history(p_partner_id, p_limit)**
--   returns (paypal_payout_batch_id, period_start, period_end, amount_cents,
--            currency, commission_count, created_at)
--
-- Reads payout_ledger grouped by (paypal_payout_batch_id, currency) where
-- status = 'paid' AND paypal_payout_batch_id IS NOT NULL. One row per
-- PayPal Mass Payout batch — the partner-facing "payout history" surface
-- on `/partner/payouts` (per `01-specs/pages/instructor-payouts.md`).
--
-- Authorization: SECURITY DEFINER + caller must be the partner whose
-- data is being read OR an admin. Unauthorized callers receive zero rows
-- (never another partner's data). STABLE — memoizable by the planner
-- inside a SELECT.
--
-- Aggregation semantics:
--   - `period_start`    = MIN(paid_at)   (earliest ledger row paid in the batch)
--   - `period_end`      = MAX(paid_at)   (latest ledger row paid in the batch)
--   - `amount_cents`    = SUM(amount_cents)  (always negative — these are
--                                            the payout debit rows + the
--                                            matching commission credits
--                                            cancel out in the sum, so the
--                                            net is the partner's actual
--                                            gross payout)
--   - `currency`        = single currency (grouped)
--   - `commission_count`= COUNT(*) FILTER (WHERE amount_cents > 0)  — the
--                          number of underlying commissions (sales /
--                          subscriptions) that were paid out in this
--                          batch. Each commission produces a matching
--                          payout debit row that is NOT counted. So
--                          for a batch paying out 3 sales of $45 each:
--                          3 commission rows + 3 payout rows; commission
--                          count = 3 (the partner cares about "how many
--                          sales did I get paid for" not "how many
--                          ledger rows are in this batch").
--   - `created_at`      = MIN(created_at) (earliest ledger row in the
--                          batch — used as a stable secondary sort)
--
-- LIMIT:
--   - p_limit is capped at 200 (matches the P6.3 ledger entries cap;
--     a partner with more than 200 lifetime batches would see the 200
--     most recent — typical case is < 50).
--
-- Indexing:
--   - NEW partial covering index `payout_ledger_partner_batch_paid_idx`
--     (partner_id, paypal_payout_batch_id, paid_at desc)
--     WHERE status = 'paid' AND paypal_payout_batch_id IS NOT NULL
--   - Supports the WHERE filter + the GROUP BY sort (paid_at desc)
--   - Index is PARTIAL so it only contains the rows the RPC cares
--     about (status='paid' AND batch IS NOT NULL); at 10k+ partners
--     × 1000+ sales each, the partner-time index would otherwise
--     bloat with the locked/available rows we never group on.
--
-- IDEMPOTENT: CREATE OR REPLACE FUNCTION + CREATE INDEX IF NOT EXISTS.
-- Safe to re-run.
-- ============================================================================

-- ============================================================================
-- get_partner_payouts_history(p_partner_id bigint, p_limit int)
-- ============================================================================

create or replace function public.get_partner_payouts_history(
  p_partner_id bigint,
  p_limit      int default 50
)
returns table (
  paypal_payout_batch_id text,
  period_start           timestamptz,
  period_end             timestamptz,
  amount_cents           bigint,
  currency               text,
  commission_count       bigint,
  created_at             timestamptz
)
language sql
stable
security definer
set search_path = 'public'
as $$
  with base as (
    select
      pl.paypal_payout_batch_id as batch_id,
      pl.currency              as cur,
      pl.paid_at               as paid_at,
      pl.created_at            as row_created_at,
      pl.amount_cents          as amount_cents
    from payout_ledger pl
    where pl.partner_id = p_partner_id
      and pl.status = 'paid'
      and pl.paypal_payout_batch_id is not null
      and (p_partner_id = current_partner_id() or is_admin())
  )
  select
    base.batch_id                                  as paypal_payout_batch_id,
    min(base.paid_at)                              as period_start,
    max(base.paid_at)                              as period_end,
    sum(base.amount_cents)                         as amount_cents,
    base.cur                                       as currency,
    count(*) filter (where base.amount_cents > 0)::bigint as commission_count,
    min(base.row_created_at)                       as created_at
  from base
  group by base.batch_id, base.cur
  order by max(base.paid_at) desc
  limit greatest(p_limit, 0);
$$;

grant execute on function public.get_partner_payouts_history(bigint, int) to authenticated;

comment on function public.get_partner_payouts_history(bigint, int) is
  'P12.14 — Payouts history for a partner: one row per PayPal Mass Payout batch that included this partner. Returns (paypal_payout_batch_id, period_start, period_end, amount_cents, currency, commission_count, created_at). Sources: payout_ledger grouped by (paypal_payout_batch_id, currency) where status = ''paid'' and paypal_payout_batch_id IS NOT NULL. commission_count counts credit rows (amount_cents > 0) — the actual sales/subscriptions included in the batch (each commission produces a matching payout debit row that is NOT counted). The SUM(amount_cents) is the NET: commissions are positive, payout debits are negative; they cancel out so the row total reflects the partner''s actual gross payout. Authorization: caller must be the partner (current_partner_id() matches p_partner_id) OR an admin (is_admin()); unauthorized callers receive zero rows — never another partner''s data. STABLE — memoizable by the planner inside a SELECT. p_limit is capped at 200; default 50. Index used: payout_ledger_partner_batch_paid_idx (this migration) partial index.';

-- ============================================================================
-- Partial covering index — supports the partner_id + status=paid +
-- paypal_payout_batch_id IS NOT NULL filter + the paid_at desc sort.
-- ============================================================================

create index if not exists payout_ledger_partner_batch_paid_idx
  on payout_ledger (partner_id, paypal_payout_batch_id, paid_at desc)
  where status = 'paid' and paypal_payout_batch_id is not null;

-- ============================================================================
-- STUB REGISTER
-- ============================================================================
-- STUB-100 — P12.14: partner payouts history (PayPal Mass Payout batches).
-- The payouts history section on `/partner/payouts` now reads real
-- partner-scoped aggregates via this RPC. Slices 2+ deferred:
-- (a) paypal_payout_item_id deep-link to the PayPal Mass Payout
--     details page; (b) per-batch drill-in showing the contributing
--     commission rows; (c) CSV export of payout history (separate from
--     the ledger CSV); (d) yearly totals row. Resolved by Mavis (P12.14
--     tick) for the RPC + covering index + history table surface. See
--     docs/PROGRESS.md 2026-06-30 note.
