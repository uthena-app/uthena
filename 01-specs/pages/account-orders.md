# Account Orders — `/account/orders`

## What this page does

The user's order history. A paginated list of every order the signed-in user has placed, newest first. Each row shows order id, order date, total (formatted USD), status badge, item count, and a "Download invoice" button. The page supports filtering by status and date range. Clicking a row navigates to `/account/orders/[id]` for the full detail.

If the user has never placed an order, the page shows an empty state: "You haven't bought anything yet" with a CTA to `/browse`. The page is auth-gated; anonymous visitors are redirected to `/login?next=/account/orders`.

## Data this page shows

| Field | Source | Format | Sort/filter |
|---|---|---|---|
| `id` (display as `#12345`) | `orders.id` | number, prefixed `#` | sort desc (default) |
| `created_at` | `orders.created_at` | `MMM D, YYYY` (e.g. `Jun 12, 2026`) | filter: date range (`from`, `to`) |
| `total_cents` | `orders.total_cents` | `$497.00` (formatMoney) | — |
| `currency` | `orders.currency` | text code | — |
| `status` | `orders.status` | badge: `paid` (green) / `refunded` (gray) / `partially_refunded` (amber) / `pending` (blue) / `failed` (red) / `fraudulent` (red) | filter: status multi-select |
| `item_count` | `count(*)` over `order_items where order_id = orders.id` | integer + "items" | — |
| `invoice_url` | (computed; see account-order-detail.md for the PDF generator) | link/button, disabled if no PDF | — |

**Queries:**
- `getMyOrders(userId, { status?, from?, to?, page, pageSize })` in `02-features/account/queries/getMyOrders.ts` — returns paginated list with `item_count` aggregated.
- Server-side pagination. Default `pageSize=20`. Cursor-based optional fallback in v2.

**Filter UI state lives in the URL** (`?status=paid,refunded&from=2026-01-01&to=2026-12-31&page=2`) so the user can share or bookmark filtered views. RSC reads from `searchParams`.

## User actions

| Action | Trigger | Result | RBAC |
|---|---|---|---|
| View an order | Click a row (anywhere except the invoice button) | Navigate to `/account/orders/[id]` | self (RLS: `orders.customer_id = auth.uid()`) |
| Download invoice | Click "Download invoice" on a row | Server action `generateInvoicePdf(orderId)` returns a signed PDF URL (24h TTL), logged to `file_downloads` with `file_id=null, target='order_invoice'`, browser downloads | self |
| Filter by status | Toggle one or more status checkboxes in the filter bar | URL updates with `?status=...`, list re-fetches via RSC | self |
| Filter by date range | Pick `from` and `to` in date inputs | URL updates with `?from=&to=`, list re-fetches | self |
| Clear filters | Click "Clear" in the filter bar | Removes filter query params, list shows all | self |
| Go to next/prev page | Click pagination controls | URL updates with `?page=`, list re-fetches | self |
| Change page size | Click "20 / 50 / 100" selector | URL updates with `?pageSize=`, list re-fetches | self |
| Empty state CTA | Click "Browse catalog" | Navigate to `/browse` | self |

## What this page does NOT do

- No "reorder" button (re-orders happen via cart; this is read-only history)
- No bulk actions (no "refund all", no "download all invoices" — one at a time, see Security for rate limits)
- No CSV export of order history (v2; the user can download individual invoices)
- No "tracking number" or shipping status (all products are digital; there is no shipment)
- No "contact support about this order" inline form (support goes through support@uthena.com)
- No "view as partner" or admin override (admins use `/admin/orders` — out of scope for this spec)
- No currency switching (USD only in v1; the `currency` column is shown as a code next to the total, not used for display)

## Acceptance criteria

