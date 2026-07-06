# Checkout — `/checkout`

## What this page does

The **multi-step** checkout wizard (P4.7). Auth-gated. URL-driven
via `?step=email|review`. Two local steps live on this page:

1. **Email** — confirm the receipt + library-access destination. The
   actual email-change flow is owned by P9.3; this step shows the
   current address and links into `/account/settings` to change it.
2. **Review** — items + coupon + legal links + the Pay button.

The **Payment** step happens on Stripe Checkout (hosted). We redirect
via `createCheckoutSessionAction` and the user returns to
`/checkout/success?order=…` (the existing **Confirmation** page).
Neither Payment nor Confirmation is rendered inside the wizard — the
CheckoutStepper shows all four so users see "Payment + Done are next"
from the moment they arrive.

The Payment step's "wizard entry" exists for the progress indicator
only — there is no `?step=payment` route. `parseCheckoutStep` clamps
unknown values to `email` so a typed garbage URL lands on a sensible
screen instead of an empty page.

## Data this page shows

| Section | Field | Source | Format |
|---|---|---|---|
| Stepper | step id, label, description, current state | derived | numbered bubbles + connector lines |
| Email step | user.email, user.display_name | `auth.users` (via `requireUser`) | pill + dl |
| Email step | "Update email" link to /account/settings | hard-coded | link |
| Review step — items | `product.title`, `product.thumbnail_url`, license, `unit_price_cents` | cart (server-side, RLS-aware via `getCart`) | line items |
| Review step — items | "Edit your cart" link to /cart | hard-coded | link |
| Subtotal | sum of `line_total_cents` | `getCartSubtotalCents` | money |
| Discount | coupon discount | `getAppliedCoupon` | money + coupon tag |
| Tax | `tax_cents` (calculated by Stripe Tax in v1) | Stripe | money (0 in v1) |
| Total | `subtotal - discount + tax` | computed | money, large |
| Payment | Stripe Payment Element | Stripe SDK | (redirect, not embedded) |
| Trust strip | "14-day return rights", "Secure checkout", "Instant download" | hard-coded | icons + text |
| Legal links | Terms + Refund Policy | hard-coded | inline links |

Cart is server-side: `02-features/cart/queries/getCart.ts`. Auth-only
cookie/localStorage cart is the project default; anon-cookie cart is
supported but the checkout page itself redirects anon users to
`/signup?next=/checkout`.

## User actions

| Action | Trigger | Result | RBAC |
|---|---|---|---|
| Advance to Review step | Click "Continue to review →" on EmailStep | `<Link>` to `/checkout?step=review` | requires auth |
| Go back to Email step | Click "← Back to email" on ReviewStep | `<Link>` to `/checkout?step=email` | requires auth |
| Edit cart | Click "Edit your cart" link | `<Link>` to `/cart` | requires auth |
| Apply coupon | Type code in coupon field, click "Apply" | Calls `applyCouponAction`, revalidates the route | requires auth |
| Remove coupon | Click "Remove" on the applied-coupon chip | Calls `removeCouponAction`, revalidates | requires auth |
| Pay | Click "Pay with Stripe" | Calls `createCheckoutSessionAction`, redirects to Stripe Checkout hosted URL | requires auth |
| Change email | Click "Update it in account settings" on EmailStep | `<Link>` to `/account/settings` (P9.3 owns the actual email-change flow) | requires auth |
| Sign in (for anon) | (this page requires auth; if anon lands here, redirect to /signup?next=/checkout) | — | requires auth |

## What this page does NOT do

