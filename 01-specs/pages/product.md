# Product detail — `/products/[slug]`

## What this page does
Single-product page. Shows the multi-image gallery, title, short
description, rating row, price + save%, license-tier radio, perks
list, tabs (Description / Curriculum / Instructor / Reviews), and
"At a glance" sidebar. The full curriculum + reviews ship in PH15
(their data lands via P0.15 `curriculum` JSONB + Phase 15 LMS
tables; the rendering ships with P0.12 Slice 4). The Add to cart
button is wired in PH06.

## Data this page shows
- Breadcrumb: Catalog > Category > Product
- Gallery (main + 3 thumbnails from `product_images`)
- Optional preview-video thumbnail (from `products.preview_video_url`)
- Title, short description
- Rating row: stars + numeric rating + review count + instructor + ID
- Price row: price · strikethrough · save% · "OR N × $X" installment stub
- License radio: PLR / MRR / RR / Personal (data from `product_pricing`)
- Add to cart CTA (PH06 wires the click; the button shows a
  "coming in PH06" message until then)
- Perks list (data from `products.bullets` JSONB; falls back to
  the mockup-faithful 4-item list when bullets is null)
- Tabs: Description (always shown) · Curriculum (P0.12 Slice 4
  renders the data from P0.15) · Instructor · Reviews
- "At a glance" sidebar: Format / Modules / License / Instructor /
  Updated + Add to cart + Preview curriculum (P0.12 Slice 5)

## User actions
- Click a breadcrumb category — navigate to `/collections/[handle]`
- Click a thumbnail in the gallery — swap the main image (P0.12
  Slice 1)
- Click the instructor — navigate to `/partners/[public_slug]`
- Click the "Add to cart" button — opens cart (PH06, currently
  disabled with a "coming soon" message)
- Click a tab in the lower section — switch tab (P0.12 Slice 4+)
- Click "Preview curriculum" — scroll to the Curriculum tab
  (P0.12 Slice 3)

## What this page does NOT do (this phase)
- Curriculum tab content rendering (P0.12 Slice 4; data lands via
  P0.15)
- Reviews tab content (Phase 9 P9.14)
- Preview video (Phase 9 P9.2 — needs Bunny signed stream URL)
- Add-to-cart action (PH06) — the brief's Add-to-cart CTA is a
  forward-looking affordance; the real action lives in the top
  `LicenseSelector`
- Wishlist (deferred)

## Acceptance criteria

### P0.12 Slice 1 — Gallery + rating row (this tick)
- [x] Server component, ISR 60s
- [x] `generateMetadata` returns proper title/description/og
- [x] 404 if the product doesn't exist or isn't published
- [x] **Gallery**: 16:9 main image + horizontal row of up to 4
      thumbnails. Clicking a thumb swaps the main image. The
      currently-active thumb is outlined in `--teal`.
- [x] **Preview-video thumbnail**: when `products.preview_video_url`
      is set, the gallery renders a special "video" thumbnail slot
      with a `▶` glyph and "PREVIEW" label (mockup-faithful to
      `mockups/product.html` line 54). When unset, the slot is
      omitted and only image thumbs render.
- [x] **Rating row**: 5-star row (only when `review_count > 0`),
      numeric rating (e.g. "5.00"), review count, instructor link,
      mono "ID #PLR-1284" badge. Matches
      `mockups/product.html` lines 62–69.
- [x] **Breadcrumb**: Home / Category / Product (mockup-faithful
      text, real links).
- [x] Page is keyboard-accessible (focus rings on gallery thumbs,
      breadcrumb links, rating row instructor link).
- [x] No PII in the page
- [x] Public route — RLS-aware reads only show published products

### P0.12 Slice 2 (this tick) — Price block + license radio + Add to cart
- [x] **Price block**: price (large mono) + strikethrough (compare_at)
      + SAVE % chip (orange on orange-line) + "OR 4 × $X.XX with Shop
      Pay" installments stub. RSC, no interactivity. Falls back to
      "No pricing available" when the product has no active pricing.
      Mockup-faithful to `mockups/product.html` lines 72–77 and
      `mockups/styles/main.css` lines 280–284.
