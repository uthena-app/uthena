# Search results — `/search?q=`

## What this page does

The public full-page search results. Lands users who submit a query
through the SiteHeader's pill input (`<form action="/search">`,
already wired in P0.2) or who navigate directly to `/search?q=…`.
Renders the same `ProductCard` grid as `/browse` so the catalog
surface stays visually consistent. Provides three designed empty
states (no q, no results, error) so the page is always useful.

## Data this page shows

| Section | Field | Source | Format |
|---|---|---|---|
| Header | active query (`q`) | URL param | text + H1 |
| Header | match count | result set length | mono line |
| Active-query chip | the query itself with `✕` clear | URL → `/search` (no q) | pill |
| Result grid | `slug`, `title`, `short_description`, `thumbnail_url`, `kind`, `category`, `partner`, `starting_price_cents`, `msrp_cents`, `default_license`, `avg_rating`, `review_count`, `total_lesson_count`, `total_duration_seconds` | `searchPublishedProducts(q, 60)` → normalized via `normalizeListItem` | `ProductCard` |
| SEO metadata | title, description, canonical, OG | route metadata | `<head>` |

The query strategy (P0.4) is intentionally narrow: tokenize on
whitespace, max 6 tokens, match `title` OR `short_description` per
token. The same `searchPublishedProducts` query backs the ⌘K
overlay (limit=8) and this page (limit=60). Newest-first ordering.

## User actions

