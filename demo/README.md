# Uthena v2 — clickable HTML demo

A fully self-contained, clickable HTML/CSS/JS demo of the redesigned Uthena marketplace.
Built directly from the v4 design system (tokens, primitives, two-signal color system) and
the page specs in `01-specs/pages/`. Uses real Uthena product data — names, prices, copy,
instructor names, course descriptions, curriculum — pulled from the live site.

## What's included

| Page | File | Notes |
|---|---|---|
| Home | `index.html` | Hero, 3-step "how it works", 3 pillars (Marketplace/Platform/Toolbox), launch deals, best-sellers grid, "3 ways to earn" cards, instructor spotlight, reviews, categories, newsletter, FAQ |
| Marketplace | `browse.html` | 12 real Uthena courses, faceted sidebar (category/price/license/length/rating), active filter pills, sort dropdown, grid/list toggle, pagination |
| Product detail (showcase) | `p/chatgpt-for-personal-branding.html` | Full PDP with all 5 tabs (Overview/Curriculum/Reviews/PLR License/Instructor), curriculum accordion, license-tier selector (PLR/MRR), review summary with rating bars, related products |
| Product detail (template) | `p/*.html` (10 more) | Real data: AI Personal Branding, Python Pro, Network Hacking, Affiliate Marketing, Decision-Making CEOs, Viral Content, SQLite, AI Beginners, AI Agents, Gen AI Leaders, B2B Sales, AI Monetize |
| Cart | `cart.html` | Live localStorage cart, add/remove/change tier, coupon codes (try `WELCOME10` / `FOUNDER` / `LAUNCH`), empty + populated states |
| Checkout | `checkout.html` | Auth-gated stub (mirrors the real `checkout.md` spec); previews Stripe Payment Element + order summary |
| Affiliate mini-shop | `marcusreyes.html` | The full `affiliate-minishop.md` spec — header, hero, stats, trust strip, featured pick with curator's note, curated collection, about |

## Design system

- **`styles/tokens.css`** — dark theme tokens (orange + teal two-signal system, 6-level surface stack, type, radii, shadows, section tints)
- **`styles/theme-light.css`** — light theme override (`[data-theme="light"]`); both brand colors keep their hex, hover variants darken for cream legibility
- **`styles/main.css`** — all components (typography, buttons, badges, nav, footer, cards, modals, tabs, accordions, etc.)

## What's interactive

- **Theme toggle** (bottom-right) — dark ⇄ light, persisted in `localStorage`
- **Add to cart** — every "Add to cart" button on every PDP, and the cart count badge updates in the nav
- **License tier** — clicking PLR / MRR on a PDP updates the price and the CTA
- **Cart line items** — change tier (PLR ⇄ MRR, with live price recalc), remove, clear all
- **Coupons** — `WELCOME10` (10% off), `FOUNDER` (25% off), `LAUNCH` (15% off)
- **PDP tabs** — switch between Overview / Curriculum / Reviews / PLR License / Instructor
- **PDP curriculum** — expand/collapse modules
- **Marketplace filter pills** — click the × to remove
- **PDP → related products** → adds to cart with same slug flows through the full flow

## How to run

```bash
cd demo
python3 -m http.server 8765
# open http://localhost:8765 in your browser
```

Or just open `index.html` directly in a browser (some browsers restrict relative file:// paths
to assets; the server is recommended).

## What's NOT included (intentionally)

- No real auth, no real payments, no real product search
- No database, no API calls — all data is hard-coded into the HTML
- The "Buy now" / checkout flow ends at the auth wall (checkout.html)
- The add-to-cart is purely localStorage, no server cart

## Source data

Product names, prices, course descriptions, curricula, and instructor bios come from the live
uthena.com pages and are hard-coded into each PDP. Swap the demo for the real app by
replacing the HTML with the actual Next.js server components driven by the same
`02-features/catalog/queries/`, `02-features/product/queries/`, etc.
