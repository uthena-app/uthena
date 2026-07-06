# Admin Order List — `/admin/orders`

## What this page does

The admin's view of every order in the system. A paginated table (default 50 rows per page) with: order id, date, customer email, total, status badge, items count, partner share, payment method (brand + last4), affiliate handle (if any), and row actions (view detail, manual refund). Sort: `created_at desc` by default. Filters: status, date range, customer email (search), affiliate, product, partner. CSV export (admin-only, rate-limited).

The page is the same shape as `/account/orders` (see `account-orders.md`) but the data is admin-scoped via RLS `orders_admin_all` and the columns are admin-relevant (PII visible, partner share visible, affiliate attribution visible). Every page view and every row action is audit-logged — this is the highest-audit-traffic page after the dashboard.

Server-rendered RSC. No caching (financial data). The empty state is "No orders match these filters" with a "Clear filters" CTA.

## Data this page shows

| Section | Field | Source | Format |
|---|---|---|---|
| Sidebar | same admin shell as `mockups/admin.html` | hard-coded | sidebar |
| Top bar | page title, "Export CSV" button (rate-limited), "View refund queue" link | hard-coded | top bar |
| Filter bar | status multi-select, date range (`from` / `to`), customer email search input, affiliate select, product select, partner select, "Clear" button | local state → URL params | filter bar |
| Table header | Order id, Date, Customer, Total, Status, Items, Partner share, Payment, Affiliate, Actions | derived | table |
| Table row | `#12345`, `MMM D, YYYY` + time, customer email, `$497.00`, status badge, `2 items`, `$298.20`, `Visa ••4242`, `@handle` (or `—`), buttons | orders + order_items + profiles + products + partners + affiliates | row |
| Pagination | "Previous / 1 2 3 ... 12 / Next", page size selector (`20 / 50 / 100`) | derived | pagination footer |
| Empty state | "No orders match these filters" + "Clear filters" button | derived | centered card |

**Query:** `getAdminOrders({ status?, from?, to?, customerEmail?, affiliateId?, productId?, partnerId?, page, pageSize })` in `02-features/admin/queries/getAdminOrders.ts`. Joins: `orders` + `profiles` (customer display_name + email) + `order_items` (count + sum) + `products` (for product filter join) + `partners` (for partner filter join) + `affiliates` (for handle). The `payment_method` (brand + last4) is denormalized on `orders` per the OQ in `account-order-detail.md`; we read those columns directly.

## User actions

| Action | Trigger | Result | RBAC |
|---|---|---|---|
| View a row | Click a row (anywhere except the action buttons) | Navigate to `/admin/orders/[id]` | admin |
| Open manual refund | Click "Refund" on a row with status='paid' | Opens the refund flow at `/admin/refunds?orderId=[id]&prefill=true` | admin |
| Filter by status | Toggle status checkboxes | URL updates with `?status=...`, list re-fetches via RSC | admin |
| Filter by date range | Pick `from` and `to` dates | URL updates with `?from=&to=`, list re-fetches | admin |
| Filter by customer email | Type into the customer email input | URL updates with `?email=...` (server-side ILIKE search, debounced 300ms) | admin |
| Filter by affiliate | Pick from the affiliate select | URL updates with `?affiliateId=...` | admin |
| Filter by product | Pick from the product select | URL updates with `?productId=...` | admin |
| Filter by partner | Pick from the partner select | URL updates with `?partnerId=...` | admin |
| Clear all filters | Click "Clear" | Removes all filter params, list shows all | admin |
| Change page | Click pagination | URL updates with `?page=`, list re-fetches | admin |
| Change page size | Click "20 / 50 / 100" | URL updates with `?pageSize=`, list re-fetches | admin |
| Change sort | (not in v1 — date desc only) | — | — |
| Export CSV | Click "Export CSV" top-right | Server action generates CSV, returns signed URL, logs to `file_downloads` with `target='admin_orders_export'`, browser downloads | admin |
| Open refund queue | Click "View refund queue" | Navigate to `/admin/refunds` | admin |

## What this page does NOT do

