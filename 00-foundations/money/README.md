# 00-foundations/money/

Money. Two flows: money in (Stripe, for customer purchases) and money out (PayPal Mass Payout, for partner/affiliate payouts). This folder is the boundary between "we touched money" and "the rest of the app got a result."

## Files

- **`cents.ts`** — the canonical money math + formatting layer. Bigint-safe arithmetic, bps-based discounts, royalty + subscriber-discount calculators. **The only file in the codebase that should touch cents math.** All feature-level money helpers (in `02-features/*/format.ts`) are thin wrappers over this one.
- **`stripe.ts`** — Stripe SDK wrapper. Methods: `getStripe()`, `verifyWebhook()`, `isStripeConfigured()`. Re-exports `withStripeErrorHandling`, `classifyStripeError`, `idempotencyKey`, `bucketedIdempotencyKey` from the sibling modules so call sites only need one import. Env-gated; throws if `STRIPE_SECRET_KEY` is empty.
- **`stripe-errors.ts`** — canonical Stripe error classifier + `withStripeErrorHandling<T>` wrapper. Every Stripe API call goes through the wrapper; returns a discriminated `StripeResult<T>` with typed `code` (one of 9) + PII-safe fields. Logs only the typed fields via pino — never `err.message`. 34 unit tests cover each rawType branch + fallback paths + the wrapper itself.
- **`stripe-idempotency.ts`** — canonical idempotency-key generator. `idempotencyKey(scope, ...parts)` returns `<scope>:<sha256-hex>` capped at Stripe's 255-char limit. `bucketedIdempotencyKey(scope, bucketSeconds, ...parts)` adds a time bucket for session-creation sites where retries within the window dedupe but later attempts get fresh sessions.
- **`refund-window.ts`** — `REFUND_WINDOW_DAYS = 14`. The single source of truth for the refund window. PH18 wires a `platform_settings.refund_window_days` read so admin can change the window without a code deploy (per STUB-011).

> Files the spec mentions but are not yet built (parked in `docs/PROGRESS.md` / `PHASES.md`): **`paypal.ts`**, **`tax.ts`**, **`currency.ts`** (split into `cents.ts` instead), **`encryption.ts`**, **`plr-license.ts`**, **`refund.ts`**. They're planned for the paypal + tax phases.

## cents.ts — the only money file you should touch

Every monetary value in Uthena is **integer cents** (bigint in DB, number or bigint in TS). No floats. No decimal strings. The `cents.ts` helpers are the single source of truth for any arithmetic, conversion, or formatting.

### Surface

| Function | Returns | Use when |
|---|---|---|
| `formatMoney(cents, currency?, locale?)` | `string` | Display a cents value as currency (`'$497.00'`). |
| `formatMoneyShort(cents, currency?, locale?)` | `string` | Display without decimals (`'$497'`). |
| `parsePriceToCents(input)` | `number` | Parse a user-typed price string (`"19.99"` → `1999`). |
| `addMoney(a, b)` | `bigint` | Sum two cent amounts. Negative inputs allowed (for debit modeling). |
| `subtractMoney(a, b)` | `bigint` | Subtract; **clamped at 0** (the right default for discounts — see JSDoc for refund-ledger exception). |
| `multiplyCents(cents, factor)` | `bigint` | Multiply by a small integer factor (quantity). |
| `applyDiscountBps(cents, bps)` | `bigint` | Discount amount in cents, **floor** (we never over-discount). |
| `discountFromBps(cents, bps)` | `bigint` | Alias for `applyDiscountBps`. |
| `calculateRoyalty(lineTotal, bps)` | `bigint` | Royalty cents owed on a line, **floor** (we never over-pay a partner). |
| `calculateSubscriberDiscount(unitPrice, bps)` | `bigint` | Subscriber discount cents off (PLR-tier only by convention; call site gates on `license === 'plr'`). |
| `applyBps(cents, bps)` | `bigint` | Legacy ROUND variant. Kept for any pre-existing round-based caller; prefer `applyDiscountBps` for new code. |
| `assertCents(n, label?)` | `bigint` | Throw on negative / non-integer; returns bigint. Use at module boundaries (CSV import, manual ledger correction). |

