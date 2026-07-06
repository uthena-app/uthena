# Feature: checkout

Cart → multi-step wizard (P4.7: Email → Review → Stripe-hosted Payment → Confirmation) → success / canceled outcomes. The webhook handler lives in `04-platform/webhooks/stripe/`; the Stripe SDK wrapper is in `00-foundations/money/stripe.ts`.

- **Specs:** [`01-specs/pages/checkout.md`](../../01-specs/pages/checkout.md), [`checkout-success.md`](../../01-specs/pages/checkout-success.md), [`checkout-canceled.md`](../../01-specs/pages/checkout-canceled.md)
- **Owner:** Mavis
- **Depends on:** `@features/cart`, `@features/catalog/queries`, `@foundations/money`, `@foundations/data`, `@foundations/auth`, `@foundations/ui/Stepper` (P4.7)
- **Depended on by:** `@features/library` (grants are created on payment success), `@features/affiliate` (commission attribution lives on the order)
- **Status:** P4.7 Slice 1 (wizard shell) + P4.10 (payment method picker, code done — runtime verification deferred until `STRIPE_SECRET_KEY` is wired). Payment (Stripe redirect) + Confirmation (existing `/checkout/success`) wired through the stepper.
- **Test locally:** `pnpm test 02-features/checkout`; the dev env has no Stripe key so the action fails closed with a typed error (see STUB-002)
- **Open follow-ups:** see `01-specs/pages/_followups.md`

## Layout

```
02-features/checkout/
├── queries/
│   ├── getOrderForConfirmation.ts   — order + items + grant count
│   └── getOrderForAccount.ts        — order detail for /account/orders/[id]
├── actions/
│   ├── createCheckoutSession.ts     — server action: builds the Stripe session (STUB-006: automatic_tax enabled)
│   ├── createCheckoutSession.test.ts — unit tests (P4.10 coverage + STUB-006 Stripe Tax + happy path + auth/Stripe gating)
│   ├── onPaymentSucceeded.ts        — checkout.session.completed handler; calls the mark_order_paid_and_grant RPC (STUB-062 atomicity fix)
│   ├── onPaymentSucceeded.test.ts   — unit tests incl. the STUB-062 RPC-failure regression test
│   ├── onRefund.ts                  — charge.refunded handler
│   ├── onRefund.test.ts
│   ├── onPaymentFailed.ts           — STUB-063: payment_intent.payment_failed / checkout.session.expired / checkout.session.async_payment_failed
│   ├── onPaymentFailed.test.ts
│   ├── onDispute.ts                 — STUB-061: charge.dispute.created / charge.dispute.closed
│   └── onDispute.test.ts
├── components/
│   ├── CheckoutWizard.tsx           — P4.7 orchestrator (RSC, URL-driven)
│   ├── CheckoutWizard.module.css
│   ├── CheckoutStepper.tsx          — the canonical 4-step list (Email/Review/Payment/Done)
│   ├── EmailStep.tsx                — first step: confirm receipt + library destination
│   ├── EmailStep.module.css
│   ├── ReviewStep.tsx               — second step: items + summary + Pay button
│   ├── ReviewStep.module.css
│   ├── PayButton.tsx                — client island that triggers the Stripe redirect
│   ├── PayButton.module.css
│   ├── parseCheckoutStep.ts         — pure URL-param parser (`?step=email|review`)
│   ├── parseCheckoutStep.test.ts    — 9 unit tests
│   ├── OrderSummary.tsx             — read-only summary used on success page
│   ├── CheckoutErrorBanner.tsx      — shows "Stripe not configured" etc.
│   └── PollLibraryReady.tsx         — client poll for the success badge
├── format.ts
└── index.ts
```

The Stripe webhook handler is at `04-platform/webhooks/stripe/route.ts` (the route itself) and `04-platform/webhooks/stripe/_handlers/onPaymentSucceeded.ts` (the business logic). The handler imports `onPaymentSucceeded` from this feature.

## P4.10 — Payment method picker

The Checkout (hosted) page is run by Stripe, not by us. Two pieces of plumbing ensure the buyer sees the right methods:

1. **Method availability (Card / Apple Pay / Google Pay / Link)** — `createCheckoutSessionAction` does NOT set `payment_method_types` on the session. Stripe defaults to the Dashboard's "Payment methods" config, so ops can flip Apple Pay / Google Pay / Link on or off without code changes. **Same pattern applied to `startSubscriptionAction`** for subscriptions. Hard-coding `['card']` here would silently block Apple Pay on Safari/iOS even when the Dashboard has it enabled — do NOT add `payment_method_types` unless a future requirement demands an override.
2. **Saved methods for returning buyers** — before building the session, `createCheckoutSessionAction` reads the user's most-recent order's `stripe_customer_id` from `orders` and passes `customer: <id>` to the session when present. Stripe Checkout then surfaces the buyer's saved cards on the hosted page. First-time buyers fall back to `customer_email`; Stripe creates a Customer on payment success and `onPaymentSucceeded` writes the ID back to `orders`, so the next checkout attaches via `customer`. **Same pattern applied to `startSubscriptionAction`** so a Subscription attaches to the same Customer as any prior one-time purchases.

### What ops needs to do (Stripe Dashboard)

Once `STRIPE_SECRET_KEY` is wired:

- Stripe Dashboard → Settings → Payment methods → enable Card (on by default), Apple Pay, Google Pay, Link.
- Apple Pay requires a registered Apple Pay Merchant ID + a verified domain (Stripe walks you through this).
- Link requires the Link financial product to be enabled for the account.

Runtime verification (does Apple Pay actually appear on Safari/iOS at `/checkout`) is gated on these Dashboard steps + a live `STRIPE_SECRET_KEY` — deferred until P4.8 unblocks the Stripe live account.
