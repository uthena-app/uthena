# Feature: subscriptions

`personal_access` tier ($19/mo) — active subscribers get 15% off all PLR-tier one-time orders at checkout. The subscription does NOT grant library access in v1 (that's PH08); the entire v1 subscriber benefit is the discount.

- **Spec:** [`01-specs/pages/account-subscriptions.md`](../../01-specs/pages/account-subscriptions.md)
- **Migration:** [`04-platform/migrations/0002_subscriptions.sql`](../../04-platform/migrations/0002_subscriptions.sql) — `subscriptions` table + `subscription_status` enum + `has_active_subscription(uuid)` helper
- **Owner:** Mavis
- **Depends on:** `@foundations/money/stripe`, `@foundations/data`, `@foundations/auth`, `@features/checkout` (extended in PH07 with the discount engine)
- **Depended on by:** `library` (PH08 — subscription grants come in v1.1), `affiliate` (the discount stacks with affiliate attribution, not with coupons)
- **Status:** Phase 5 complete — P5.1 / P5.2 / P5.3 / P5.4 / P5.5 / P5.6 / P5.7 / P5.8 / P5.9 / P5.10 all shipped (P5.7 ships the last 12 months window + PDF per invoice)
- **Test locally:** `pnpm test 02-features/subscriptions`; webhook flow via `stripe listen --forward-to localhost:3100/api/webhooks/stripe`
- **Open follow-ups:** see `01-specs/pages/_followups.md`

## Layout

```
02-features/subscriptions/
├── queries/
│   ├── getSubscriptionForUser.ts   — read the current user's subscription row
│   ├── getSubscriberDiscountContext.ts — { isActive, discountBps } used by checkout
│   └── getRecentInvoices.ts        — **last 12 months** of invoices via Stripe API (server-side, time-windowed via `created[gte]`)
├── actions/
│   ├── startSubscription.ts        — server action: opens Stripe Checkout (subscription mode)
│   ├── cancelAtPeriodEnd.ts        — server action: cancel-at-period-end (idempotent)
│   ├── resumeSubscription.ts       — server action: resume before period ends (idempotent)
│   └── openBillingPortal.ts        — server action: mint a Billing Portal session URL
├── components/
│   ├── SubscriptionStatusCard.tsx  — status pill + next renewal + cancel/resume
│   ├── StartSubscriptionCard.tsx   — empty state for non-subscribers
│   ├── RecentInvoices.tsx          — "Last 12 months" heading + PDF link per row (P5.7)
│   └── CancelConfirmDialog.tsx     — typed-confirm modal
├── format.ts
└── index.ts

03-app/account/subscriptions/
├── page.tsx                        — the RSC
├── page.module.css
└── CancelButton.tsx                — client island for the cancel flow
```

## Discount engine — load profile

The hot path is `createCheckoutSessionAction`. It calls `getSubscriberDiscountContext(userId)` once per checkout. The query is a single PK lookup on `subscriptions (user_id)` (the unique index makes this O(1)). At our scale (~10K users, ~5% subscribers = 500 active rows) the load is negligible — sub-millisecond per checkout.

We do **not** cache the discount context in process memory. Caching would be the wrong trade — subscription state flips (cancel-at-period-end, past-due) need to be visible to the very next checkout, and the query is cheap enough that a stale cache is worse than a fresh read. If we ever see 100+ RPS on checkout, we add a 30s edge-cache here. v1: no cache.
