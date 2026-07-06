# `02-features/search/`

Instant-search surface for Uthena. Two consumers:

- **P0.4** — the global `⌘K` overlay (mounted in `app/layout.tsx`).
- **P0.19** — the `/search?q=` results page (pending; will reuse
  `searchPublishedProducts`).

## Files

| File | Purpose |
|---|---|
| `SearchOverlay.tsx` | Client component. Owns the modal DOM, the `⌘K` / `Ctrl+K` global listener, the debounced `/api/search` fetch loop, and keyboard navigation. |
| `SearchTrigger.tsx` | Tiny client island. Delegates `click` on any `[data-search-trigger]` element to a `uthena:search:open` window event that the overlay listens for. Mounted once alongside the overlay so the SiteHeader's pill input can prefill-then-open the overlay instead of submitting its fallback form. |
| `SearchOverlay.module.css` | Modal + skeleton + result-row styles. Token-only. |
| `queries.ts` | Server-only `searchPublishedProducts(q, limit)` — RLS-aware, `cache()`-deduped per request. |
| `useDebouncedValue.ts` | Generic debounce hook (separated so the future `/search` page can reuse it). |
| `searchEvents.ts` | Module-scoped `SEARCH_TRIGGER_OPEN_EVENT` constant — the bridge between trigger (header) and overlay. |
| `index.ts` | Barrel — the only thing `03-app/` should import from. |

## How it wires together

```
SiteHeader (RSC)
  └── <SearchTrigger />            ← client island
        └─ listens for clicks on [data-search-trigger]
        └─ dispatches uthena:search:open

SiteHeader (RSC)
  └── <SearchOverlay />             ← client component
        ├─ listens for uthena:search:open
        ├─ listens for ⌘K / Ctrl+K
        ├─ fetches /api/search?q=...   (debounced 300ms)
        └─ renders modal into a portal-like fixed overlay
```

## Acceptance criteria (P0.4)

- ⌘K (macOS) or Ctrl+K (others) toggles the overlay.
- Click on the SiteHeader search pill opens the overlay instead of
  submitting its no-JS fallback form.
- `Escape` and click-on-backdrop close.
- Body scroll is locked while open; focus is restored on close.
- Debounced query hits `/api/search` (300 ms after last keystroke).
- Empty input shows a "Type to search" idle state + popular-category
  pills.
- No-results shows an actionable empty state with a link to `/browse`.
- Keyboard nav: `↑` / `↓` highlight, `Home` / `End` jump, `Enter`
  opens the highlighted result or falls through to `/search?q=…`.
- All styles use design tokens (no inline hex / px).
- Zod-validated `/api/search` query + length-bounded input.
- All 6 checks green (`typecheck`, `lint`, `check:no-todo`,
  `check:pii`, `check:specs`, `check:rls`).

## Deferred

- Highlighted-text within results (token match bolding) — would
  need either client-side regex over the title (cheap) or
  Postgres `ts_headline` (heavier). Not in this slice; ship the
  match-the-row surface first.
- Recent / pinned searches — would persist in localStorage. Not
  in this slice; out of scope until the catalog has user-side
  recency worth keeping.
- `/search?q=` results page (P0.19) — reuses `searchPublishedProducts`
  with a higher limit + pagination; not in this slice.