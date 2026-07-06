# Checkout Canceled — `/checkout/canceled`

## What this page does

The post-payment-canceled landing page. Stripe redirects here when the user clicks "Cancel" inside Stripe Checkout, closes the tab mid-checkout, or the session expires before payment. The page reassures the user that their cart is still saved, then offers two ways back: **Back to checkout** (primary CTA — re-enters the Stripe flow with the same items) and **Continue shopping** (secondary — goes to `/browse`). The cart is preserved untouched — no items removed, no order created.

This page is the friendly counterpart to `/checkout/success`. It exists so users who bailed out of Stripe don't land on a generic 404 or get bounced to the homepage with no context. It also handles the edge case of an anonymous user who clicked through to Stripe and was redirected back without ever signing in: in that case we route them to `/signup?next=/cart` so the cart can be claimed into a real account.

## Data this page shows

| Section | Field | Source | Format |
|---|---|---|---|
| Header | "Payment canceled" | hard-coded | H1, large |
| Subhead | "No charge was made. Your cart is still saved." | hard-coded | muted paragraph |
| Cart preview (auth) | list of items: `product.thumbnail_url`, `product.title`, `tier`, `unit_price_cents` | `cart_items` JOIN `products` | compact list (max 3 visible, "+N more" if > 3) |
| Cart preview (auth) | subtotal | computed | money |
| Cart preview (auth) | "(items in your cart will be saved for 30 days)" | hard-coded | small muted text |
| Cart preview (anon) | "Sign in to save your cart" prompt | hard-coded | banner with CTA → `/signup?next=/cart` |
| Reason helper | "You canceled at Stripe. You can try again anytime." | hard-coded (only shown if URL has `?reason=user_canceled`) | small italic text |
| Support link | "Need help? Email support@uthena.com" | hard-coded `mailto:` | text link |

**Queries / actions:**
- `getCart()` in `02-features/cart/queries/getCart.ts` — same query the `/cart` page uses. Returns line items for the current user, or empty array for anon.
- No mutation actions on this page. The cart is read-only here.

## User actions

| Action | Trigger | Result | RBAC |
|---|---|---|---|
| Back to checkout | Click primary CTA | If auth: navigate to `/checkout` (re-enters Stripe with current cart). If anon: navigate to `/signup?next=/checkout` | public CTA, checkout requires auth |
| Continue shopping | Click secondary CTA | Navigate to `/browse` | public |
| Sign in to save cart (anon) | Click banner CTA | Navigate to `/signup?next=/cart` | anon only |
| Email support | Click support link | Opens `mailto:support@uthena.com` (with `?subject=Checkout canceled — order not placed` pre-fill) | public |
| Remove a specific item | Click ✕ on a cart-preview row | Calls `removeCartItem(cartItemId)`, re-renders | public (auth) — anon cannot (cart lives in cookie) |

## What this page does NOT do

- No automatic retry of the Stripe session (user clicks "Back to checkout" explicitly)
- No "why did you cancel?" survey (v2; would need a feedback table)
- No upsell ("here's 10% off if you complete now") — that's a v1.5 follow-up via `01-specs/pages/_followups.md`
- No cart cleanup — items stay in the cart for 30 days, then expire (see Open Questions)
- No order row is created (no `orders` row, no `orders.status='failed'` — the absence of an order IS the canceled state)
- No email is sent (we don't email on cancellation; the user's own email client has the Stripe receipt-of-cancelation if they want one)
- No "if this was a mistake" pop-up (the CTA itself is the recovery path)
- No PII displayed

## Acceptance criteria