- [ ] Page is auth-gated — anonymous users redirect to `/login?next=/account/orders`
- [ ] Page shows only orders where `orders.customer_id = auth.uid()` (RLS enforces; verified by test that injects a second user)
- [ ] Default sort is `created_at desc`; default page size is 20; `?pageSize=20|50|100` overrides it
- [ ] Status badge color matches the status (`paid`=green, `refunded`=gray, `partially_refunded`=amber, `pending`=blue, `failed`=red, `fraudulent`=red)
- [ ] Filters: status multi-select (`?status=paid,refunded`) and date range (`?from=&to=`) both work; "Clear filters" returns to page 1 with no params
- [ ] "Download invoice" triggers PDF generation; failure shows an inline error; download is logged to `file_downloads` with `target='order_invoice'`
- [ ] Pagination disables "Previous" on page 1 and "Next" on the last page
- [ ] Empty state: zero orders shows "You haven't bought anything yet" + CTA to `/browse` (no mocked data)
- [ ] Page renders in < 400ms p95 (user-specific; no caching)
- [ ] No PII in URLs, no `TODO`/`FIXME` in the diff

## Design reference

- Mockup: not yet built — to be created during the account feature build
- Components: `00-foundations/ui/DataTable.tsx`, `00-foundations/ui/StatusBadge.tsx`, `00-foundations/ui/DateRangePicker.tsx`, `00-foundations/ui/EmptyState.tsx`, `00-foundations/ui/Pagination.tsx`
- Tokens: `00-foundations/design/tokens.css` (status badge colors via semantic tokens, not inline hex)
- Theme: dark (default), with a light variant in v2

## Security

- **Auth required:** YES
- **Allowed roles:** any authenticated user (the `customer` role is the default; partners/affiliates/admins also have a personal order history)
- **RLS policies that apply:** `orders` (`orders_self_read` — `customer_id = auth.uid()`), `order_items` (inherits via order). We do NOT grant admin-all visibility from this page; this is the user's own view only.
- **PII displayed:** the order's total, status, item count, and date — none of which is PII. The user's own email is implicit in the auth session but not echoed on the page.
- **PII in URLs:** NO. Order ids are `bigint`; they are not PII. Filter values are enum-ish (status codes, ISO dates) — no PII.
- **Audit logged:** YES — every "Download invoice" action is logged to `file_downloads` with `target='order_invoice', file_id=null, order_id=orders.id`. The list view itself is not individually logged (would create log volume with no security value).
- **Rate limiting on invoice download:** max 60 invoice downloads per user per hour, 200 per user per day. Exceeding triggers a soft block and writes a row to `admin_audit_log` with `action='rate_limit_triggered'`.
- **CSRF:** the download server action is CSRF-protected (Supabase auth session + same-site cookies).
- **Idempotency:** the invoice download is read-only (generates a URL); no idempotency key required, but the URL is signed with a 24h TTL and is one-redeemable-in-spirit (we monitor for abuse).
- **Third-party scripts:** none

## Performance

- **Target p95:** < 400ms (user-specific page; no caching)
- **Render strategy:** RSC + SSR. The list query runs on the server with the user's `auth.uid()` bound to the RLS policy — no client-side data fetching.
- **Cache:** NONE. The data is too personalized. We re-query on every navigation.
- **DB indexes used:** `orders (customer_id, created_at desc)` — already in `_data-model.md` §orders.
- **Pagination:** server-side offset/limit. For a user with 1,000 orders, the count query is fast because of the index. We do NOT fetch all rows.
- **Bundle size budget:** < 30KB added to client bundle (table, filters, status badge, pagination — all small primitives)
- **No client-side state for filters:** filters are URL params, the page is RSC, the client just navigates.

## Out of scope for v1

- Bulk actions ("refund all", "download all invoices")
- CSV export of order history
- "Reorder" button (re-buying happens via cart)
- "Tracking number" / shipping status (we sell digital only)
- "Contact support" inline form (use support@uthena.com)
- Admin override view (separate `/admin/orders` page, not in this spec)
- Multi-currency display
- Saved filter presets
- "View as partner" — partners see their own orders on this same page, but their partner-side sales live on `/partner/sales` (separate spec)

## Open questions for human