| Action | Trigger | Result | RBAC |
|---|---|---|---|
| Submit search | Submit SiteHeader form | Navigate to `/search?q=<value>` | public |
| Clear search | Click the `✕` on the active-query chip, or any "Clear search" CTA in an empty state | Navigate to `/search` (no q) | public |
| Open result | Click a `ProductCard` | Navigate to `/products/[slug]` | public |
| Open bundled results | (n/a — bundles aren't indexed separately; they share the product search) | — | — |
| Browse all categories | Click "Browse the catalog" CTA on no-results empty state | Navigate to `/browse` | public |
| Modify search | Edit the q in the URL bar (or use the header search form again) | Re-run search with new q | public |

## What this page does NOT do

- Filters (price / license / category / sort / density) — the
  overlay already handles "type-to-search" filtering; a full-page
  results view inherits the search-time permissiveness.
- Pagination — search results cap at 60 (matches `/browse`'s
  `BROWSE_PAGE_SIZE`); a real catalog at scale would need
  pagination, cursor-based or offset. Documented in "Out of scope
  for v1" below.
- "Did you mean" — no fuzzy matching, no spelling correction, no
  related-terms expansion. The query is what the user typed.
- Server-side caching beyond Next.js ISR — every render hits
  `searchPublishedProducts` (which is `cache()`-deduped within a
  request, but not across requests).
- Search analytics / query logging — no event tracking, no log
  capture. Future phase (P16.1) wires Gorse `search` events.

## Acceptance criteria

- [ ] Route `/search?q=<value>` is public, RSC, ISR 60s, returns 200
- [ ] `q` is validated with Zod (`min(1).max(120)`); invalid q falls
      back to the empty-state UI (no 4xx page for legitimate
      client typos)
- [ ] `/search` with no `q` shows the "Type to search" empty state
      with a search prompt + a "Browse the catalog" CTA
- [ ] `/search?q=X` with 0 results shows the "No matches for X"
      empty state with a "Browse the catalog" CTA + a "Try a
      different search" hint
- [ ] `/search?q=X` with N>0 results shows: eyebrow + H1 echoing
      the query + active-query chip with `✕` clear + count + grid
      of `ProductCard` components
- [ ] Result count echoes the live result length
- [ ] Active-query chip's `✕` links to `/search` (no q)
- [ ] Grid is 3-col desktop / 2-col tablet / 1-col mobile (same
      shape as `/browse` comfortable density)
- [ ] Page metadata: title includes the query (`"X — Search · Uthena"`),
      description summarizes the search, canonical = `/search`
      (without q — search results shouldn't be indexed), `noindex`
      on the results page (search results are user-specific)
- [ ] No client JS shipped (pure RSC; the SiteHeader form is a real
      HTML `<form>` so non-JS users get the same flow)
- [ ] Search input in the SiteHeader still submits to `/search` (no
      regression to the P0.2 + P0.4 wiring)
- [ ] RLS-aware reads (anon sees only published products via the
      existing `searchPublishedProducts` query — same RLS matrix as
      the ⌘K overlay)
- [ ] No PII in logs (no q logged at INFO; existing query's
      `console.error('[search] searchPublishedProducts', err.message)`
      stays — it logs the DB error, not the user's query)
- [ ] Keyboard accessible — chip is a real `<Link>` with focus ring,
      cards are real `<a>` with focus rings

## Design reference

- Mockup: catalog family rhythm (header eyebrow + h1 + lede + grid)
  matches `mockups/browse.html` lines 45–57 + 91–304 with the
  sidebar omitted (search has no facets). The active-query chip
  reuses the browse page's `.pill.on` shape (P0.16).
- Design tokens: `00-foundations/design/tokens.css`
- Theme: dark (matches the rest of the catalog family)

## Security

- **Auth required:** NO
- **Allowed roles:** public (anon, customer, partner, affiliate,
  admin)
- **RLS policies that apply:**
  `products_public_read_published`,
  `product_pricing_public_read_active`,
  `categories_public_read`,
  `partners_public_read`. Same matrix as `/browse` — anon sees
  only published products, partners see their own drafts, admins
  see everything.
- **PII displayed:** NO. The q is echoed in the H1 + chip, but q
  is user input (no PII implied).
- **PII in URLs:** NO. The query is plain text, never user
  identifiers.
- **Audit logged:** NO. Page reads are not audited (matches the
  rest of the catalog family). Future P14.18 search analytics
  would emit a `search_performed` event.
- **Third-party scripts:** NONE.

## Performance

- **Target p95:** < 200ms (catalog performance budget per
  `docs/ARCHITECTURE.md` §5)
- **Render strategy:** RSC + ISR with `revalidate = 60`
- **Cache:** Next.js ISR caches the rendered HTML for 60s per
  unique q. `searchPublishedProducts` is `cache()`-deduped within
  a single request.
- **Bundle size budget:** 0 KB client JS (page is RSC; the only
  client JS is the header's SearchOverlay, which already exists
  and is unaffected)
- **Search query:** single PostgREST read with `.or(...)` +
  `.limit(60)`. 60 × 2 join rows (pricing) ≈ 120 rows in flight,
  well under PostgREST's default 1000-row response budget.

## Out of scope for v1

- Pagination (offset or cursor-based) — current cap is 60 results;
  catalog at scale will need real pagination. Documented as a
  Phase 19 / 20 follow-up.
- Search filters on the results page (license, price, category,
  rating) — overlay handles "type-to-search"; full-page filters
  are a Phase 19 task (P19.10).
- "Did you mean" / related-search suggestions — Phase 19 (P19.10).
- Search analytics / Gorse signal — Phase 16 (P16.1) wires
  `search` events.
- Saved searches per user — would need a `user_searches` table
  + a `notifications` surface for "new results for your saved
  search". Not in any current phase.
- Stemming / fuzzy matching — the existing `.ilike` strategy is
  permissive enough for v1. A real `tsvector` column lands in
  Phase 20 (P3.7 hardening).

## Open questions for human

None.

---

## Implementation notes

- P0.19 (2026-06-24): first-pass implementation. Reuses the P0.4
  `searchPublishedProducts` query (same tokenization, same RLS
  matrix, same sort). Page is RSC + ISR=60s. Three designed empty
  states (no-q prompt, no-results, loading-state UX is deferred
  to P0.24 which owns loading.tsx per route). Single
  `SEARCH_PAGE_SIZE = 60` constant matches `BROWSE_PAGE_SIZE`.
- P8.2 (2026-06-26): "Included with Personal Access" badge on
  result cards. Same shape + color DNA as the catalog grid. Access
  map fetched in parallel via `Promise.all`. No new client JS.
