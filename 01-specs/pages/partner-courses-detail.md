# Partner Course Detail — `/partner/courses/[id]`

## What this page does

Single-course management for the partner. Tabs: **Curriculum** (modules and lessons — the editing surface that `instructor-upload.md` says doesn't exist as a separate page in v1; this spec adds it deliberately, see Open Questions), **Pricing** (3 license tiers with active toggles and prices; propagates to the live product page on save), **Sales** (revenue chart, sales count, refund rate, top buyers' countries — see the dedicated `/partner/courses/[id]/sales` spec for the per-order table), **Reviews** (the reviews on this product, with moderation actions scoped to the partner — flag the conflict: partners can mark a review as "needs admin review" but CANNOT delete it; admin-only delete), and **Settings** (title, descriptions, category, kind, preview video, thumbnail — editable; changes propagate to the live product page after save). Every edit is audit-logged. Course status badges (published / unpublished / archived) with a deliberate "Unpublish" action (with confirmation modal that warns about impact on existing buyers).

## Data this page shows

| Section | Field | Source | Format |
|---|---|---|---|
| Page header | `product.title`, `product.status` badge, `product.slug` (read-only), `product.kind`, breadcrumb back to /partner | products | header |
| Tab nav | 5 tabs (Curriculum, Pricing, Sales, Reviews, Settings) | hard-coded | tab nav |
| **Curriculum tab** | List of `product_modules` for this product, sorted by `display_order` | product_modules | editable list |
| Curriculum module | `title`, `summary`, `display_order`, drag handle, expand toggle, edit/delete, "Add lesson" button | product_modules | module row |
| Curriculum lesson (expanded) | `title`, `summary`, `duration_seconds`, `is_preview` toggle, `file_id` link, drag handle, edit/delete | product_lessons | lesson row |
| Add module | Click "Add module" | opens inline edit | inline form |
| Add lesson | Click "+ Add lesson" | opens inline edit | inline form |
| **Pricing tab** | 3 rows: whitelabel / plr / plr_mrr — each with `active` toggle, `price_cents` input, `partner_share_pct` (read-only default 60) | product_pricing | pricing matrix |
| Pricing | Currency (read-only, USD) | product_pricing | badge |
| Pricing | "Save pricing" button | hard-coded | button |
| **Sales tab** | Summary stats: revenue_30d, units sold_30d, refund rate, avg rating | order_items + reviews aggregate | 4 stat cards |
| Sales | Revenue chart (daily, 30d) | order_items aggregate | line chart |
| Sales | Top buyers' countries (top 5, count + percent) | order_items joined with orders.ip_address country (GeoIP at write-time, no raw IP stored) | horizontal bar chart |
| Sales | Link to "View full sales table" → `/partner/courses/[id]/sales` | hard-coded | link |
| **Reviews tab** | List of `reviews` for this product, all statuses, sorted by `created_at desc` | reviews | table |
| Review row | `rating` (stars), `body` (truncated to 200 chars), `verified_buyer` badge, `status` badge, `created_at`, reviewer display_name (no email), "Mark for admin review" button | reviews | row |
| Review empty state | "No reviews yet." | hard-coded | empty state |
| Review "needs admin review" badge | (visual treatment only — no separate DB column, the action writes a flag in `reviews.flagged_reason` — see OQ) | reviews | badge |
| **Settings tab** | `title` (text input, max 200) | products | form |
| Settings | `short_description` (textarea, max 280) | products | form |
| Settings | `long_description` (textarea, max 10000, supports markdown) | products | form |
| Settings | `category_id` (select from categories) | products | form |
| Settings | `kind` (select from product_kind) | products | form |
| Settings | `preview_video_url` (Bunny signed URL, or upload zone) | products | upload zone |
| Settings | `thumbnail_url` (image upload) | products | image uploader |
| Settings | "Save settings" button | hard-coded | button |
| Status bar (always visible) | `status` (published / unpublished / archived), "Unpublish" button (destructive) | products | sticky bar |
| Unpublish modal | Type "UNPUBLISH" to confirm, impact summary ("X existing buyers keep access. New sales will be blocked. Y pending payouts paused.") | derived | modal |
| Audit strip | "Last edit: {time ago} ({field})" | most-recent `admin_audit_log` (extended) row for this product | mono strip |

