# Cart drawer — P4.1

## What this feature does

A global, slide-in cart drawer that lets the buyer review their cart
without leaving the page. Triggered two ways:

1. **Header cart button** — the "Cart {N}" pill in the global header
   is now a real `<button data-cart-trigger="true">`. Clicking it
   slides the drawer in from the right (P4.1's primary entry point).
2. **Add-to-cart success** — every successful `addToCartAction` call
   (from the product detail page's `LicenseSelector` OR the
   `AddToCartButton` used elsewhere) dispatches `uthena:cart:open`,
   which the drawer listens for. The drawer slides in on the same
   page the user was browsing — no navigation to `/cart` required.

The drawer is a **read-only** preview: line items (thumbnail + title
+ license + price), subtotal, and the two main CTAs (**View full
cart** + **Checkout**). Editing line items (license change, quantity,
full remove) still happens on the dedicated `/cart` page so the
drawer stays compact and the editing UX doesn't compete with the
preview UX. A small ✕ per line lets the user drop items without
leaving the drawer.

## Data this feature shows

| Section | Field | Source | Format |
|---|---|---|---|
| Header | Title "Your cart (N items)" | sum of line `quantity` | eyebrow text |
| Per-line | `product.title`, `slug`, `thumbnail_url`, `category.name` | `/api/cart` (which calls `getCart()`) | 64×48 thumb + 2-line-clamp title + category eyebrow + license label + price + remove ✕ |
| Per-line | `license` label | `LICENSE_LABELS` map (PLR / MRR / RR / Personal) | uppercase chip + descrption beneath |
| Per-line | `unit_price_cents` (× quantity when > 1) | `product_pricing` joined live | money (USD), mono-numbered |
| Per-line | Remove button | per-line action | ✕ icon button |
| Subtotal | sum of `unit_price_cents × quantity` across lines | `getCartSubtotalCents()` | money, large mono |
| Tax note | "Tax calculated at checkout" | hard-coded | muted small text |
| CTAs | "Checkout" (primary) + "View full cart" (secondary) | hard-coded | full-width orange + bordered teal |
| Empty | Cart glyph + "Your cart is empty" + "Browse catalog" CTA | hard-coded | centered card |

**Queries / actions:**
- `getCart()` — already exists in `02-features/cart/queries/getCart.ts`.
  RLS-aware, joined live against `product_pricing`.
- `getCartSubtotalCents()` — already exists.
- `removeLineAction()` — already exists. Used by the drawer's per-line
  ✕ button so the user can drop items without leaving the drawer.
- `GET /api/cart` — new route handler (auth-aware). Returns
  `{ isAuthed, count, subtotalCents, lines }`. The drawer fetches this
  when it opens and on every `uthena:cart:changed` window event.

## User actions

| Action | Trigger | Result | RBAC |
|---|---|---|---|
| Open drawer | Header cart button click OR add-to-cart success | Drawer slides in from the right; data refreshes from `/api/cart` | public (works for anon + auth) |
| Close drawer | Esc / backdrop click / X button / "Browse catalog" / "View full cart" / "Checkout" link | Drawer slides out; focus restored to previously-focused element | public |
| Remove line | Click ✕ on a line | `removeLineAction` runs, drawer re-fetches, line disappears | auth required (server-side enforced) |
| View full cart | Click "View full cart" link | Navigate to `/cart`, drawer closes | public |
| Checkout | Click "Checkout" button | If auth: `/checkout`. If anon: `/login?next=/checkout` | public CTA, checkout requires auth |
| Continue shopping (empty) | Click "Browse catalog" | Navigate to `/browse`, drawer closes | public |

## What this feature does NOT do

- **No editing inside the drawer.** License change, quantity
  adjustment, and "save for later" happen on `/cart` (P4.4, P4.5).
  The drawer is a preview + CTA surface.
- **No quantity editing.** PLR is per-license, quantity is always 1
  in v1 (per `cart.md` "What this page does NOT do"). The qty
  capability ships with Phase 8 bundles if/when those land.
- **No coupon entry.** Coupons live on `/checkout` (per spec).
- **No "save for later" / wishlist.** Deferred to v2.
- **No anonymous cart cookie.** ~~Per STUB-005, v1 is auth-only.~~
  P4.2 SHIPPED the anon-cookie cart — anon visitors now see their
  cookie-backed cart rendered in the drawer. The Checkout CTA
  routes anon users through `/login?next=/checkout` (so the cart
  persists across the auth round-trip via the merge-on-signin
  hook). See `01-specs/pages/cart.md` for the persistence + merge
  design.
- **No toast notification.** The drawer IS the notification — it
  slides in and shows the new line. A toast on top of the drawer
  would compete visually.
- **No "added X to cart" inline message.** Same reason: the drawer
  carries the feedback.

## Acceptance criteria

- [x] Drawer slides in from the right on header cart button click
- [x] Drawer slides in on add-to-cart success from any page
- [x] Drawer closes on Esc / backdrop click / X / any nav-out link
- [x] Drawer shows line items: thumbnail + title + license + price
      + remove ✕
- [x] Drawer shows subtotal at the bottom (large mono number)
- [x] Drawer has "View full cart" + "Checkout" CTAs (Checkout routes
      anon through `/login?next=/checkout`)
- [x] Empty state renders when cart is empty (centered card +
      "Browse catalog" CTA)
- [x] Remove (✕) on each line removes the line + re-fetches drawer
- [x] Tab is trapped inside the drawer while open
- [x] Focus moves to close button on open; previously-focused
      element restored on close
- [x] Body scroll is locked while open
- [x] Header cart count badge updates within 1s of add (RSC
      revalidation via `revalidatePath('/', 'layout')`)
- [x] prefers-reduced-motion disables the slide animation
- [x] No `TODO` / `FIXME` / `HACK` in the diff
- [x] All inputs (the `/api/cart` query, the `removeLineAction`
      call) are Zod-validated server-side
- [x] RLS: `cart_items` self-only enforcement is unchanged
- [x] No PII in logs (the existing `removeLineAction` logs the
      structured failure shape only)

## Design reference

- Visual language mirrors the existing SearchOverlay (P0.4) +
  MobileNav (P0.5) backdrops: `--bg-overlay` + 6px blur, drawer on
  `--bg-elev-1` with `--line` left border + `--shadow-lg`.
- Width: `min(420px, 100vw)`. On phones (≤ 480px) it goes full-width
  (no border-left, no slide-in animation).
- Per-line layout is a compact 64×48 thumb + 2-line-clamp title +
  license label + price + remove ✕.
- The Checkout button uses the existing `--action` orange fill (the
  same as the header's "Cart" pill and the "Continue to checkout"
  link on `/cart`).

## Security

- **Auth required for actions:** YES for the AUTH-DB `removeLineAction`
  path (the action returns `{ ok: false, error: 'Sign in to edit your
  cart.' }` for an anon caller passing a numeric `cart_item_id`).
  Anon callers pass a synthesized `anon:<product_id>:<license>` string
  id which routes through the cookie branch instead — no auth required
  to mutate your own anon cart. The Checkout CTA still routes anon
  users through `/login?next=/checkout`.
- **Allowed roles:** anyone can OPEN the drawer (it shows anon-cart
  lines for anon, auth-cart lines for auth). Mutations work in both
  branches (cookie for anon, DB for auth).
- **RLS policies that apply (auth branch):** `cart_items` self-only
  via `auth.uid()` (unchanged). The drawer's `GET /api/cart` uses
  the request-scoped client, so RLS enforces `user_id = auth.uid()`
  on every read. `removeLineAction` runs `.eq('user_id', user.id)`
  so a forged numeric `cart_item_id` against another user's cart
  returns 0 rows.
- **Cookie trust boundary (anon branch):** the `uthena_anon_cart`
  cookie is HMAC-SHA256-signed + Zod-validated on parse. A corrupted
  cookie returns null and the drawer renders empty (no panic, no
  crash). The Zod schema rejects bad versions, unknown licenses,
  qty out of range, and > 50 lines.
- **PII displayed:** the drawer's UI shows product titles,
  thumbnails, prices — no PII. The authed state is implicit (the
  Checkout button's text is "Checkout" for authed, "Sign in to
  checkout" for anon).
- **PII in URLs:** no — `/api/cart` takes no params; the drawer
  doesn't carry IDs in the URL.
- **Audit logged:** no — adding to cart isn't currently audit-logged
  (per `cart.md` "Routine add-to-cart events are NOT logged to keep
  the table small"). Removing an item isn't either. The existing
  `removeLineAction` already logs the structured failure path; the
  success path is silent.
- **CSRF:** server actions are CSRF-protected via Supabase auth
  session + same-site `Lax` cookies. `GET /api/cart` is read-only.
- **Abuse protection:** rate-limiting add-to-cart is deferred to P18.8
  (per the existing STUB; not in this tick). The drawer itself is
  fetch-only.

## Performance

- **Target p95:** < 200ms (per `docs/ARCHITECTURE.md` §5)
- **Render strategy:** drawer is a client island (returns `null`
  when closed — zero steady-state DOM). On open, it fetches
  `/api/cart` (one parallel pair: `getCart` + `getCartSubtotalCents`).
- **Cache:** `/api/cart` returns `Cache-Control: private, no-store`
  (cart is user-specific). The header's `getCartCount()` is already
  cache()-deduped per request.
- **DB load:** one index lookup on `cart_items (user_id, status)`
  per drawer open (the existing `cart_items_user_status_idx` index
  covers the predicate).

## Open questions for human

None. The drawer mirrors the existing search-overlay + mobile-nav
modal patterns (same focus trap, same body scroll lock, same
backdrop). All patterns are already approved.
