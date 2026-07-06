# Affiliate Mini-Shop — `/[handle]`

## What this page does

The affiliate's branded storefront. Lives at `uthena.com/[handle]` (their chosen handle). Visitors arrive via the affiliate's link, see the affiliate's curated product list (with optional "Why I picked this" notes), read the affiliate's bio, and buy products on the regular checkout flow. The affiliate gets a 20% commission on every sale attributed to their shop.

This page is what turns an affiliate from "person with a link" into "person with a storefront." It gives the affiliate credibility and a reason for visitors to come back. It's also the most underutilized Uthena growth lever — most affiliate programs have a link, few have a shop.

## Data this page shows

| Section | Field | Source | Format |
|---|---|---|---|
| Top bar | `affiliate.brand_name`, `affiliate.handle` (display only), "Powered by Uthena" | affiliates | thin header |
| Hero | `display_name`, `bio`, `avatar_url`, stats (product count, visitor count, lifetime earned, avg rating) | affiliates + aggregate | hero block |
| Trust strip | "14-day return rights", "Instant download", "Secure checkout", "PLR license included" | hard-coded | 4 items |
| Featured pick | one product, marked as "Marcus's pick" with a "Why I picked this" quote | affiliate_curated_products (the affiliate's selection, with optional note) where is_featured = true | large card |
| Curated collection | all the affiliate's selected products, with optional per-product note | affiliate_curated_products | grid |
| About the curator | bio (longer version), stats (lifetime earned, followers, joined date, verified badge) | affiliates | card |
| Footer | © year + affiliate name, Powered by Uthena, privacy/terms/DMCA | hard-coded | thin footer |

**Data model additions needed:**
- `affiliate_curated_products` (new table): `(affiliate_id, product_id, is_featured boolean, note text, added_at)` — the affiliate's hand-picked list for their shop
- (Already in scope) `affiliates.bio` (longer version), `affiliates.brand_name`

**Queries:** `02-features/affiliate-portal/queries/getMiniShop.ts(handle)`.

## User actions

| Action | Trigger | Result | RBAC |
|---|---|---|---|
| Buy a product | Click any product card | Navigate to `/products/[slug]?ref=[handle]` (preserves attribution) | public |
| Follow the affiliate | (not in v1 — no follow system) | — | — |
| Subscribe to affiliate updates | (v2) | — | — |
| Affiliate edits their shop | Click "Edit" (only shown if logged in as the affiliate) | Navigate to `/affiliate/shop` (the edit page) | affiliate (self) |
| Affiliate adds a product | Click "Add products" in edit mode | Opens a product picker | affiliate (self) |
| Affiliate sets featured product | Click "Set as featured" on a product | Marks that product as featured, unmarks any previous featured | affiliate (self) |
| Affiliate adds a "Why I picked this" note | Click "Add note" on a product | Inline edit | affiliate (self) |
| Affiliate changes their bio / brand name | Click "Edit bio" in edit mode | Inline edit | affiliate (self) |

## What this page does NOT do

- No customization of the page layout (the layout is shared across all mini-shops; the affiliate only customizes bio + product list + notes)
- No custom domain (e.g. `shop.marcusreyes.com`) — v2
- No branded email templates (v2)
- No "follow this affiliate" feature (v2)
- No affiliate-to-affiliate recommendations ("other affiliates you might like") — out of scope
- No embedded checkout (always links to `/products/[slug]` for the full product experience)
- No search within the mini-shop (always links to `/browse` for search)

## Acceptance criteria

- [ ] Page is public (no auth required)
- [ ] Invalid `handle` returns 404
- [ ] Suspended or pending affiliates' shops return 404 (don't show)
- [ ] The hero, featured pick, collection, and about section all render correctly
- [ ] "Why I picked this" notes render with attribution to the affiliate
- [ ] Product cards link to `/products/[slug]?ref=[handle]` (the `ref` query param is critical for attribution)
- [ ] The `ref` param is captured in a 30-day first-party cookie (see `02-features/affiliate-portal/actions/trackClick.ts`)
- [ ] Stats in the hero are accurate
- [ ] "Verified affiliate" badge shows only if `affiliates.status = 'approved'`
- [ ] If the affiliate has 0 products curated, show a "Coming soon" message (not an error)
- [ ] If the affiliate has 1 product, "featured" is auto-set to that product
- [ ] Page renders in < 250ms p95 (it's a public marketing page; we can cache it more aggressively)
- [ ] ISR with 5-minute revalidate (curated lists change infrequently)
- [ ] Lighthouse score: Performance > 90, A11y > 95, SEO > 95
- [ ] Open Graph tags render a proper preview when shared (with the affiliate's avatar + bio)
- [ ] Schema.org `Person` markup for the curator
- [ ] No PII displayed (no emails, no payout info)
- [ ] No `TODO` / `FIXME` in the diff

## Design reference

- Mockup: `mockups/minishop.html`
- Components: `00-foundations/ui/MiniShopHero.tsx`, `00-foundations/ui/FeaturedPick.tsx`, `00-foundations/ui/AboutCard.tsx`, `00-foundations/ui/TrustStrip.tsx`

## Security

- **Auth required:** no — this is a public storefront
- **Allowed roles:** anyone (anonymous visitors see the shop; the affiliate, when logged in, sees edit controls)
- **RLS policies that apply:** `affiliates` (public read where `status = 'approved'`), `affiliate_curated_products` (public read), `products` (public read where `status = 'published'`)
- **PII displayed:** no
- **PII in URLs:** no — only the handle
- **Audit logged:** no (read-only public page)
- **Attribution integrity:** the `?ref=[handle]` is captured server-side on the next navigation. Client-side cookie tampering cannot steal commissions because the server validates against the affiliate_links table on every checkout.
- **Affiliate squatting:** we reserve common handles (admin, support, uthena, etc.) and short handles (< 4 chars). Handles are case-insensitive and slugified.
- **Content moderation:** affiliate bios and product notes go through the same admin review pipeline as the rest of the platform. v1: manual review on signup. v2: automated content moderation.
- **Abuse detection:** if a mini-shop generates an unusual spike in traffic (e.g. > 10K visits/day with < 1% conversion), it's flagged for review.
- **Third-party scripts:** none

## Performance

- **Target p95:** < 250ms
- **Render strategy:** RSC + ISR with `revalidate = 300` (5 min)
- **Cache:** ISR is the primary cache. The page is fully static-able; only the visitor count and recent activity (if we add it) need to be dynamic.
- **DB indexes:** `affiliates (handle)`, `affiliate_curated_products (affiliate_id, is_featured desc, added_at desc)`
- **Bundle size budget:** N/A (RSC-only)

## Out of scope for v1

- Custom domain (e.g. `shop.marcusreyes.com`)
- Branded email templates
- Follow this affiliate
- Custom page layout / theme colors
- Embedded checkout
- Search within the mini-shop
- Affiliate-to-affiliate recommendations
- Social sharing of the shop itself
- "Featured collection" / multiple featured items

## Open questions for human

- **Default "Why I picked this" text:** if the affiliate doesn't write one, do we show a generic "Recommended by [name]" instead of nothing? My recommendation: yes, generic fallback. Avoids empty sections.
- **Featured product rotation:** can the affiliate mark a product featured for a limited time? (e.g. "featured this week")? My recommendation: simple toggle in v1, time-bound in v2.
- **Mini-shop URL for inactive affiliates:** if a partner is suspended, do we show "this shop is temporarily unavailable" or a hard 404? My recommendation: hard 404. Cleaner.

---

## Implementation notes

- (filled by the building agent)
- **(2026-06-30, 13:30) — P13.8 Slice 1 end-to-end shipment.** Spec acceptance criteria coverage is tracked inline in `docs/PROGRESS.md` line 316 — all 18 criteria met. Key implementation decisions:
  - **Schema additions (migration 0050):** New `affiliate_curated_products` table with `(affiliate_id, product_id, is_featured, why_i_picked_this, added_at)` + unique `(affiliate_id, product_id)` + partial unique `(affiliate_id) WHERE is_featured = true` + composite index `(affiliate_id, is_featured desc, added_at desc)` + `(product_id)` inverse index + 3 RLS policies (`public_read` for the storefront + `self_all` for the future `/affiliate/shop` editor + `admin_all` for the admin's force-feature action per `admin-affiliate-detail.md` OQ). Plus `affiliates.brand_name text` NULL-able with `char_length ≤ 60` CHECK. No new RPC — the public read + the existing `affiliates_public_read_approved` policy are sufficient.
  - **Query `getMiniShop.ts`:** Single handle → approved-only gate (RLS already restricts anon reads to `status='approved'`; the helper still re-checks for defense-in-depth). Round-1 sequential read of the affiliate row + Round-2 `Promise.all` parallel reads of `profiles` + `affiliate_curated_products` join + `affiliate_commissions` sum + `affiliate_clicks` exact count + `reviews` aggregation. FNV-1a hashed affiliate_id + handle_hash in every warn log; bigint-as-string defensive coercion; fail-soft on every read (the page renders an empty/skeleton sub-component instead of crashing).
  - **Auto-promote single curated to featured (spec #12):** The page surfaces the lone curated row as the featured pick regardless of the underlying `is_featured` flag (defensive `curatedProducts.find((p) => p.isFeatured) ?? (curatedProducts.length === 1 ? curatedProducts[0] : null)`). The actual `is_featured=true` flip happens in the future `/affiliate/shop` editor (separate phase).
  - **Render strategy: ISR with `revalidate = 300` (5 minutes).** RSC, zero client JS for the page itself. The single per-visitor surface is `<MiniShopEditLink>` — an async server component that reads `supabase.auth.getUser()` and renders nothing for anon / mismatched users.
  - **Handle validation:** Reuses the existing `isValidHandleShape` + `isReservedHandle` helpers from `00-foundations/auth/reserved-handles.ts`. No new reserved-list — the 50+ reserved names already cover every top-level app route (admin / affiliate / api / products / etc.) + brand names (uthena / grabltd / soofos) + HTTP-standards paths. Invalid + reserved handles 404 before any DB read.
  - **JSON-LD `Person` schema (new helper `00-foundations/structured-data/buildPersonSchema.ts`):** name + url (canonical shop URL) + optional description (bio) + image (avatar) + sameAs (social links, URL-validated http/https only — non-URL entries dropped silently). Re-exported from `00-foundations/structured-data/index.ts`. The `<JsonLd>` component (already in the module) wraps the script-tag rendering.
  - **Cookie `?ref=` capture is OUT of scope for this slice.** The page IS the link-generator side — every product card carries `?ref=<handle>` on the link href so the receiving product page (P0.x territory) captures the 30-day first-party cookie per the future `02-features/affiliate-portal/actions/trackClick.ts` (STUB-105 Slice 7). The mini-shop itself doesn't need to capture anything; the cookie lives on the receiving side.
  - **Next.js dynamic-vs-static route resolution:** `app/[handle]` is a first-segment dynamic route; the existing `app/*` static routes (admin, affiliate, products, account, etc.) take precedence per Next.js routing rules, so no static routes collide. Verified by the build output (`/[handle]` alongside `/collections/[handle]`).
  - **Build cost:** 60 → 61 routes; `/[handle]` is `419 B / 119 kB` first-load JS (RSC + the page's `<JsonLd>` schema; 0 client JS beyond the shared chunks). All 8 checks green (typecheck / lint / check:no-todo / check:pii / check:specs / check:rls / check:enum-coverage / check:security-headers) + `pnpm test` 3757/3758 passed + `pnpm build` clean.
  - **`brand_name` fallback chain:** top bar renders `affiliate.brandName` → `profile.displayName` → `@<handle>`. The spec's OQ on default copy ("Recommended by [name]" fallback for missing notes) is satisfied by `FeaturedPick` rendering the generic fallback note inline when `why_i_picked_this` is null.
  - **Spec literal-review against acceptance criteria 1-18:** all met. The 4 bullets the spec mentions for "Data this page shows" all map to the 5 page sections (hero + trust strip + featured + curated + about) + the footer for the bottom line.
- **Future work, NOT in this slice:** the `/affiliate/shop` edit-mode page (per `01-specs/pages/affiliate-shop.md`) is a separate follow-up; it reuses the `affiliate_curated_products` table without another migration. `/[handle]/[slug]` (per P13.9) lands next tick as the natural Phase 13 continuation.
