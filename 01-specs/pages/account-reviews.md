# My Reviews — `/account/reviews`

## What this page does

The user's self-service review management page. Two stacked sections in a single column:

1. **My reviews** — a list of every review the user has written (regardless of status), with the product thumbnail, title, star rating, submission date, and a status badge (`pending` / `approved` / `rejected`). Each row has Edit and Delete actions. This is the user's record of their voice on the platform.
2. **Leave a new review** — a list of products the user owns (via `library_grants`) that they have not yet reviewed. Each row has a "Write review" button that opens a review form (rating, title, body, optional photo). The list is sorted by grant date desc (most recently acquired first) and excludes products the user has already reviewed (any status, including deleted).

The review form lives in a side panel or modal: 1–5 stars (required), title (max 80 chars), body (required, 50–2000 chars), optional photo upload (jpg/png, max 5 MB). On submit, a `reviews` row is created with `status = 'pending'`. The user sees a confirmation: "We'll review your submission within 24 hours." and receives an email.

Admin moderation (approve / reject / flag) is owned by `/admin/review` (see `admin-review.md`). This page is **write-only for the user** — the user can submit, edit, and delete their own reviews, but cannot approve them.

## Data this page shows

| Section | Field | Source | Format |
|---|---|---|---|
| Section header | "My reviews" + count | reviews aggregate | H2 + pill |
| My reviews row | `product.thumbnail_url`, `product.title`, `product.slug` | products | thumbnail + linked title |
| My reviews row | `reviews.rating` (1–5) | reviews | 5-star icon row, filled to N |
| My reviews row | `reviews.title`, `reviews.body` (truncated 120 chars) | reviews | text |
| My reviews row | `reviews.status` | reviews | badge: pending (yellow) / approved (green) / rejected (red) |
| My reviews row | `reviews.created_at` | reviews | relative date ("3 weeks ago") |
| My reviews row | `reviews.updated_at` if `> created_at` | reviews | small "edited" tag |
| My reviews row | Edit button, Delete button | action | icon buttons |
| Section header | "Leave a new review" + count | library_grants minus reviewed | H2 + pill |
| New-review row | `product.thumbnail_url`, `product.title`, `product.partner_id` (partner name) | products + partners | thumbnail + linked title + "by {partner}" |
| New-review row | `library_grant.tier`, `library_grant.granted_at` | library_grants | "PLR · granted Mar 4, 2026" |
| New-review row | "Write review" button | action | primary button |
| Empty state (no grants) | "Browse catalog" CTA | hard-coded | link card |
| Empty state (all reviewed) | "You've reviewed every product you own. Thank you!" | hard-coded | text block |
| Review form (modal/panel) | star picker, title input, body textarea, photo uploader | form | form fields |

**Queries:** `02-features/account/queries/getMyReviews.ts`, `getReviewableProducts.ts` (both in `02-features/account/`).

## User actions

| Action | Trigger | Result | RBAC |
|---|---|---|---|
| Open the page | Navigate to `/account/reviews` | Server-renders the two sections | self |
| Open review form | Click "Write review" on a reviewable row | Opens modal/panel pre-bound to `product_id` | self + has library_grant for product |
| Submit new review | Click "Submit" in form | Server action validates (Zod), inserts `reviews` row with `status='pending'`, `verified_buyer=true` (auto-derived from grant), sends confirmation email, closes form, refreshes "My reviews" | self + has library_grant for product |
| Upload review photo | Drag/select file in form | Optional photo upload (storage column TBD — see Open Questions §1). When enabled, client-side validates type + size, uploads to Bunny storage via signed upload URL. | self |
| Edit own review | Click "Edit" on a row in "My reviews" | Opens form pre-filled with current values; `created_at` is preserved; `updated_at` is bumped; status resets to `pending` if the rating/title/body changed materially (see Security) | self + owns review |
| Save edit | Click "Save changes" | Updates row; if content changed, status → `pending` for re-moderation | self + owns review |
| Delete own review | Click "Delete" → confirm | Soft-deletes by setting `body = '[deleted]'` and `status = 'rejected'` (see Security); row preserved for audit | self + owns review |
| Cancel form | Click "Cancel" or close modal | Discards input | self |
| Open public product page | Click product title in either section | Navigate to `/products/[slug]` | self |

