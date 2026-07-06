# loading.md — per-route streaming fallbacks

> **Cross-cutting spec.** Covers every `loading.tsx` file in `app/`. The
> check-specs script doesn't audit `loading.tsx` files (it matches
> `page.tsx`), but AGENTS.md says "no code without a spec" — this file
> is the single source of truth for the loading surface.

---

## What this surface does

Every long-running route in `app/` ships a `loading.tsx` that renders
while the route's `page.tsx` streams in. Next.js wraps each `page.tsx`
in an automatic `<Suspense>` boundary; the `loading.tsx` next to a
`page.tsx` is the fallback for that boundary. The root
`app/loading.tsx` is the fallback for any route that doesn't have its
own.

Why this matters:

- **No layout shift.** The skeleton mirrors the eventual page's
  shape, so when the streaming chunk arrives the user doesn't see
  content jump.
- **Perceived speed.** A skeleton that matches the page reads as
  "loading the page" instead of "loading nothing".
- **Streaming-native.** Next.js renders the `loading.tsx` immediately
  while it awaits the `page.tsx`'s `await`s. Without it, the user
  sees a blank canvas for the full DB round-trip.

---

## Data this surface shows

None. A `loading.tsx` is a server component with no data fetch —
rendering it is the whole point.

---

## User actions (with RBAC)

None. The surface is non-interactive (skeleton placeholders are not
focusable, not clickable, not keyboard-navigable).

---

## What this surface does NOT do

- No data fetch. (The skeleton renders before the page's data fetch
  even starts.)
- No client JS. (Loading components are RSC; the pulse animation is
  pure CSS, gated on `@media (prefers-reduced-motion)`.)
