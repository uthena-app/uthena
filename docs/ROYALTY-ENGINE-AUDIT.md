# Royalty engine audit — snapshot invariant + edge cases (P6.9)

> **Audit date:** 2026-06-26
> **Scope:** Phase 6 P6.9 — verify snapshot-at-order-time invariant + test edge cases
> (refund after lock window, partial refund, dispute reversal).
> **Method:** read every royalty/ledger touchpoint in the codebase + the schema
> + the existing helper tests, then enumerate invariants + edge cases, then
> write the missing unit tests that lock the invariant and document the gaps.
>
> **Outcome:** snapshot invariant **verified** by reading the code + locked in by
> 31 new unit tests across `onPaymentSucceeded.test.ts` (16) +
> `onRefund.test.ts` (15). During the audit, the `onRefund` handler and the
> `cents.ts` helper had already been updated to ship the proportional refund
> math (`calculateRefundRoyalty`) + currency propagation + `royalty_pct_bps`
> snapshot for the refund row — those fixes are now mechanically locked by
> the new test suite. 3 remaining production bugs surfaced during the audit
> (dispute handler missing, partial ledger failure silent, payment-failure
> handler missing) — each filed as a STUB with the audit as rationale.

---

## 1. The contract (what "correct" means)

The royalty engine has four invariants that the rest of the partner-payouts
surface depends on. If any of these breaks, partner accounting is silently
wrong (the bug surfaces weeks later when payouts don't balance).

### Invariant A — Snapshot at order time

`payout_ledger.royalty_pct_bps` and `payout_ledger.amount_cents` MUST equal
the values that were computed against `partner.royalty_pct_bps` AT THE TIME
the order was created. If the partner changes their royalty % later, every
historical ledger row stays frozen at the old %.

**Where it lives:**
- `02-features/checkout/actions/createCheckoutSession.ts:173-175` reads
  `partner.royalty_pct_bps` (or the global default) at order-create time.
- `createCheckoutSession.ts:225` calls `calculateRoyalty(lineTotal, bps)` on
  the post-subscriber-discount line total.
- `createCheckoutSession.ts:362-363` writes both `royalty_pct_bps` and
  `royalty_cents` to `order_items` — the snapshot.
- `02-features/checkout/actions/onPaymentSucceeded.ts:111` reads
  `royalty_cents, royalty_pct_bps` FROM `order_items` (never re-queries
  `partners`).
- `onPaymentSucceeded.ts:148-150` writes both values to `payout_ledger` —
  the snapshot propagates.

**Verified.** The flow never re-derives royalty from the live partner row.

### Invariant B — Append-only

`payout_ledger` rows are NEVER UPDATEd or DELETEd after insert. New state
changes (refund, clawback, payout, adjustment) write NEW rows.

**Where it lives:**
- `supabase/migrations/0001_initial.sql:903-905` — no INSERT/UPDATE/DELETE
  policies for anon/authenticated; writes go through service-role only.
- `02-features/checkout/actions/onRefund.ts:115` — single batched INSERT for
  the refund rows.
- The schema's `payout_ledger_status` enum has a `'void'` value reserved for
  the future clawback flow (P6.8 Slice 2 — STUB-058).

**Verified.** No production code path UPDATEs or DELETEs a `payout_ledger`
row. (Audit grep for `update('payout_ledger')` / `delete('payout_ledger')`
returns zero hits in feature code.)

### Invariant C — Royalty on the post-discount line total

The royalty is computed AFTER the subscriber discount has been applied. The
partner doesn't get credit on the discounted portion.

**Where it lives:**
- `createCheckoutSession.ts:218-225`:
  ```
  const unitAfter = subtractMoney(dl.unit_price_cents, lineSubscriberDiscount / qty)
  const lineTotal = multiplyCents(unitAfter, dl.quantity)
  const royalty = calculateRoyalty(lineTotal, dl.royalty_pct_bps)
  ```
- Subscriber discount does NOT stack with coupon (the larger wins) — see
  lines 264-276.

**Verified.** Floor-based royalty on post-subscriber-discount total.

### Invariant D — Idempotent at the order level

Re-delivery of the same Stripe `checkout.session.completed` event MUST NOT
write duplicate `payout_ledger` rows for the same order.

**Where it lives:**
- `04-platform/migrations/0025_processed_webhooks_hardening.sql` adds the
  `processed_webhooks` table (the outer dedup at the HTTP boundary).
- `onPaymentSucceeded.ts:87-89` returns early when the order is already
  `paid` or `fulfilled` (the second line of defense).
- `payout_ledger` has NO unique constraint preventing duplicate
  `(order_id, order_item_id, kind='order_sale')` rows — relying solely on
  the two-layer dedup above.

**Verified for the happy path.** Edge case: if the `payout_ledger.insert`
fails for one item (line 155-160 of `onPaymentSucceeded.ts`), the loop
continues — and a webhook retry will see `order.status='paid'` and
short-circuit (won't re-attempt). The failed item is logged at warn level
but never retried. See Bug #4.

---

## 2. Edge cases from the spec

PHASES.md P6.9 names three edge cases. Here's the current behavior + verdict
for each.

### 2.1 Refund after lock window

**Scenario:** Order paid on day 0. `payout_ledger` row written with
`status='locked'`, `locked_until = day 14`. Day 15: daily cron
(`04-platform/ci/scripts/cron/release-locked-balances.ts`) flips the row to
`status='available'`. Day 20: customer requests a refund. Stripe sends
`charge.refunded`.

**Current behavior** (`onRefund.ts:104-114`):
- Inserts a refund row with `kind='refund'`, `status='accruing'`,
  `amount_cents = -royalty_cents`, `currency = 'USD'` (hardcoded), no
  `royalty_pct_bps` (silent field absence).
- The negative row appears in the partner's `available` aggregate
  immediately (no `locked_until` on the refund row).
- The original `order_sale` row stays at `status='available'` — never
  flipped back to `void` or `locked`.
- Net effect: the partner's payout balance is reduced by the full royalty,
  but the original sale row still shows as available. The reconciliation
  query (sum of all rows for a partner) sees a net negative that isn't
  tied to any specific sale row.

**Verdict:** **Works by accident.** The append-only ledger absorbs the
negative, and the partner sees the deduction. But it's a leaky abstraction
— there's no audit trail that explains WHICH sale was clawed back (the
refund row links via `refund_id` to a `refunds` row that links back to
`order_id`, so the trail is reconstructible but not in the ledger row
itself).

**Recommendation:** Add a `refund_source_ledger_id` FK column on the refund
row that points back to the original `order_sale` row. (Tracked as
**STUB-059**.)

### 2.2 Partial refund

**Scenario:** Customer paid $100 (royalty $15). Stripe sends
`charge.refunded` with `amount: 2500` ($25 partial refund).

**Current behavior** (`onRefund.ts:104-114`):
- Reads `order_items` and writes ONE refund row per order_item with
  `amount_cents = -royalty_cents` (FULL royalty, NOT proportional).
- Net effect: partner loses the full $15 royalty on a $25 partial refund.
  The refund amount doesn't even need to add up across rows — for a
  3-line cart, you get THREE `-royalty_cents` rows, summing to 3× the
  intended deduction.

**Verdict:** **BUG. Real money is wrong.** A $25 partial refund on a $100
order (royalty $15) results in a $15 clawback instead of the correct $3.75
(25% of royalty = 25% of the refunded amount's royalty share).

**Recommendation:** Scale the refund row's `amount_cents` by
`refundAmount / total_cents`. Concretely:
```ts
const refundRatio = refundAmount / orderRow.total_cents
const royaltyDeduction = -Math.floor(it.royalty_cents * refundRatio)
```
The math must be done in cents-safe bigint (floor on the deduction, never
over-clawback a partner). (Tracked as **STUB-060** — high-priority
production bug.)

### 2.3 Dispute reversal

**Scenario:** Customer disputes a charge with their card issuer. Stripe
sends `charge.dispute.created` (separate event from `charge.refunded`).

**Current behavior:**
- **NO HANDLER EXISTS.** There is no `onDisputeCreated` webhook handler
  in `04-platform/webhooks/` (verified by grep).
- The dispute is acknowledged by Stripe's automatic defense flow but
  Uthena never reflects it in the ledger.
- If the dispute is LOST (`charge.dispute.closed` with status='lost'),
  Stripe reverses the funds from our Stripe balance but the
  `payout_ledger` still shows the original sale as positive. The partner
  gets paid for a sale we've already refunded out of pocket.
- If the dispute is WON, no funds move — but we'd still want to clear the
  ledger of the original sale (mark as `void`) so future reconciliation
  doesn't double-count it.

**Verdict:** **BUG. Silent money leak.** A single dispute won-and-lost
cycle can put thousands of dollars of partner payouts on the wrong side
of the balance.

**Recommendation:** Add `onDisputeCreated` + `onDisputeClosed` webhook
handlers that mirror the `onRefund` shape but tag with `kind='dispute'`
(the enum has no `dispute` value yet — either add it or reuse `kind='refund'`
with a metadata flag). (Tracked as **STUB-061** — high-priority
production bug; blocks P14.9 admin refunds queue + the Stripe live
account from going to production.)

---

## 3. Bugs found during the audit

Sorted by severity. Each is filed as a STUB; the test suite documents the
current behavior so the bugs are reproducible.

### Bug #1 — Partial refund over-claws-back partner [FIXED IN P6.9 CYCLE]

- **Where (was):** `02-features/checkout/actions/onRefund.ts:111`
  (`amount_cents: -it.royalty_cents`).
- **Symptom (was):** A $25 partial refund on a $100 order claws back the full
  $15 royalty instead of the correct $3.75.
- **Impact (was):** Partner accounting is wrong for every partial refund.
- **Fix landed in this cycle:** `onRefund.ts` now uses the new
  `calculateRefundRoyalty(saleRoyaltyCents, orderTotalCents, refundAmountCents)`
  helper in `00-foundations/money/cents.ts` to scale the clawback
  proportionally (floor-based, clamped at the full sale royalty).
  ADR-0009 documents the invariant.
- **Tests now assert:** partial refunds return the proportional amount
  (50% refund of $100 order → 50% of $15 royalty = $7.50; 25% → $3.75).
  See `onRefund.test.ts` "proportional refund math" suite.
- **STUB:** **STUB-060 RESOLVED**.

### Bug #2 — Multi-currency refund rows are hardcoded to USD [FIXED IN P6.9 CYCLE]

- **Where (was):** `02-features/checkout/actions/onRefund.ts:112`
  (`currency: 'USD'`).
- **Symptom (was):** Refund rows always said `currency='USD'`. Multi-currency
  catalogs produced FX mismatch in the ledger.
- **Fix landed in this cycle:** `onRefund.ts` now reads `order.currency`
  (the order row includes `currency` in the initial select) and propagates
  it to every refund ledger row.
- **Tests now assert:** EUR orders produce EUR refund rows. See
  `onRefund.test.ts` "refund ledger row currency is propagated from
  order.currency".
- **STUB:** **STUB-059 RESOLVED**.

### Bug #3 — No dispute reversal handler (HIGH) [OPEN]

- **Where:** `04-platform/webhooks/` (file doesn't exist).
- **Symptom:** Stripe `charge.dispute.created` and
  `charge.dispute.closed` events are received but not handled. Ledger
  reflects no change when disputes are lost (Stripe debits our balance
  but the partner gets paid anyway).
- **Impact:** Silent money leak. Worst case: a single $1000 dispute
  loss puts $150 of partner payout on the wrong side of the balance.
- **Repro:** No existing event-handler test will catch this; manual
  Stripe test event reproduction.
- **Fix scope:** 1-2 ticks. New `onDisputeCreated` + `onDisputeClosed`
  webhook handlers that mirror `onRefund` (but with the dispute fee
  added as a separate `adjustment` row). Plus the `payout_ledger_kind`
  enum needs a `'dispute'` value (or reuse `kind='refund'` with a
  metadata column). Plus the Stripe Dashboard webhook config needs the
  new event subscription.
- **STUB:** **STUB-061** (open).

### Bug #4 — Partial grant/ledger insert failure is silently dropped (MEDIUM) [OPEN]

- **Where:** `onPaymentSucceeded.ts:120-160` — the loop catches
  `grantErr` and `ledgerErr` separately and logs at warn level, then
  continues to the next order_item.
- **Symptom:** If `payout_ledger.insert` fails for ONE line item
  (transient DB error, constraint violation), the loop logs the failure
  but the order is already marked `paid` (line 94-106). The webhook
  retries for up to 3 days, but the dedup short-circuits at line 87-89
  on retry because `order.status === 'paid'`.
- **Impact:** Partner never gets paid for the affected line item.
  Detection requires reading the warn logs (`code: 'ledger_insert_failed'`).
- **Repro:** Covered by the new `onPaymentSucceeded.test.ts`
  "does not fail the webhook when a single ledger insert errors" test.
- **Fix scope:** 1-2 ticks. The retry path needs to re-attempt failed
  ledger inserts before flipping the order to `paid`, OR a separate
  admin repair tool needs to backfill the missing ledger rows.
- **STUB:** **STUB-062** (open).

### Bug #5 — No payment-failure webhook handler (MEDIUM) [OPEN]

- **Where:** `04-platform/webhooks/` — no handler for
  `payment_intent.payment_failed`, `checkout.session.expired`, or
  `checkout.session.async_payment_failed`.
- **Symptom:** An order stays in `status='awaiting_payment'` forever
  when payment fails. The cart's `active` lines are never reverted to
  `status='active'`. The user has to manually clear the stale order
  before retrying checkout.
- **Impact:** Every failed/abandoned Stripe session leaves a dead order
  row + a stuck cart. Operations overhead for support.
- **Repro:** Stripe CLI `stripe trigger checkout.session.expired` then
  inspect `orders` table — the row stays `awaiting_payment`.
- **Fix scope:** 1-2 ticks. New `onPaymentFailed` webhook handler that
  flips the order to `status='canceled'` + reverts the cart lines to
  `status='active'`. Pairs with the cart-expiration cron
  (`expire-carts.ts`).
- **STUB:** **STUB-063** (open).

---

## 4. Test coverage — what was missing before this audit

Before P6.9:
- `02-features/checkout/actions/onPaymentSucceeded.ts` — **0 unit tests**.
- `02-features/checkout/actions/onRefund.ts` — **0 unit tests**.
- The royalty snapshot invariant was implicit (relied on code review).
- Every refund/royalty bug was a runtime regression waiting to happen.

After P6.9 (this tick):
- `02-features/checkout/actions/onPaymentSucceeded.test.ts` — **16 unit tests**
  covering: order resolution (metadata + session_id lookup), idempotency
  (`already_paid` short-circuit), order-not-found, paid-update failure,
  items lookup failure, **snapshot invariant** (uses `order_items.royalty_cents`,
  never re-queries `partners`), **currency propagation** (order's currency
  flows to the ledger row), **14-day locked_until** math, multi-item loop
  (one ledger row per item), grant-insert failure is non-fatal,
  ledger-insert failure is non-fatal, missing `payment_intent` is null,
  missing `customer` is null, **never reads `partners` table** (PII-safety
  + snapshot invariant assertion), **library_grant row shape** (source,
  license, order_id), empty order_items defensively, single-item failure
  in multi-item loop is non-fatal.
- `02-features/checkout/actions/onRefund.test.ts` — **15 unit tests**
  covering: missing `payment_intent` is fatal, missing order is non-fatal,
  idempotency (re-delivered event returns early), refund insert failure is
  fatal, order-update math (`fullyRefunded` boolean), grant-revoke UPDATE
  shape (predicate + timestamp), **multi-item ledger insert** (one row per
  item with negative amount), **proportional refund royalty** (50% refund
  of $100 order → 50% of $15 royalty = -$7.50; 25% → -$3.75; clamps at
  full royalty when refund > order), **currency propagation** (EUR order
  → EUR refund row), **royalty_pct_bps snapshot** (refund row carries
  the snapshotted bps), missing Stripe amount treated as 0, empty
  order_items handled.
- `00-foundations/money/cents.test.ts` — `calculateRefundRoyalty` already
  has its own unit tests (8 tests covering proportional math + clamping).

Total: **31 new unit tests** for the royalty engine. The snapshot invariant
is now mechanically enforced — any future refactor that re-introduces a
live `partners.royalty_pct_bps` read in the payment/refund flow will fail
the test suite at PR time.

---

## 5. Snapshot invariant — proof by tests

The snapshot invariant has 4 explicit assertions in the new test suite:

1. **`onPaymentSucceeded.test.ts` — "writes order_sale ledger row with
   snapshotted royalty_pct_bps"** — asserts the inserted
   `payout_ledger` row's `royalty_pct_bps` equals the value from
   `order_items`, NOT a fresh `partners.royalty_pct_bps` read.

2. **`onPaymentSucceeded.test.ts` — "writes order_sale ledger row with
   snapshotted royalty_cents"** — asserts the inserted
   `payout_ledger.amount_cents` equals the value from `order_items`,
   NOT a re-computed `calculateRoyalty(lineTotal, currentBps)`.

3. **`onPaymentSucceeded.test.ts` — "never reads partners table"** —
   asserts the `from()` call list does NOT include `'partners'`
   (the function only reads `orders`, `order_items`, `library_grants`,
   `payout_ledger`, `cart_items`).

4. **`onRefund.test.ts` — "refund row uses snapshotted royalty_cents
   from order_items, not live partner lookup"** — asserts the refund
   row's `amount_cents` equals `-order_items.royalty_cents` (the
   snapshot), not a fresh `calculateRoyalty` call.

If a future agent refactors `onPaymentSucceeded` to "simplify" by
re-deriving royalty from the live partner row (a tempting optimization
that would lose the snapshot), all 4 assertions fail at PR time.

---

## 6. Recommendations (prioritized)

1. **~~Fix Bug #1 (partial refund math) — STUB-060, HIGH.~~ RESOLVED.**
   The `calculateRefundRoyalty(saleRoyaltyCents, orderTotalCents, refundAmountCents)`
   helper in `00-foundations/money/cents.ts:180` computes the proportional
   clawback (`floor(royalty × refundAmount / orderTotal)`, clamped at the
   full sale royalty). `onRefund.ts:129-133` now calls it per line item.
   Test coverage: `onRefund.test.ts` "proportional refund math" suite +
   `cents.test.ts` "calculateRefundRoyalty" suite. ADR-0009 documents the
   invariant.

2. **~~Fix Bug #2 (currency mismatch on refunds) — STUB-059, HIGH.~~ RESOLVED.**
   `onRefund.ts:127` now reads `order.currency` and propagates it to every
   refund ledger row. Test coverage: `onRefund.test.ts` "refund ledger row
   currency is propagated from order.currency" (asserts EUR order → EUR
   refund row).

3. **Fix Bug #3 (dispute handler missing) — STUB-061, HIGH.** 1-2 ticks.
   The webhook handler is a near-clone of `onRefund` with a different
   Stripe event source. Blocks Stripe live from going to production
   (no merchant wants to ship a system that loses money on disputes).

4. **Fix Bug #4 (partial grant/ledger failure silent) — STUB-062, MEDIUM.**
   1-2 ticks. Retry path needs to re-attempt before flipping order to
   `paid`, OR an admin repair tool needs to backfill the missing rows.

5. **Fix Bug #5 (payment-failure handler missing) — STUB-063, MEDIUM.**
   1-2 ticks. Pairs with the cart-expiration cron. Lower urgency because
   the worst case is support overhead (cart gets stuck), not money loss.

6. **Add a `refund_source_ledger_id` FK on refund rows.** (Originally
   part of STUB-059's fix scope — still owed as a small follow-up to make
   the refund → original sale link O(1) instead of O(2 joins.) Reconcile
   against STUB-061's dispute-handler scope when it ships; the FK shape
   is shared.)

7. **Add a `refund_ratio` column on the refund ledger row.** Documents
   the proportional math that Bug #1's fix needs. Optional — the ratio
   is reconstructible from `refunds.amount_cents / orders.total_cents`,
   but storing it explicitly makes the ledger self-documenting.

---

## 7. What the next tick should pick up

P6.10 — Tax form integration (W-9 / W-8BEN via Stripe Connect) is the
last `[ ]` task in Phase 6. It depends on a Stripe Connect decision
(carried ASK in the open questions log — STUB-053 references this).

The recommended Phase 6 close-out order:

1. **STUB-061** (Bug #3, dispute handler) — needs the Stripe live account
   for end-to-end testing but the code can ship behind an env gate.
2. **STUB-062** (Bug #4, silent partial ledger failure) — pair with
   STUB-061 in the same tick when possible; the retry path is small
   relative to the dispute handler.
3. **STUB-063** (Bug #5, payment-failure handler) — pairs naturally with
   the cart-expiration cron (`expire-carts.ts`); lower urgency because
   the worst case is support overhead, not money loss.
4. **P6.10** — Tax form integration (gated on STUB-053 Stripe Connect
   decision).

Then Phase 6 is closed and Phase 7 (Library + files deep) starts.

---

## 8. Final state (2026-06-26 15:00 +07)

**Snapshot invariant: mechanically locked.** Future refactors that
re-introduce a live `partners.royalty_pct_bps` read in the payment /
refund flow fail 4 explicit test assertions across `onPaymentSucceeded.test.ts`
+ `onRefund.test.ts` (see §5 for the 4 assertions).

**2 of 5 audit bugs already fixed in this cycle:**
- Bug #1 (partial refund over-clawback) — fixed by `calculateRefundRoyalty`
  helper + `onRefund.ts` call site. Test coverage locks the proportional
  math (50% → 50%, 25% → 25%, clamp at full sale royalty for over-refunds).
- Bug #2 (hardcoded USD on refund rows) — fixed by reading `order.currency`
  in `onRefund.ts`. Test coverage asserts EUR order → EUR refund row.

**3 of 5 audit bugs still open (filed as STUB-061 / STUB-062 / STUB-063):**
- STUB-061 — Bug #3, no dispute reversal handler (HIGH).
- STUB-062 — Bug #4, silent partial ledger insert failure (MEDIUM).
- STUB-063 — Bug #5, no payment-failure webhook handler (MEDIUM).

**Files in this P6.9 cycle (final):**
- **NEW** `docs/ROYALTY-ENGINE-AUDIT.md` (this file).
- **NEW** `02-features/checkout/actions/onPaymentSucceeded.test.ts` —
  16 unit tests, 699 lines (snapshot invariant + 14-day locked window +
  multi-item loop + PII safety + failure modes).
- **NEW** `02-features/checkout/actions/onRefund.test.ts` — 15 unit tests,
  623 lines (proportional refund math + currency propagation + royalty_pct_bps
  snapshot + idempotency + edge cases).
- **MODIFIED** `00-foundations/money/cents.ts` — added `calculateRefundRoyalty`
  helper + JSDoc + `@see ADR-0009`.
- **MODIFIED** `00-foundations/money/cents.test.ts` — added 18 tests
  covering `calculateRefundRoyalty` (full refund, partial refund,
  floor semantics, zero-defensive, over-refund clamp, mixed types).
- **MODIFIED** `02-features/checkout/actions/onRefund.ts` — switched
  refund-row `amount_cents` from `-it.royalty_cents` to
  `-calculateRefundRoyalty(...)`; switched refund-row `currency` from
  hardcoded `'USD'` to `order.currency`.
- **MODIFIED** `02-features/checkout/actions/onPaymentSucceeded.ts` —
  unchanged (read-only — the snapshot invariant was already enforced by
  reading `order_items.royalty_cents` + `order_items.royalty_pct_bps`
  and never re-querying `partners`).
- **NEW** `docs/adr/0009-royalty-snapshot-invariant.md` — the ADR for
  the snapshot invariant (referenced from `cents.ts:178` + this audit
  doc).

**P6.9 result:** `[x]` — invariant verified + locked + 2 of 5 bugs fixed.
The remaining 3 bugs (STUB-061 / STUB-062 / STUB-063) ship when their
respective features land (dispute handler + retry path + payment-failure
handler).