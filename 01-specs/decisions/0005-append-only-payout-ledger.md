# ADR-0005: Append-only payout ledger

**Date:** 2026-06-12
**Status:** Accepted
**Deciders:** Human, platform agent

## Context

Uthena has a complex money flow. Every sale splits into three: 60% to the partner, 20% to the affiliate (if any), 20% to the platform. Refunds can happen at any time. Disputes can be filed. Payouts can fail. Partners can leave the platform and come back.

The challenge: **how do we accurately track who is owed what, at any point in time, given that the past is not always settled (refunds after payout, clawbacks, etc.)?**

The naive approach is to keep a running balance on each partner/affiliate record: `partners.balance_cents`. When a sale happens, we add 60% to the balance. When a payout happens, we subtract. Simple, but:

- **The balance is mutable.** It can be edited, deleted, or corrupted. An audit can't reconstruct the history.
- **Disputes are unanswerable.** A partner says "I should have been paid for this sale in March" — we have no record of why or why not.
- **Refunds are messy.** If a refund happens 30 days after payout, we have to subtract from a future payout. With a running balance, we just decrement. With a ledger, we add a negative entry. The math is the same, but the audit trail is not.

The accounting principle we need is **append-only**: every money event is a new row. Corrections are new rows. The history is immutable.

## Decision

**We maintain an append-only `payout_ledger` table.** Every money event is a new row. The current balance is computed by summing the relevant rows. Corrections are reversal entries, never edits.

## The schema

```sql
CREATE TABLE payout_ledger (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  
  -- Who this entry is for
  recipient_type  text NOT NULL CHECK (recipient_type IN ('partner', 'affiliate', 'platform')),
  recipient_id    uuid NOT NULL,  -- partners.id or affiliates.id
  
  -- What triggered this entry
  event_type      text NOT NULL CHECK (event_type IN (
    'sale_commission',    -- new sale (positive)
    'refund_void',        -- refund during hold period (negative)
    'refund_reversal',    -- refund after hold, before payout (negative)
    'refund_clawback',    -- refund after payout (negative)
    'manual_adjustment',  -- admin correction (positive or negative)
    'payout_submitted',   -- payout sent to PayPal (negative, marks available as gone)
    'payout_paid',        -- confirmed by PayPal (no balance change, just status)
    'payout_failed',      -- PayPal rejected (no balance change, but reversal)
    'forfeiture'          -- partner unreachable (negative)
  )),
  
  -- The money
  amount_cents    bigint NOT NULL,  -- can be negative for reversals/clawbacks
  currency        text NOT NULL DEFAULT 'USD',
  
  -- The source (what sale triggered this, if any)
  order_id        uuid REFERENCES orders(id),
  parent_entry_id uuid REFERENCES payout_ledger(id),  -- for reversals, the original entry
  
  -- Status (separate from amount, because the same row can be in different states)
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending',     -- created, but the hold period hasn't elapsed
    'available',   -- hold period elapsed, eligible for next batch
    'approved',    -- included in a batch (or being batched)
    'submitted',   -- sent to PayPal
    'paid',        -- confirmed by PayPal
    'cancelled',   -- voided (refund during hold, etc.)
    'reversed',    -- reversed by a later entry
    'forfeited'    -- abandoned (partner unreachable)
  )),
  
  -- The hold period
  available_at    timestamptz NOT NULL,
  
  -- The PayPal reference, once submitted
  paypal_payout_item_id text,
  paypal_batch_id       text,
  
  -- Idempotency
  source_event_id text,  -- e.g. "stripe:evt_12345" for the originating event
  
  -- Audit
  created_by      uuid REFERENCES profiles(user_id),  -- null for system-created
  notes           text
);

-- Indexes for the queries we run
CREATE INDEX idx_payout_ledger_recipient ON payout_ledger(recipient_type, recipient_id);
CREATE INDEX idx_payout_ledger_status ON payout_ledger(status) WHERE status IN ('available', 'approved');
CREATE INDEX idx_payout_ledger_order ON payout_ledger(order_id);
```

## The state machine

The `status` column is the row's state. Transitions:

```
pending → available → approved → submitted → paid
              ↓           ↓
          cancelled   cancelled
                                ↓
                            reversed (by a new row)
```

A row's `status` only moves forward. The exception is `cancelled`, which can happen from `pending`, `available`, or `approved` (when a refund voids the entry). The `reversed` state is set by a new row referencing it; the original row's status doesn't change (it stays `paid`), but the new row creates a negative balance.

## The current balance

The current balance for a partner is computed by summing the relevant rows:

```sql
-- Partner balance (positive = owed to partner, negative = clawed back)
SELECT COALESCE(SUM(amount_cents), 0)
FROM payout_ledger
WHERE recipient_type = 'partner'
  AND recipient_id = $1
  AND status NOT IN ('cancelled');
```

This is the "available" balance. The "pending" balance (not yet eligible for payout) is:

```sql
-- Partner pending balance
SELECT COALESCE(SUM(amount_cents), 0)
FROM payout_ledger
WHERE recipient_type = 'partner'
  AND recipient_id = $1
  AND status = 'pending';
```

These queries are run in views for performance:

