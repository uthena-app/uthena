# Feature: product

The product detail page (`/products/[slug]`) and the components that
build it.

- **Specs:** [`01-specs/pages/product.md`](../../../01-specs/pages/product.md)
- **Route:** `app/products/[slug]/page.tsx` (thin — composes the
  feature components)
- **Depends on:** `catalog` (for the `getProductBySlug` query that
  feeds the page), `cart` (for the Add to cart button), `00-foundations`
  (design tokens + data layer)
- **Depended on by:** `checkout`, `library`, partner portal course
  detail (P12.6)
- **Status:** P0.12 Slice 1 (gallery + rating row) + Slice 2 (price
  block + license radio) + Slice 3 (perks list) + Slice 4 (tabs +
  Description/Curriculum/Instructor/Reviews panels) + Slice 5
  ("At a glance" sidebar) all shipped — P0.12 is complete. **P0.15**
  (curriculum JSONB data layer) also shipped as a standalone
  completion.
- **Test locally:** `pnpm test 02-features/product`

## Components

| Component | Role | Server/Client |
|---|---|---|
| `ProductGallery` | 16:9 main image + up to 4 thumbnail slots. Click a thumb to swap the main. Renders a "video" slot when the product has a preview video. | Client (uses `useState` for the active thumb) |
| `ProductRatingRow` | The inline metadata strip: stars, rating, review count, instructor link, ID badge. | Server (no interactivity) |
| `ProductPriceBlock` | The price row: price + strikethrough + save% + installments stub. | Server (no interactivity) |
| `LicenseSelector` | The license-tier radio group + Add to cart CTA. Tracks the selected tier in `useState` and posts to `addToCartAction` on submit. | Client (interactive form) |
| `ProductPerks` | The `.pinfo .perks` block at the bottom of the right column. Renders `products.bullets` (JSONB, migration 0013) as a stacked list with a teal check-circle prefix. Falls back to the mockup-faithful 4-item list when bullets is null. Renders nothing when bullets is empty. | Server (no interactivity) |
| `ProductCurriculum` | The Curriculum tab content. Renders `products.curriculum` (JSONB, migration 0014) as the mockup-faithful `.curric` block. Three render modes (null = 12-item fallback from `mockups/product.html` line 132, [] = render nothing, array = render rows with index/name/duration). | Server (no interactivity) |
| `ProductDescription` | The Description tab content. Renders `products.long_description` (TipTap JSON, JSONB column) via the pure-JSX `renderTipTap` renderer. Three render modes (null = mockup-faithful Course overview + What you'll learn, empty doc = nothing, doc = the doc). | Server (no interactivity) |
| `ProductInstructor` | The Instructor tab content. Partner card (avatar + display_name + @slug + bio) sourced from `product.partner.profile`. Renders a placeholder card when no partner row exists. | Server (no interactivity) |
| `ProductReviews` | The Reviews tab content. Read-only display of the avg + count + top 5 published reviews (newest first). Empty state when no reviews. Renders no write CTA — Phase 9 P9.14 wires the create flow. | Server (no interactivity) |
| `ProductTabs` | The 4-tab shell below the gallery/pinfo section. WAI-ARIA tabs pattern (role="tablist" + role="tab" + role="tabpanel" + aria-selected + aria-controls + aria-labelledby). Arrow-key nav (Left/Right/Home/End), default tab = description. The only client island below the fold. Listens for the `uthena:product:switch-tab` window event to switch tabs from external triggers (the "At a glance" sidebar's Preview curriculum button). | Client (interactive tabs) |
| `ProductAtAGlance` | The "At a glance" sidebar (the mockup's `.brief` block). 5 data rows (Format / Modules / License / Instructor / Updated) + Add to cart + Preview curriculum CTAs. Sticky on desktop, stacks on mobile. RSC except for the Preview curriculum button. | Server (with one client island) |
| `PreviewCurriculumButton` | The secondary "Preview curriculum" CTA inside `ProductAtAGlance`. Dispatches the `uthena:product:switch-tab` window event so the tabs switch to Curriculum when the user clicks. | Client (single event handler) |

## Helpers (no JSX)

| Helper | Role | Pure? |
|---|---|---|
| `formatDuration(seconds)` | Format seconds as the mockup's compact duration string ("12m" / "1h 23m" / "45s"). Defensive against NaN/negative input. | Yes (pure function) |
| `renderTipTap(doc)` | Pure-JSX TipTap JSON → React renderer. Supports StarterKit nodes (paragraph / heading / lists / blockquote / codeBlock / hardBreak / horizontalRule) + Link mark. Strict XSS defense on hrefs (strips `javascript:` / `data:` / `vbscript:`). | Pure (RSC-safe) |

## Data flow

`app/products/[slug]/page.tsx` calls `getProductBySlug(slug)` from
`@features/catalog/queries`, which fetches the product row + the
embedded `category` / `partner` (+ nested profile) / `pricing` /
`images` joins in a single query (no N+1). A second small query
fetches the top 5 published reviews (RLS-aware, anon-safe via
the `reviews_public_read_published` policy). The page passes the
data to the feature components. `ProductGallery` and `ProductTabs`
are the only client islands on the page (the rest is RSC).

## Slice plan

P0.12 is the umbrella task; it ships in 5 sub-slices. This feature
shipped Slices 1–5 (P0.12 is fully done). **P0.15** (curriculum
data layer) also shipped as a standalone completion — the rendering
component `ProductCurriculum` lands with Slice 4.

| Slice | Scope | Status |
|---|---|---|
| 1 | Gallery (data migration + multi-image component) + rating row | **shipped 2026-06-24** |
| 2 | Price block + license radio + Add to cart CTA | **shipped 2026-06-24** |
| 3 | Perks list (from `products.bullets` JSONB) | **shipped 2026-06-24** |
| 4 | Tabs (Description / Curriculum / Instructor / Reviews) + `ProductCurriculum` component reading `products.curriculum` JSONB (P0.15) + `ProductDescription` (renders `long_description` via `renderTipTap`) + `ProductInstructor` + `ProductReviews` | **shipped 2026-06-24** |
| 5 | "At a glance" sidebar (the mockup's `.brief` block — Format / Modules / License / Instructor / Updated + Add to cart + Preview curriculum) | **shipped 2026-06-24** |

P0.13 (`product_images` migration) shipped with Slice 1.
P0.14 (`products.bullets` JSONB migration) shipped with Slice 3.
**P0.15** (`products.curriculum` JSONB migration + `CurriculumEntry`
type + `getProductBySlug` select) shipped as a standalone
completion — the data was ready for Slice 4's component.

## Decisions worth remembering

- **Why the gallery is a client component.** The active-thumb
  state is local UI state. The initial state is server-rendered
  (first image active), so SSR still produces a meaningful first
  paint — a no-JS user sees the first image in the main slot, with
  the thumbs row inert. The component is intentionally small and
  ships no other client JS.
- **Why the video slot is a virtual item, not a `product_images`
  row.** The mockup shows the video preview as a special slot
  (gradient + play glyph + "PREVIEW" label), not as an image. The
  `product_images` table allows `kind = 'preview_video_thumb'` for
  a real thumbnail image, but the product detail page renders the
  video slot whenever `products.preview_video_url` is set, not
  based on a `product_images` row. This keeps the visual treatment
  consistent across all products that have a video, even if the
  partner hasn't uploaded a separate thumbnail.
- **Why the ID badge is `#PLR-1284` and not the slug.** The mockup
  shows `ID #PLR-1284` — a short SKU-style reference, not the
  full URL slug. We synthesize it from the license code + product
  id. This gives support and partner-ops a quick identifier
  without depending on a separate SKU column the schema doesn't
  have. When a real SKU column lands in P12.7 (course creation
  wizard), the badge swaps to read from it.
- **Why the thumbs row uses `role="tab"` / `aria-selected`.** The
  row behaves like a tab strip (only one main image visible at a
  time, focus the thumb to "select" it). The WAI-ARIA tabs pattern
  is the closest match. We don't go full tabs-with-panels because
  the "panel" is the same main-image element above the row, not
  a separate region. Screen-reader users get "Show image 2 of 4,
  selected" semantics, which is the right story.
- **Why the rating row is a server component.** It's pure
  presentation — no state, no event handlers. Rendering on the
  server keeps it zero-JS.
- **Why a hand-rolled TipTap renderer (`renderTipTap.tsx`).**
  TipTap's `generateHTML` ships a full DOMPurify + ProseMirror
  schema (~80 KB on the server) to support every conceivable
  node. Our partners only use StarterKit + Link — a 120-LOC
  pure-JSX renderer covers them. Bonus: no `dangerouslySetInnerHTML`,
  no XSS surface beyond what React already manages. The renderer
  uses an explicit `safeHref()` allowlist that strips
  `javascript:` / `data:` / `vbscript:` / `file:` hrefs and only
  permits http(s) / relative / mailto / fragment URLs. Unknown
  nodes fall through to "render children" so a future TipTap
  extension never drops prose silently.
- **Why the tabs UI is the only client island below the fold.**
  Each tab panel is fully server-rendered — switching tabs only
  toggles `hidden` on the panel and `aria-selected` on the
  tab button. The Description / Curriculum / Instructor / Reviews
  components ship zero client JS. This keeps the catalog/product
  page bundle size in check (per the architecture's "< 50 KB
  client JS per route" rule).
- **Why reviews are a separate query (not a join).** The
  `getProductBySlug` product query joins partner + profile + images
  + pricing + category; adding reviews to that join would inflate
  the payload for every product view, even though reviews are
  only shown in the Reviews tab (which most visitors don't open).
  A separate `getRecentReviewsForProduct(supabase, productId, 5)`
  runs once per page render and only when the row exists. RLS
  keeps anon safe (only `status = 'published'` rows surface).
- **Why the Curriculum component caps at 24 entries.** A runaway
  partner might paste a 200-item list. Capping at 24 matches the
  mockup's 12-item fallback (the partner can always paginate
  via the LMS in Phase 15) and keeps the row grid from blowing
  up the layout.
- **Why the Instructor tab links to `/partners/[public_slug]`.**
  The mockup shows a single-line "Instructor: Lambros Lazopoulos"
  in the At-a-glance sidebar (Slice 5 territory); the dedicated
  Instructor tab is the wider version of that — a partner card.
  The link goes to the partner's public page once that ships
  (P12.4 dashboard detail or a new public partner page). Today
  the link is a forward-looking affordance; if the partner page
  doesn't exist yet the link 404s, same pattern the rest of the
  app uses for `/affiliate` and `/about`.
- **Why a kind → format string map (not a `format` text column).**
  Slice 5's Format row reads `products.kind` and maps it to a
  format string via a hardcoded `Record<kind, string>`. We don't
  have a `format` column today; adding one would mean a new
  migration + an admin input + a partner wizard field. The
  kind-derived label is the right v1: it's deterministic, it
  matches the mockup's "MP4 + PDF + Figma" treatment of the
  `video_course` kind, and a partner who wants to override the
  default can do so in the partner wizard (P12.7). At that point
  the column lands and the map becomes a fallback. No data
  debt; just a clean upgrade path.
- **Why a window event for the Preview curriculum button (not a
  ref or context).** The brief is a sibling of the tabs in the
  page tree, not a parent. Lifting state would require a context
  that wraps both — a lot of plumbing for one click. A named
  CustomEvent keeps both surfaces independent. The `instanceId`
  filter on the receiver means multiple ProductTabs on the same
  page (rare; future-proofing for the bundle configurator) don't
  fight each other for the active tab. The pattern is identical
  to the `SearchTrigger` / `MobileNavTrigger` event bridge used
  for the global overlays (P0.4 + P0.5). Reusable: any future
  "click here to switch to the curriculum tab" affordance fires
  the same event.
- **Why the brief's Add to cart is disabled, not wired.** Slice
  5 ships a forward-looking CTA — a real `onClick` would need
  the radio state (the brief doesn't have it; that's the
  `LicenseSelector`'s job at the top of the page) plus a server
  action. Until the cart drawer lands (P4.1) the brief's
  Add-to-cart is a no-op affordance. The primary add-to-cart
  path is the top `LicenseSelector`. When the cart drawer is in
  place, the brief's button can be wired with the default
  license preselected (read from `default_license`); for v1 the
  disabled state is the honest answer (and the `aria-label`
  surfaces "no active pricing" when the product has no
  tiers).
- **Why the brief stacks the rows label-above-value (not
  label-left/value-right).** The brief is 320 px wide; a
  label-left / value-right layout would force very narrow value
  text on desktop (the "12 modules · 4h 38m" line would wrap to
  2-3 lines). The vertical stack gives the value the full
  column width and keeps the row rhythm consistent. The
  mockup's `.brief` rule (line 137–145 of main.css) shows the
  same shape.
- **Why the brief hides rows when their data is missing.** The
  License row hides when no default license; the Instructor row
  hides when no partner profile. Showing "—" for those would
  clutter the brief with empty rows that have no actionable
  information. The 3 hard rows (Format / Modules / Updated) are
  always present (with a "—" fallback for Format when the kind
  is unknown, and for Modules / Updated when no data) because
  those values are part of the product's identity, not optional
  metadata.

## What the next slice owns

P0.12 is complete. The next phase-0 loose-end task is **P0.16**
(Browse polish — sort + price filter + density toggle + URL-driven
filters). P0.16 is independent of the PDP work and can land in
parallel with any future /products/[slug] refinements.