- [ ] Direct visit to `/checkout/canceled` with no Stripe context still renders the page (it should not 500)
- [ ] Auth user with a non-empty cart sees the cart preview (up to 3 items + "+N more" link)
- [ ] Auth user with an empty cart sees the empty-state variant ("No items in your cart. Browse catalog?")
- [ ] Anon user sees the "Sign in to save your cart" banner and the "Continue shopping" CTA, but NOT the cart preview (the cookie cart is not human-readable)
- [ ] "Back to checkout" CTA routes auth users to `/checkout`, anon users to `/signup?next=/checkout`
- [ ] "Continue shopping" CTA always routes to `/browse`
- [ ] Cart is NOT mutated on this page — no items added, removed, or cleared
- [ ] No `orders` row is created when this page is hit
- [ ] Cart preservation is durable: items added yesterday and abandoned today are still in the cart 24h later (verified by re-fetching after a wait)
- [ ] Support mailto link is pre-filled with `?subject=Checkout canceled — order not placed`
- [ ] If URL has `?reason=user_canceled`, show the reason helper line; if absent, hide it (don't show stale state)
- [ ] The page never auto-redirects — the user stays in control of the next step
- [ ] Mobile responsive (single-column on < 768px)
- [ ] No PII leaked in logs (cart reads log `user_id` only, never `email`)
- [ ] No `TODO` / `FIXME` in the diff

## Design reference

- Mockup: `mockups/checkout-canceled.html` (dark) + `mockups/checkout-canceled-light.html` (light) — **to be created during the checkout feature build**
- Design tokens: `00-foundations/design/tokens.css`
- Components: `00-foundations/ui/Button.tsx`, `00-foundations/ui/CartPreview.tsx`, `00-foundations/ui/EmptyState.tsx`
- Theme: both

## Security

- **Auth required:** NO — anon can land here. The page branches on session and shows different content per branch.
- **Allowed roles:** anyone
- **RLS policies that apply:** `cart_items` (self-only when auth; anon bypasses the table). `products` (public read on `status='published'`). `product_pricing` (public read on `active = true`).
- **PII displayed:** no — the cart preview shows products, not user data. Email is never shown on this page.
- **PII in URLs:** no — `/checkout/canceled` is a static path. `?reason=` is a code, not a value.
- **Audit logged:** no — this is a read-only page that does not mutate state. The "back to checkout" navigation is logged at the checkout level, not here.
- **CSRF:** no server actions on this page; nothing to CSRF.
- **Rate limiting:** none needed — page is idempotent and read-only.
- **Third-party scripts:** none.

## Performance

- **Target p95:** < 200ms (one cart read for auth users; zero DB reads for anon)
- **Render strategy:** RSC. The cart preview is a server component; no client JS needed except the mailto link.
- **Cache:** none — user-specific content.
- **DB load:** one index lookup on `cart_items (user_id)` for auth users. Zero for anon.
- **Bundle size budget:** < 5KB added to client bundle (effectively zero; this is RSC-only).

### Cart preservation contract

The cart is the user's data; this page guarantees it survives a canceled checkout. Three rules:

1. **No destructive actions on this page.** Removing an item is allowed (the ✕ on a preview row), but adding or clearing is not — and "Back to checkout" never modifies the cart.
2. **No implicit expiration.** A cart abandoned 30 days ago is still there. We do NOT run a cron that wipes old carts; the `cart_items` table grows with users and we accept that. (If it becomes a storage issue in v2, we add a `last_activity_at` column and a monthly cleanup job. v1 ships without one.)
3. **No silent reset on the next page load.** When the user lands on `/cart` later, items are exactly as they left them. The cart is not tied to the Stripe session in any way.

## Out of scope for v1

- "Why did you cancel?" survey (would need a new `cancellation_feedback` table)
- Automatic Stripe session retry
- Upsell / discount code on cancellation recovery
- Email follow-up ("we noticed you didn't complete your purchase")
- Cart expiration (v2; see Open Questions)
- Affiliate disclosure (attribution is captured at order time)

## Open questions for human

- **Anon user redirect — to `/signup` or `/cart` first?** When an anon user lands on `/checkout/canceled`, my recommendation is to send them to `/signup?next=/cart` (not `/signup?next=/checkout`) because we don't have a way to re-enter Stripe without an account, and showing them the cart first lets them see what they would have bought. The cart page then has its own "Continue to checkout" CTA that handles the signup prompt. Alternative: send anon straight to `/signup?next=/checkout` and assume the session cookie carries over. Approve `/signup?next=/cart` for v1?
- **Cart expiration.** Should old `cart_items` rows ever be deleted? My recommendation: **no expiration in v1**. The table is small (one row per user per product per tier; a heavy user has ~50 rows). At 10k users with full carts, that's 500k rows — trivial for Postgres. v2 can add `last_activity_at` + a monthly cleanup if we ever care. Approve "no expiration" for v1?
- **"Reason helper" line visibility.** When Stripe sends users back to `/checkout/canceled`, it can include `?reason=user_canceled` (user clicked Cancel) or `?reason=expired` (session timed out). My recommendation: show the helper line only when `?reason` is present, with a different message per reason code (`user_canceled` vs `expired` vs `failed`). Approve, or do you want a single generic line for all reasons?
- **Cart preview for anon — show at all?** Anon cart lives in a signed cookie. The server CAN read it. Should we render the anon cart preview (so the user sees what they almost bought), or hide it (less informative, but simpler)? My recommendation: **hide for anon** in v1. The "Sign in to save your cart" CTA already covers the use case; showing the cookie cart adds complexity for a small UX win. If a user complains, we add it in v1.5.

---

## Implementation notes

- P4.13 (2026-06-26): `/checkout/canceled` shipped as RSC at `03-app/checkout/canceled/page.tsx` + `.module.css` (token-only, mockup parity pending — `mockups/checkout-canceled.html` not yet authored). Auth-optional — anon users see the sign-in card, auth users see the cart preview or empty-state card. Reads via `getCart()` + `getCartSubtotalCents()` from `@features/cart` (no mutations; this page is read-only). Cart preview slices to first 3 items + a "+N more" affordance when the cart has > 3 lines. Subtotal + "(items in your cart will be saved for 30 days)" copy displayed when lines exist. `?reason=` query param drives the reason helper line via a `REASON_LINES` map (`user_canceled` / `expired` / `failed`); unknown / missing reason → no helper line (no stale state). Primary CTA "Back to checkout" routes auth users to `/checkout` and anon users to `/signup?next=/checkout`. Secondary "Continue shopping" → `/browse`. Support mailto link pre-fills `?subject=Checkout canceled — order not placed` per acceptance criterion. `force-dynamic` ensures no stale caching. `sensitivePageMetadata` adds `noindex` per P0.21.
