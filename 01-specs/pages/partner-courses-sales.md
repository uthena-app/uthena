# Partner Course Sales — `/partner/courses/[id]/sales`

## What this page does

Per-course sales table. The dedicated drill-down for a single product's sales. Columns: order id, date, customer (masked: `j***@email.com` — partners do NOT have raw customer email; that's admin-only), tier, unit price, partner share, refund status. Filters: date range, tier, status. Sort: date desc default. CSV export rate-limited 10/hr. The customer email masking is the same approach as the partner-dashboard spec's recent sales table — consistent across the portal. Pagination default 20.

## Data this page shows

| Section | Field | Source | Format |
|---|---|---|---|
| Page header | `product.title` (course context), breadcrumb back to /partner/courses/[id], summary stats (revenue_period, units_period, refund_rate_period, avg_rating_period) | products + order_items aggregate | header |
| Filter bar | date range (default last 90d), tier (all / whitelabel / plr / plr_mrr), status (all / paid / refunded / partially_refunded) | local state + URL | filter row |
| Table | (see below) | `order_items` joined with `orders` (masked) | table, paginated |
| Order id | `orders.id` (display, clickable to admin-only `/admin/orders/[id]` — partner gets 404; we use a deep-link badge "View in admin" that opens in a new tab) | orders | link |
| Date | `orders.created_at` (in partner's timezone) | orders | mono date |
| Customer | masked email (`j***@email.com`), display_name | orders (masked) + profiles | text |
| Tier | `order_items.tier` (chip) | order_items | chip |
| Unit price | `order_items.unit_price_cents` (formatted) | order_items | mono number |
| Partner share | `order_items.partner_share_cents` (formatted) | order_items | mono number |
| Refund status | `orders.status` (paid / refunded / partially_refunded / failed / fraudulent) | orders | badge |
| Pagination | "Prev / Next" + "Page X of Y" + page size selector (20 / 50 / 100) | derived | pagination row |
| Empty state | "No sales in this period." | hard-coded | empty state |
| Export button | "Export CSV" (top-right) | server action | button |
| Export cooldown | After export, button shows "Exported — try again in N minutes" | derived | inline timer |

**Queries / actions (all in `02-features/partner-portal/`):**
- `getCourseSales(id, filters, page, pageSize)` — RSC, returns the paginated table + summary stats
- `exportCourseSalesCsv(id, filters)` — server action, returns a signed URL for a CSV (24h TTL), audit row, rate-limited 10/hr

## User actions

| Action | Trigger | Result | RBAC |
|---|---|---|---|
| Filter by date range | Click date range picker, pick range | URL updates with `?from=` and `?to=`, table re-queries | partner (own course) |
| Filter by tier | Click tier chip | URL updates with `?tier=`, table re-queries | partner (own course) |
| Filter by status | Click status chip | URL updates with `?status=`, table re-queries | partner (own course) |
| Change page | Click "Next" / "Prev" / page number | URL updates with `?page=` | partner (own course) |
| Change page size | Click page size selector | URL updates with `?pageSize=` | partner (own course) |
| Sort by column | Click a sortable column header | URL updates with `?sort=` (only `date` is sortable in v1; default `date desc`) | partner (own course) |
| Open order in admin | Click the order id | New tab to `/admin/orders/[id]` (partner sees what admin sees — a read-only order detail; v1 doesn't gate this) | partner (own course, with caveat — see OQ) |
| Export CSV | Click "Export CSV" | Server action runs, signed URL returned, success toast, button shows cooldown | partner (own course) |
| Refresh data | Click "Refresh" | Invalidates the 5-minute cache, fresh data | partner (own course) |
| View course detail | Click the breadcrumb | Navigate to `/partner/courses/[id]` | partner (own course) |

## What this page does NOT do

- No individual customer click-through (the masked email is the deepest we go; clicking does nothing — see OQ)
- No per-order refund request (partners do not approve refunds in v1; admin does, via `/admin/payouts`)
- No real-time updates (5-minute refresh; the page reads from a cached aggregate)
- No cohort / retention view (the analytics page is for admin; partner gets summary stats only)
- No A/B test breakdowns (v2)
- No "this customer is also a partner / affiliate" cross-reference
- No customer LTV (lifetime value) — the partner sees the per-order row, not a customer rollup
- No "contact this customer" CTA (we never give the partner a way to email a buyer; that's a privacy violation, and partners know this)
- No refund reason display (the partner sees `refunded` / `not refunded`; the reason text is admin-only)
- No multi-currency display (USD only)
- No "show only my tier" or "show only my region" filters beyond the basic tier + date
- No "compare to last period" (v2)

## Acceptance criteria

- [ ] Page is auth-gated AND requires `profiles.role IN ('partner')` AND the partner owns the product (RLS enforces; non-owner gets 404)
- [ ] Table shows order id, date, customer (masked), tier, unit price, partner share, refund status
- [ ] Customer email is masked as `j***@email.com` (or appropriate pattern: first char + *** + @domain) — NEVER the raw email
- [ ] Date is rendered in the partner's timezone (`profiles.timezone`)
- [ ] All amounts are formatted with mono numbers, currency symbol, no decimals
- [ ] Default sort is `date desc`; only `date` is sortable in v1
- [ ] Default page size is 20; page size selector offers 20 / 50 / 100
- [ ] Filters (date range, tier, status) are reflected in the URL (shareable, back-button works)
- [ ] Summary stats at the top reflect the current filter (not lifetime)
- [ ] CSV export includes all filtered rows (not just the visible page)
- [ ] CSV export columns: order id, date, customer (masked), tier, unit price, partner share, refund status
- [ ] CSV export rate-limited to 10/hr per partner; the button shows a cooldown timer after each export
- [ ] CSV export is logged to `admin_audit_log` (extended) with `action='partner_csv_export'`, `target_id=course_id`, `after` carries the filter params + row count
- [ ] Customer name display: `profiles.display_name` (the customer's chosen name) — NOT their email's local part
- [ ] The order id link goes to `/admin/orders/[id]` in a new tab; the partner sees what admin sees (this is a deliberate "you can see order metadata" surface, see OQ)
- [ ] Empty state when no sales: "No sales in this period." with a help text "Sales will appear here within minutes of purchase."
- [ ] Page renders in < 400ms p95 (RSC; the query is bounded by the date filter, which has an index)
- [ ] No layout shift on data load
- [ ] No `TODO` / `FIXME` / `HACK` in the diff

## Design reference

- Mockup: not yet built — to be created during the partner portal build
- Components: `00-foundations/ui/SalesTable.tsx`, `00-foundations/ui/FilterBar.tsx`, `00-foundations/ui/MaskedEmail.tsx`, `00-foundations/ui/ExportButton.tsx`

## Security

- **Auth required:** YES
- **Allowed roles:** partner (own course only)
- **RBAC enforcement:** the query is wrapped in a function that filters by `products.partner_id = self_partner_id`. RLS is the second line of defense.
- **RLS policies that apply:**
  - `order_items` — for the table data: the partner's view is via a service-role query that filters by their product's `partner_id`. RLS on `order_items` says "Inherits from order" (the data model); the data model doesn't have an explicit partner-readable policy. My recommendation: add `order_items_partner_read_own_product` for this page. See OQ.
  - `orders` — for the order metadata (date, status, masked email): same as above, add `orders_partner_read_own_product` OR query via the service-role with masking. See OQ.
  - `products` — `products_partner_read_own` (read; we need the product for the header summary)
- **PII displayed:** masked email only. The masking is server-side: the query returns a derived `masked_email` column, not the raw `email`. The raw email is NEVER in the server response, NEVER in the client bundle, NEVER in the CSV.
- **PII in URLs:** no
- **CSV export masking:** the CSV export server action re-masks emails server-side. The CSV does NOT contain raw emails, even if the masking function has a bug. (Defense in depth: the export action runs the masking function on the rows, not the read query.)
- **Audit logged:** every page view (with the filter params), every CSV export. The audit row for export carries the filter params and the row count, not the data itself.
- **CSRF:** all server actions are CSRF-protected
- **Rate limiting:** 10 CSV exports per partner per hour (matches `instructor-dashboard.md` and `instructor-payouts.md`); 200 page loads per partner per hour
- **Cache:** the page is cached for 5 minutes (RSC fetch cache). The cache key includes the filter params and the partner's id. Manual "Refresh" button invalidates.
- **Order id deep-link:** clicking an order id opens `/admin/orders/[id]` in a new tab. The partner is technically able to read admin-rendered order detail (which includes the unmasked email and PII). This is a deliberate v1 trade-off — see OQ for the recommendation.
- **Third-party scripts:** none

## Performance

- **Target p95:** < 400ms
- **Render strategy:** RSC + SSR. The table is server-rendered.
- **Cache:** RSC fetch cache, 5-minute TTL, keyed on (partner_id, course_id, filter params, page, pageSize). Manual "Refresh" button invalidates.
- **DB indexes:** existing `order_items (product_id, created_at desc)`; NEW: `order_items (product_id, status, created_at desc)` for the status filter; the existing `orders (customer_id, created_at desc)` is not used (we don't filter by customer in v1)
- **Bundle size budget:** < 25KB added to client bundle (table + filter bar + pagination + export button)

## Out of scope for v1

- Per-customer click-through / contact
- Per-order refund request (admin-only in v1)
- Real-time updates
- Cohort / retention view
- A/B test breakdowns
- "This customer is also a partner / affiliate" cross-reference
- Customer LTV
- "Contact this customer" CTA (privacy)
- Refund reason display
- Multi-currency display
- "Compare to last period"
- Per-tier / per-region aggregations beyond the basic filters
- Sortable columns beyond `date`

## Open questions for human

- **RLS for partner-readable order_items / orders:** the data model has no policy that lets a partner read order_items or orders for their own products. The page needs this. Options: (a) add explicit `order_items_partner_read_own_product` and `orders_partner_read_own_product` policies (the partner can see rows for products they own), (b) keep the partner's read path as a service-role query that filters server-side, never expose the table to the partner's RLS. My recommendation: (b) — keep order data behind service-role queries with explicit server-side filtering. The reason: PII handling is easier to reason about when the partner never has RLS access to the underlying tables. The service-role query is the single read path; the masking function is applied uniformly.
- **Order id deep-link to `/admin/orders/[id]`:** the spec says clicking an order id opens the admin order detail page in a new tab. But the admin order page may show the raw customer email, the customer's IP, the customer's user agent — all of which are PII. The partner does not need to see those. My recommendation: don't deep-link to the admin order page. Instead, open a partner-scoped read-only order detail modal that shows: order id, date, line items, total, refund status — and the masked customer email. No IP, no user agent, no customer PII beyond the masked email. The admin order page is admin-only. This is the cleaner privacy boundary.
- **Masking pattern:** `j***@email.com`. My recommendation: always show first char + `***@` + the full domain. This is the pattern Stripe and Shopify use. It's stable (the partner can recognize "this is the same customer as in the row above") without revealing the local part. Alternative: hash the email and show the hash (most private, but the partner can't recognize repeat customers). v1: first-char + *** + domain.
- **Default date range:** 90d is my recommendation. The partner-dashboard spec shows 30d on the recent sales table; this page is the deeper view, so 90d is reasonable. Alternative: 30d (consistent with the dashboard). My recommendation: 90d here, document the difference.
- **CSV export columns:** the spec lists order id, date, customer (masked), tier, unit price, partner share, refund status. Should we also include: order id (full, not truncated), license tier (more detail than the chip), the product title (for the partner's own records)? My recommendation: include everything the table shows, plus `order_id` (full bigint) and `license_tier` (full enum value, not abbreviated). The CSV is for the partner's accounting — more detail is better.
- **Customer name display:** the spec uses `profiles.display_name`. If the customer has no `display_name` set, we fall back to the masked email (which is itself a fallback — we never show the raw email). My recommendation: display_name first, masked email as fallback. The order row never shows the raw email, even as a fallback.
- **Refund reason:** the spec says refund reason is admin-only. My recommendation: the partner sees `refunded` / `partially_refunded` / `not refunded` as a status, but the reason text (e.g. "course was misleading") is NOT shown. The partner can ask the admin for context if needed, but the default is "you see the status, not the words."

---

## Implementation notes

- **P12.11 Slice 1 (2026-06-30) — Sales tab on `/partner/courses/[id]?tab=sales`.** Ships the per-course lifetime summary (4 stat cards: Revenue, Units sold, Refund rate, Average rating) + a drill-down link to `/partner/courses/[id]/sales`. Reads from the new SECURITY DEFINER RPC `get_partner_course_sales_summary(p_partner_id, p_product_id)` (migration `0042_partner_course_sales_summary.sql`). Files: `02-features/partner-portal/queries/getMyCourseSalesSummary.ts` (RSC-side wrapper, fail-soft on RPC error + ownership check + partner lookup, bigint-coercion for PostgREST wire form, refund rate clamped to [0, 1], avg_rating preserves NULL contract, PII-safe log redaction via FNV-1a hashes for partner_id and product_id) + `02-features/partner-portal/components/CourseSalesSummary.tsx` + matching CSS module (4-card responsive grid 4→2→1 across 900px/640px breakpoints, mono-numerics for KPI alignment, token-only CSS). Wired into the existing 5-tab `page.tsx` so the Sales tab (`?tab=sales`) renders the summary in parallel with the rest of the page (`Promise.all` — no extra round-trip when the tab is selected). Tests: **17 query tests** (auth gating × 4, input validation × 3, ownership mismatch × 2, happy-path mapping × 5, RPC failure handling × 3) + **18 component tests** via `renderToStaticMarkup` (header layout, formatting for USD/units/rate/rating, refund hint branches, drill-down link href + hint copy, recency footer incl. "today" via relative timestamp). **All 6 checks green** + `pnpm typecheck` + `pnpm lint` clean. 17 + 18 = **35 new unit tests, runs in 19ms**. Slice boundary: drill-down page (`/partner/courses/[id]/sales` — table, URL-driven filters, masked customer email, pagination, CSV export with rate limit + audit log, top-5 buyer countries once `orders.ip_country` is added in a future migration) — Slices 2+ deferred to **STUB-097**.