- No inline status edit (status changes go through Stripe webhooks or the fraud-mark action on the order detail page)
- No "merge duplicate orders" tool (v2; duplicates are rare and we re-issue refunds when they happen)
- No "view as customer" on the list (that lives on `/admin/orders/[id]`)
- No custom sort (date desc only in v1; column-header sort is v2)
- No saved filter presets per admin
- No real-time new-order WebSocket push (admins reload to see new orders; the v1 cadence is fine)
- No column visibility toggles (the 10 columns are fixed; v2 has a column picker)
- No "mark as fraudulent" on the list (that action lives on `/admin/orders/[id]`)
- No mass actions (no "refund all selected"; the manual refund is one-at-a-time and rate-limited at the destination)

## Acceptance criteria

- [ ] Page is auth-gated AND requires `profiles.role = 'admin'` (loader throws `requireRole(['admin'])`)
- [ ] Page is auth-gated AND requires `profiles.role = 'admin'`; customer/partner/affiliate access returns 403
- [ ] Default sort is `created_at desc`; default page size is 50; `?pageSize=20|50|100` overrides it; status badge colors match the customer-side spec (`paid`=green, `refunded`=gray, `partially_refunded`=amber, `pending`=blue, `failed`=red, `fraudulent`=red)
- [ ] All 6 filters work independently and combined (`?status=&from=&to=&email=&affiliateId=&productId=&partnerId=`); "Clear filters" removes all filter params AND resets `?page=1`; customer email is an ILIKE substring search debounced 300ms client-side
- [ ] "Manual refund" button renders only on paid orders where `now() - created_at < REFUND_WINDOW_DAYS + 14d`; on older paid orders the button is hidden, not disabled
- [ ] CSV export contains the 10 specified columns (id, created_at, customer email, total, status, items count, partner share, payment brand+last4, affiliate handle, currency); file is server-generated, returned via a 24h signed URL, logged to `file_downloads` with `target='admin_orders_export'`; rate-limited to 10 per admin per hour
- [ ] Pagination: "Previous" disabled on page 1; "Next" disabled on the last page; empty state shows "No orders match these filters" + "Clear filters" button (NOT the marketing-style empty state from `/account/orders`)
- [ ] Every page view, row click, manual-refund initiation, and CSV export writes one row to `admin_audit_log` with the action strings `view_orders_list`, `view_order_detail`, `initiate_manual_refund`, and `export_orders_csv` respectively (with target_id set to the order id where applicable; the CSV export's `before` jsonb includes the filter set, with email hashed)
- [ ] Page renders in < 700ms p95; no PII in URLs (the `?email=` value is hashed in audit logs, not echoed anywhere); no `TODO` / `FIXME` in the diff

## Design reference

- Mockup: not yet built — to be created during the admin feature build
- Components: `00-foundations/ui/AdminSidebar.tsx`, `00-foundations/ui/DataTable.tsx`, `00-foundations/ui/StatusBadge.tsx`, `00-foundations/ui/DateRangePicker.tsx`, `00-foundations/ui/FilterBar.tsx`, `00-foundations/ui/Select.tsx`, `00-foundations/ui/Pagination.tsx`, `00-foundations/ui/EmptyState.tsx`
- Tokens: `00-foundations/design/tokens.css`
- Theme: dark (default)

## Security

- **Auth required:** YES
- **Allowed roles:** admin (only)
- **RLS policies that apply:** `orders` (`orders_admin_all`), `order_items` (inherits via order), `profiles` (`profiles_admin_all` for customer email), `partners` (`partners_admin_all` for partner name), `affiliates` (`affiliates_admin_all` for handle)
- **PII displayed:** YES — by design. Customer email is visible. The `card_brand` + `card_last4` are visible. Partner share is visible. Every page view + every row click + every action is audit-logged
- **PII in URLs:** NO. The `?email=` filter value is a search param and is hashed in the `admin_audit_log.before` jsonb (sha-256 prefix only — full email is not stored in the audit row)
- **Audit logged:** YES. `action` values used in `admin_audit_log`:
  - `view_orders_list` — every page view (1 row per render, NOT per row)
  - `view_order_detail` — when a row is clicked (target_id = order id)
  - `initiate_manual_refund` — when the manual-refund button is clicked (target_id = order id)
  - `export_orders_csv` — when CSV export is triggered (before = the filter set, redacted)
- **Rate limiting on CSV export:** max 10 exports per admin per hour. Exceeding returns 429 and writes `action='rate_limit_triggered'`
- **Rate limiting on manual refund initiation:** the actual refund runs in `/admin/refunds`; that flow has its own rate limit (see `admin-refunds.md`). This page only initiates the redirect
- **CSRF:** the CSV export server action is CSRF-protected
- **Email enumeration protection:** the customer email search is admin-only; admins are already authorized to see customer emails, so no enumeration risk from this page
- **Third-party scripts:** none

## Performance

- **Target p95:** < 700ms (50-row table, 8 joins, RSC)
- **Render strategy:** RSC + SSR, no caching (financial data, must be live)
- **Cache:** NONE
- **DB indexes used:** `orders (created_at desc)`, `orders (status, created_at desc)`, `orders (customer_id, created_at desc)`, `orders (affiliate_id, created_at desc)`, `order_items (order_id)`, `profiles (user_id)`. The customer email search uses `pg_trgm` GIN index on `profiles.email` (proposed in Open Questions if not present)
- **Pagination strategy:** offset/limit. For 100K+ orders, the offset gets slow; we switch to keyset pagination in v2 (key = `(created_at, id)`)
- **Bundle size budget:** < 40KB added to client bundle (table, filters, status badge, pagination)
- **No client-side data fetching:** the page is RSC; the client just navigates

## Out of scope for v1

- Column-header click-to-sort (date desc only)
- Saved filter presets per admin
- Column visibility toggles
- Real-time new-order push (WebSocket)
- Inline status edit
- "Merge duplicate orders" tool
- Bulk actions (mass-refund, mass-mark-fraudulent)
- Keyset pagination (offset is fine at v1 scale)
- Multi-currency display (USD only; the `currency` column is shown as a code next to the total)

## Open questions for human

- **Admin refund grace window:** customers can request refunds for 14 days; should admins be able to manually refund a paid order that is 30 days old? My recommendation: yes, with a 14-day admin grace window. The "Manual refund" button renders for paid orders where `now() - created_at < REFUND_WINDOW_DAYS + 14d` (i.e. up to 28 days total). Beyond that, the button hides and the admin must handle out-of-band. Confirm or change the 14d number.
- **`profiles.email` needs a trigram index for the customer search:** the data model has no `pg_trgm` index on `profiles.email` today. My recommendation: add the index in a new migration (`create extension if not exists pg_trgm; create index profiles_email_trgm on profiles using gin (email gin_trgm_ops);`). Substring search is unindexed without it and will full-scan at 100K users.
- **Email storage in the CSV export and audit log:** the CSV legitimately needs the email (admins export to investigate fraud, etc.). The audit log's `before` jsonb does NOT — the search filter value is hashed (sha-256 prefix, 16 chars). Confirm: should the CSV itself be logged with a row-count and the filter set but not the row contents? My recommendation: yes — the CSV is the deliverable, the audit is the metadata, never the row data.
- **Should failed and fraudulent orders show by default?** the customer-side spec (`account-orders.md`) hides them by default. For the admin, showing them is the honest behavior. My recommendation: show by default, expose a single "Hide failed/fraudulent" toggle that adds `?excludeStatus=failed,fraudulent` to the URL. Defaults: show all.

---

## Implementation notes

- `getAdminOrders(filters, { page, pageSize })` in `02-features/admin/queries/getAdminOrders.ts` — single SQL with conditional WHERE clauses; returns `{ rows, total_count, page, pageSize, total_pages }`
- `exportAdminOrdersCsv(filters)` in `02-features/admin/actions/exportAdminOrdersCsv.ts` — server action; generates CSV in-memory (max 10K rows; if filters return more, the action errors with a "narrow the filters" message); uploads to Bunny Storage at `admin-exports/orders/{admin_id}/{timestamp}.csv`; returns signed URL with 24h TTL
- Manual refund initiation is a navigation, not an action — clicking the button is a `Link` to `/admin/refunds?orderId=[id]&prefill=true`
- The "partner share" column shows the sum of `order_items.partner_share_cents` across all line items in the order, formatted as USD