- [x] **License radio**: real `<input type="radio">` group, one option
      per active pricing tier, with name + tag + description + price
      on each option. Selected option gets teal border + teal-soft
      background. PLR/Personal get teal tag; MRR/RR get orange tag
      (matches `mockups/styles/main.css` `.lic-tag.mrr`). Keyboard
      accessible — radios stay in tab order, focus ring shows on
      the label.
- [x] **Add to cart CTA**: full-width orange `Button` below the radios.
      Posts the selected license to the existing
      `addToCartAction` server action. On success, navigates to
      `/cart`. On auth-required, redirects to `/login?next=/cart`.
      On other error, shows an inline `role="alert"` message.
- [x] Empty pricing case: when `product.pricing` has no active
      tiers, both the price block and the radio group render their
      "no pricing" state and the CTA is hidden.
- [x] Defense in depth: `addToCartAction` re-validates the
      `product_id`/`license` pair server-side (already in place
      since PH06) — the new client UI doesn't introduce a new
      trust boundary.

### P0.12 Slice 3 (this tick) — Perks list
- [x] `products.bullets` JSONB column added (migration 0013) —
      nullable, no default, CHECK constraint that the value is
      `null` or a JSONB array of plain strings. Inherits RLS from
      the products table (no new policies needed).
- [x] `getProductBySlug` selects `bullets`; `ProductDetail` type
      exposes `bullets: string[] | null`.
- [x] **ProductPerks component** (RSC, in `02-features/product/`)
      renders the mockup-faithful `.pinfo .perks` block (lines
      101–106 of `mockups/product.html`):
      - `bullets === null` → renders the 4 mockup-faithful
        fallback items (Earn money reselling / 100% PLR license /
        Downloadable video, slides, scripts / Edit, modify,
        repackage).
      - `bullets.length === 0` → renders nothing (partner
        explicitly cleared the list — different intent from
        "hasn't been set").
      - `bullets.length > 0` → renders the partner's items,
        capped at 8 entries × 200 chars each, with non-string
        entries + empty strings filtered out.
- [x] ProductPerks wired into the `pinfo` column of
      `/products/[slug]` directly after the `LicenseSelector` (the
      mockup places the perks list at the bottom of the right
      column, after the Add-to-cart CTA).
- [x] Legacy below-the-fold `.bullets` "What you get" section
      removed (now duplicated by the new ProductPerks in the top
      section). The "License terms" card stays until Slice 4 lands
      the tabs and gives it a proper home.
- [x] Token-only styles in `ProductPerks.module.css` — `var(--s-4)`
      vertical padding, `var(--teal-soft)` + `var(--teal-line)` +
      `var(--teal)` check-circle, `var(--r-pill)` circle radius,
      `var(--text)` body color. No magic literals.
- [x] A11y: `role="list"` + `role="listitem"` + `aria-label="What's
      included"` on the perks block; the check glyph is
      `aria-hidden` (decorative).
- [x] No PII / no secrets in the component (read-only data from
      the products row, no user input).

### P0.12 Slice 4 (this tick) — Tabs + 4 panel content components
- [x] **Tabs UI**: a `<ProductTabs>` client component that renders a
      `role="tablist"` of 4 `<button role="tab">` elements
      (Description / Curriculum / Instructor / Reviews) plus the
      matching `<section role="tabpanel">` panels. Active tab gets
      the heading color + a 2 px `--teal` bottom border over the
      row's 1 px `--line` border (matches the mockup's `.tabs`
      rule, line 298 of `mockups/styles/main.css`). Default tab =
      Description.
