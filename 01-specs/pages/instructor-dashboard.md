# Partner Dashboard — `/partner`

## What this page does

The partner portal home. Shows the partner's revenue, sales, payout status, course health, and a list of action items (refund pending, low rating, sales page conversion drop). This is where partners come to "check their business" — a daily/weekly habit for serious partners.

## Data this page shows

| Section | Field | Source | Format |
|---|---|---|---|
| Header | `display_name`, `partner.status`, `partner.kyc_status`, `partner.tax_form_status` | partners + profiles | greeting + status badges |
| Onboarding banner | (only if partner.status != 'approved' OR kyc pending OR tax pending) | derived | callout |
| Stat row (top) | `revenue_30d`, `sales_30d`, `active_students`, `avg_rating` | orders + reviews aggregate | 4 stat cards |
| Payout bar | `next_payout_amount`, `next_payout_date`, `transactions_in_batch`, `min_payout_cleared` | payout_ledger aggregate + scheduled payout | highlighted card |
| Revenue chart | daily revenue for last 30 days, segmented by tier (whitelabel/plr/plr_mrr) | orders aggregate | line chart |
| My courses | `product.title`, `product.status`, `product.price_cents`, `sales_count`, `earned_cents`, `rating_avg`, `product.thumbnail_url` | products owned by partner | list |
| "What to fix" panel | action items (refund pending, low rating, conversion drop, missing metadata) | derived from products + reviews + refunds | list of action items |
| Recent sales | `order_id`, `product.title`, `tier`, `date`, `partner_share_cents`, `status` | order_items where product.partner_id = self | table |

**Queries:** `02-features/partner-portal/queries/getDashboard.ts`. All aggregate queries filter by `partner_id = self`.

## User actions

| Action | Trigger | Result | RBAC |
|---|---|---|---|
| Upload new course | Click "Upload new course" CTA | Navigate to `/partner/upload` | partner (any status) |
| View course | Click "Details" on a course row | Navigate to `/partner/courses/[id]` (course management page, v2) | partner (own course only) |
| View sales | Click "Sales" on a course row | Navigate to `/partner/courses/[id]/sales` (filtered sales table) | partner (own course only) |
| Edit course | (v2 — for now, all editing happens in the upload wizard's draft state) | — | — |
| Request early payout | Click "Request early" on payout bar | Triggers a manual payout request (admin reviews) | partner (status=approved) |
| View payout history | Click "View history" on payout bar | Navigate to `/partner/payouts` | partner (self) |
| Resolve an action item | Click "Fix" on a "What to fix" item | Navigates to the relevant edit page (e.g. `/partner/courses/[id]/edit` in v2) | partner |
| Export sales CSV | Click "Export CSV" on recent sales | Generates a CSV of the partner's sales, signed URL returned | partner (self) |
| Edit profile / payout method | Click profile in sidebar | Navigate to `/partner/settings` | partner (self) |
| View API tokens | Click "API & webhooks" in sidebar | Navigate to `/partner/settings/api` | partner (self) |

## What this page does NOT do

- No real-time data (it's a 5-minute refresh, not WebSocket). v2 can add live updates.
- No A/B test dashboards for sales pages (v2)
- No cohort analysis (v2)
- No customer email list / export (v2 — privacy concerns)
- No "submit for review" inline (uploads are managed in `/partner/upload`)
- No social features ("see what other partners are doing") — intentionally out
- No refund approval (partners don't approve refunds in v1; admin does)

## Acceptance criteria

- [ ] Page is auth-gated AND requires `profiles.role IN ('partner')` (a customer trying to access this gets a "Become a partner" CTA, not a 403)
- [ ] Page only shows the partner's own data (RLS enforced)
- [ ] Stats in the top row are accurate (verified by a test: insert N orders, check the stat)
- [ ] Payout bar shows the correct next-payout amount and date
- [ ] If `min_payout_cleared = false` (balance < $50), the payout bar shows a "Reach $50 minimum" message instead
- [ ] Revenue chart renders correctly with 30 data points, hoverable
- [ ] "My courses" list shows all the partner's products, regardless of status
- [ ] Inactive products have a visual treatment (lower opacity, "Unpublished" badge)
- [ ] "What to fix" panel populates with at least one item if there are any issues
- [ ] Recent sales table is paginated (default 20 rows)
- [ ] "Export CSV" generates a real CSV (not a placeholder) with the partner's data only
- [ ] Onboarding banner appears for partners in any non-approved state
- [ ] Page renders in < 500ms p95 (slightly higher due to aggregates)
- [ ] No layout shift on chart load
- [ ] No PII leak in URLs (use IDs, not emails or names)
- [ ] No `TODO` / `FIXME` in the diff

## Design reference

- Mockup: `mockups/instructor.html`
- Components: `00-foundations/ui/StatCard.tsx`, `00-foundations/ui/RevenueChart.tsx`, `00-foundations/ui/PerfRow.tsx`, `00-foundations/ui/PayoutBar.tsx`

## Security

- **Auth required:** YES
- **Allowed roles:** partner (any status, but onboarding banner shows for non-approved)
- **RLS policies that apply:** `partners` (self only), `products` (partner's own), `orders`/`order_items` (via product.partner_id), `payout_ledger` (self only)
- **PII displayed:** no (partner sees their own data)
- **PII in URLs:** no
- **Audit logged:** yes — every page load, every CSV export. The export audit is critical for detecting "partner scraped their own customer list" (which would be a TOS violation).
- **Rate limiting on CSV export:** 10/hour per partner
- **Third-party scripts:** none

## Performance

- **Target p95:** < 500ms
- **Render strategy:** RSC + SSR (no caching — partner-specific)
- **Cache:** none on this page
- **DB indexes:** all the `partner_id` indexes on `products`, `order_items`, `payout_ledger`
- **Bundle size budget:** < 30KB added to client bundle (chart, stat cards, table)

## Out of scope for v1

- Real-time updates (WebSocket)
- A/B testing for sales pages
- Cohort analysis
- Customer email list
- Refund approval (admin-only in v1)
- Course edit inline (all editing goes through the upload wizard's draft)
- "Best practices" content for partners (v2)
- Seasonal campaigns / promo codes managed by partners (admin-only in v1)

## Open questions for human

- **Early payout request:** is this a real v1 feature? My recommendation: ship the next-payout card only, no early requests. Admin can manually trigger early if a partner asks. Keeps the payout logic simple in v1.
- **Onboarding state for `pending` partners:** what do they see? My recommendation: a clear "Your application is being reviewed" state with what to expect (timeline, what we'll email you about, what to prepare in the meantime). Default to this.
- **"What to fix" panel rules:** my recommendation for v1:
  - Refund pending > 7 days old → "Resolve pending refund"
  - Course rating < 4.0 → "Improve course rating"
  - Sales page conversion dropped > 20% week-over-week → "Update sales page"
  - Course missing preview video → "Add a preview"
  - Course has < 3 reviews → "Encourage reviews"
  - That's 5 default rules. Tune post-launch.

---

## Implementation notes

- (filled by the building agent)
