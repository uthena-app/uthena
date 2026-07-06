# Checkout Success — `/checkout/success?order=[id]`

## What this page does

The post-payment confirmation page Stripe redirects to after a successful Checkout Session. Renders a big checkmark, a "Thanks for your order!" headline, a summary of the items purchased, a primary "Go to your library" CTA, a secondary "Browse more" link, and a "Download invoice" link. The page is auth-gated AND verifies the order belongs to the current user. Optimistic by design: the user sees the success UI even if the Stripe webhook hasn't landed yet; a small client-side poll upgrades the page to "Library is ready" once `library_grants` appear.

This page is the bridge between "Stripe says paid" and "library_grants exist". It is intentionally tolerant of the race between Stripe's client-side return URL and the asynchronous `checkout.session.completed` webhook — the page never shows an error for a successful payment, only a polite "still processing" state that resolves on its own.

## Data this page shows

| Section | Field | Source | Format |
|---|---|---|---|
| Header | "Thanks for your order!" | hard-coded | H1, large |
| Header | "Order #[id] confirmed" | `orders.id` from URL `?order=` | sub-headline, muted |
| Status badge | "Library ready" / "Finalizing your library…" | `library_grants` for `order_id` (count > 0 → ready) | pill, accent color |
| Order summary | per-line: `product.thumbnail_url`, `product.title`, `tier` | `order_items` JOIN `products` | list rows |
| Order summary | subtotal, tax, total | `orders.subtotal_cents`, `orders.tax_cents`, `orders.total_cents` | money row |
| Order summary | order date | `orders.created_at` | date, localized |
| CTAs | "Go to your library" | link → `/library` | primary button |
| CTAs | "Browse more" | link → `/browse` | secondary button |
| Invoice | "Download invoice (PDF)" | link → `/api/orders/[id]/invoice` (server action, signed URL) | text link with icon |
| Receipt email note | "We sent a receipt to [email]" | `profiles.email` of the buyer | small muted text |

**Queries / actions:**
- `getOrderForConfirmation(orderId, userId)` in `02-features/checkout/queries/getOrderForConfirmation.ts` — returns the order + items + grant count. Throws if `orders.customer_id !== userId`.
- `getLibraryGrantsForOrder(orderId)` in `02-features/library/queries/getLibraryGrantsForOrder.ts` — returns grant list; used to drive the "Library ready" badge.
- `generateInvoicePdf(orderId)` — server action in `02-features/checkout/actions/generateInvoice.ts` — mints a 24h signed URL to a server-rendered PDF, logs to `file_downloads` (kind = `document`).

## User actions

| Action | Trigger | Result | RBAC |
|---|---|---|---|
| View order | Land on `/checkout/success?order=[id]` | Page renders the order summary if owned by current user | self (must own the order) |
| Go to library | Click "Go to your library" | Navigate to `/library` | self |
| Browse more | Click "Browse more" | Navigate to `/browse` | public |
| Download invoice | Click "Download invoice (PDF)" | Server action mints signed PDF URL, opens in new tab | self |
| Resend receipt | Click "Resend receipt email" (small link) | Server action calls Resend, shows toast | self |
| Poll for grants | Page mounts | Client component polls `getLibraryGrantsForOrder(orderId)` every 5s for up to 60s, then stops and shows "This is taking longer than usual" with a support link | automatic |

## What this page does NOT do

- No upsell ("add another course for $X") — that's a v2 follow-up via `01-specs/pages/_followups.md`
- No social share button (v2)
- No "rate your purchase" prompt here (review submission is admin-curated in v1, see `product.md`)
- No live order tracking / shipping status (digital products, no shipping)
- No "what's next" tutorial overlay (the library page is the tutorial)
- No print-friendly view (PDF invoice is the printable artifact)
- No affiliate disclosure on this page (attribution is captured on the order row, not user-visible here)
- No cross-sell of related products (related products live on `/products/[slug]`, not on confirmation)

## Acceptance criteria

