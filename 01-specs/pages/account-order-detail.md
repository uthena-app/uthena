# Account Order Detail — `/account/orders/[id]`

## What this page does

A single order's detail page. Shows the order header (id, date, status), line items (product thumbnail, title, license tier, unit price), a money breakdown (subtotal / discount / tax / total), the payment method (last 4 of the card via Stripe, never the full card), the billing address (if collected at checkout), a "Download invoice" button, and a "Request refund" button.

The "Request refund" button is conditional: it renders only if `now() - order.created_at < 14 days` AND `order.status = 'paid'`. The button links to `/account/orders/[id]/refund`. The 14-day window is the constant `REFUND_WINDOW_DAYS` in `00-foundations/money/refund-window.ts` (single source of truth, also used by the refund flow and the admin queue).

The invoice is generated server-side as a PDF. The download is a signed URL (24h TTL) and is logged to `file_downloads` with `target='order_invoice'`. **Critical:** we never display the full card number. Stripe is the source of truth for payment method metadata; we store only the `stripe_payment_intent_id` and a denormalized `last4` / `card_brand` snapshot on the order (see Open Questions).

## Data this page shows

| Section | Field | Source | Format |
|---|---|---|---|
| Header | `id` (as `#12345`) | `orders.id` | number, prefixed |
| Header | `created_at` | `orders.created_at` | `MMM D, YYYY` + time |
| Header | `status` | `orders.status` | status badge (same color tokens as `/account/orders`) |
| Header | refund-window status | computed: `days_remaining = max(0, 14 - (now - created_at).days)` | small text "Refundable for X more days" or "Refund window closed" |
| Line items | `product.thumbnail_url` | products | 64×64 image (next/image) |
| Line items | `product.title`, `product.slug` | products | link to `/products/[slug]` |
| Line items | `tier` (Whitelabel / PLR / PLR + MRR) | `order_items.tier` | tier badge (see `00-foundations/ui/TierBadge.tsx`) |
| Line items | `unit_price_cents` | `order_items.unit_price_cents` | `$497.00` |
| Line items | `quantity` (always 1 in v1) | `order_items.quantity` | integer (displayed only if > 1, future-proof) |
| Line items | `refunded_cents` (per item) | `order_items.refunded_cents` | strikethrough on unit price if > 0 |
| Breakdown | `subtotal_cents` | `orders.subtotal_cents` | `$X.XX` |
| Breakdown | discount | computed: `subtotal - (sum of unit_price * quantity)` if a coupon was applied | `$X.XX` with the coupon code in small text, only if non-zero |
| Breakdown | `tax_cents` | `orders.tax_cents` | `$X.XX` (zero-state: hide the row) |
| Breakdown | `total_cents` | `orders.total_cents` | `$X.XX` large |
| Payment | `card_brand` (e.g. "Visa"), `card_last4` (e.g. "4242") | denormalized snapshot on `orders` (see Open Questions) | "Visa ending in 4242" |
| Payment | `stripe_payment_intent_id` (truncated) | `orders.stripe_payment_intent_id` | small mono text, first 8 chars + `…` |
| Billing | name, line1, line2, city, state, postal_code, country | `orders.billing_address` jsonb (collected at checkout; see Open Questions) | address block |
| Actions | "Download invoice" | server action `generateInvoicePdf(orderId)` | button, primary |
| Actions | "Request refund" | link to `/account/orders/[id]/refund` | button, secondary; hidden if not eligible |

**Queries:**
- `getOrderById(orderId, userId)` in `02-features/account/queries/getOrderById.ts` — single query that joins `orders`, `order_items`, and `products` (for thumbnail and title).
- The 404 path: if the order id doesn't exist OR `customer_id != auth.uid()`, the page returns a 404 (we don't distinguish "doesn't exist" from "not yours" — security).

