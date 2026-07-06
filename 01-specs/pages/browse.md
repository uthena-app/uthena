# Browse — `/browse`

## What this page does
Full catalog grid. Lists every published product with sort, price
filter, density toggle, and category filter — all URL-driven.
ISR-cached 60s per unique URL.

## Data this page shows
- Header (eyebrow "Marketplace" + h1 with teal accent on "courses" + count + filter description)
- Sidebar filter: list of active categories with product counts + price filter (Any / Free / Under $50 / Under $100)
- Active-filter chips row above the grid (only when price or density ≠ default; each chip has a ✕ to clear)
- Results head: count + sort dropdown + density toggle (Comfortable / Compact)
- Grid of `ProductCard` components (3-col desktop in comfortable, 4-col in compact; degrades to 2-col / 1-col at smaller breakpoints)
- Empty state when no products match (links to clear filters)

## User actions
- Click a category in the sidebar — URL gets `?category=<slug>`
- Pick a sort from the dropdown — URL gets `?sort=<key>`; dropdown submits on change (no Apply button)
- Pick a price filter from the sidebar or clear an active chip — URL gets `?price=<bucket>`
- Pick a density from the toggle — URL gets `?density=comfortable|compact`
- Click "Clear all" — strips `price` + `density` from the URL (preserves `category`)
- Click a chip's ✕ — strips that one param, preserves the rest
- Click a product card — navigate to `/products/[slug]`
- Refresh / share the URL — filters survive (URL is source of truth)

## What this page does NOT do
- Search (`/search?q=` is its own route, P0.19)
- License-type filter (sidebar lists category only; license lives on the product card)
- Pagination (catalog fits in one page for v1 — `BROWSE_PAGE_SIZE = 60`)
- Multi-select filters (single bucket per category: one category, one price bucket, one density, one sort)

## Acceptance criteria
- [x] Server component, RSC, ISR 60s
- [x] URL is source of truth for all filters (category, sort, price, density)
- [x] Sort dropdown with 4 keys: newest / popular / price-asc / price-desc
- [x] Price filter with 4 buckets: any / free / under-50 / under-100 (default "any")
- [x] Density toggle with 2 modes: comfortable (3-col) / compact (4-col) (default "comfortable")
- [x] Active-filter chips row above the grid; each chip has a clear ✕ that strips one param
- [x] "Clear all" link strips price + density (preserves category)
- [x] Invalid sort/price/density values fall back to defaults (no error page)
- [x] Default URL `/browse` is clean — no params appended when on defaults
- [x] Active filter highlighted in sidebar (category + price)
- [x] Empty state designed for "no products match" (clearer copy + clear-filters action)
- [x] No client data fetching (only the sort `<select>` is a tiny client island; rest is RSC)
- [x] Keyboard accessible (chips + density toggle are real `<Link>` elements with focus rings)
- [x] RLS-aware reads (anon sees only published)
- [x] No PII in logs (no email/password/token logging)

## Design reference
`mockups/browse.html` lines 45–57 (filter chip row + h1) +
lines 91–97 (results head + sort) + lines 98–304 (3-col grid).
The mockup's multi-group facets sidebar (On sale / Price / Genre /
Rating) is not yet implemented — P0.16 ships category + price in
the sidebar; future phases can add On sale / Rating facets.

## Security
- Public route, RLS-gated
- Only published products in the result set
- URL params are validated with literal unions + safe fallback (no
  raw user input in the query builder)

## Performance
- p95 < 200ms (catalog performance budget per docs/ARCHITECTURE §5)
- 60s ISR cache per unique URL combination
- Popular + newest sorts use SQL `.order()` (columns on products)
- Price sort + price filter are post-fetch in JS at the current
  60-product limit. Phase 20 hardening (P3.1) will denormalize
  `min_price_cents` to products for SQL-side sort + filter at scale.

## Out of scope for v1
- Pagination (catalog fits in a single page for v1)
- On-sale / Rating / Genre facets in the sidebar (mockup has them; P0.16 ships category + price)
- Saved filters per user (would need a `user_preferences` table)

## Open questions for human
None.

---

## Implementation notes

### P8.2 — "Included with Personal Access" badge

Status: shipped (this tick). Subscriber-only visual signal on the catalog grid.

- **Query:** `getSubscriptionCatalogAccess()` in `02-features/library/queries/getSubscriptionCatalogAccess.ts`. Cached call to the existing `user_accessible_products` RPC, filtered in JS to `access_source === 'subscription'` only (purchases are not "included with" the subscription — they're already in the library). Returns `{ productIds: Set<number>, totalAccessible: number }`.
- **Filter scope:** subscription only. A user who both purchased and has a subscription sees the badge on the subscription's catalog coverage, not on the purchased row (the `LibraryRow` in P5.8 already shows the `access_source` discriminator).
- **Card affordance:** inline teal pill between the meta row and the title. `aria-label` on the card root gains "— included with Personal Access" when the badge renders. Same shape as the existing `.lic` PLR/Personal license pill, but with `--teal-soft` background (vs solid `--teal`) to differentiate the "you have this" signal from the "what it costs" signal.
- **Fail-soft:** anon → empty Set, RPC error → empty Set + warn log. The page renders without badges; never throws.
- **No new schema, no new RPC, no new RLS.** Pure additive UI on top of the P5.8 data layer.
- **Tests:** 9 new unit tests in `getSubscriptionCatalogAccess.test.ts` (anon path, happy path, mixed access sources, empty library, `data: null`, RPC error fail-soft, RPC call shape, Set instance freshness, large Set).
