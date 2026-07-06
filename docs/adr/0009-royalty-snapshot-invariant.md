# ADR-0009 — Royalty engine snapshot invariant + proportional refund math

> **Status:** Accepted
> **Date:** 2026-06-26
> **Deciders:** Mavis (cron) + Philip (foundations)
> **Supersedes:** none
> **Superseded by:** none

---

## Context

The royalty engine computes what Uthena owes each partner when an order is
paid and claws it back when an order is refunded. Two invariants must hold
for the partner-facing ledger to be reconcilable against the actual Stripe
payouts:

1. **Snapshot at order time.** When a partner changes their `royalty_pct_bps`
   on the partner row (admin promotes them, partner negotiates a new rate,
   etc.), every historical `payout_ledger` row must stay frozen at the rate
   in effect AT THE TIME the order was paid. Re-deriving royalty from the
   live partner row at refund time would silently rewrite history.
2. **Proportional refund math.** A $25 partial refund on a $100 order at
   15% royalty must claw back exactly 15% × 25% = $3.75 of the $15 royalty.
   Not the full $15. Not 3× the $15 across multi-item carts. The ledger
   must mirror the underlying order's actual payout.

Pre-P6.9 code violated invariant #2 with the literal
`amount_cents: -it.royalty_cents` — the proportional refund math was
never implemented; every refund (full or partial) clawed back the full
sale royalty. Pre-P6.9 code also hardcoded `currency: 'USD'` on refund
ledger rows, breaking multi-currency catalogs.

The audit (see `docs/ROYALTY-ENGINE-AUDIT.md`) verified invariant #1 was
already enforced by reading `order_items.royalty_cents` + `order_items.royalty_pct_bps`
in both the payment and refund flows (never re-querying `partners`) but
no tests locked that contract. The audit surfaced invariant #2 as a
production bug and added the missing `calculateRefundRoyalty` helper.

---

## Decision

### Snapshot invariant (already enforced, now mechanically locked)

- `order_items.royalty_cents` and `order_items.royalty_pct_bps` are
  populated at checkout-create time from `partner.royalty_pct_bps` (or
  the global default `platform_settings.default_royalty_pct_bps`).
- `onPaymentSucceeded` and `onRefund` NEVER read `partners.royalty_pct_bps`.
  They only read `order_items.royalty_cents` + `order_items.royalty_pct_bps`
  and propagate those values to `payout_ledger`.
- The `payout_ledger` row's `royalty_cents` and `royalty_pct_bps` columns
  are therefore a frozen snapshot of the rate at order time.
- Locked in by 4 explicit assertions in `onPaymentSucceeded.test.ts` +
  `onRefund.test.ts` (see `docs/ROYALTY-ENGINE-AUDIT.md` §5 for the
  4 assertions).

### Proportional refund math (new in P6.9 cycle)

- New helper `calculateRefundRoyalty(saleRoyaltyCents, orderTotalCents, refundAmountCents)`
  in `00-foundations/money/cents.ts:180` computes the proportional clawback:
  `floor(saleRoyalty × (refundAmount / orderTotal))`, clamped at the
  full sale royalty.
- `onRefund.ts:129-133` calls it per line item when writing the refund
  ledger row.
- For a full refund (`refundAmount === orderTotal`), the formula
  collapses to `-saleRoyalty` (the full royalty is clawed back).
- For a partial refund, the clawback is proportional — never more than
  was earned on the original sale.
- The currency on the refund row matches the order's currency (was hardcoded
  to `'USD'` before P6.9; now reads `order.currency`).

### Append-only invariant

- `payout_ledger` rows are NEVER UPDATEd or DELETED after insert. Refunds
  write new `kind='refund'` rows; the original `order_sale` row stays
  unchanged. Future clawback / dispute-reversal flows will also write
  new rows (P6.8 Slices 2-3 + STUB-061).
- Enforced by the absence of any INSERT/UPDATE/DELETE RLS policies for
  `anon` and `authenticated` roles; all writes go through service-role.

---

## Consequences

### Positive

- Partner accounting is reconcilable against actual Stripe payouts for
  any partner, any historical order, any partial refund.
- Multi-currency catalogs work — EUR / GBP / USD orders produce
  matching-currency refund rows so per-currency aggregates stay balanced.
- Future per-tier royalty overrides (`subscriber_discount_bps` opt-out,
  partner-specific promotional rates, etc.) compose cleanly with the
  snapshot because the snapshot is captured at order time and never
  re-derived.
- A future "edit historical royalty" admin tool would need to write
  compensating ledger rows, not UPDATE originals — the append-only
  invariant keeps the audit trail intact.

### Negative / risks

- The `payout_ledger` table is append-only by policy but the DB doesn't
  enforce it via triggers or unique constraints. A future refactor that
  adds an UPDATE policy would break the invariant silently. **Mitigation:**
  any RLS policy change to `payout_ledger` should be reviewed against
  ADR-0009 + the audit doc.
- The `royalty_pct_bps` column on the refund row is informational (the
  audit trail of "this refund was computed at X%") — future UI surfaces
  must NOT re-derive royalty from this column; they should use the
  amount math instead.
- `calculateRefundRoyalty` does floor-based rounding, matching the rest
  of the money module. For orders where the refund amount has fractional
  cents (rare in practice — Stripe uses integer cents), this means a
  small rounding error in the partner's favor over many partial refunds.
  Acceptable per AGENTS.md "we never over-discount a customer, we never
  over-pay a partner" — but worth noting if a future surface needs
  exact reconciliation.

---

## Open questions

1. **Should `refund_source_ledger_id` be a FK on the refund row?**
   Currently reconstructible via `refunds.order_id` → `order_items.id`
   → `payout_ledger.order_item_id`. Tracked as item #6 in
   `docs/ROYALTY-ENGINE-AUDIT.md` §6.
2. **Should the refund row carry a `refund_ratio` column?**
   Currently reconstructible from `refunds.amount_cents / orders.total_cents`.
   Tracked as item #7 in `docs/ROYALTY-ENGINE-AUDIT.md` §6.

---

## References

- `docs/ROYALTY-ENGINE-AUDIT.md` — the full audit with invariants + edge cases + bugs
- `00-foundations/money/cents.ts:180` — `calculateRefundRoyalty` helper
- `00-foundations/money/cents.test.ts` — 18 tests for `calculateRefundRoyalty`
- `02-features/checkout/actions/onRefund.ts:129-133` — call site + currency propagation
- `02-features/checkout/actions/onPaymentSucceeded.ts:111` — snapshot propagation (untouched by P6.9)
- `02-features/checkout/actions/createCheckoutSession.ts:173-175` — checkout-time snapshot
- `04-platform/migrations/0001_initial.sql:903-905` — append-only RLS invariant
- AGENTS.md §"Working with the database" — RLS + append-only guidance