# ADR-0002: Stripe in, PayPal Mass Payout out

**Date:** 2026-06-12
**Status:** Accepted
**Deciders:** Human, platform agent

## Context

Uthena handles two money flows: **in** (when a customer buys a product) and **out** (when we pay partners and affiliates). We need to choose a payment processor for each flow.

The constraints:
- We sell globally (international customers)
- Partners/affiliates are in many countries, including some where Stripe is the dominant choice and some where PayPal is the only option
- We need to handle tax (VAT, sales tax)
- We need to be PCI compliant without becoming a security burden
- The product has 60/20/20 split (60% partner, 20% affiliate, 20% platform) — we need to automate the payouts

## The "in" flow: Stripe

We use **Stripe** for the "money in" flow.

### Why

- **Stripe Elements** lets us collect card details on Stripe's hosted UI. We never see card numbers, which keeps us in **PCI-DSS SAQ-A** territory (the lightest possible compliance burden).
- **Stripe Tax** (in v1) handles VAT, sales tax, and GST calculations globally. Costs 0.5% of transaction volume, which is well worth not running our own tax engine.
- **Stripe Connect** is on the v2 roadmap but not used in v1. We don't need it for the 60/20/20 split — we collect the full amount, then pay out separately via PayPal.
- **Stripe Customer Portal** gives users a self-serve way to manage payment methods, view invoices, and download receipts. We don't have to build any of that.
- **Stripe webhooks** are the most reliable in the industry. We rely on them for: `payment_intent.succeeded`, `charge.refunded`, `charge.dispute.created`.
- **Idempotency** is built in. We use idempotency keys on every API call.
- **Stripe Tax** also handles the 2026+ European DAC7 reporting requirements automatically.

### What we don't use (yet)

- **Stripe Connect** (for partner onboarding and direct payouts via Stripe) — deferred to v2
- **Stripe Subscriptions** — we don't have subscriptions in v1, only one-time purchases
- **Stripe Issuing** — not relevant

## The "out" flow: PayPal Mass Payout

We use **PayPal Mass Payout** for the "money out" flow.

### Why

- **PayPal is the only payment method that works for partners/affiliates in every country we care about.** Stripe Payouts (via Connect) works in 50+ countries; PayPal works in 200+. The long tail (e.g. partners in Vietnam, Pakistan, Nigeria) often only have PayPal.
- **PayPal email = bank account.** Our partners and affiliates give us their PayPal email. We pay to that email. PayPal handles the local transfer (bank, mobile money, etc.).
- **Mass Payout API** supports batch submissions (up to 500 items per call) with idempotency. We submit one batch per day with all eligible ledger entries.
- **Webhook events** for batch processed / item failed / item unclaimed. We rely on these to update the ledger.
- **No platform account needed for the recipient.** The recipient can claim the payout with just an email and a PayPal account (free to create).

### The cost

- PayPal charges ~2% per payout (varies by country). For a $100 payout, we pay ~$2 in fees. This is the platform's cost — we don't deduct it from the partner's amount.

## Why not Stripe Connect for payouts?

We considered it. The reasons we chose PayPal Mass Payout for v1:

1. **Reach.** Stripe Connect works in fewer countries than PayPal. We have partners in regions where Stripe Connect isn't available.
2. **Onboarding friction.** Stripe Connect requires the partner to complete Stripe's onboarding (KYC, bank account). PayPal Mass Payout only requires an email. Less friction for the partner.
3. **Cost.** Stripe Connect is cheaper per transaction (no PayPal's 2%), but the operational cost of supporting both is higher. We can revisit in v2.
4. **Refund/chargeback flow.** With Stripe in / PayPal out, if a refund happens, we control the in-flow (Stripe) and the out-flow is already past the hold period. With Stripe in / Stripe Connect out, the out-flow can be clawed back if the partner's account is closed, which adds complexity.

We accept the cost (PayPal's 2%) as a platform expense. The 20% platform cut covers it.

## The ledger

We maintain an **append-only `payout_ledger`** that records every commission event (sale, refund, reversal, clawback). The state machine is in `01-specs/pages/_data-model.md`. Corrections are new rows, never edits.

The ledger drives the daily PayPal batch. The batch is idempotent (uses `senderItemId` for deduplication).

## Consequences

### Positive

- **Global reach.** Partners and affiliates can be paid almost anywhere.
- **Simple compliance.** We are SAQ-A for cards (Stripe Elements). We don't handle money transmission for payouts (PayPal does).
- **Predictable per-transaction cost.** Stripe: 2.9% + 30¢ per card transaction + 0.5% for Stripe Tax. PayPal: 2% per payout. No surprises.

### Negative

- **Two vendors for money.** More integration, more webhook handlers, more to monitor.
- **PayPal's 2%** is a real cost. At scale, this adds up. Tracked as a platform expense.
- **Refunds + clawbacks are tricky.** A refund after the partner's hold period means we need to claw back the partner's earnings from a future payout. This works in our ledger but adds operational complexity.

### Mitigations

- **All money flow is in code** (`00-foundations/money/`). Two vendors is not a problem if the integration is well-structured.
- **The ledger handles clawbacks** with negative entries. The math always works out.
- **Refunds before the hold period** (the common case) just void the pending ledger entry. No clawback needed.

## References

- The 60/20/20 split spec: `01-specs/pages/instructor-payouts.md`, `01-specs/pages/affiliate-dashboard.md`
- The ledger: `01-specs/pages/_data-model.md` (`payout_ledger`)
- The payout procedure: `05-ops/runbooks/payout-procedure.md`
- The Stripe integration: `00-foundations/money/stripe.ts`
- The PayPal integration: `00-foundations/money/paypal.ts`