### Bigint safety

Every arithmetic helper returns `bigint` and accepts `number | bigint`. JavaScript `number` is silently imprecise above 2^53 - 1 cents (~$90 trillion) — Uthena will not hit that in v1, but the day it does we'd be debugging rounding bugs in payouts instead of shipping features. Bigint-native math means we never have to think about it.

The convention at the DB write boundary is: do the math in bigint, convert to number at the very last step before inserting. Supabase handles the number → bigint column write transparently (as long as the cents value fits in a JS safe integer, which it always will).

### Floor vs round — why it matters

- **Floor** for customer-facing discounts (`applyDiscountBps`) and partner payouts (`calculateRoyalty`). We never over-discount a buyer or over-pay a partner.
- **Round** (legacy `applyBps`) is preserved only for backward compat. Half-cent boundary cases like `100 × 50 / 10000 = 0.5` would round up to 1 cent in `applyBps` but floor to 0 in `applyDiscountBps`. The one-cent difference matters at scale.

### Example — checkout math

```ts
import {
  addMoney,
  calculateRoyalty,
  calculateSubscriberDiscount,
  multiplyCents,
  subtractMoney,
} from '@foundations/money/cents'

const unit = tier.price_cents // e.g. 10000 ($100)
const unitDiscount = calculateSubscriberDiscount(unit, discountBps) // 1500n (15% off)
const unitAfter = subtractMoney(unit, unitDiscount) // 8500n (post-discount)
const lineTotal = multiplyCents(unitAfter, row.quantity) // 25500n (3 × $85)
const lineDiscount = multiplyCents(unitDiscount, row.quantity) // 4500n
const royalty = calculateRoyalty(lineTotal, royaltyBps) // 3825n (15% of post-discount)

// Bigint → number only at the DB write boundary:
await supabase.from('order_items').insert({
  unit_price_cents: tier.price_cents,
  unit_price_after_discount_cents: Number(unitAfter),
  line_total_cents: Number(lineTotal),
  subscriber_discount_cents: Number(lineDiscount),
  royalty_cents: Number(royalty),
})
```

### What does NOT go here