**Invoice data source:** the PDF reads the same data as the page render (`orders` + `order_items` + `products` + `profiles` for the buyer's display name). It does NOT hit Stripe at render time; the snapshot on `orders` is the source of truth for the invoice.

## User actions

| Action | Trigger | Result | RBAC |
|---|---|---|---|
| View line item | Click a product title in the line items list | Navigate to `/products/[slug]` | self (public page) |
| Download invoice | Click "Download invoice" | Server action generates PDF, returns signed URL, browser downloads, logged to `file_downloads` | self (order owner only) |
| Request refund | Click "Request refund" (if eligible) | Navigate to `/account/orders/[id]/refund` | self (order owner, within 14 days, status='paid') |
| Back to orders | Click "← All orders" in the breadcrumb | Navigate to `/account/orders` | self |
| Copy order id | (v2) click-to-copy on the `#12345` | copies to clipboard | — |

## What this page does NOT do

- No "cancel order" button (orders are paid instantly via Stripe Checkout; there is no "in flight" state to cancel — the refund flow is the cancel path)
- No "edit billing address" (the billing address is what was on file at the time of purchase; editing it would alter financial records)
- No "reorder" button (use the cart for new purchases)
- No "download all source files for this order" (downloads happen from `/library`, which respects license grants; we don't bypass that here)
- No partial-refund UI (refund requests are full or partial, and partial is handled by the admin — see `admin-refunds.md` (to be specced))
- No "view invoice in browser" (PDF is download-only; the HTML page is the in-browser view)
- No real-time order status updates (the order is paid or not; status doesn't change after the webhook fires — refunds are a separate state, not a "status flip")
- No affiliate disclosure on this page (affiliate attribution is internal; the buyer doesn't see it here)

## Acceptance criteria

- [ ] Page is auth-gated; 404s (not 403) if order doesn't exist or `customer_id != auth.uid()` (RLS returns zero rows, loader throws `notFound()`)
- [ ] Header shows order id (`#12345`), date, and color-coded status badge
- [ ] Refund-window hint shows "Refundable for X more days" or "Refund window closed"; "Request refund" button renders only when `status='paid'` AND `days_remaining > 0`
- [ ] "Request refund" button is disabled (not just hidden) when a `refunds` row exists with `status IN ('requested','approved')` for this order
- [ ] Line items show product thumbnail, title (linked to `/products/[slug]`), tier badge, unit price; items with `refunded_cents > 0` show a strikethrough with the refunded amount
- [ ] Breakdown shows subtotal, discount (with coupon code, if non-zero), tax (if non-zero), total
- [ ] Payment method shows brand + last4 ("Visa ending in 4242"); full PAN is never sent to the client
- [ ] Billing address renders only if `orders.billing_address` is non-null
- [ ] "Download invoice" generates a PDF server-side, downloads it, logs to `file_downloads` with `target='order_invoice', order_id=orders.id`; PDF includes buyer name/email, order id/date, line items, money breakdown, payment method, billing address; paginates > 20 items
- [ ] Page renders in < 500ms p95; no PII in URLs; no `TODO`/`FIXME` in the diff

## Design reference

- Mockup: not yet built — to be created during the account feature build
- Components: `00-foundations/ui/OrderLineItem.tsx`, `00-foundations/ui/StatusBadge.tsx`, `00-foundations/ui/TierBadge.tsx`, `00-foundations/ui/MoneyBreakdown.tsx`, `00-foundations/ui/PaymentMethodBlock.tsx`, `00-foundations/ui/AddressBlock.tsx`
- Invoice PDF: a server action that uses a React-to-PDF library (see Open Questions for library choice). Template lives in `02-features/account/invoice/InvoicePdf.tsx`.
- Tokens: `00-foundations/design/tokens.css`
- Theme: dark (default)

## Security

- **Auth required:** YES
- **Allowed roles:** any authenticated user. The page is the user's own view of their order.
- **RLS policies that apply:** `orders` (`orders_self_read` — `customer_id = auth.uid()`), `order_items` (inherits via order), `products` (`products_public_read_published` — line item titles are public; the join still requires the order RLS to pass first).
- **PII displayed:** YES — the buyer's name and email (from the auth session / profile), the billing address (if collected), the card last4 + brand. All of this is the user's OWN data, displayed on their own order page. We never expose another user's PII.
- **PII in URLs:** NO. The order id is `bigint` and is not PII. The `[id]` route segment is the only URL param.
- **PCI compliance:** we never see a full PAN. Stripe handles the card form at checkout. We display only `brand` + `last4`, which Stripe returns to us via the PaymentIntent. This is PCI-DSS-compliant (SAQ-A).
- **Stripe API key:** stored encrypted, never returned to the client. The page does NOT call Stripe at render time; it reads the snapshot fields on `orders`.
- **Audit logged:** YES — invoice download is logged to `file_downloads`. The page view itself is not individually logged.
- **Rate limiting on invoice download:** max 60 per user per hour, 200 per user per day.
- **CSRF:** the download server action is CSRF-protected.
- **Idempotency:** invoice generation is read-only (it renders a PDF from existing rows); no idempotency key required.
- **Refund-window check:** the eligibility check (`now() - order.created_at < 14 days` AND `status = 'paid'`) is enforced both at the UI level (button hidden) AND at the server-action level (the `/refund` route's server action re-checks; a tampered URL can't grant refund access).
- **Third-party scripts:** none

## Performance

- **Target p95:** < 500ms (RSC, single query, no client-side fetching)
- **Render strategy:** RSC + SSR. The query is bound to `auth.uid()` via RLS.
- **Cache:** NONE (user-specific).
- **Invoice PDF generation:** ~200–500ms typical. Run as a server action; the page does not block on it. We stream the PDF as it's generated.
- **DB indexes used:** `orders (customer_id, created_at desc)`, `order_items (order_id)`, `products (id)`.
- **Bundle size budget:** < 30KB added to client bundle. The PDF library is server-side only (`'use server'` action).
- **No client-side state:** the page is read-only; the only interaction is "Download invoice" and "Request refund" buttons.

## Out of scope for v1

- "Cancel order" (orders are paid instantly; refund is the cancel path)
- Edit billing address on historical orders
- Reorder button (use cart)
- "Download all source files for this order" (use `/library`)
- Partial-refund UI (handled in admin)
- "View invoice in browser" (PDF is download-only)
- Real-time status updates (status is settled by the time the page loads)
- Affiliate disclosure on the order page
- Multi-currency display
- Invoice templates per region (one global template; localization in v2)

## Open questions for human

- **PDF library choice:** `react-pdf` (declarative, React-style, runs in Node), `@react-pdf/renderer` (similar), or `pdfkit` (imperative, more control)? My recommendation: `@react-pdf/renderer` for the invoice — it's a server-side library, it works without a browser, it produces real PDFs (not browser print), and the JSX-style API is maintainable. Confirm or pick another.
- **Where to store the card brand + last4 snapshot:** the `orders` table in `_data-model.md` doesn't have `card_brand` / `card_last4` columns today. Two options: (a) add them to `orders` (denormalized, written by the Stripe webhook), or (b) call Stripe's API at render time to fetch the PaymentMethod (live, no denormalization). My recommendation: (a) denormalize. Faster, no Stripe dependency on the hot path, and the snapshot is what the invoice needs anyway. Requires a small migration.
- **Billing address storage:** the `orders` table in `_data-model.md` doesn't have a `billing_address` jsonb column. Stripe Checkout collects it (when `tax_id_collection` or `billing_address_collection` is enabled). My recommendation: add `billing_address jsonb` to `orders`, populated by the Stripe webhook. If we don't enable address collection in Stripe Checkout, this column stays null and the section is hidden.
- **Refund-window display copy:** "Refundable for 3 more days" vs. "Refund until Jun 26, 2026" vs. an explicit countdown? My recommendation: show the date ("Refundable until Jun 26") plus a small urgency hint ("3 days left") when ≤ 2 days remain. Avoid second-level countdowns — they create anxiety without driving conversion.

---

## Implementation notes

### Slice 1 (shipped 2026-06-29) — verification + spec gap fills

This slice turns `/account/orders/[id]` into the production-grade
single-order view the spec describes. Most acceptance criteria are
already met by the existing `OrderDetail` RSC; the gaps filled here:

- **Refund-window hint** — banner above the items section shows
  "Refund window: eligible until &lt;date&gt; (N days remaining)"
  in info tone (&gt;2 days), amber tone (≤2 days, gentle urgency), or
  "Refund window closed" muted tone. Days remaining = `max(0, ceil(
  (createdAt + 14d − now) / 1d))`. Uses the `REFUND_WINDOW_DAYS`
  constant from `00-foundations/money/refund-window.ts` (single source
  of truth shared with the refund flow + admin queue + Stripe webhook).
- **Request refund button (eligibility-gated)** — rendered as a
  `<Link>` to `/account/orders/[id]/refund` only when
  `status === 'paid' && days_remaining > 0 && !has_active_refund`.
  When an active refund row exists (`status IN ('pending',
  'succeeded')` per the actual schema enum — the spec's
  `'requested','approved'` wording is off), the button shows as a
  disabled "Refund in progress" span with `aria-disabled="true"`.
- **License tier badge** — new `<LicenseBadge>` component maps
  `order_items.license` (`'plr' | 'mrr' | 'rr' | 'personal'`) to
  semantic pill colors. The spec's "Whitelabel / PLR / PLR + MRR"
  wording was aspirational — the actual `license_type` enum is
  the source of truth.
- **Product thumbnail** — line items now show a 64×64 next/image
  thumbnail (placeholder when `products.thumbnail_url` is null).
- **Coupon code in discount row** — joined via `coupons(code)`,
  shown as small mono text after "Discount".
- **Billing address block** — `orders.billing_address jsonb` is
  rendered as a multi-line address block in the Payment section.
  Section hidden when the column is null (collection disabled).
- **Stripe reference id** — `orders.stripe_payment_intent_id` is
  truncated to first 8 chars + `…` (e.g. `pi_3OAB…`) and shown
  in mono. Never the full id — PCI-scope discipline.
- **Download invoice CTA** — replaces the spec's "PDF generator"
  approach. Per STUB-051 (RESOLVED 2026-06-29), the CTA links to
  Stripe's `invoice.hosted_invoice_url` (open in new tab with
  `rel="noopener noreferrer"`). The click fires the
  `logInvoiceDownloadAction` server action which writes one
  `file_downloads` row with `kind='invoice_redirect'` (migration
  `0034_file_downloads_invoice_redirect.sql` widens the CHECK
  constraint to allow that value). The button is hidden entirely
  when Stripe is unconfigured / the lookup fails — AGENTS.md forbids
  placeholders, so we render nothing rather than a disabled "Coming
  soon" pill.
- **Stripe-hosted-invoice lookup** — `getHostedInvoiceForOrder(orderId)`
  does a fail-soft 2-step Stripe call (paymentIntents.retrieve →
  invoices.retrieve) and returns the hosted URL + PDF URL + invoice
  id + invoice number. Returns null when Stripe is unconfigured, the
  order has no PI id, or any step fails. PII safety: the hosted URL
  is single-tenant (keyed by Stripe Customer ID), so it's never
  logged — the warn paths log only the typed error code.

### Spec gaps filed as STUBS

- **STUB-082 — card brand + last 4 digits** — the schema has
  `stripe_payment_intent_id` but no `card_brand` / `card_last4`
  columns on `orders`. Per the spec's open question, the recommended
  fix is denormalization (write `card_brand` + `card_last4` from the
  PaymentIntent webhook). Blocked on (a) Stripe webhook populating
  the snapshot, (b) the live Stripe account being wired. Today the
  Payment section on the page explains this with a friendly help
  line + a link to `/account/settings` for managing saved methods.

### Files touched

- **New** —
  - `04-platform/migrations/0034_file_downloads_invoice_redirect.sql`
  - `02-features/account/profile/queries/getHostedInvoiceForOrder.ts`
  - `02-features/account/profile/queries/getHostedInvoiceForOrder.test.ts`
  - `02-features/account/profile/actions/logInvoiceDownload.ts`
  - `02-features/account/profile/actions/logInvoiceDownload.test.ts`
  - `02-features/account/profile/components/LicenseBadge.tsx` (+ `.module.css`)
  - `02-features/account/profile/components/InvoiceDownloadButton.tsx` (+ `.module.css`)
  - `02-features/account/profile/queries/getMyOrderDetail.test.ts`
- **Modified** —
  - `02-features/account/profile/queries/getMyOrderDetail.ts`
    (added coupon_code, billing_address, stripe_payment_intent_short,
    days_remaining, window_end_at, has_active_refund, item
    product_thumbnail_url)
  - `02-features/account/profile/components/OrderDetail.tsx`
    (refund-window banner, eligibility-gated refund button, license
    badge, thumbnail, coupon code, billing address block, Stripe
    reference, invoice CTA)
  - `02-features/account/profile/components/OrderDetail.module.css`
    (banner tones, 3-col item grid, address block, action row)
  - `03-app/account/orders/[id]/page.tsx` (and `app/` hardlink —
    fetches `hostedInvoice` and passes it down)
  - `STUBS.md` (STUB-082 filed)