```sql
CREATE VIEW partner_balances AS
SELECT
  p.id AS partner_id,
  p.user_id,
  COALESCE(SUM(l.amount_cents) FILTER (WHERE l.status != 'cancelled'), 0) AS balance_cents,
  COALESCE(SUM(l.amount_cents) FILTER (WHERE l.status = 'pending'), 0) AS pending_cents,
  COALESCE(SUM(l.amount_cents) FILTER (WHERE l.status = 'available' OR l.status = 'approved'), 0) AS available_cents
FROM partners p
LEFT JOIN payout_ledger l ON l.recipient_type = 'partner' AND l.recipient_id = p.id
GROUP BY p.id, p.user_id;
```

The view is computed on read. We don't denormalize the balance into the `partners` table. The ledger is the source of truth.

## The events that create ledger entries

### Sale completed (Stripe webhook)

When `payment_intent.succeeded` fires, we create **two** ledger entries:
- One for the partner (60% of the sale, in `pending`)
- One for the affiliate (20% of the sale, in `pending`, if there's an affiliate)
- (The platform's 20% is not a ledger entry — it's just retained revenue)

Both entries have `available_at = order.created_at + 7 days` (partners) or `+ 30 days` (affiliates).

### Refund during hold period (before `available_at`)

We update the original entry's `status` to `cancelled`. The amount stays (it's negative in the sense that the row exists but is excluded from the balance).

### Refund after hold, before payout

We create a new entry with `event_type = 'refund_reversal'`, `amount_cents = -original_amount`, `parent_entry_id = original.id`, `status = 'cancelled'` (immediate, no hold). The original entry's status doesn't change (it was `available` or `approved`); the new entry is the correction.

### Refund after payout

We create a new entry with `event_type = 'refund_clawback'`, `amount_cents = -original_amount`, `parent_entry_id = original.id`, `status = 'pending'` (with no hold; it will be deducted from the next batch). The original entry is untouched (it was `paid`); the clawback is a new debt.

### PayPal batch processed

The batch job updates all `submitted` entries to `paid` (or `failed`) based on the PayPal webhook. No new entries are created — the existing entries transition state.

## What we CANNOT do

- **Edit an existing ledger entry.** Once created, a row's amount, recipient, and event type are immutable.
- **Delete a ledger entry.** Not allowed. (Cancellations are status changes, not deletes.)
- **Combine two entries into one.** If we need to correct a 3-way split, we create 3 reversal entries.
- **Run a "fix balances" script that updates multiple rows.** That's the kind of thing an auditor would flag. Every change is a new row with `event_type = 'manual_adjustment'`.

## The "audit answer any question" test

The test: "Can we answer the question 'what did partner X earn in March 2026, and what was the net after refunds and clawbacks?'"

With the append-only ledger, the answer is a SQL query:

```sql
SELECT
  DATE_TRUNC('month', created_at) AS month,
  SUM(amount_cents) FILTER (WHERE event_type = 'sale_commission' AND status != 'cancelled') AS gross_earned,
  SUM(amount_cents) FILTER (WHERE event_type IN ('refund_void', 'refund_reversal', 'refund_clawback')) AS refunds,
  SUM(amount_cents) FILTER (WHERE event_type != 'manual_adjustment' AND status NOT IN ('cancelled', 'reversed')) AS net
FROM payout_ledger
WHERE recipient_type = 'partner'
  AND recipient_id = $1
  AND created_at >= '2026-03-01'
  AND created_at < '2026-04-01'
GROUP BY DATE_TRUNC('month', created_at);
```

This query can be answered at any point in the future, with full confidence that the data is correct. No "we think the balance was X" — the math is the math.

## Consequences

### Positive

- **Immutable history.** We can reconstruct the past at any point in time. Useful for disputes, audits, tax filings.
- **Easier debugging.** When something looks wrong, we can replay the events and see exactly what happened.
- **Compliance-friendly.** Tax authorities, partners asking for statements, our own finance team — all can get answers from the ledger.
- **Concurrent-safe.** Two webhook deliveries of the same event can race, but the `source_event_id` unique constraint prevents double-counting.
- **No "balance drift."** A bug in the balance-update logic can't accumulate over time. The math is always derived from the rows.

### Negative

- **Storage grows linearly with sales.** A platform with 10k sales/month accumulates 30k ledger rows/month (2 per sale for partner+affiliate, plus reversals). This is fine for our scale.
- **Some queries are slower.** Computing the current balance requires summing the relevant rows. We use materialized views for the most common queries.
- **Reversal logic is subtle.** Getting the hold-period logic right requires careful testing. We have a comprehensive test suite in `06-quality/tests/integration/ledger.test.ts`.

### Mitigations

- **Materialized views** for the common queries (current balance, pending balance, monthly earnings).
- **Indexes** on `(recipient_type, recipient_id)` and on `status` for the batch queries.
- **Idempotency** via `source_event_id` (unique constraint). The webhook handler is safe to retry.
- **Clear documentation** in `01-specs/pages/_data-model.md` and in the code comments.

## References

- The ledger schema: `01-specs/pages/_data-model.md` (`payout_ledger`)
- The state machine: `01-specs/pages/_data-model.md` (`payout_ledger.status`)
- The payout procedure: `05-ops/runbooks/payout-procedure.md`
- The webhook handler: `04-platform/webhooks/stripe.ts` and `04-platform/webhooks/paypal.ts`
