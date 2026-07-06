# Subscriptions — `/account/subscriptions`

## What this page does

The self-service subscription management page. Buyers with an active `personal_access` subscription can:
- See their current plan, status, and renewal date
- See what the subscription includes (PLR discount rate)
- Cancel the subscription at period end (Stripe Billing Portal is used for reactivation / payment method update)
- See the recent invoice history

Anon access redirects to `/login?next=/account/subscriptions`. Non-subscribers see the "Start a subscription" pitch with a CTA that opens the Stripe Checkout (subscription mode) for the configured `STRIPE_PRICE_PERSONAL_ACCESS_MONTHLY` price.

Subscribers get 15% off all PLR-tier one-time orders via the subscriber discount engine wired into `createCheckoutSessionAction`. The discount is computed live from `subscriptions.status IN ('active','trialing') AND current_period_end > now()`. v1 = discount only. Library access via subscription is PH08. Subscriber-only products are out of scope for v1.

## Data this page shows

| Section | Field | Source | Format |
|---|---|---|---|
| Header | "Subscription" | hard-coded | H1 |
| Status | Plan name (`Personal Access`) | static | text |
| Status | Current state (`Active` / `Past due` / `Canceled`) | `subscriptions.status` | pill (semantic color) |
| Status | Next renewal date | `subscriptions.current_period_end` | localized date |
| Status | `cancel_at_period_end` badge | `subscriptions.cancel_at_period_end` | small pill when true |
| Discount | "You save 15% on all PLR orders" | hard-coded | muted text, conditional on active status |
| Action | "Manage in Stripe" | link to a Stripe Billing Portal session | button |
| Action | "Cancel at period end" | server action → DB update | button (with typed confirmation) |
| Action | "Resume" (when cancel_at_period_end=true) | server action | button |
| Invoices | **Last 12 months** of invoices (date, amount, status, link to Stripe-hosted PDF) | `stripe.invoices.list` with `created[gte]` filter | list rows |
| Empty state | "You don't have a subscription" | hard-coded | centered card with "Start a subscription" CTA |
| Paywall note | "Subscriptions are temporarily disabled" when Stripe key is missing | hard-coded | banner above the CTA |