## What this page does NOT do

- No moderation UI — approving / rejecting reviews is the admin's job in `/admin/review`
- No "helpful" voting on this page — the public product page handles that via `reviews.helpful_count`
- No photo moderation (admin views the photo at moderation time)
- No review analytics for the user (e.g. "your reviews have been viewed 1,234 times") — not in v1
- No bulk edit / bulk delete
- No review on a product the user does not own (the "Leave a new review" list is computed from `library_grants`, so this is enforced at the source)
- No edit of reviews older than 30 days (locked to preserve review history — see Security)
- No reply to admin notes on rejected reviews from this page (admin can add a note at moderation time; we surface it as a "View admin note" link, but no in-page reply form in v1)

## Acceptance criteria

- [ ] Page is auth-gated; unauth users redirect to `/login?next=/account/reviews`
- [ ] "My reviews" lists only reviews where `user_id = auth.uid()`, regardless of status; each row shows thumbnail, title, star rating, status badge, date submitted, Edit + Delete actions
- [ ] "Leave a new review" lists only products where the user has an active `library_grant` AND has no existing `reviews` row (any status, including deleted) for that product
- [ ] Submitting a new review creates a row with `status='pending'`, `verified_buyer=true` (derived server-side from grant existence), and sends a confirmation email
- [ ] Form validation: rating 1–5 (required), title max 80 chars, body 50–2000 chars (required), photo jpg/png only and ≤ 5 MB — server-side re-validates MIME + size + dimensions and strips EXIF
- [ ] One row per `(user_id, product_id)` is enforced at the DB level via the existing `unique (user_id, product_id)` constraint; the server action returns a clear "You've already reviewed this" error on duplicate
- [ ] Edit preserves `created_at`, bumps `updated_at`; if content changed, status resets to `pending` for re-moderation
- [ ] Delete soft-deletes (status → 'rejected', body → '[deleted]'); the row remains in the DB and the user cannot resubmit for the same product without admin intervention
- [ ] RLS prevents reading other users' reviews on this page (verified by a test) and prevents writing reviews for products the user doesn't own
- [ ] No PII in URLs; no `TODO` / `FIXME` in the diff

## Design reference