- Stripe / PayPal SDK wrappers (in their own files: `stripe.ts`, `paypal.ts`).
- Webhook handlers (those are in `04-platform/webhooks/`).
- The actual checkout UI (that's in `02-features/checkout/`).
- The actual payout UI for partners/affiliates (that's in their respective feature folders).
- Tax form collection (v2; we'll add a new file when we add it).

If you find yourself writing money math inline in a feature module, you're in the wrong place. Add it to `cents.ts` and re-export from the feature if you need a feature-specific name.

## stripe.ts — money in (env-gated wrapper)

```ts
import {
  isStripeConfigured,
  getStripe,
  withStripeErrorHandling,
  idempotencyKey,
  bucketedIdempotencyKey,
} from '00-foundations/money/stripe';

if (!isStripeConfigured()) {
  return { ok: false, error: 'Payments temporarily disabled.', code: 'stripe_unconfigured' }
}

const stripe = getStripe()
const result = await withStripeErrorHandling(
  () => stripe.checkout.sessions.create(
    sessionParams,
    { idempotencyKey: idempotencyKey('checkout_session', order.id) },
  ),
  { surface: 'checkout.createCheckoutSession' },
)
if (!result.ok) return { ok: false, error: result.message, code: 'unknown' }
const session = result.data
```

**Env-gated.** `getStripe()` throws if `STRIPE_SECRET_KEY` is empty; `isStripeConfigured()` returns false in that case. This means the rest of the app can import this without breaking the build — call sites must check `isStripeConfigured()` before issuing a real call.

**All operations go through `withStripeErrorHandling`.** The wrapper catches every Stripe SDK error, classifies it into a typed `StripeResult<T>` (success vs. one of 9 typed failure codes), logs a PII-safe shape via pino, and returns a discriminated union the caller can pattern-match on. See `stripe-errors.ts` for the classification rules.

**Idempotency keys on every write.** `idempotencyKey(scope, ...parts)` returns a SHA-256-fingerprinted key of shape `<scope>:<hex>` (capped at Stripe's 255-char limit). For session-creation sites where retries shouldn't dedupe to the same response indefinitely, `bucketedIdempotencyKey(scope, bucketSeconds, ...parts)` adds a time bucket so retries within the window dedupe but later attempts get a fresh session. Every Stripe write call in the codebase passes an idempotency key — see the table below for the exact key shapes.

**PCI compliance:** we're SAQ-A eligible. We don't store, process, or transmit any cardholder data. The Stripe integration is the minimum that PCI-DSS allows.

**Webhook signature verification:** mandatory. The webhook handler in `04-platform/webhooks/stripe/handleStripeWebhook.ts` calls `verifyWebhook(rawBody, signature)` on every incoming event. Unverified events are rejected.

### Idempotency key shapes per call site

| Surface | Scope | Parts | Notes |
|---|---|---|---|
| `createCheckoutSession` | `checkout_session` | `order.id` | Stable per order; each order is its own attempt. |
| `startSubscription` | `sub_session` | `user.id`, `priceId`, `bucket` (30s) | 30s bucket — double-click within 30s dedupes; later attempt gets fresh session. |
| `cancelAtPeriodEnd` | `sub_cancel` | `sub.id` | Stable per (sub, action). Two cancel clicks dedupe to the first response. |
| `resumeSubscription` | `sub_resume` | `sub.id` | Stable per (sub, action). |
| `openBillingPortal` | `billing_portal` | `user.id`, `bucket` (60s) | 60s bucket — portal URL is single-use anyway. |
| `getRecentInvoices` | — (read) | — | Reads don't get idempotency keys. |

### Error code → user-facing message mapping

`withStripeErrorHandling` returns a `StripeFailure` with a typed `code`. The default user-facing message comes from `defaultUserMessage[code]` — chosen from a small static lookup so we never echo Stripe's raw error messages (which can be misleading or include internal terminology). Call sites that want a surface-specific message (e.g. "Could not start your subscription." for the subscription flow) should ignore `failure.message` and supply their own. The codes are:

| Code | When | Default message |
|---|---|---|
| `stripe_unconfigured` | `STRIPE_SECRET_KEY` is empty | "Payments are temporarily disabled. Try again later." |
| `card_declined` | `card_error` with `decline_code` | "Your card was declined. Try a different payment method." |
| `authentication_required` | `authentication_error`, `invalid_grant`, `temporary_session_expired` | "Payment service is misconfigured. Contact support." |
| `invalid_request` | `invalid_request_error` (4xx other than auth/card) | "Invalid payment request. Refresh and try again." |
| `rate_limited` | `rate_limit_error` (429) | "Too many requests. Wait a moment and try again." |
| `api_connection` | `StripeConnectionError` (no response) | "Could not reach the payment service. Try again." |
| `api_error` | `api_error` (5xx) | "The payment service had an error. Try again or contact support." |
| `idempotency_conflict` | `idempotency_error` (reused key, different params) | "This payment is already in progress. Refresh and try again." |
| `unknown` | Anything else | "Could not complete the request. Try again or contact support." |

## refund-window.ts — the refund policy

14 days from purchase. Buyer must demonstrate removal of downloaded files where applicable (we track `file_downloads` for this). `REFUND_WINDOW_DAYS = 14` is the single source of truth and is imported by refund request, order detail, checkout trust copy, and admin refund review.

If subscription products or memberships are introduced, cancellation must be self-service through account settings or Stripe's customer portal. A support-only cancellation path is not acceptable.

```ts
import { REFUND_WINDOW_DAYS } from '@foundations/money/refund-window'

// Used by:
// - the order page (shows "eligible until [date]")
// - the refund request flow
// - the admin review queue (to auto-approve or flag for review)
```