**Queries / actions:**
- `getCurrentSubscription()` — read the current user's subscription row. Returns null if none.
- `getSubscriberDiscountContext(userId)` — returns `{ isActive, discountBps }`. Used by `createCheckoutSessionAction` to compute the per-line PLR discount.
- `startSubscriptionAction()` — server action that creates a Stripe Checkout Session in `mode: 'subscription'` with `STRIPE_PRICE_PERSONAL_ACCESS_MONTHLY`.
- `cancelAtPeriodEndAction()` — server action that calls `stripe.subscriptions.update(id, { cancel_at_period_end: true })` and updates the local row. Idempotent.
- `resumeSubscriptionAction()` — reverse of the above; only valid if `cancel_at_period_end=true` and the period has not ended.
- `openBillingPortalAction()` — server action that mints a Stripe Billing Portal session URL.
- `getRecentInvoices(limit?, olderThanMonths?, now?)` — last 12 months of invoices via Stripe API (defaults: `limit=24`, `olderThanMonths=12`). Each row links out to its Stripe-hosted `invoice_pdf` (or `hosted_invoice_url` fallback when the PDF hasn't been generated yet).

## User actions

| Action | Trigger | Result | RBAC |
|---|---|---|---|
| Start subscription | Click "Start a subscription" | Server action creates Stripe Checkout Session; redirect | auth |
| Cancel at period end | Click "Cancel at period end" → typed confirmation | Local row + Stripe subscription updated to `cancel_at_period_end=true` | auth (self only) |
| Resume | Click "Resume" | Subscription resumes; `cancel_at_period_end=false` | auth (self only) |
| Manage in Stripe | Click "Manage in Stripe" | Mint a Billing Portal session; redirect to Stripe | auth (self only) |

## What this page does NOT do

- **No subscriber-only library access** in v1 (PH08)
- **No plan upgrades / downgrades** in v1 (single tier $19/mo)
- **No free trial** in v1
- **No team / multi-seat subscriptions** in v1
- **No proration display** in v1
- **No subscription pause** in v1
- **No gift subscriptions** in v1
- **No annual plan** in v1

## Past-due recovery (P5.10)

When `subscriptions.status = 'past_due'` (set by the `invoice.{open,uncollectible}` webhook
branch in `onSubscriptionEvent.ts:177-186`), the page renders a dedicated
recovery banner above the layout grid so the user is nudged to update
their payment method.

| Field | Source | Format |
|---|---|---|
| Headline | hard-coded | "Your last payment failed" |
| Subhead | hard-coded | explains Stripe will auto-retry after the update |
| CTA (Stripe ready) | `openBillingPortalAction` | "Update payment method" — opens Stripe Billing Portal in a new tab |
| CTA (Stripe unconfigured) | `mailto:` link | "Contact support" — degrades gracefully |

The banner is an `<aside role="alert" aria-live="assertive">` (assertive
because user action is required). The CTA is a client island that calls
`openBillingPortalAction` — same action `ManageInStripeButton` uses, so
there's exactly one place that knows how to mint a portal session.

Dunning emails (the `invoice.payment_failed` → email cadence) are
deferred to Phase 17 (STUB-052).

## Acceptance criteria

- [ ] Page is auth-gated — anon users redirect to `/login?next=/account/subscriptions`
- [ ] Active subscribers see status, next renewal, the discount amount, and three actions
- [ ] Non-subscribers see the "Start a subscription" pitch
- [ ] When Stripe is not configured, the CTA is disabled with an inline notice
- [ ] "Cancel at period end" requires a typed-confirmation modal (user types "CANCEL")
- [ ] Cancel + Resume are idempotent
- [ ] Recent invoices list is empty for users with no invoices
- [ ] The 15% PLR discount is applied automatically at `/checkout` for active subscribers
- [ ] Webhook events `customer.subscription.{created,updated,deleted}` and `invoice.paid` / `invoice.payment_failed` update the local row idempotently
- [ ] Canceled subscriptions immediately stop applying the discount at checkout
- [ ] **P5.10** When `sub.status === 'past_due'`, a recovery banner renders above the layout grid with role="alert" + aria-live="assertive"
- [ ] **P5.10** Banner CTA calls `openBillingPortalAction` (same action as ManageInStripeButton) — fail-soft on Stripe-not-configured via a `mailto:` fallback
- [ ] **P5.10** Banner is not rendered for any other status (active, trialing, canceled, etc.)
- [ ] **P5.7** Invoice history shows the **last 12 months** of subscription invoices (heading "Last 12 months" + subtitle) — older invoices are filtered out server-side via Stripe's `created[gte]` parameter
- [ ] **P5.7** Each invoice row links out to its Stripe-hosted PDF (`inv.invoice_pdf`) when present, with a fallback to `inv.hosted_invoice_url` when the PDF hasn't been generated yet, and a muted dash when neither URL is available
- [ ] **P5.7** Invoice list renders cleanly (empty state) when the user has no invoices in the 12-month window — same empty card copy whether the gap is "never subscribed" or "subscribed but no charges in window"
- [ ] **P5.7** The 12-month filter is computed from the time of the request (`Date.now()`), not a build-time constant, so subscribers who refresh on day 366 see their first invoice fall off
- [ ] No `TODO` / `FIXME` in the diff

## Design reference

- Tokens: `00-foundations/design/tokens.css`
- Components used: `Button` (from `00-foundations/ui/primitives/Button.tsx`), inline cards/pills

## Security

- **Auth required:** YES — anon users redirect.
- **RLS:** `subscriptions_self_read` (self only) + `subscriptions_admin_all`.
- **PII displayed:** buyer's email (read from Stripe; not logged).
- **Webhook signature verification:** mandatory (existing `verifyWebhook` reused).
- **Idempotency:** webhook events deduped via `processed_webhooks`.
- **CSRF:** server actions CSRF-protected via Supabase auth session.

## Performance

- **Target p95:** < 300ms (one DB read on `subscriptions`; the invoice list is server-rendered from Stripe's `invoices.list`).
- **Render strategy:** RSC + tiny client island for the cancel confirmation modal.
- **DB load:** one PK lookup on `subscriptions (user_id)`. The discount engine used by checkout is the same query, called per checkout, not per request.

## Out of scope for v1

- Subscriber-only library access (PH08)
- Plan upgrades / downgrades
- Free trial
- Multi-seat subscriptions
- Subscription pause
- Gift subscriptions
- Annual plan
- Proration display
- Dunning / payment-retry email cadence (PH18)

## Implementation notes

### P5.7 — Invoice list + download (last 12 months, PDF per invoice)

- **Time filter is server-side.** Stripe's `invoices.list` accepts a `created[gte]` filter; we pass `Math.floor((Date.now() - 12 * 365.25/12 * 86400 * 1000) / 1000)` so older invoices never reach our process. The default `limit = 24` is a safety cap (≈2× a 12-month monthly cadence) — pathological cases (mid-cycle adjustments, refunds, credit memos) won't drop out, but the time window still bounds the response.
- **PDF link is always first.** When `invoice_pdf` is present, it's the primary affordance — `aria-label` carries the invoice number for screen-reader semantics. `hosted_invoice_url` is the fallback for very fresh drafts where Stripe hasn't generated the PDF yet. A muted dash renders when neither URL is present (defensive — should not happen for any real-world invoice).
- **No "all time" view in v1.** The `olderThanMonths` parameter accepts `null` to disable the filter, but the page does not expose this. A future "Download full history" button could.
- **12-month window is computed per-request, not build-time.** Subscribers who refresh on day 366 will see their first invoice drop off naturally. No background cron to "rotate" the window.

## Open questions for human

- **Trial period** — no trial in v1 (per spec).
- **Discount on the first month** — discount applies only after the first `invoice.paid` webhook lands.
- **Discount cap** — no stacking with coupon codes; larger wins.
- **Refund semantics on cancel** — no refunds in v1; access continues until period_end.
- **Multiple subscriptions per user** — one subscription per user in v1 (unique index on `user_id`).