- Mockup: `mockups/library.html` (reviews section is part of that file's account area — needs a focused mockup follow-up; flag in Open Questions)
- Components: `00-foundations/ui/ReviewRow.tsx`, `00-foundations/ui/ReviewForm.tsx`, `00-foundations/ui/StarPicker.tsx`, `00-foundations/ui/StatusBadge.tsx`
- Design tokens: `00-foundations/design/tokens.css`
- Theme: dark (primary) + light (secondary)

## Security

- **Auth required:** YES
- **Allowed roles:** any authenticated user with at least one `library_grant` (an empty library gets a "Browse catalog" empty state linking to `/browse`, not a 403)
- **RLS policies that apply:**
  - `reviews`: `reviews_self_read_own`, `reviews_self_write_own`, `reviews_self_update_own` — already exist in `_data-model.md`. Used as-is.
  - `products`: `products_public_read_published` — to load product metadata (thumbnail, title, slug).
  - `library_grants`: `library_grants_self_read` — to compute the "reviewable" list. The `verified_buyer` flag is set server-side from grant existence, never trusted from the client.
- **PII displayed:** no (the user sees their own reviews and their own product list; no other users' data)
- **PII in URLs:** no (only `product_id` and `review_id` in the form state; never the user's id, email, or token)
- **Audit logged:** implicit via `reviews` row + `admin_audit_log` on moderation. This page itself doesn't write to audit log (only admins do).
- **Photo upload validation:**
  - Client-side: type filter (jpg/jpeg/png only), size cap 5 MB, image-dimension sanity check (max 6000×6000).
  - Server-side: re-validate MIME via magic bytes (not just extension), re-validate size, re-validate dimensions.
  - Storage: write to a private Bunny bucket via signed upload URL (`00-foundations/files/signed-upload.ts`); the bucket is **not** publicly readable. The admin review page reads the photo via a server-rendered signed read URL.
  - EXIF strip: server-side strips EXIF metadata before storing (no GPS, no camera serial — see `01-specs/pages/_data-model.md` §`file_downloads` for the privacy posture).
- **Idempotency on submit:** the `(user_id, product_id)` unique constraint + the server action's pre-flight check (`SELECT … FROM reviews WHERE user_id = $1 AND product_id = $2`) makes duplicate submissions impossible. If a duplicate is attempted, the action returns `{ ok: false, code: 'already_reviewed' }` and the form shows "You've already reviewed this product."
- **Edit lock window:** reviews older than 30 days cannot be edited (returns 403 from the server action). This preserves the integrity of the review history and prevents late-stage rating inflation. The 30-day clock starts at `created_at`.
- **Status flow on edit:** if the title, body, or rating changes during an edit, the review's status resets to `pending` for re-moderation. If only the photo changes, status is preserved. An audit field (`reviews.edit_count`, see Open Questions) increments.
- **CSRF:** all write server actions are CSRF-protected (Next.js server actions + origin check).
- **Rate limiting:** max 5 new reviews per user per day (prevents spam). Max 20 edits per user per day. The 30-day edit lock is a hard rule, not a rate limit.
- **Third-party scripts:** none. The form is pure React + a single Bunny signed-upload call.

## Performance

- **Target p95:** < 300ms (page is auth-gated, RSC + SSR, no public caching)
- **Render strategy:** RSC + SSR. The "My reviews" and "Leave a new review" lists are fetched in parallel server-side.
- **Cache:** none on this page — fully user-specific.
- **DB indexes used:** `reviews (user_id, product_id)` (via the unique index on `user_id, product_id` and the `(product_id, status, created_at desc)` index for the join with products), `library_grants (user_id, granted_at desc)`.
- **Bundle size budget:** < 30 KB added to client bundle (form, star picker, photo uploader). The lists themselves are RSC and ship as HTML.
- **Image loading:** thumbnails use `next/image` with the standard lazy + blur placeholder. No new optimization needed.

## Out of scope for v1

- Reply to admin moderation notes (a follow-up spec is needed)
- Review analytics ("your reviews have 1,234 helpful votes")
- Bulk edit / bulk delete
- Review photos in admin preview (admin opens the photo in a new tab; inline preview is v2)
- Review on non-purchased products (sampled / beta access — v2)
- Review reminder emails ("you bought this 30 days ago, share your thoughts") — v2
- Review helpful-count surfaced to the user on this page
- Re-submitting a deleted review without admin intervention (deletes are sticky in v1)

## Open questions for human

- **Photo column:** `reviews` in `_data-model.md` has no `photo_url` column. Do we (a) add `photo_url text` to the `reviews` table (recommended — single optional image per review matches the product page spec), or (b) create a separate `review_photos` table for multi-photo? My recommendation: (a) — keep v1 single-photo. Multi-photo is a v2 follow-up.
- **Edit count column:** do we want a `reviews.edit_count int default 0` column to surface "edited 3 times" on the public product page, or do we rely on `updated_at != created_at`? My recommendation: explicit `edit_count` — cheaper than comparing timestamps in the public query path, and the value is useful for the admin moderation queue.
- **Edit lock window:** 30 days. Is that the right number, or do we want 60 / 90? My recommendation: 30. It's long enough that the review is "settled" but short enough that an honest typo can be fixed.
- **Confirmation email template:** I'll write a reasonable default, but you should review the "we got your review" email — it's the user's only signal that the submit actually landed. Should the email include a "view my review" link back to `/account/reviews`? My recommendation: yes — and a "review our other products" CTA if applicable.

---

## Implementation notes

- (filled by the building agent)