- [ ] Page is auth-gated — anon access to `/checkout/success?order=[id]` redirects to `/login?next=/checkout/success?order=[id]`
- [ ] If `?order=` is missing or not a valid bigint, show a friendly "We can't find that order" page (not a 500)
- [ ] If the order exists but belongs to a different user, redirect to `/account/orders` (do not leak existence)
- [ ] Renders the big checkmark, "Thanks for your order!" headline, and order summary correctly
- [ ] Lists every line item from `order_items` with thumbnail, title, tier
- [ ] Shows subtotal, tax, and total — all in cents-converted-to-formatted money
- [ ] Primary CTA "Go to your library" navigates to `/library` and the user's newly-granted products are visible
- [ ] Secondary CTA "Browse more" navigates to `/browse`
- [ ] "Download invoice" mints a signed PDF URL (24h TTL) and the download is logged to `file_downloads`
- [ ] Optimistic render: page shows success UI even if `orders.status = 'pending'` (i.e. webhook hasn't arrived yet)
- [ ] Status badge starts as "Finalizing your library…" and flips to "Library ready" once `library_grants` for this `order_id` are detected
- [ ] Client poll runs every 5s, stops after 60s, then shows "This is taking longer than usual — contact support" with a mailto link
- [ ] If `orders.status` flips to `failed` or `refunded` (extremely rare race), show a "Something went wrong" state with a "View order details" link to `/account/orders/[id]` and the support link
- [ ] Receipt email is sent by the Stripe webhook handler (not this page); this page only displays a "receipt sent" confirmation. If the email failed to send, the page still works.
- [ ] No PII leaked in logs (user_id, order_id logged; email never logged)
- [ ] No `TODO` / `FIXME` in the diff

## Design reference

- Mockup: `mockups/checkout-success.html` (dark) + `mockouts/checkout-success-light.html` (light) — **to be created during the checkout feature build**
- Design tokens: `00-foundations/design/tokens.css`
- Components: `00-foundations/ui/Button.tsx`, `00-foundations/ui/StatusBadge.tsx`, `00-foundations/ui/OrderSummary.tsx`
- Theme: both

## Security

- **Auth required:** YES — anon users redirect to `/login?next=...`
- **Allowed roles:** the customer who owns the order. Partner and admin can view any order via `/admin/orders/[id]`; this public-facing success page is customer-only.
- **RLS policies that apply:** `orders` (`orders_self_read` — `customer_id = auth.uid()`), `order_items` (inherits via `orders`), `products` (public read on `status='published'`), `library_grants` (`library_grants_self_read` — `user_id = auth.uid()`)
- **Order ownership check:** the page's RSC server component does an explicit `customer_id = auth.uid()` check in addition to RLS. If the check fails, redirect to `/account/orders` (defense in depth — RLS is a safety net, not the primary gate).
- **PII displayed:** yes — `profiles.email` (own email only). Used for "We sent a receipt to …" line. Never logged.
- **PII in URLs:** no — order IDs are bigint, not email or name. `?order=` is just the bigint.
- **Audit logged:** yes — every page render is logged to `admin_audit_log` (action: `view_order_confirmation`) ONLY for orders > $500 (high-value audit trail; routine orders are not logged to keep the table small). Every invoice PDF generation is logged to `file_downloads`.
- **CSRF:** the invoice-download server action is CSRF-protected via Supabase auth session + same-site `Lax` cookies.
- **Idempotency:** the client poll uses a stable query (no POST), so a 200ms-vs-5s race is impossible to double-fire. The Stripe webhook handler is idempotent via `processed_webhooks` table.
- **Third-party scripts:** none on this page (no Stripe.js needed — payment is done before we get here).

## Performance

- **Target p95:** < 300ms (one DB read for order, one for grants; both indexed)
- **Render strategy:** RSC. The status-badge "Library ready" flip is a tiny client component (`'use client'`) that polls every 5s for up to 60s, then unmounts. The poll is a `GET` to an RSC-friendly server action.
- **Cache:** none — this is a user-specific page; must reflect live `orders` / `library_grants` state.
- **DB load:** one PK lookup on `orders` + one index lookup on `order_items` + one index lookup on `library_grants` (filtered by `order_id`).
- **Bundle size budget:** < 10KB added to client bundle (the polling client component only).

### Webhook-ordering race — design decision

The success page is hit by Stripe's client-side return URL. The `checkout.session.completed` webhook may or may not have arrived by the time the user lands. There are three possible orderings:

| Ordering | What the user sees | What the system did |
|---|---|---|
| Webhook first, then user lands | Page reads `orders.status='paid'`, `library_grants` exist, badge = "Library ready" on first paint | Server-side, everything is already done |
| User lands first, then webhook (within 60s) | Page shows "Finalizing your library…" badge, poll detects grants, badge flips to "Library ready" | Client poll catches up |
| User lands first, webhook delayed > 60s | Page shows "Finalizing your library…" → after 60s shows "This is taking longer than usual — contact support" with mailto | The webhook handler is the source of truth; the poll is a UX nicety. Support gets paged from the admin side anyway. |

**Key principle:** the page never blocks the user on the webhook. The order row is created by the client-side return path AND by the webhook handler (idempotent insert keyed on `stripe_checkout_session_id`); whichever lands first wins, the other no-ops. The poll is a courtesy — the user can always navigate to `/library` and the grants will be there once the webhook completes.

## Out of scope for v1

- Upsell / order bumps on the success page
- "Rate your purchase" prompt (review submission is admin-curated in v1)
- Social share buttons
- Live order tracking
- "What's next" tutorial overlay
- Affiliate disclosure on this page
- Cross-sell of related products
- "Email me a copy of the receipt" button (the webhook already sends one; v1.5 follow-up if we see support requests)
- Multi-currency display (USD only)

## Open questions for human

- **Poll cadence and timeout.** My recommendation: poll every 5s for up to 60s (12 attempts), then bail with the "taking longer than usual" message. 5s is fast enough to feel instant once the webhook lands; 60s is generous enough for Stripe's 99p webhook latency. Acceptable, or do you want a different cadence (e.g. 2s for 30s, then a "refresh page" button)?
- **Should `/checkout/success` be reachable for an order that's still `pending` after 60s, or should we kick the user to a holding page?** My recommendation: keep them on success with the "taking longer" message. The order row exists; the grants will appear. The alternative — a separate "your payment is processing" page — adds a route and a state machine for a sub-1% edge case. Defer the holding page to v2.
- **Invoice PDF library.** My recommendation: server-render with `@react-pdf/renderer` (no headless browser needed, runs in the Next.js serverless function). Alternative: headless Chromium (heavier, slower, more cost). Approve `@react-pdf/renderer` for v1?
- **"Resend receipt" link — include in v1 or punt?** My recommendation: include it. It costs one server action that calls Resend, and it saves a support email per week. v1 ships it; if we see abuse, we rate-limit it.

---

## Implementation notes

- P4.13 (2026-06-26): `/checkout/success` shipped as RSC at `03-app/checkout/success/page.tsx` + `.module.css` (token-only, mockup parity pending — `mockups/checkout-success.html` not yet authored). Auth-gated via `getSessionUser` + redirect to `/login?next=/checkout/success?order=[id]` preserving the order id. Invalid `?order=` → `OrderNotFound` RSC (no 500). Order not owned by session user → redirect to `/account/orders` (defense in depth on top of RLS). Reads via `getOrderForConfirmation(orderId)` in `02-features/checkout/queries/getOrderForConfirmation.ts` which performs the explicit `customer_id = auth.uid()` check + returns the mapped `OrderForConfirmation` shape (9 unit tests cover anon-gate, happy path, query shape, owner mismatch, DB error, empty result, and three defensive mapping paths). Per-line summary via `OrderSummary` (already in `02-features/checkout/components/OrderSummary.tsx`) which renders thumbnail + title + tier + qty + line total + subtotal + discount + tax + total. Primary CTA "Go to your library" → `/library`; secondary "Browse more" → `/browse`; tertiary "View order details" → `/account/orders/[id]`. Status badge via `PollLibraryReady` client island — polls `/api/orders/[id]/grants` every 5s for up to 60s, flips to "Library ready" on `grant_count > 0`, to "Still finalizing — contact support" on timeout, to "Something went wrong — view order details or contact support" on `failed`/`refunded` (the failed state surfaces BOTH the `/account/orders/[id]` link AND a mailto support link per acceptance criterion). The PollLibraryReady component uses a CSS module (`PollLibraryReady.module.css`, token-only) for the state-triad pill colors (`--success` / `--warn` / `--danger` / neutral). The "Download invoice (PDF)" link is deferred to P4.12 per the open question on `@react-pdf/renderer` approval — see STUB-051.