**Queries / actions (all in `02-features/partner-portal/`):**
- `getMyCourse(id)` — RSC, joins `products` + `product_modules` + `product_lessons` + `product_pricing` + aggregate stats
- `getCourseSalesSummary(id)` — revenue, units, refund rate, top countries (uses a materialized view, see OQ)
- `getCourseReviews(id)` — RSC, all reviews for this product
- `saveCurriculum(id, payload)` — server action, replaces the full module/lesson tree atomically (delete + insert in one transaction)
- `savePricing(id, pricing[])` — server action, upserts per tier, propagates to live product page on next request
- `updateProductSettings(id, input)` — server action, writes the editable fields
- `markReviewForAdminReview(reviewId, reason)` — server action, sets `reviews.status='flagged'` and `reviews.flagged_reason=reason`
- `unpublishProduct(id)` — server action, sets `products.status='unpublished'`, pauses pending payouts for this product, sends admin notification email
- `republishProduct(id)` — server action (admin-only trigger; partner cannot self-republish once unpublished; admin resets via the review queue or a new admin page — see OQ)

## User actions

| Action | Trigger | Result | RBAC |
|---|---|---|---|
| Switch tab | Click a tab | Loads the tab content (RSC sub-tree) | partner (own course) |
| Add module | Click "Add module" | Adds a new module at the end, inline edit for title, saves | partner (own course) |
| Edit module title | Click on the module title | Inline edit, autosave on blur | partner (own course) |
| Reorder modules | Drag a module to a new position | Updates `display_order` for all affected modules, saves | partner (own course) |
| Delete module | Click trash on a module | Confirmation modal (warns about X lessons), on confirm removes module + cascades lessons, saves | partner (own course) |
| Add lesson | Click "+ Add lesson" inside a module | Opens lesson form (title, duration, preview toggle, file picker) | partner (own course) |
| Edit lesson | Click on a lesson row | Inline edit, autosave on blur | partner (own course) |
| Reorder lessons | Drag a lesson to a new position | Updates `display_order` for all affected lessons, saves | partner (own course) |
| Mark as preview | Toggle the "Preview" switch | Updates `is_preview`, saves | partner (own course) |
| Delete lesson | Click trash on a lesson | Confirmation modal, on confirm removes, saves | partner (own course) |
| Save curriculum | (auto on every change, debounced 1s; no Save button) | Server action `saveCurriculum` runs, audit row per change | partner (own course) |
| Toggle pricing tier | Click the tier's active toggle | Inline save, success toast, audit row | partner (own course) |
| Edit price | Type in the price input | Validates > 0, inline save on blur, audit row | partner (own course) |
| Save pricing | (auto on every change; "Save pricing" button shows if dirty) | Server action `savePricing` runs | partner (own course) |
| Save settings | Click "Save settings" | Server action runs, success toast, audit row with before/after JSON | partner (own course) |
| Upload new preview video | Drop into preview dropzone | Uploads to Bunny, transcodes, updates `preview_video_url` on save | partner (own course) |
| Upload new thumbnail | Drop into thumbnail dropzone | Uploads to Bunny, updates `thumbnail_url` on save | partner (own course) |
| Mark review for admin review | Click "Flag for review" on a review row | Modal (reason text input), on confirm sets `reviews.status='flagged'`, audit row, toast | partner (own course) |
| Delete a review | (not in v1 — admin-only) | — | — |
| Unpublish product | Click "Unpublish" in the status bar | Confirmation modal (type "UNPUBLISH"), impact summary, on confirm sets `status='unpublished'`, pauses pending payouts, admin notification, audit row | partner (own course) |
| Republish product | (not in v1 — partner cannot self-republish; admin-only) | — | — |
| View on storefront | Click "View on site" in the header | Opens `/products/[slug]` in a new tab | partner (own course) |
| View sales | Click "View full sales table" | Navigate to `/partner/courses/[id]/sales` | partner (own course) |
| Open keyboard shortcut panel | Press `?` | Modal (none for v1) | partner (self) |