- **Refund eligibility hint on the list view:** should each row show a small "Refundable until Jun 26" badge if the order is within the 14-day window, or should we keep the list minimal and surface that only on the detail page? My recommendation: keep the list minimal. The detail page is where refund actions live; the list is for history. Surface refundability on `/account/orders/[id]` only.
- **Date range presets:** "Last 30 days / 90 days / 1 year / All time" buttons in addition to the free-form date inputs? My recommendation: yes, four preset chips above the date inputs. Cheap to build, common ask.
- **Item count vs. items list:** should each row expand to show the items (a la Amazon), or is item count + a click-through to detail enough? My recommendation: keep rows flat. Expansion adds complexity (state management, accessibility) for a small UX win. Detail page is one click away.
- **Failed / fraudulent order visibility:** should we show `failed` and `fraudulent` orders on this list at all, or hide them by default? My recommendation: show them, but exclude them from the default filter and only show when the user explicitly toggles "Include failed". Showing nothing would be confusing; showing everything is the honest behavior.

---

## Implementation notes

- **List-view split for P9.10:** the user-visible **Download invoice** column
  is intentionally **not rendered** on the list view. Reasons:
  1. The list is for scanning history; the invoice action lives on the
     detail page (`/account/orders/[id]` — P9.11), which has all the
     context (line items, payment method, billing address) the PDF
     actually needs.
  2. An earlier version of the list had a disabled "Invoice" button with
     `title="Coming soon"` — that's a placeholder, and AGENTS.md / QWEN.md
     forbid placeholders in shipped code.
  3. Invoice download is gated on the **PDF library decision**
     (`@react-pdf/renderer` vs headless Chromium — see STUB-051). That
     decision gates the **action**, not the list-view layout, so removing
     the placeholder column does not couple the layout to the library
     choice.

  The list row itself is a `<tr>` whose first cell is a `<Link>` to the
  detail page; that link IS the path to the invoice. Once P9.11 ships
  with `generateInvoicePdf(orderId)` wired (and STUB-051 resolved), the
  detail page is the single source for invoices.
- **Status tone split (2026-06-29):** `partially_refunded` was previously
  grouped with `refunded` under a single gray "refund" tone. The spec
  says `partially_refunded=amber`; the implementation now has its own
  `partial` tone using `--warn` / `--warn-soft` / `--warn-line` tokens.
  `refunded` stays gray (the order is fully closed out, no money in
  motion). `<StatusBadge>` exports a `StatusTone` union for downstream
  consumers.
- **Query PII safety:** `getMyOrders` selects only `id, created_at, status,
  total_cents, currency, order_items!order_items_order_id_fkey(id)` with
  `{ count: 'exact' }`. The order_items embed pulls only `id` (we use it
  for the `item_count` aggregation, never the row contents — order_items
  has no PII columns in v1 but the embed is intentionally narrow).
  `orders.user_id` is the only auth predicate (RLS also enforces it via
  the `orders_self_read` policy).
- **20 unit tests** in
  `02-features/account/profile/queries/getMyOrders.test.ts` cover:
  anon path (no orders-table calls), happy-path mapping + totalCount +
  pageCount math, pagination range math (including page=0 / pageSize=0
  clamps), status multi-filter shape, empty-status-skip, date-range bounds
  (`T00:00:00Z` / `T23:59:59Z`), empty-string date inputs treated as no
  filter, defensive mapping (missing items array → item_count = 0,
  empty rows + count:0 → pageCount = 1 via the `Math.max` guard), DB
  error → empty result (no throw), user-scoped isolation
  (`eq('user_id', signed-in-user.id)` always set and reacts to session
  swap), and PII safety (select payload excludes `email` / `ip` /
  `user_agent` / `billing_address`; order_items embed is `id`-only).

## Slice status

- **Slice 1 (shipped 2026-06-29):** all 10 PHASES.md / spec acceptance
  criteria satisfied EXCEPT criterion #6 ("Download invoice triggers PDF
  generation"). That criterion is blocked on STUB-051 (PDF library
  decision) and surfaces on the detail page (P9.11), not on this list.
  Marked `[~]` (per the cron protocol's "human step ⇒ `[~]`, not `[x]`"
  rule) with the blocker in the tick log line.