- [x] **Curriculum badge count**: the Curriculum tab button shows
      "{N} module{s}" mono badge to the right of the label
      (mirrors the mockup's `.ct` rule, line 301). Hidden when
      `products.curriculum` is null or empty.
- [x] **Reviews badge count**: the Reviews tab button shows the
      numeric review count as a mono badge (e.g. "12"). Hidden
      when `products.review_count` is 0.
- [x] **WAI-ARIA tabs pattern**: each tab carries `role="tab"`,
      `aria-selected`, and `aria-controls` pointing at the
      panel's id. Each panel carries `role="tabpanel"` +
      `aria-labelledby` pointing back at the controlling tab.
      Keyboard nav: Left/Right arrows cycle through tabs (wraps),
      Home jumps to first, End jumps to last, Tab leaves the
      tablist. Only the active panel is rendered (others get
      `hidden`); `tabIndex={isActive ? 0 : -1}` keeps the tab
      order clean.
- [x] **Description tab** (`ProductDescription`, RSC) renders
      `products.long_description` (TipTap JSON stored as JSONB).
      Null = mockup-faithful fallback ("Course overview" + "What
      you'll learn" with 6 bullets). Empty doc = nothing.
      Non-empty doc = render via the pure-JSX `renderTipTap`
      helper (no DOMPurify, no `dangerouslySetInnerHTML`,
      strict XSS defense on link hrefs).
- [x] **Curriculum tab** (`ProductCurriculum`, RSC) renders
      `products.curriculum` (JSONB, migration 0014) as the
      mockup-faithful `.curric` block. Null = 12-item fallback
      from `mockups/product.html` line 132. Empty array =
      nothing. Array = render rows with `{index, name,
      duration_seconds}` formatted via the shared `formatDuration`
      helper ("12m" / "1h 23m" / "45s"). Capped at 24 entries
      × 200 chars per name.
- [x] **Instructor tab** (`ProductInstructor`, RSC) renders a
      partner card (64×64 circular avatar or initials fallback +
      display name + @public_slug link + bio) sourced from
      `product.partner.profile` (joined profile row). When the
      partner row is null (orphan / deleted profile), renders a
      small "Instructor info coming soon" placeholder card. When
      the bio is empty, renders a "hasn't written a bio yet"
      italic note. Caps at 80 chars for display name + 1500 chars
      for bio (defensive against runaway input).
- [x] **Reviews tab** (`ProductReviews`, RSC) is read-only today:
      aggregate header (stars + numeric avg + verified-reviews
      count) + the top 5 published reviews (newest first). Each
      review row carries the star row, title (when present),
      reviewer display_name, date (UTC month + year), body (capped
      at 2000 chars), and a helpful-count line when the count is
      > 0. Empty state when `products.review_count = 0` ("No
      reviews yet. Reviews open after Phase 9 ships the buyer
      write flow — check back soon.").
- [x] **Reviews data**: `getProductBySlug` now also fetches the
      top 5 published reviews for the product (separate query,
      not a join) via a new `getRecentReviewsForProduct` helper.
      The `reviews_public_read_published` RLS policy keeps this
      anon-safe (only `status = 'published'` rows surface). The
      `recent_reviews` field on `ProductDetail` exposes the array.
- [x] **Instructor data**: `getProductBySlug` joins the partner's
      profile row (`display_name` + `avatar_url`) via
      `profile:profiles!partners_user_id_fkey(...)`. The
      `ProductDetail.partner.profile` field exposes the nested
      profile. RLS for `profiles` is already public-read for the
      fields we need.
- [x] **Helper**: `formatDuration(seconds)` in
      `02-features/product/formatDuration.ts` — pure function,
      defensive against NaN / negative input. Below 60s → "Ns",
      below 60m → "Nm", 60m+ → "Nh MMm" with 2-digit minute
      padding. Cap at 30 days so a runaway input doesn't blow up
      the layout.
- [x] **Helper**: `renderTipTap(doc)` in
      `02-features/product/renderTipTap.tsx` — pure-JSX TipTap
      JSON → React renderer. Supports StarterKit nodes (paragraph
      / heading / bulletList / orderedList / listItem /
      blockquote / codeBlock / hardBreak / horizontalRule) +
      marks (bold / italic / strike / underline / code / link).
      Strict XSS defense: `safeHref()` allowlist that strips
      `javascript:` / `data:` / `vbscript:` / `file:` hrefs and
      only permits http(s) / relative / mailto / fragment URLs.
      Max depth cap (64) prevents stack overflow on a malicious
      doc. Unknown node types fall through to "render children"
      so future TipTap extensions never drop prose silently.
- [x] **Page integration**: `app/products/[slug]/page.tsx` now
      composes the four panels into a single `<ProductTabs>` call
      below the `pdpTop` section. The legacy "License terms"
      below-the-fold card is removed (the mockup doesn't have one
      — the tabs replace it). `ProductTabs` is the only client
      island below the fold; the four panels are RSC, so the
      catalog/product page bundle stays in the architecture's
      "< 50 KB client JS per route" budget.
- [x] **Token-only styles**: every new component uses design
      tokens (`var(--teal)`, `var(--text-2)`, `var(--r-lg)`,
      `var(--font-mono)`, `var(--s-5)`, etc.). No magic literals
      in the new CSS. The only literals in `ProductCurriculum` /
      `ProductTabs` are column widths (32 px idx / 80 px dur)
      that are visual-rhythm decisions, not token-able values.
- [x] **No PII / no secrets in the new components**. The four
      panel components are pure read-only views of data already
      on the product row; no user input, no logging, no console
      output. The reviews query logs error.message on failure
      (same pattern as the rest of `catalog/queries.ts`) — no
      PII fields, no query params.
- [x] **All 6 checks green** (typecheck / lint / check:no-todo /
      check:pii / check:specs / check:rls) + `pnpm build` clean.

### P0.12 Slice 5 (this tick) — "At a glance" sidebar
- [x] **Sidebar component**: `ProductAtAGlance` (RSC) renders the
      mockup's `.brief` block (`mockups/product.html` lines 135–150
      + `mockups/styles/main.css` lines 313–319). Sits to the right
      of the `ProductTabs` in a 2-column grid (`1fr 320px`). Sticky
      on desktop (`position: sticky; top: 120px;`); stacks below
      the tabs on tablet / mobile (< 1024 px) with sticky behavior
      disabled.
- [x] **Five data rows** (Format / Modules / License / Instructor /
      Updated), each rendered as a `.label` (12 px `--text-soft`)
      stacked above a `.value` (14 px `--heading`) — matches
      `mockups/styles/main.css` line 137–145. Hairline `--line`
      divider between rows. Rows are conditionally hidden when the
      underlying data is missing (e.g. the License row hides when
      `products.default_license` is null; the Instructor row hides
      when no partner profile is joined).
- [x] **Format row** — derived from `products.kind` via a kind →
      format string map (`video_course` → "MP4 + PDF + Figma",
      `ebook` → "PDF + EPUB", `template_pack` → "Figma + Notion",
      `audio_course` → "MP3 + PDF", `bundle` → "Mixed formats",
      `asset_pack` → "ZIP — multiple files"). Falls back to the
      human kind label ("Video course" / "Ebook" / etc.) when no
      format string is registered. A real `format` text column is
      a P12.7 enhancement (course creation wizard lets the partner
      override the default).
- [x] **Modules row** — `products.total_lesson_count` + the shared
      `formatDuration` helper applied to
      `products.total_duration_seconds` (e.g. "12 modules · 4h
      38m"). Defensive: when `total_lesson_count` is 0 the row
      shows just the duration (or "—" when no duration either).
      Module / modules pluralization is correct.
- [x] **License row** — derives from `products.default_license`
      using the shared `LICENSE_LABELS` constant from
      `@features/cart/format`. Renders "<LICENSE> included" with
      the license code in the teal `<b>` accent (matches the
      mockup's `.brief .v b` rule on line 316). The License row
      is hidden when no default license is set.
- [x] **Instructor row** — short version of the `ProductInstructor`
      card. Reads `product.partner.profile.display_name` (the same
      join the Instructor tab reads); caps the display name at 80
      chars; falls back to a plain text node (no link) when no
      `public_slug` is available. The row is hidden when no
      profile row is joined.
- [x] **Updated row** — `products.updated_at` formatted as
      "Month YYYY" (e.g. "June 2026") via a pure `Intl`-backed
      helper. UTC-stable so the value doesn't flicker for visitors
      in different timezones. Defensive against bad input: any
      non-string / unparseable value returns "—".
- [x] **Add to cart CTA** — full-width orange `Button` (`size="lg"`,
      `variant="primary"`). Disabled when the product has no active
      pricing tiers. `aria-label` provides the kind context for
      screen readers. (The "real" add-to-cart is wired in the top
      `LicenseSelector` — the brief's CTA is a forward-looking
      affordance; phase 4 P4.1 lands the cart drawer that this
      button will dispatch into. Same code path; the brief just
      gets a second affordance so the sidebar is useful in
      isolation.)
- [x] **Preview curriculum CTA** — secondary `Button` (`size="md"`,
      `variant="secondary"`) in the brief. Implemented as a tiny
      client island (`PreviewCurriculumButton`) that dispatches a
      window CustomEvent (`uthena:product:switch-tab`) with
      `detail = { tab: 'curriculum', instanceId }`. The
      `ProductTabs` client island listens for the event and
      switches the active tab + moves focus to the new tab button
      (so screen readers announce the change). Same RSC↔client
      bridge pattern as `SearchTrigger` (P0.4) and
      `MobileNavTrigger` (P0.5).
- [x] **2-column grid** — the page's `.pdpBelow` section now uses
      `grid-template-columns: 1fr 320px;` to match the mockup's
      `.pdp-below` rule (line 297 of main.css). The tabs wrap in
      `.pdpTabs` (which adds `min-width: 0` so the tabs column
      doesn't push the sidebar off-screen on narrow viewports).
      The grid collapses to 1 column on tablet / mobile (< 1024
      px) so the sidebar stacks below the tabs naturally.
- [x] **Page integration** — `app/products/[slug]/page.tsx` now
      composes `<ProductAtAGlance>` in the right column of
      `.pdpBelow` (alongside `<ProductTabs>` in the left column).
      The `instanceId` is shared between the tabs and the brief
      (`product-${id}`) so the switch-tab event reaches the right
      tabs instance even if multiple products are rendered on the
      same page in the future.
- [x] **Token-only styles** — `ProductAtAGlance.module.css` uses
      `var(--s-5)` / `var(--s-3)` / `var(--r-lg)` / `var(--teal)`
      / `var(--line)` / `var(--text-soft)` / `var(--heading)` /
      `var(--bg-elev-1)` from `tokens.css`. No magic literals.
- [x] **A11y** — the sidebar is a real `<aside>` with
      `aria-label="At a glance"`. The "At a glance" h5 acts as the
      visual label (the `aria-label` and the h5 text are
      semantically consistent). The Instructor link has a real
      `:focus-visible` outline so keyboard users see the focus
      state against the elevated background.
- [x] **No PII / no secrets** — the sidebar reads the already-
      fetched product row (no new query, no user input, no
      logging). The format / modules / updated values are
      deterministic from the product data. The license label is
      a static enum → string map. The instructor name is the
      same display name the Instructor tab already renders.
- [x] **All 6 checks green** (typecheck / lint / check:no-todo /
      check:pii / check:specs / check:rls) + `pnpm build` clean.

### P0.15 (this tick) — Curriculum JSONB data
- [x] `products.curriculum` JSONB column added (migration 0014) —
      nullable, no default, CHECK constraint that the value is
      `null` or a JSONB array of objects with the exact
      `{index: number, name: string, duration_seconds: number}`
      keys. Inherits RLS from the products table (no new policies
      needed). Partial index `products_curriculum_present_idx`
      (WHERE curriculum IS NOT NULL) for the admin "products
      with curriculum" backfill query.
- [x] `CurriculumEntry` type defined in
      `00-foundations/data/types.ts` (and re-exported from
      `02-features/catalog/queries.ts`) as
      `{index: number, name: string, duration_seconds: number}`.
      Field names match the planned Phase 15 `lessons` table so
      the JSONB→lessons backfill is a straight copy.
- [x] `getProductBySlug` selects `curriculum`; `ProductDetail`
      type exposes `curriculum: CurriculumEntry[] | null`.
- [x] P0.15 is the **data layer only** — the actual
      `ProductCurriculum` component (mockup-faithful `.curric`
      block, three render modes: null = 12-item fallback, [] =
      nothing, array = render rows) ships with **P0.12 Slice 4**
      (the Curriculum tab). The component has no consumer on the
      page today; shipping it without a tab would orphan it.
- [x] Phase 15 LMS migration will normalize this column to a
      proper `lessons` table (with `lesson_progress` +
      `bookmarks`); the JSONB shape is a v1 placeholder.
- [x] No PII / no secrets in the migration or types. Read-only
      data from the products row.

## Design reference
- `mockups/product.html` lines 45–151 (pdp-top + pdp-below)
- `mockups/styles/main.css` lines 255–319 (`.pdp` / `.gallery` /
  `.pinfo` / `.vrow` / `.price-row` / `.license` / `.perks` /
  `.tabs` / `.prose` / `.curric` / `.review` / `.instructor` /
  `.brief`)

## Security
- Public route
- Reads via RLS-aware Supabase client — only `status = 'published'`
  is visible to anon
- `product_images` is a new table (migration 0012) with the same
  RLS pattern: public read for images on published products,
  partner write for own products, admin all

## Performance
- p95 < 200ms per `docs/ARCHITECTURE.md` §5
- One query for the product (with embedded category, partner,
  pricing, AND images joins) — no N+1

## Out of scope for v1
- Live preview player
- Real add-to-cart action (PH06)
- Wishlist

## Open questions for human
None.

---

## Implementation notes

### P8.2 — "Included with Personal Access" banner

Status: shipped (this tick). Subscriber-only visual signal on the product detail page.

- **Banner:** full-width teal-soft card in the `.pinfo` column when the current user has an active Personal Access subscription that includes this product. Sits between the header (h1 + rating + lede) and the price block so the user's eye lands on it just before they look at the price.
- **Banner shape:** teal circle icon (`✓` on `--teal` fill) + 2-line body (title "Included with Personal Access" + body "You already have access to this course via your subscription. Open your library to start watching." with an inline `<Link href="/library">` for the deep link).
- **Query:** `getSubscriptionCatalogAccess()` in `02-features/library/queries/` — same data layer as the catalog-card badge. `Promise.all([getProductBySlug, getSubscriptionCatalogAccess])` parallel fetch; no added latency.
- **Companion to the card pill:** same color DNA (`--teal-soft` + `--teal-line` + `--teal`), same icon (`✓`), same copy. The shape difference (full-width vs inline-pill) is about real-estate: the PDP has the room; the 4-col catalog grid doesn't.
- **`role="status"` + `aria-label`:** polite live region announces the access state when the user lands on the PDP — they don't have to discover the badge visually before the page tells them they already have access.

### P8.3 — Subscriber-only content (Slice 1: read path + gate)

Status: shipped Slice 1 (this tick). Schema + PDP UI + server-side gate are end-to-end. The partner/admin UI to flip the `subscriber_only` flag is deferred to Slice 2 + Slice 3 (see `STUBS.md` STUB-065 — Phase 14 / Phase 12 territory).

- **Schema** — migration `0032_products_subscriber_only.sql` adds `products.subscriber_only boolean NOT NULL DEFAULT false` (idempotent `add column if not exists`). Partial index `products_subscriber_only_idx` on `id WHERE subscriber_only = true` for the future admin "subscriber-only catalog" filter. No new RLS policies needed: the column inherits the existing `products_public_read_published` (anon can read the flag), `products_partner_write_own` (partner can flip their own product's flag), and `products_admin_all` (admin overrides). Idempotent.
- **Type layer** — `ProductRow.subscriber_only: boolean` added to `00-foundations/data/types.ts`. `ProductDetail` extends the `Pick<Tables<'products'>, ...>` to include the field. `getProductBySlug` selects the column.
- **Query layer** — `getSubscriptionCatalogAccess` extended with `hasActiveSubscription: boolean`. Derived from the same RPC payload (`user_accessible_products` returns rows with `access_source === 'subscription'` for active subscribers); no second roundtrip. Fail-closed: anon, empty data, and RPC errors all return `false` so the gate stays locked by default. Critical for the P8.3 gate — the boolean is what the PDP consults to decide between showing the LicenseSelector vs the upgrade card.
- **PDP UI** — when `product.subscriber_only === true` AND the current user is NOT a subscriber:
  - The `<LicenseSelector>` is replaced by the new `<SubscriberOnlyUpgradeCard>` RSC. Orange DNA (action color) — full-width card with orange-soft background + orange-line border + orange eyebrow icon (`★` in orange circle on `--orange` fill) + headline "Get every course with Personal Access" + body explaining the offer + the "$19 / month" price line in tabular-nums + a primary `<Button>` "See Personal Access" wrapped in a `<Link href="/pricing">` + a secondary "Already subscribed? Sign in" link (only for anon users, with `?next=/products/[slug]` preserved) + a fine-print line about the 15% subscriber discount.
  - The sidebar `<ProductAtAGlance>` also replaces its placeholder "Add to cart" button with a "See Personal Access" CTA (`<Link href="/pricing">` + `<Button>`). The sidebar CTA doesn't actually fire add-to-cart today (it's a forward-looking affordance per the Slice 5 design), but rendering a misleading "Add to cart" for a subscriber-only product would confuse the user. Both surfaces (top + sidebar) now show the same orange upgrade affordance.
  - When the user IS a subscriber, the existing P8.2 teal "Included with Personal Access" banner wins (no change to the P8.2 surface).
- **Server-side gate (defense in depth)** — `addToCartAction` extended in both branches:
  - **Auth branch**: the `product_pricing` lookup now also pulls `product:products!inner ( id, status, subscriber_only )` in the same single roundtrip (no extra query). When `subscriber_only === true`, the action calls `supabase.rpc('has_active_subscription', { p_user_id })` (SECURITY DEFINER per migration 0002). If the RPC errors or returns non-true, the action returns `{ ok: false, error: '<friendly subscriber message>', subscriberOnly: true }` and the upsert is never reached. If the user IS a subscriber, the upsert proceeds normally.
  - **Anon branch**: same `subscriber_only` check on the joined product row. Anon users can't have a subscription, so any subscriber-only product is refused at this layer with `{ ok: false, error: '<friendly subscriber message>', subscriberOnly: true }`. The anon cart cookie is not written.
  - **New typed error flag** `AddToCartResult.subscriberOnly?: boolean` — UI consumers (the `<LicenseSelector>` client island + future surfaces) can detect the gated reason and render tailored copy vs the generic "not available" error.
- **Tests** — +12 unit tests across two files:
  - `getSubscriptionCatalogAccess.test.ts` (+3 net new asserts): every existing test now asserts the `hasActiveSubscription` field; +1 dedicated test "returns hasActiveSubscription:false when the only accessible rows are purchases (no subscription)" — critical for the P8.3 gate semantic (a user with library access via purchase is NOT a subscriber).
  - `addToCart.test.ts` (+7 tests, 6 in a new "P8.3 subscriber-only gate (auth branch)" describe + 2 in a new "P8.3 subscriber-only gate (anon branch)" describe): (a) auth branch refuses subscriber-only when user has no subscription + `subscriberOnly: true` flag + no upsert fired, (b) auth branch allows subscriber-only when user has active subscription, (c) auth branch refuses when the `has_active_subscription` RPC errors (fail-closed), (d) auth branch does NOT call RPC for non-subscriber-only products (gate is opt-in), (e) auth branch does NOT call RPC when the product join omits `subscriber_only` (defensive), (f) anon branch refuses subscriber-only + no cookie written, (g) anon branch still allows non-subscriber-only. Also: the fake `supabase` mock gained a top-level `rpc` method (it already had one on the chain builder, but the action calls `supabase.rpc()` directly so the top-level is what the test had to wire).
- **Open question for human** — None blocking. The Slice 1 surface is self-contained; partner/admin UI to flip the flag is documented in `STUBS.md` STUB-065 (Phase 14 + Phase 12 territory). For now the flag can be flipped via direct DB UPDATE or a future Supabase Studio edit; the Slice 1 read path + gate work without the write UI.
