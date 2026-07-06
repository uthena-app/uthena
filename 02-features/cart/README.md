# Feature: cart

The buyer's pre-checkout staging area. **P4.2 — both auth (DB) and anon (HMAC-signed cookie) carts are now first-class.** The query + action layer branches transparently on session state; the rest of the cart surface (CartDrawer, /cart page, /api/cart route) consumes the unified `CartLine[]` shape.

- **Specs:** [`01-specs/pages/cart.md`](../../01-specs/pages/cart.md), [`01-specs/pages/cart-drawer.md`](../../01-specs/pages/cart-drawer.md)
- **Owner:** Mavis
- **Depends on:** `@features/catalog/queries`, `@foundations/data`, `@foundations/auth`, `@foundations/money`, `@foundations/cookies/anon-cart`
- **Depended on by:** `@features/checkout` (reads the cart at checkout time), `@features/auth` (calls `mergeAnonCartIntoAuth` on signup/signin)
- **Status:** P4.1 (drawer) + P4.2 (persistence) shipped
- **Test locally:** `pnpm test 02-features/cart`
- **Open follow-ups:** P4.3 (30-day expiry cron) + P4.5 (coupon in drawer) + P4.6 (cart-abandoned event) — see `01-specs/pages/_followups.md`

## Layout

```
02-features/cart/
├── queries/
│   ├── getCart.ts             — fetch current user's cart with live pricing (auth + anon)
│   ├── getCartCount.ts        — small int for the nav badge (auth + anon)
│   ├── getCartSubtotal.ts     — sum in cents (auth + anon)
│   └── resolveAnonCart.ts     — anon-cookie branch: cookie + live pricing fetch
├── actions/
│   ├── addToCart.ts           — server action: upsert (user|anon, product, license)
│   ├── updateLicense.ts       — server action: change license on a cart line
│   ├── updateQuantity.ts      — server action: change quantity (1-99)
│   ├── removeLine.ts          — server action: delete one cart line
│   ├── clearCart.ts           — server action: delete every cart line
│   ├── applyCoupon.ts         — server action: validate + attach coupon_id
│   └── mergeAnonCart.ts       — server action: union anon cookie → auth cart (signup/signin hook)
├── components/
│   ├── AddToCartButton.tsx    — client form for product page
│   ├── CartLineRow.tsx        — one row in /cart
│   ├── CartLineControls.tsx   — license select + qty + remove client island
│   ├── CartSummary.tsx        — subtotal + CTA + trust strip
│   ├── CartDrawer.tsx         — global slide-in drawer (P4.1)
│   ├── CartTrigger.tsx        — `data-cart-trigger` click island
│   ├── ClearCartButton.tsx    — small "Clear cart" link with confirm
│   ├── CouponForm.tsx         — coupon entry client island
│   └── EmptyCartState.tsx     — empty state for /cart
├── cartEvents.ts          — `CART_OPEN_EVENT` + `CART_CHANGED_EVENT` constants
├── format.ts
└── index.ts              — re-exports the public surface
```

## Auth-vs-anon branching

`CartLine.id` is `number | string`:
- **Auth:** `number` (the DB `cart_items.id` bigint).
- **Anon:** the synthesized `anon:<product_id>:<license>` string id (see `anonLineId()` in `@foundations/cookies/anon-cart`).

Each action branches on the type to pick the right mutation path:

```ts
if (typeof cart_item_id === 'string') {
  // anon-cookie branch — parse via parseAnonLineId + writeAnonCart
} else {
  // auth branch — DB delete via .eq('id', cart_item_id).eq('user_id', user.id)
}
```

The Zod schemas (`RemoveCartLineInput`, `UpdateCartLineLicenseInput`, `UpdateCartLineQuantityInput`) accept `z.union([z.number(), z.string().regex(/^anon:\d+:(plr|mrr|rr|personal)$/)])`. The schema fails fast on a malformed anon id — no garbage data reaches the cookie layer.

## Merge on signup / signin

`02-features/auth/actions.ts` calls `mergeAnonCartIntoAuth(user.id)` after both `signUpAction` and `signInAction` succeed. The merge is:

- **Union respecting (product_id, license)** — auth lines for the same pair win (the unique constraint prevents duplicates anyway).
- **Skips products no longer published or licenses no longer active** — the user's auth cart shouldn't gain items they can't actually buy.
- **Best-effort** — never throws; on failure the anon cookie is preserved for retry from `/cart`.

The spec's recommended "conflict resolution UI" (the "Keep both? [Keep both] [Use account cart] [Use session cart]" modal) is deferred to a follow-up — the union default is what most commerce sites do and what users expect. See `01-specs/pages/cart.md` "Open questions" for the policy rationale.

## Live pricing

The anon cookie carries `(product_id, license, qty, added_at)` only — never prices. Every render calls `resolveAnonCart()` which fetches `products` + `product_pricing` for the cookie's product ids and joins live. Matches the auth cart's "join live against pricing" pattern so a price change between add-to-cart and checkout reflects. Storing prices in a signed cookie would create a mismatch with the live DB and is one more surface to harden.
