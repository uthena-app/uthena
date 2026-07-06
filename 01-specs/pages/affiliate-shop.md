# Affiliate Shop (Edit Mode) — `/affiliate/shop`

## What this page does

The edit-mode counterpart of `/[handle]` (the public mini-shop, per `affiliate-minishop.md`). Renders the same data and layout as the public view, but with **inline-edit controls** so the affiliate can manage their shop without going through admin. Sections: **Hero** (display_name, bio, avatar — with inline edit), **Curated products** (the affiliate's hand-picked list, with "Why I picked this" notes and a "Set as featured" toggle), **Featured pick** (one product, surfaced at the top of the public view), **About the curator** (long-form bio, stats — read-only on this page in v1, edited in the Hero section).

A "View as customer" button at the top right opens the public `/[handle]` in a new tab so the affiliate can see exactly what visitors see. A "Publish changes" CTA at the bottom commits the staged edits (see Open Questions for autosave vs. batch-publish). Every change is audit-logged. The page is gated to `profiles.role = 'affiliate'`; anon visitors redirect to `/login?next=/affiliate/shop`; non-affiliates redirect to `/library`.

This page coexists with the (forthcoming) `admin-affiliate-detail.md` admin action that can also feature a product on a mini-shop. The conflict-resolution rule: **admin's force-feature takes precedence** on conflict (flagged in Open Questions).

## Data this page shows

| Section | Field | Source | Format |
|---|---|---|---|
| Top bar | "View as customer" link → `/[handle]` in a new tab, "Back to dashboard" link → `/affiliate` | hard-coded | top bar |
| Hero (editable) | `affiliates.display_name` (via `profiles.display_name`), `affiliates.bio`, `profiles.avatar_url` | profiles + affiliates | hero block with "Edit" buttons |
| Featured pick (editable) | the one `affiliate_curated_products` row with `is_featured = true`, with "Why I picked this" note | affiliate_curated_products | large card with edit + unfeature buttons |
| Curated products (editable) | all `affiliate_curated_products` rows for the affiliate, with "Why I picked this" note editor | affiliate_curated_products | grid with per-row actions |
| Add product | "+ Add product" button → opens product picker (searchable list of all `products` with `status='published'`) | products | modal with search + checkboxes |
| About the curator (read-only) | longer bio + stats (lifetime earned, followers, joined date, verified badge) | affiliates + aggregates | card |

**Server actions** in `02-features/affiliate-portal/actions/shop.ts`:
- `getMyShop()` — RSC. Reads `affiliates` + `affiliate_curated_products` joined with `products` (for thumbnail + title). Computes stats: product count, lifetime earned (from `affiliate_commissions` where `status != 'reversed'`).
- `updateHero(input)` — Zod-validates `display_name` (2-60 chars) and `bio` (max 280 chars). Writes `profiles.display_name` + `profiles.bio` (the same writes as the settings page). Audit row.
- `updateAvatar()` — reuses the avatar upload flow from `/account/profile` — same Bunny Storage path, same signed-URL helper, same max size (2MB jpg/png). Writes `profiles.avatar_url`. Audit row.
- `addProduct(input)` — adds a row to `affiliate_curated_products` with `note = null` and `is_featured = false`. Idempotent on `(affiliate_id, product_id)`: a re-add returns the existing row. Audit row.
- `removeProduct(productId)` — deletes the row from `affiliate_curated_products`. If the removed product was featured, `is_featured` flips to `false` (no auto-replacement — the affiliate must pick a new featured product, or accept the auto-promotion of the most-recently-added remaining product; see OQ).
- `updateProductNote(productId, note)` — writes `note text` (max 280 chars, same as bio). Audit row.
- `setFeaturedProduct(productId)` — sets `is_featured = true` on the target row and `is_featured = false` on all other rows for the affiliate, in a single transaction. Race-safe via the partial unique index `unique (affiliate_id) where is_featured = true` (flag in OQ).
- `publishChanges(payload)` — see OQ. In the batch-publish model, this action writes a single `affiliate_shop_published` audit row with `{ added: N, removed: N, notes_updated: N, featured_changed: bool }`. In the autosave model, this action is a no-op (each individual action already wrote its own audit row). The spec supports both models — the v1 build picks one (OQ).

**Schema additions** (flagged in Open Questions; need a migration):
- The `affiliate_curated_products` table is **NEW** — proposed in `affiliate-minishop.md` OQ. The same table backs both the public view and this edit page. The page assumes the migration has landed.

## User actions

| Action | Trigger | Result | RBAC |
|---|---|---|---|
| Open the page | Direct nav to `/affiliate/shop` | Render the editable mini-shop shell | affiliate (self) |
| Edit display name | Click "Edit" on the hero's display_name | Inline edit (debounced inline save, 300ms) | affiliate (self) |
| Edit bio | Click "Edit" on the hero's bio | Inline edit (debounced inline save, 300ms, with char counter 0/280) | affiliate (self) |
| Edit avatar | Click "Edit avatar" on the hero | Opens the avatar upload modal (reuses `/account/profile` flow) | affiliate (self) |
| Add a product | Click "+ Add product" | Opens product picker modal: search input (debounced 300ms) + scrollable list of all `products` with `status='published'`, each with a checkbox | affiliate (self) |
| Confirm add | Click "Add" in the picker | Adds the row, modal closes, the new product appears in the curated grid, audit row | affiliate (self) |
| Remove a product | Click "Remove" on a curated product card | Confirmation modal ("Remove this product from your mini-shop? Your 'Why I picked this' note will be lost."), server action, row disappears, audit row | affiliate (self) |
| Edit "Why I picked this" note | Click the note area on a curated product card | Inline edit (debounced inline save, 300ms, with char counter 0/280) | affiliate (self) |
| Set as featured | Click "Set as featured" on a curated product card | Radio-style: unmarks the previous featured product, marks this one, audit row. The featured card moves to the top of the curated list. | affiliate (self) |
| Unset featured | Click "Unset featured" on the currently-featured product | The product stays in the curated list but loses the "Featured" badge. If the curated list is now empty of featured products, see OQ for fallback behavior. | affiliate (self) |
| View as customer | Click "View as customer" in the top bar | Opens `/[handle]` in a new tab | affiliate (self) |
| Publish changes | Click "Publish changes" (bottom CTA) | See OQ. In the batch-publish model, this is the commit point. | affiliate (self) |
| See staged changes indicator | (always visible at the bottom, in batch-publish model) | "3 unsaved changes" with "Publish" + "Discard" buttons | affiliate (self) |

## What this page does NOT do

- No customization of the page layout (the layout is shared across all mini-shops; the affiliate only customizes bio + product list + notes — same as the public view's constraint)
- No custom domain
- No custom theme / colors
- No featured product time-bomb ("featured for 7 days")
- No "follow this affiliate" feature (v2)
- No analytics dashboard on this page (clicks + conversions are on `/affiliate` and `/affiliate/links`)
- No drag-to-reorder of curated products in v1 (sort is `is_featured desc, added_at desc`; v2 may add manual ordering)
- No "duplicate this product from another affiliate's shop"
- No affiliate-to-affiliate recommendations

## Acceptance criteria

- [ ] Page is auth-gated AND requires `profiles.role = 'affiliate'`; anon visitors redirect to `/login?next=/affiliate/shop`; non-affiliates redirect to `/library`
- [ ] Page renders the same data and layout as `/[handle]` (the public view) with edit affordances overlaid; "View as customer" opens the public view in a new tab and the affiliate sees the current state of the shop (no preview, no draft mode)
- [ ] Inline edits to display_name, bio, and "Why I picked this" notes save within 300ms; on failure the field reverts and a toast shows the error; every change writes an `affiliate_shop_hero_updated` or `affiliate_shop_note_updated` row to `admin_audit_log` with `{ before, after }` JSON
- [ ] Avatar upload reuses the `/account/profile` flow (Bunny Storage signed upload, max 2MB jpg/png, validated server-side); the upload writes `profiles.avatar_url` and is reflected on the public `/[handle]` within 5 minutes (ISR revalidate)
- [ ] Product picker is searchable, paginated (50 per page), and lists every `products` row with `status='published'`; selected products appear in the curated grid; an already-curated product shows a disabled checkbox ("Already in your shop")
- [ ] "Set as featured" is a radio (only one featured at a time); the previous featured product is automatically unmarked; race-safe via the partial unique index `unique (affiliate_id) where is_featured = true` (verified by a test: call `setFeaturedProduct` for two products in parallel from the same affiliate, assert exactly one is featured)
- [ ] "Remove" on a featured product unsets the featured flag and removes the row; if no products remain, the public view shows the "Coming soon" empty state (no broken layout)
- [ ] The page renders in < 350ms p95 (RSC, one row read on `affiliates`, one indexed read on `affiliate_curated_products` joined with `products`)
- [ ] All inputs and buttons are keyboard-navigable with `--border-3` focus rings; mobile responsive at 360px, 768px, 1280px; no PII in URLs, no `TODO` / `FIXME` / `HACK` in the diff, no console errors
- [ ] The page is the **self-service** way for the affiliate to manage their shop; the (forthcoming) admin-side `admin-affiliate-detail.md` action can also feature a product; on conflict, **admin's force-feature takes precedence** (flagged in OQ for explicit confirmation)

## Design reference

- Mockup: not yet built — to be created during the affiliate portal build (`mockups/affiliate-shop.html`)
- Design tokens: `00-foundations/design/tokens.css`
- Theme: both
- Components: `00-foundations/ui/MiniShopHero.tsx` (shared with the public view, with an `editable: boolean` prop), `00-foundations/ui/FeaturedPick.tsx` (shared), `00-foundations/ui/ProductPicker.tsx` (new — searchable list with checkboxes), `00-foundations/ui/CuratedGrid.tsx` (shared, with per-row edit affordances), `00-foundations/ui/InlineEdit.tsx`, `00-foundations/ui/FileDropzone.tsx` (reused from onboarding)

## Security

- **Auth required:** YES — `requireRole(['affiliate'])` then `user_id = auth.uid()` on every server action
- **Allowed roles:** affiliate (any status; pending affiliates can stage edits but the public view doesn't show until `status='approved'`, per `affiliate-minishop.md`)
- **RLS policies that apply:**
  - `affiliates` — `affiliates_self_read` (for the bio + handle reads); write is blocked at RLS for self on `payout_method` but allowed on bio (via `profiles` self-update)
  - `profiles` — `profiles_self_read`, `profiles_self_update` (writes to display_name, bio, avatar_url go through the same policy)
  - NEW: `affiliate_curated_products` — `affiliate_curated_self_read`, `affiliate_curated_self_write` (per the schema in `affiliate-minishop.md` OQ; the same table backs both the public view and this edit page)
  - `products` — `products_public_read_published` (the picker reads published products)
  - `admin_audit_log` — admin read only; server actions use `service_role` to insert
- **PII displayed:** the affiliate's own profile data (display_name, bio, avatar) — same as the public view. No emails, no payout info.
- **PII in URLs:** no — only the handle (publicly known) and the affiliate's own IDs
- **Content moderation:** affiliate bios and product notes are moderated per `affiliate-minishop.md` §Security — manual review on signup in v1. An admin moderation action can edit a bio or remove a product note; the audit trail records the admin's action.
- **Featured-product race-safety:** `setFeaturedProduct` is atomic — sets `is_featured = false` on all current rows for the affiliate, then sets `is_featured = true` on the target, in a single transaction. Enforced by a partial unique index (proposed in OQ).
- **Rate limiting:**
  - `updateHero` — 60/min/user (debounced inline save; the rate limit is for defense against client bugs looping)
  - `addProduct` / `removeProduct` — 30/min/user
  - `updateProductNote` — 60/min/user
  - `setFeaturedProduct` — 30/min/user
  - `updateAvatar` — 10/hr/user (reuses the onboarding limit; avatar upload is expensive)
  - `publishChanges` — 5/min/user (in the batch-publish model; the autosave model has no publish action)
- **Audit logged:** every action above writes a row to `admin_audit_log`:
  - `updateHero` — `action='affiliate_shop_hero_updated'`, `target_table='profiles'`, `before`/`after` JSON (display_name, bio only)
  - `updateAvatar` — `action='affiliate_shop_avatar_updated'`, `target_id` = new avatar storage path
  - `addProduct` — `action='affiliate_shop_product_added'`, `target_id` = product id
  - `removeProduct` — `action='affiliate_shop_product_removed'`, `target_id` = product id
  - `updateProductNote` — `action='affiliate_shop_note_updated'`, `target_table='affiliate_curated_products'`, `before`/`after` JSON (note only)
  - `setFeaturedProduct` — `action='affiliate_shop_featured_changed'`, `target_id` = product id (with `before` JSON: previous featured product id, or null)
  - `publishChanges` — `action='affiliate_shop_published'` with `{ added, removed, notes_updated, featured_changed }` summary (batch-publish model only)
- **CSRF:** server actions use Next.js's built-in origin check + Supabase Auth session cookie
- **Third-party scripts:** none

## Performance

- **Target p95:** < 350ms
- **Render strategy:** RSC for the initial render; small client components for inline-edit + the product picker modal
- **Cache:** the **public** `/[handle]` is ISR with 5-minute revalidate (per `affiliate-minishop.md`); the edit page is RSC with no cache (live, user-specific)
- **DB indexes used:** `affiliate_curated_products (affiliate_id, is_featured desc, added_at desc)`; `products (status) where status='published'`; the partial unique index on `(affiliate_id) where is_featured = true` (proposed in OQ)
- **Bundle size budget:** < 50KB added to client bundle (inline-edit, product picker modal, file dropzone, char counters). The hero, featured pick, and curated grid are RSC components reused from the public view.

## Out of scope for v1

- Custom page layout / theme colors (the public view's constraint applies)
- Custom domain
- Drag-to-reorder of curated products
- Featured product time-bomb
- "Follow this affiliate"
- Per-product analytics on this page (lives on `/affiliate` and `/affiliate/links`)
- Bulk add (paste a list of product slugs)
- Affiliate-to-affiliate recommendations
- "Featured collection" / multiple featured items
- Real-time click counter (5-minute refresh, same as the dashboard)

## Open questions for human

1. **Autosave vs. batch-publish:** the spec supports both. **Autosave** (the simpler model): every inline edit, every "Add product", every "Set as featured" is a server action that writes immediately, and there's no "Publish changes" button. **Batch-publish**: edits are staged in client state and a single "Publish changes" CTA commits them; users see "3 unsaved changes" at the bottom and can "Discard". My recommendation: **autosave**. Reasons: (a) the data is user-scoped and the public view is ISR-cached for 5 min, so staging doesn't help the visitor experience; (b) autosave removes a class of "I lost my changes" support tickets; (c) audit log granularity is per-action in autosave, which is more useful for moderation. The batch-publish model is appropriate when staged changes need approval (e.g. publishing a course); this is not that. Confirm autosave as the v1 default.

2. **`affiliate_curated_products` schema and the partial unique index:** the table is NEW (per `affiliate-minishop.md` OQ). See the `affiliate_curated_products` table in `_data-model.md` (under "New tables: risk + curation") for the full schema, RLS policies, indexes, and the race-safety contract. Confirm the `note` length cap (280, same as bio), the partial unique index, and the RLS policy split (public read for approved, self write, admin all).

3. **Featured-product fallback when the last featured product is removed:** the spec removes the row and unsets `is_featured` (no auto-replacement). The public view's "Featured pick" section is then empty. Alternatives: (a) auto-promote the most-recently-added remaining curated product, (b) leave it empty and the layout collapses gracefully (the "Featured pick" section is hidden), (c) require the affiliate to pick a new featured product in the same action. My recommendation: **(b) leave it empty, section hidden**. Reasons: (a) is surprising behavior (the affiliate removed a product and a different one is suddenly featured), (c) is friction (extra click in a destructive flow). The affiliate can re-set a featured product from the curated grid in a separate action. Confirm.

4. **Conflict with `admin-affiliate-detail.md` (forthcoming):** the admin-side detail page can also feature a product on a mini-shop. If the admin force-features product X and the affiliate (on this page) features product Y, which wins? My recommendation: **admin's force-feature takes precedence**. The admin's action writes directly to `affiliate_curated_products.is_featured` (via `service_role`); on the affiliate's next page load, the curated grid reflects the admin's choice. The affiliate can override by clicking "Set as featured" on a different product, but the audit log records both actions, and admins can review affiliate-overrides of admin-actions. The conflict-resolution rule needs to be in both this spec and the (forthcoming) `admin-affiliate-detail.md` spec. Confirm the rule and the audit pattern.

---

## Implementation notes

- (filled by the building agent)