- No quantity selector (always 1 in v1 — PLR is sold per-license, not per-seat)
- No BNPL (Klarna/Afterpay — v2)
- No crypto payment (v2)
- No gift wrapping / personal message (v2)
- No order notes (v2)
- No "create an account" checkbox on the contact form (we always require auth before checkout)
- No guest checkout (intentional — see "Why we require auth" in Security)
- No in-page payment form (we redirect to Stripe Checkout; the wizard's Payment step is a redirect, not a render)
- No multi-currency display (we charge in USD; Stripe handles FX at payment time)
- No checkout-time "saved methods" picker (P4.10): saved methods are surfaced by Stripe Checkout itself once we attach via `customer`; we do NOT render our own saved-methods list on the Uthena domain. Subscription renewals / management go through Stripe's hosted Billing Portal (`openBillingPortal.ts` in `@features/subscriptions`).

## Acceptance criteria

- [ ] Page is auth-gated — anonymous users redirect to /signup?next=/checkout
- [ ] Cart contents are correct (items, tiers, prices)
- [ ] Removing an item updates the cart and totals
- [x] **P4.5** — Coupon field accepts valid codes and applies discount correctly (the form is wired into the right summary column below the totals; valid codes attach to eligible cart lines via `applyCouponAction` and revalidate the page)
- [x] **P4.5** — Invalid coupon shows an inline error and does not change totals (Zod input validation + 5 coupon-lookup error paths + 3 eligibility gates return `role="alert"` inline messages; cart state is never mutated on failure)
- [x] **P4.5** — Subtotal, discount, tax, total all sum correctly (math is right) — the discount row uses `applyDiscountBps(subtotalCents, coupon.discount_bps)` from `00-foundations/money/cents` (floored, bigint-safe); total = subtotal − discount + tax (tax = 0 in v1, calculated by Stripe at payment)
- [x] **P4.7 Slice 1** — Multi-step wizard layout. /checkout renders the CheckoutStepper at the top and the active step's body below. Step transitions are `<Link>`-driven (`?step=email|review`), no client-side state machine needed. URL-driven state means back / forward / shareable links just work.
- [x] **P4.7 Slice 1** — Stepper shows all 4 steps (Email → Review → Payment → Confirmation) with current / done / upcoming states derived from `parseCheckoutStep`'s result. Active step carries `aria-current="step"`; completed steps render the check icon; future steps render their number.
- [x] **P4.7 Slice 1** — Email step shows the account email + a "Continue to review →" CTA. Empty / missing email surfaces a "(missing account email)" sentinel instead of crashing. A "Change email" link points to /account/settings.
- [x] **P4.7 Slice 1** — Review step shows the cart items + the order summary + the Pay button + the legal links. Same content as the legacy single-page /checkout (the existing pay button is now `02-features/checkout/components/PayButton.tsx` — moved out of `/app/checkout/` so the feature owns its UI).
- [x] **P4.7 Slice 1** — `?step=` is parsed by `parseCheckoutStep`. Unknown / missing values fall back to `email`; SQLi / CRLF / raw-percent payloads never escape the parser (defense in depth). Round-trip through `checkoutStepHref` is verified by unit test.
- [x] **P4.7 Slice 1** — `PayButton` styles are token-only (the legacy inline-styled button in `/app/checkout/PayButton.tsx` was deleted; the new feature-layer version lives at `02-features/checkout/components/PayButton.tsx` with a co-located `.module.css`).
- [ ] Stripe Checkout (hosted) accepts test cards
- [ ] Pay button is disabled when `STRIPE_SECRET_KEY` is missing (existing `isStripeConfigured()` gate + the "Payments disabled" notice on Review step)
- [ ] Pay button shows a loading state during payment processing
- [ ] On payment success: redirect to /checkout/success?order=[id]
- [ ] On payment failure: show error inline, don't lose cart state
- [ ] On payment success: cart is cleared
- [ ] On payment success: library_grants are created (verified by querying the library page)
- [ ] On payment success: payout_ledger entries are created for partner share (verified in admin)
- [ ] On payment success: orders row created with status='paid', stripe_payment_intent_id set
- [ ] Idempotency: if the user double-clicks Pay, only one order is created
- [ ] Webhook from Stripe confirms the order (we don't trust the client return URL alone)
- [ ] If webhook arrives before the client return, the success page still works
- [ ] Tax is calculated correctly (Stripe Tax in v1; manual in v2)
- [ ] Mobile responsive (single-column layout < 768px)
- [ ] Page renders in < 500ms p95 (Stripe redirect adds latency, but the wizard body itself is RSC + tree-shaken)
- [ ] No `TODO` / `FIXME` in the diff
- [x] **P4.10** — Stripe Checkout offers Card / Apple Pay / Google Pay / Link (Dashboard-driven) — `createCheckoutSessionAction` does NOT pass `payment_method_types`, so the Stripe Dashboard's "Payment methods" config decides which methods are offered. This lets ops enable Apple Pay on Safari/iOS without code changes. The same pattern applies to `startSubscriptionAction` for consistency. **Runtime verification** (Apple Pay actually showing up on Safari/iOS, etc.) requires a real `STRIPE_SECRET_KEY` + Dashboard config — deferred until P4.8 (Stripe Tax wiring unblocks the Stripe live account).
- [x] **P4.10** — Returning buyers see their saved payment methods on the Stripe-hosted Checkout page. `createCheckoutSessionAction` looks up the user's most recent order's `stripe_customer_id` and passes `customer: <id>` to the session when present; `customer_email` is the first-time fallback. Stripe Checkout then surfaces the buyer's saved cards (Card / Apple Pay / Google Pay / Link methods they previously used). For first-time buyers, Stripe creates a Customer on payment success and `onPaymentSucceeded` writes the ID back to `orders`, so subsequent checkouts attach via `customer`. Same pattern applied to `startSubscriptionAction` for subscriptions.
- [x] **P5.9** — Subscriber discount is visible on the Review step. When the signed-in user has an active or trialing subscription AND at least one PLR-tier line in the cart is eligible (per-tier override is null OR > 0), the Review step renders (a) a per-line "Subscriber 15% off" tag on every qualifying PLR line and (b) a "Subscriber discount" row in the totals sidebar showing `−$<amount>`. Both are derived from `calculateCartSubscriberDiscount(lines, discountCtx)` — a pure shared helper. The `createCheckoutSessionAction` server action uses the SAME helper, so the UI total can never disagree with what Stripe charges.
- [x] **P5.9** — Subscriber discount eligibility is PLR-only. MRR / RR / personal license lines never show the subscriber tag, even when the user is a subscriber — the discount is a PLR-tier perk.
- [x] **P5.9** — Partner per-row opt-out works. When `product_pricing.subscriber_discount_bps = 0` for a (product, license) tier, that tier is opted out of the subscriber discount — no per-line tag + no contribution to the totals row, even for active subscribers. Explicit non-null values (e.g. 1000 = 10%) override the platform default. `null` (or absent) inherits the platform default from `PLR_SUBSCRIBER_DISCOUNT_PCT_BPS`.
- [x] **P5.9** — Inactive / canceled / past_due subscribers see no discount. The tag + totals row only render when `getSubscriberDiscountContext().isActive === true` (active or trialing + `current_period_end > now()`).
- [x] **P5.9** — Subscriber discount stacks with coupon per the spec's "larger wins" rule. When both are present, `createCheckoutSessionAction` picks the larger of the two; the Review step shows whichever applied (or both rows, with the unused one suppressed). Coupon discount is shown only when applied (`applied_to_lines > 0`); subscriber discount is shown only when `any_applied === true`.

## Design reference

- Mockup: not yet built — to be created during the checkout feature build
- Components: `00-foundations/ui/Stepper.tsx` (new — referenced in the foundations README), `02-features/checkout/components/CheckoutWizard.tsx`, `EmailStep.tsx`, `ReviewStep.tsx`, `PayButton.tsx`, `CheckoutStepper.tsx`, `parseCheckoutStep.ts`

## Security

- **Auth required:** YES — anonymous users redirect to /signup
- **Allowed roles:** customer, partner, affiliate, admin (anyone with an account)
- **RLS policies that apply:** `cart_items` (self only), `orders` (self only), `order_items` (via order), `product_pricing` (public read on active)
- **PII displayed:** yes — email, name (collected in the form). Never logged to console. Stored encrypted at rest.
- **PII in URLs:** no — order IDs are `bigint` not PII
- **Audit logged:** yes — order creation, payment success, payment failure all logged
- **PCI compliance:** we never touch card data. Stripe Elements handles it. We are SAQ-A eligible.
- **CSRF:** server actions are CSRF-protected via Supabase auth session + same-site cookies
- **Idempotency:** Pay button generates a client-side idempotency key, sent to Stripe and our server. Double-submit creates one order.
- **Webhook signature verification:** mandatory. Stripe webhook handler verifies `stripe-signature` header. Reject unsigned events.
- **Third-party scripts:** Stripe.js (loaded from js.stripe.com). No others.

### Why we require auth for checkout

We don't do guest checkout. Reasons:
1. We need to create `library_grants` keyed on user_id. Doing this for anonymous sessions means a "claim your library" step that always breaks for someone.
2. The 14-day refund policy needs an account to issue refunds to.
3. Audit log is more useful with a user_id.
4. Affiliate attribution works correctly (cookies can be cleared; account IDs can't).

If the user comes from an affiliate link, the affiliate_id is stored on the order, attributed via cookie at signup time.

## Performance

- **Target p95:** < 500ms
- **Render strategy:** RSC + SSR
- **Cache:** none — this is a user-specific page
- **Stripe Elements:** loaded async, doesn't block first paint
- **Bundle size budget:** < 80KB added to client bundle (Stripe.js + Elements)

## Out of scope for v1

- Quantity > 1 (always 1)
- Saved payment methods
- BNPL (Klarna, Afterpay)
- Crypto payments
- Gift wrapping / notes
- Order notes
- Guest checkout (intentionally out — see Security)
- Multi-currency display (we charge in USD; the user sees USD; Stripe handles FX if their card is in another currency)
- Subscription products (v2)
- Bundle checkout (v2)
- Order bumps (v2 — common in PLR offers like "add this for $27")

## Open questions for human

- **Anonymous cart → account merge:** when an anon user signs up mid-flow, do we (a) merge their session cart into their account, (b) discard the session cart, or (c) prompt them? My recommendation: prompt with a clear "Keep your items?" modal. Default to keep. (Add to v1 if simple, otherwise punt to v2.)
- **Order bumps:** PLR offers often have "$27 add-on" style bumps. Skip for v1 to keep checkout clean?
- **Stripe Tax:** Stripe Tax costs 0.5% of transaction. Worth it for v1 or do manual tax handling in v1 and Stripe Tax in v2? My recommendation: Stripe Tax in v1 from day one, since manual tax is a compliance nightmare we don't want to own.
- **Subscription cancellation if v2 scope moves forward:** checkout has no subscription products in v1. If memberships/subscriptions are added, the checkout and account specs must add a prominent self-service cancellation path before launch; support-only cancellation is not acceptable.

---

## Implementation notes

- **P4.5** — Coupon code input shipped. The `CouponForm` lives in the right summary column below the totals; it accepts an `applied: { code, label } | null` initial state (server-side read from `getAppliedCoupon`). When applied, the form swaps to a coupon badge + Remove button (calls `removeCouponAction`). When empty, it renders the input + Apply button. Both states use `useTransition` for the action call. The Discount row uses `applyDiscountBps` from `00-foundations/money/cents`. Total = subtotal − discount. Both `applyCouponAction` and `removeCouponAction` are tested (28 unit tests across `actions/applyCoupon.test.ts` + `actions/removeCoupon.test.ts`); all 6 checks green + `pnpm build` clean (`/checkout` is `1.4 kB / 118 kB` first-load JS, the +700 B is the CouponForm client island). See the cart spec for the full P4.5 implementation notes (migration + action refactor + query helper + component refactor).
- **P4.7 Slice 1** — Multi-step wizard. URL-driven via `?step=email|review`. The wizard itself is a pure rendering layer (`CheckoutWizard` in `02-features/checkout/components/`) — no DB, no I/O; the page route resolves `?step=`, fetches the cart + coupon + stripe-readiness in parallel, and hands the payload to the wizard. Step transitions are plain `<Link>` navigation, so the back button + shareable URLs work without any client-side state machine. The shared `Stepper` primitive in `00-foundations/ui/Stepper.tsx` (was referenced in the foundations README but didn't exist — this slice ships it) is the visual progress indicator; the four-step list `Email → Review → Payment → Confirmation` is owned by `CheckoutStepper` so every surface that needs "what are the checkout steps?" gets the same answer. The `Payment` step is on Stripe's domain (we redirect); the `Confirmation` step is the existing `/checkout/success` page. Both are visible in the stepper so users see what's next, but neither is rendered inside the wizard. `parseCheckoutStep` is the single source of truth for `?step=` validation — pure function, no I/O, unit-tested (8 tests covering canonical ids, missing/garbage fallback, case-insensitivity, CRLF / SQLi / raw-percent payloads, round-trip with `checkoutStepHref`). The legacy `PayButton.tsx` was moved out of `/app/checkout/` into `02-features/checkout/components/PayButton.tsx` and converted from inline styles to token-only CSS (per the AGENTS.md "no inline colors" rule). All 6 checks green + `pnpm test` 1143/1143 (was 1121, +22 new: 13 Stepper + 9 parseCheckoutStep) + `pnpm build` clean (`/checkout` is `368 B / 121 kB` first-load JS — the wizard body is pure RSC; the +20 kB delta from the shared 101 kB baseline is the PayButton client island).
- **P5.9** — Subscriber discount display + shared helper. The UI now shows the subscriber discount on the Review step in two places: a per-line "Subscriber 15% off" tag on every qualifying PLR line (only when the line actually got a discount), and a "Subscriber discount" row in the totals sidebar. Both are derived from a single new helper `calculateCartSubscriberDiscount(lines, discountCtx)` in `02-features/subscriptions/lib/`. The helper is pure (no DB, no I/O) and is the same code that `createCheckoutSessionAction` uses to compute the per-line `subscriber_discount_cents` written to `order_items`. This guarantees the UI total can never disagree with the amount Stripe actually charges — the previous shape had two separate inline implementations (one in the action, one nowhere — the UI just didn't show it). The helper exposes `resolveLineSubscriberBps(line, ctx)` as a standalone function too, for future call sites that need the rate alone. Eligibility: (a) user is an active or trialing subscriber with `current_period_end > now()` (from `getSubscriberDiscountContext`), (b) line license is PLR, (c) the line's per-tier override `product_pricing.subscriber_discount_bps` is either null (inherit platform default) or a positive number (custom rate). A tier with `subscriber_discount_bps = 0` is explicitly opted out. The page route passes the computed result as a new `subscriberDiscount` prop on `CheckoutWizard` → `ReviewStep`; the wizard itself stays a pure rendering layer. The cart query (`getCart`) now selects `product_pricing.subscriber_discount_bps` so per-tier opt-out is visible to the UI without an extra round-trip. 19 new unit tests in `calculateCartSubscriberDiscount.test.ts` covering every eligibility branch, floor-rounding, quantity, per-tier opt-out, mixed carts, empty carts, the inactive-subscriber edge case, the all-non-PLR case, and the pure-function invariants (no input mutation, bigint output, never over-discount). All 6 checks green + `pnpm test` passing + `pnpm build` clean (43 routes; `/checkout` first-load JS unchanged because both new files are server-side).
