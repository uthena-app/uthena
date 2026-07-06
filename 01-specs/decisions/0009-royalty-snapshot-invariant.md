# ADR-0009: Royalty engine — snapshot at order time, not at payout time

**Date:** 2026-06-26
**Status:** Accepted
**Deciders:** Human, platform agent
**Supersedes:** none
**Related:** [ADR-0005 — Append-only payout ledger](./0005-append-only-payout-ledger.md)

## Context

Uthena pays partners a royalty (typically 30%, configured per-partner via `partners.royalty_pct_bps` with a global default in `platform_settings.default_royalty_pct_bps`) on every order. The royalty is the partner's cut of the sale; the platform keeps the rest.

The question is: **when we compute the royalty for a given sale, do we use the partner's rate AT THE TIME OF THE SALE (snapshot) or AT THE TIME OF THE PAYOUT (live read)?**

The naive approach is to re-read `partners.royalty_pct_bps` every time the partner's ledger is summed (e.g. when the daily cron releases locked balances, when a payout batch is computed, when an admin views the partner's payouts page). Simpler code, but:

- **Historical rate changes rewrite history.** If a partner has their rate adjusted from 30% to 40% on March 15, every February sale that's still in the ledger now appears to have been at 40% — even though the partner earned 30% at the time. The partner sees a higher "earned" number than they actually should have received, and our books are wrong.
- **Refund math becomes ambiguous.** If a February sale is refunded in April (after the partner's rate changed), which rate do we use for the refund ledger row? The original (30%)? The new (40%)? Either way is defensible, but the choice must be deterministic.
- **Audits become impossible.** A partner asking "what rate did I earn on sale #12345 in February?" can't get a single, immutable answer. The answer depends on when they ask.

The alternative — **snapshot at order time** — freezes the rate on the `order_items` row when the order is created. The payout ledger reads from `order_items`, never from `partners`. Future rate changes don't rewrite history.

## Decision

**Royalty is snapshotted at order creation time. The payout ledger always reads the snapshot from `order_items`, never the live `partners.royalty_pct_bps`.**

### The data flow

```
1. CHECKOUT TIME
   createCheckoutSessionAction (02-features/checkout/actions/createCheckoutSession.ts)
     │
     ├─ Reads partner.royalty_pct_bps (or platform_settings.default_royalty_pct_bps fallback)
     ├─ Computes royalty_cents = calculateRoyalty(lineTotal, royaltyBps)
     │
     └─ INSERT into order_items:
          royalty_pct_bps = <bps>           ← snapshot
          royalty_cents    = <cents>        ← snapshot

2. PAYMENT TIME
   onPaymentSucceeded (02-features/checkout/actions/onPaymentSucceeded.ts)
     │
     ├─ Reads order_items.royalty_pct_bps + order_items.royalty_cents (THE SNAPSHOT)
     │
     └─ INSERT into payout_ledger:
          kind = 'order_sale'
          amount_cents    = order_items.royalty_cents   ← from snapshot
          royalty_pct_bps = order_items.royalty_pct_bps ← from snapshot

3. REFUND TIME
   onRefund (02-features/checkout/actions/onRefund.ts)
     │
     ├─ Reads order_items.royalty_cents (THE SNAPSHOT)
     ├─ Computes proportional refund: refundRoyalty = order_items.royalty_cents
     │                                  × (refundAmount / orderTotal)
     │  (or full royalty for a full refund)
     │
     └─ INSERT into payout_ledger:
          kind = 'refund'
          amount_cents    = -refundRoyalty  ← proportional
          royalty_pct_bps = order_items.royalty_pct_bps ← from snapshot (audit trail)
```

The snapshot lives in `order_items` (an immutable per-order row). The payout ledger never reaches back into `partners` to recompute the royalty. The order item row IS the source of truth.

### What this means in practice

- A partner's `royalty_pct_bps` change does NOT rewrite existing `payout_ledger` rows. The "View order details" page in `/partner/payouts/[id]` shows the snapshot rate with a note: "this is the rate at the time of sale, not your current rate." (P6.4 ships this UX.)
- The CSV export (`/partner/payouts` → "Export CSV") reads the same snapshot. Exporting in March 2027 for a January 2026 sale shows the January rate.
- Refund rows carry the same `royalty_pct_bps` as the original sale row (audit trail: "this refund was computed at X%").

## The math

### Sale royalty

```
royalty_cents = calculateRoyalty(line_total_cents, royalty_pct_bps)
             = (line_total_cents * royalty_pct_bps) / 10_000   -- FLOOR
```

See `00-foundations/money/cents.ts::calculateRoyalty`. FLOOR — the partner never receives more than `bps / 100` of the line total. Computed on the **post-discount** line total (so the partner doesn't get credit on the discounted portion).

### Refund royalty (proportional)

For a partial refund of `refund_amount_cents` on an order with total `order_total_cents`:

```
refund_proportion  = refund_amount_cents / order_total_cents   -- (0, 1]
per_item_refund    = floor(royalty_cents × refund_proportion)  -- FLOOR
refund_royalty     = sum(per_item_refund)                       -- across items
```

FLOOR again — we never give back MORE royalty than we paid out. A 50% refund of a 30%-royalty order returns 15% of the line totals, not 30%.

For a **full** refund (`refund_amount_cents === order_total_cents`), `refund_proportion === 1.0`, and the refund royalty equals the full sale royalty (the formula collapses to a negative of the sale row).

For an **over-refund** (theoretical — Stripe doesn't allow it, but defensive), `refund_amount_cents > order_total_cents` would yield `refund_proportion > 1.0`. We clamp to `1.0` so the refund royalty is never more than the original sale royalty. This is defensive code; in practice Stripe rejects over-refunds at the API level.

This is the `calculateRefundRoyalty` helper in `00-foundations/money/cents.ts` — proportional + floor + clamped at full-sale-royalty.

### Default-royalty fallback

When `partners.royalty_pct_bps IS NULL`, the system falls back to `platform_settings.default_royalty_pct_bps` (currently 3000 = 30%). The fallback is applied AT CHECKOUT TIME (snapshotted into `order_items.royalty_pct_bps`); the payout ledger never has to know that a default was used.

## Edge cases (P6.9 audit findings)

The audit (this tick) verified the following edge cases. Each is covered by a unit test in `02-features/checkout/actions/onRefund.test.ts` and `02-features/checkout/actions/onPaymentSucceeded.test.ts`.

### 1. Full refund (within or after lock window)

A full refund of any paid order writes a single `kind='refund'` row with `amount_cents = -royalty_cents` (negating the original sale). Whether the original sale is `locked` or `available` at refund time doesn't matter — the refund row is the correction; the original row's status is irrelevant.

### 2. Partial refund

A partial refund (e.g. user requests $50 back on a $100 order) writes a single `kind='refund'` row with `amount_cents = -floor(royalty_cents × 0.5)` — half the royalty. The remaining $50 of the order keeps its full royalty credited. **This was a bug** before P6.9 — the old code wrote `-royalty_cents` regardless of partial/full, which over-clawed-back the partner. Fixed in this tick.

### 3. Multi-item partial refund

A partial refund of an order with multiple items (different royalties) distributes proportionally across items. Each item's refund royalty is `floor(item.royalty_cents × refund_proportion)`. The sum of per-item refunds is the refund row's `amount_cents`. The proportions may not exactly equal the order-level proportion due to FLOOR, but they always sum to ≤ the original sale royalty (we never give back more than we paid).

### 4. Refund after lock window

The original `order_sale` row moves from `status='locked'` to `status='available'` after 14 days (the daily cron at `04-platform/ci/scripts/cron/release-locked-balances.ts` does the flip). A refund that arrives AFTER this flip still writes a `kind='refund'` row with `status='accruing'` and the same proportional refund royalty. The partner's available balance is reduced; the locked-then-available balance trail is preserved in the ledger.

### 5. Multiple refunds on the same order

If an order is refunded twice (e.g. user requests $30 then later $20 on a $100 order), the ledger has TWO `kind='refund'` rows, each with its own `amount_cents` (proportional). The sum of `order_sale.amount_cents` + `refund1.amount_cents` + `refund2.amount_cents` equals the net royalty earned. Each refund row carries its own `refund_id` link to the `refunds` table.

### 6. Currency consistency

The refund ledger row's `currency` column matches the original `order_sale` row's currency (and the `orders.currency` column). Before P6.9, the code hardcoded `currency: 'USD'` in the refund INSERT — a bug for EUR/GBP orders. Fixed in this tick.

### 7. Rate-change after sale (snapshot invariant)

If a partner's `royalty_pct_bps` changes from 3000 to 5000 after a sale is paid out, the existing `payout_ledger` rows for that sale are unchanged. Future sales use the new rate. The /partner/payouts page and the CSV export show the snapshot rate (3000) for the historical sale, not the current rate (5000).

### 8. Default-rate fallback at checkout

When `partners.royalty_pct_bps IS NULL`, the checkout reads `platform_settings.default_royalty_pct_bps`. The fallback is snapshotted into `order_items.royalty_pct_bps`. The payout ledger reads from `order_items`, not from `platform_settings` — so future changes to the default rate don't rewrite history either.

## What we CANNOT do (intentional)

- **Recompute historical sales when the rate changes.** Future sales use the new rate; historical sales keep their snapshot. If a partner wants their old sales "upgraded" to the new rate, that's a manual adjustment (admin-driven, writes a `kind='adjustment'` row — P6.8 Slice 2 territory).
- **Re-read `partners.royalty_pct_bps` at payout time.** The payout runner reads from `order_items.royalty_pct_bps`. This is the invariant. A code change that "optimizes" by re-reading from `partners` would break this ADR.
- **Refund more royalty than was earned.** The proportional formula is clamped at full-sale-royalty (refund_proportion = min(refund_amount / order_total, 1.0)). FLOOR prevents giving back fractional cents more than was earned.

## What this ADR does NOT cover

- **Stripe dispute reversal.** A dispute that's won by the customer is a charge reversal, which Stripe delivers as a `charge.refunded` event with the FULL charge amount (Stripe doesn't partial-reverse via disputes). Our existing `onRefund` handler reads the amount from the Stripe event, so dispute-driven refunds use the same proportional formula. This ADR doesn't add a separate `kind='dispute_reversal'` — the existing `kind='refund'` covers it (the `refunds.reason` column can be `'dispute_won'` for ops visibility).
- **Tax form integration (P6.10).** Tax forms affect whether the partner CAN be paid out at all, not how the royalty is computed. Out of scope for the royalty engine.
- **Payout batch math.** The `payout_ledger` is the source of truth for the payout runner. The runner sums `kind='order_sale'` + `kind='refund'` + `kind='adjustment'` rows in the partner's `status='available'` slice to determine the batch amount. This ADR doesn't change that math — it just guarantees the per-row amounts are correct.

## Consequences

### Positive

- **History is immutable.** Rate changes don't rewrite the past. Audit-able forever.
- **Refund math is deterministic.** The proportional formula is the only correct answer; no "which rate do we use" debate.
- **Code is simpler than the alternative.** The live-read approach would require every payout-sum query to JOIN to `partners` and apply the rate at read time — a per-query invariant that's easy to violate. The snapshot approach moves the invariant to a single location: `onPaymentSucceeded` + `onRefund` both read from `order_items`.
- **CSV exports are reproducible.** A partner downloading their ledger in March 2027 for January 2026 sales sees the January rate. Re-downloading in June 2027 yields the same numbers (modulo refund events).

### Negative

- **One extra write at checkout time.** The `order_items` row carries the snapshot, but it's already being written as part of the order creation. No extra cost.
- **Rate changes feel "stuck in the past" for the partner.** A partner whose rate was just increased has to wait for new sales to see the higher rate. The "View order details" page surfaces the snapshot rate with the explanatory note to set expectations.
- **Disputes need an explicit refund_reason.** Future refund UX (admin side, P14.9 territory) should require a reason selection so the `refunds.reason` column can distinguish `'dispute_won'` from `'requested_by_customer'`. Not enforced today.

### Mitigations

- **Unit tests** at `02-features/checkout/actions/onPaymentSucceeded.test.ts` + `onRefund.test.ts` cover all 8 edge cases above. The snapshot invariant is asserted by reading the captured INSERT payload (the test ensures `onPaymentSucceeded` selects from `order_items`, not from `partners`).
- **P6.4 ships the "snapshot rate" UX note** on the per-ledger-entry page so partners understand why old sales show old rates.
- **The CSV export** (`02-features/payouts/actions/exportLedgerCsv.ts`) renders the snapshot rate, not the current rate.

## References

- The snapshot invariant is implemented in `02-features/checkout/actions/createCheckoutSession.ts:225` (snapshot write) and `02-features/checkout/actions/onPaymentSucceeded.ts:142` (snapshot read).
- The refund math is in `02-features/checkout/actions/onRefund.ts` (post-P6.9 fixes).
- The proportional helper is `00-foundations/money/cents.ts::calculateRefundRoyalty`.
- The append-only ledger that holds the snapshot is ADR-0005.
- The daily lock-release cron is at `04-platform/ci/scripts/cron/release-locked-balances.ts`.