- No focus management. (The skeleton is a visual placeholder, not a
  semantic widget. Screen readers announce "Loading…" via the
  skeleton's `role="status"` + `aria-label`.)
- No error UI. (Errors surface through `app/error.tsx`, not the
  loading skeleton.)

---

## Acceptance criteria

- [ ] **AC1** `app/loading.tsx` exists at the root and renders a
      generic skeleton shape (eyebrow + h1 + lede + 6-card grid +
      mid-page band) that fits any unknown route.
- [ ] **AC2** Each high-traffic public marketing route ships its own
      `loading.tsx`:
      - `app/products/[slug]/loading.tsx` — gallery placeholder +
        right-column header + price + license radio placeholder +
        perks placeholder + tabs placeholder + sidebar placeholder.
      - `app/browse/loading.tsx` — header + filter chips + results
        head + 12-card grid.
      - `app/bundles/loading.tsx` — header + 6-card grid.
      - `app/collections/loading.tsx` — header + featured row +
        categories row.
      - `app/collections/[handle]/loading.tsx` — header + 6-card
        grid.
      - `app/search/loading.tsx` — header + results head + 6-card
        grid.
- [ ] **AC3** Every `loading.tsx` uses the shared `Skeleton`
      primitive from `@foundations/ui/primitives/Skeleton`. No inline
      pulse animations, no third-party libraries.
- [ ] **AC4** Every `loading.tsx` is a server component (no
      `'use client'` directive). Zero client JS shipped.
- [ ] **AC5** Every skeleton layout uses token-only CSS (no inline
      styles, no magic pixel values). Reuses `--bg-elev-2`,
      `--bg-elev-1`, `--line`, `--r-md`, `--r-pill`, `--space-N`,
      `--font-display`, `--font-mono` from `tokens.css`.
- [ ] **AC6** The skeleton's pulse animation is disabled when
      `prefers-reduced-motion: reduce` is set (handled by the
      `Skeleton` primitive's own `@media` rule).
- [ ] **AC7** The skeleton layout matches the eventual page's DOM
      shape within ±20px on every axis (no visible layout shift when
      the streaming chunk replaces the skeleton).
- [ ] **AC8** The skeleton is announced to screen readers via the
      `Skeleton` primitive's `role="status"` + `aria-label="Loading…"`
      defaults. The skeleton's parent `<main>` carries
      `aria-busy="true"` while the loading state is active.
- [ ] **AC9** No layout shift when the streaming chunk arrives —
      verified by visual inspection of the dev server smoke test on
      each public marketing route (cold + warm cache).
- [ ] **AC10** Each per-route `loading.tsx` ships alongside a CSS
      module (`loading.module.css`) with token-only styles.

---

## Design reference

No mockup. The skeletons are derived from the rendered output of each
`page.tsx` — they mirror the eyebrow + h1 + lede + grid pattern used
across the catalog family (home, browse, bundles, collections,
search) and the 2-column layout used on the PDP.

---

## Security

- **Auth required by default:** N/A (skeletons render before any
  auth check, and they're the same for anon + authed).
- **RLS:** N/A (no DB queries).
- **PII:** N/A (no user data flows through the skeleton).

---

## Performance

- **p95 budget:** Loading skeleton must render in < 50ms (it's pure
  static markup, no fetch). Verified via the dev server smoke test.
- **Bundle impact:** Zero client JS (RSC). The skeleton CSS module
  is bundled into the page payload (each route's existing CSS chunk
  gains ~1 KB).
- **Streaming:** Next.js renders the skeleton immediately while it
  awaits the page's DB queries. The skeleton disappears when the
  page's content is ready to stream.

---

## Out of scope for v1

- **Authenticated route skeletons** (`library`, `account/*`,
  `cart`, `checkout`). These land in a follow-up tick when those
  routes get their deeper treatment (PH7 library, PH9 account,
  PH4 cart/checkout).
- **Partner + admin route skeletons** (`partner/*`, `admin/*`).
  Same story — PH12 / PH14.
- **Per-route Suspense boundaries around client islands**
  (SearchOverlay, MobileNav, LicenseSelector, ProductTabs,
  PreviewCurriculumButton). The islands are already mounted at the
  root, and they don't have their own data fetch — wrapping them in
  extra Suspense boundaries adds complexity without changing UX. The
  global `app/loading.tsx` covers the streaming skeleton for any
  route.
- **Skeleton streaming animations** (shimmer wave, gradient sweep).
  The existing `Skeleton` primitive uses a simple opacity pulse,
  which is lighter on the GPU and reads as "loading" without being
  distracting. A more elaborate animation can ship later if design
  calls for it.

---

## Open questions for human

None. The spec is self-contained: it mirrors each page's eventual
shape, uses the existing `Skeleton` primitive, and ships as pure
RSC + token-only CSS.

---

## Implementation notes (filled by the building agent)

### Files shipped (sub-slice 1 — root + 6 public marketing routes)

- `app/loading.tsx` + `app/loading.module.css` — root fallback,
  generic eyebrow + h1 + lede + 6-card grid + band shape. Used for
  any route without its own loading.tsx (auth, partner, admin,
  library, legal pages).
- `app/products/[slug]/loading.tsx` + `.module.css` — PDP skeleton
  with gallery placeholder + right-column header + price +
  license radio + perks + tabs placeholder + sidebar placeholder.
- `app/browse/loading.tsx` + `.module.css` — browse skeleton with
  header + filter chips + results head + 12-card grid.
- `app/bundles/loading.tsx` + `.module.css` — bundles skeleton
  with header + 6-card grid.
- `app/collections/loading.tsx` + `.module.css` — collections
  index skeleton with header + featured row + categories row.
- `app/collections/[handle]/loading.tsx` + `.module.css` —
  collections detail skeleton with header + 6-card grid.
- `app/search/loading.tsx` + `.module.css` — search skeleton with
  header + results head + 6-card grid.

### Decisions worth remembering

- **One CSS module per loading.tsx** (not a shared skeleton
  hierarchy module) — each route has a unique shape; a generic
  "catalog skeleton" wouldn't match the PDP's 2-column layout or
  the search results' query-echo row. The `Skeleton` primitive is
  the shared piece; the layout CSS lives with the loader.
- **Root `loading.tsx` is intentionally generic.** It can't know
  what the eventual page is — so it uses the most common shape
  (header + grid + band). Routes that need a more specific shape
  ship their own.
- **No client JS in any loader.** Loading skeletons must render
  before the page's data fetch starts. Client components need
  hydration, which needs the JS bundle, which defeats the point.
- **Pulse animation is in the Skeleton primitive, not per-loader.**
  Every loader uses the same `Skeleton` so the animation is
  consistent across routes. Adding per-loader animation would
  fragment the UX.

### Slice boundary (this tick)

Root + 6 public marketing routes. Auth / partner / admin /
library / cart / checkout / search results / per-route skeletons
land in follow-up ticks.