## What this page does NOT do

- No "duplicate this course" (v2)
- No A/B testing of titles / thumbnails (v2)
- No real-time co-editing with another partner
- No version history / draft snapshots (we save the current state; no undo beyond what the audit log gives us)
- No AI-assisted copy generation (v2)
- No bulk lesson import (CSV/JSON in v2)
- No rich text editor for `long_description` (markdown textarea; rich text in v2)
- No scheduling of price changes (immediate only)
- No per-tier promo codes (admin-only in v1)
- No review REPLIES (partners cannot reply to a review in v1; v2: partner responses, with moderation)
- No review deletion by partner (admin-only)
- No review editing by partner (admin-only)
- No "this is a draft, not for review yet" toggle (the partner's draft is the upload wizard; this page is for published courses)
- No co-author management (single-partner ownership in v1)
- No per-tier analytics (top countries is a summary; per-tier breakdown is in the sales table)
- No webhook for "I just made an edit" (partners can poll, no realtime)

## Acceptance criteria

- [ ] Page is auth-gated AND requires `profiles.role IN ('partner')` AND the partner owns the product (RLS enforces; non-owner gets 404)
- [ ] Page is for **published, unpublished, or archived** products. Drafts are managed via the upload wizard (`/partner/upload`), not this page.
- [ ] All 5 tabs render the correct data; tab content is RSC (no client-side data fetching for the initial render)
- [ ] Curriculum edit: add / edit / delete / reorder modules and lessons, autosave debounced 1s
- [ ] Curriculum save is atomic: the full module/lesson tree is replaced in one transaction (delete + insert); the live product page reflects the change on the next request
- [ ] Pricing changes propagate to the live product page on save (next request sees the new price; ISR=60s on the public product page means up to 60s of staleness for anonymous visitors)
- [ ] Settings changes (title, descriptions, category, kind, preview, thumbnail) propagate to the live product page on save
- [ ] Mark review for admin review: sets `reviews.status='flagged'`, writes `flagged_reason`, audit row, the review remains visible on the storefront until the admin acts (we don't auto-hide; admin decides)
- [ ] Unpublish requires typed "type UNPUBLISH" confirmation; the modal shows the impact summary (X existing buyers keep access, Y pending payouts paused); on confirm, `products.status='unpublished'`, all pending `payout_ledger` rows for this product are paused (set to a new status `paused_product_takedown` — see OQ), admin notification email sent, audit row
- [ ] Unpublish is reversible: an admin can republish via `/admin/products/[id]` (v2) or the review queue (return-for-changes with a "republish" intent)
- [ ] The status bar reflects the current `products.status` on every load
- [ ] All audit rows include `before`/`after` JSON (for settings, pricing); for curriculum, the audit row carries the operation type and the affected module/lesson ids
- [ ] Page renders in < 500ms p95 (RSC; multiple joins but all on indexed columns; the heaviest query is the sales summary which uses a materialized view)
- [ ] All inputs are keyboard-navigable, mobile responsive at 360px, 768px, 1280px
- [ ] No PII in URLs, no `TODO` / `FIXME` / `HACK` in the diff

## Design reference

- Mockup: not yet built — to be created during the partner portal build
- Components: `00-foundations/ui/CourseHeader.tsx`, `00-foundations/ui/ModuleRow.tsx`, `00-foundations/ui/LessonRow.tsx`, `00-foundations/ui/LicenseMatrix.tsx`, `00-foundations/ui/ReviewRow.tsx`, `00-foundations/ui/StatusBar.tsx`, `00-foundations/ui/UnpublishModal.tsx`

## Security

- **Auth required:** YES
- **Allowed roles:** partner (self course only)
- **RBAC enforcement:** every server action checks `products.partner_id in (select id from partners where user_id = auth.uid())`. RLS is the second line of defense.
- **RLS policies that apply:**
  - `products` — `products_partner_read_own` (read), `products_partner_write_own` (write; the spec says "for all" but we need to constrain to non-status changes — see OQ)
  - `product_modules`, `product_lessons` — inherit from product (the data model says "Inherits from product"; we need explicit RLS or a function — see OQ)
  - `product_pricing` — inherit from product
  - `reviews` — `reviews_self_read_own` (a partner can read reviews on their own product? the data model doesn't have this policy — see OQ) + `reviews_admin_all` (admin can read all)
  - `order_items` — for the sales summary stats (no per-row data; the partner page reads aggregates via a service-role query, not RLS)
- **PII displayed:** reviewer `display_name` only (no email); top buyers' countries are aggregate, no individual buyer
- **PII in URLs:** no
- **Curriculum save atomicity:** the curriculum save is a single transaction that deletes all existing `product_modules` for the product and re-inserts the new tree. This is the only safe way to do "replace the whole tree" without complex diff logic. Risk: a concurrent edit by the same partner (e.g. two browser tabs) would lose data. Defense: the partner is a single user; we don't allow concurrent partner self-edits in v1. The audit log captures the before/after so the partner can recover.
- **Pricing change propagation:** the next read of the public product page sees the new pricing. The ISR=60s on the public page means anonymous visitors may see the old price for up to 60s. Acceptable; not a security issue.
- **Mark review for admin review:** the partner's flag does NOT auto-hide the review. The review remains on the storefront. This is the deliberate "partners are stakeholders, not moderators" choice — flag in OQ.
- **Unpublish atomicity:** the unpublish action runs inside a Postgres serializable transaction. Status flip, payout pause, admin notification either all succeed or all fail.
- **CSRF:** all server actions are CSRF-protected
- **Rate limiting:** 100 curriculum edits per partner per hour; 10 unpublishes per partner per day
- **Audit logged:** every edit, every pricing change, every setting change, every mark-for-review, every unpublish — all with before/after JSON
- **Third-party scripts:** none

## Performance

- **Target p95:** < 500ms
- **Render strategy:** RSC + SSR. Tabs are RSC sub-trees; the active tab's data is fetched in the same RSC pass.
- **Cache:** none on this page (partner-specific); the live product page is ISR=60s (separate)
- **DB indexes:** existing on `products (partner_id)`, `product_modules (product_id, display_order)`, `product_lessons (module_id, display_order)`, `product_pricing (product_id) where active=true`; NEW: `reviews (product_id, status, created_at desc)` for the reviews tab
- **Sales summary:** a materialized view refreshed nightly + on-demand after an order/refund; the page reads from the view, not from raw `order_items`. See OQ.
- **Bundle size budget:** < 60KB added to client bundle (curriculum editor + pricing matrix + reviews list + status bar + unpublish modal)

## Out of scope for v1

- Duplicate course
- A/B testing of titles / thumbnails
- Real-time co-editing
- Version history / draft snapshots
- AI-assisted copy generation
- Bulk lesson import (CSV/JSON)
- Rich text editor for long_description (markdown textarea)
- Scheduled price changes
- Per-tier promo codes
- Review replies by partner
- Review deletion / editing by partner (admin-only)
- Partner-initiated republish (admin-only)
- Co-author management
- Per-tier analytics breakdown
- Webhooks for edit events

## Open questions for human

- **Deviation from `partner-upload.md` — editing a published course is a v1 capability:** `partner-upload.md` (§"What this page does NOT do", line 51) and the body text both imply that all course editing happens inside the upload wizard's draft state — there is no separate "edit a published course" page in v1. This spec adds one (`/partner/courses/[id]`). The deviation is deliberate: in v1, partners need to edit curriculum, pricing, descriptions, and status on a published product, and routing that through the upload wizard's draft state would force an admin review on every edit (which is the wrong UX for low-stakes metadata changes). My recommendation: accept the deviation in this spec, and update `partner-upload.md` in a follow-up PR to remove the contradiction — specifically, remove the "all editing happens in the upload wizard's draft state" line from its "What this page does NOT do" section and add a one-line cross-reference to `/partner/courses/[id]`. The follow-up is a doc-only change; no new code.
- **Materialized view for sales summary:** the sales tab shows 30d revenue, units, refund rate, top countries. Options: (a) compute on the fly (acceptable for ≤10K orders; gets slow at 100K), (b) materialized view refreshed nightly, (c) per-product aggregate columns maintained by trigger. My recommendation: (b) — materialized view `product_sales_daily` with `(product_id, date, units, revenue_cents, refund_count, refund_cents, country_breakdown jsonb)`, refreshed nightly + on order/refund events. The page reads from the view, the materialization is the only computation. Indexes on `(product_id, date desc)`.
- **`reviews.flagged_reason` column:** the data model has `reviews.status` but no `flagged_reason`. The partner's "flag for admin review" action needs somewhere to put the reason. My recommendation: add `flagged_reason text` and `flagged_by_user_id uuid` columns. RLS: partner can write to their own product's reviews' `flagged_*` columns. Admin can read all.
- **Partner-read on reviews:** the data model has `reviews_public_read_approved` and `reviews_self_read_own` (the reviewer themselves). There is no policy for "partner reads reviews on their own product". My recommendation: add `reviews_partner_read_own_product` policy: `for select using (exists (select 1 from products where id = reviews.product_id and partner_id in (select id from partners where user_id = auth.uid())))`. This is what the partner-courses-detail page needs.
- **Payout pause on unpublish:** when a partner unpublishes, what happens to pending `payout_ledger` entries for this product? My recommendation: introduce a new `payout_ledger.status='paused_product_takedown'` value. The entries are not reversed (the sales were real); they are paused until the partner republishes OR until admin manually releases them. v2: a "clawback if no republish in 30 days" policy.
- **Republish by partner:** my recommendation: partners CANNOT self-republish. Once unpublished, the only paths back to published are: (a) admin republishes via `/admin/products/[id]` (v2 page), (b) partner submits the product for re-review via the upload wizard, (c) admin returns-for-changes via the review queue. (a) is the typical path; (b) is a "rebuild from scratch" path; (c) requires the product to have been returned for changes (not just unpublished), which is a different state. This is a deliberate safety choice: a partner who unpublishes in a panic doesn't get to re-publish in a panic.
- **Curriculum save replacement vs diff:** the spec says "saveCurriculum replaces the full module/lesson tree atomically (delete + insert)". The alternative is a diff-based save (compute the diff server-side, apply INSERT/UPDATE/DELETE per row). My recommendation: replacement. Simpler, correct, atomic. The cost is a slightly heavier write (delete N + insert M instead of diff), but the write is bounded by the size of one course (≤100 modules typically) and the page is not high-traffic. v2: diff-based if we see perf issues.
- **RLS inheritance for product_modules / product_lessons / product_pricing:** the data model says "Inherits from product" but doesn't define the policy. My recommendation: add explicit policies using the same pattern as `product_files_public_read_via_product` and `product_files_partner_write` — subquery on `products` to check the parent's partner_id and status. Three tables × two policy types (read, write) = 6 policies. Add in the same migration as the page.
- **Markdown vs rich text for `long_description`:** v1 is markdown (textarea + preview). My recommendation: markdown in v1, rich text in v2. The admin-side render is `react-markdown` with our allowlist (no raw HTML, no scripts, no iframes). The product page render is the same.
- **Top countries data source:** the spec needs country-level aggregates. We have `orders.ip_address` (encrypted at app layer per ARCHITECTURE.md §7 — wait, the data model says it's stored as inet, no encryption mentioned; let me flag this). For v1, my recommendation: at order time, run GeoIP on the IP and store `orders.ip_country` (ISO-3166-1 alpha-2, nullable). Drop the raw IP after 90 days per the data retention rule. The materialized view reads `ip_country`. If a country can't be resolved, the row is bucketed as "Unknown".

---

## Implementation notes

- (filled by the building agent)
