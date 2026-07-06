# Partner Courses List — `/partner/courses`

## What this page does

The partner's product management list. Shows every product
the partner owns (any status: draft / in_review / published /
unpublished / archived) with:
- Thumbnail (or initials placeholder)
- Title + short description
- Kind label (Video course / eBook / etc.)
- Last-updated date
- **Per-product units sold + revenue** (P6.2 — resolves STUB-035)
- Status badge (semantic color)
- "Open" link to the per-product management page
  (`/partner/courses/[id]` — ships in PH13b2)

Top-right: "+ Upload a course" CTA → `/partner/instructor-upload`.

Empty state: "You haven't uploaded any products yet" with a CTA
to the upload page.

## Data this page shows

| Section | Field | Source | Format |
|---|---|---|---|
| Header | "My courses" + count | products aggregate | H1 + lede |
| Header CTA | Link to /partner/instructor-upload | static | button |
| Row | `products.thumbnail_url` | products | thumbnail or initials |
| Row | `products.title`, `products.short_description` | products | text |
| Row | `products.kind` (mapped to a human label) | enum | text |
| Row | `products.updated_at` | products | "updated MMM D, YYYY" |
| **Row** | **`SUM(quantity)` per product** (P6.2) | `get_partner_product_aggregates(partner.id)` RPC → `units_sold` (migration 0030) | monospace integer ("Sold" label + value) |
| **Row** | **`SUM(line_total_cents)` per product** (P6.2) | `get_partner_product_aggregates(partner.id)` RPC → `revenue_cents` (migration 0030) | `formatMoney` USD ("Revenue" label + value) |
| Row | `products.status` (badge) | products | pill |
| Row | "Open" link | static | link to /partner/courses/[id] |
| Empty | "You haven't uploaded any products yet" + CTA | static | card |

## User actions

| Action | Trigger | Result | RBAC |
|---|---|---|---|
| Open a product | Click "Open" on a row | Navigate to `/partner/courses/[id]` | partner (own product) |
| Upload a new product | Click "+ Upload a course" | Navigate to `/partner/instructor-upload` | partner |

## What this page does NOT do

- No inline edit / delete actions (those are on the detail page)
- No bulk actions
- No status filter (the list is small enough; the detail page
  shows status clearly)
- No per-product date range (all-time aggregates; the per-product
  date range lives on `/partner/courses/[id]/sales` — PH13b2)

## Acceptance criteria

- [x] Page is partner-gated (auth + role check)
- [x] List shows only products where `partner_id = partners.id`
- [x] Each row has a status badge with the correct tone
- [x] Empty state renders correctly when the partner has 0 products
- [x] Page renders in < 250ms p95
- [x] No PII in URLs, no `TODO` / `FIXME` in the diff
- [x] **P6.2 (2026-06-26)**: Each row shows per-product
      `units_sold` + `revenue_cents` from
      `get_partner_product_aggregates(partner.id)` RPC (migration
      0030). Values render right-aligned with monospace numbers
      + "Sold" / "Revenue" labels.
- [x] **P6.2**: Products with no paid sales show "0" for both
      metrics (not blank, not undefined).
- [x] **P6.2**: Units counts bundle-seat quantities correctly
      (`SUM(order_items.quantity)` — not a count of rows).
- [x] **P6.2**: Revenue is gross sales (`SUM(line_total_cents)` —
      discounts already applied at sale time). Refunds surface
      separately on `/partner/payouts` (P6.3).
- [x] **P6.2**: When the RPC errors out, the list still renders
      with 0/0 aggregates (fail-soft) + a warn log carries a
      hashed partner_id (PII safety).
- [x] **P6.2**: Mobile layout collapses to 2-column (thumb + body);
      metrics stack below the title in column 2; status badge
      + action button stay accessible.

## Security

- **Auth required:** YES (partner role)
- **RLS:** `products.partner_id = partners.id` for the current
  user; the `products.partner_id` RLS policy enforces this.
  The RPC is SECURITY DEFINER and re-checks
  `current_partner_id() = p_partner_id OR is_admin()` internally.
- **PII displayed:** none (product metadata + sales aggregates
  are not PII). Logs use a hashed partner_id (FNV-1a) for
  fail-soft observability.

## Performance

- **Target p95:** < 250ms
- **Render strategy:** RSC with sequential `select * from products`
  + `get_partner_product_aggregates(partner_id)` reads. The two
  reads are sequential (not `Promise.all`) for clearer error
  semantics and simpler test mocking; latency cost is negligible
  (one extra round-trip, typically < 10ms in our Supabase region).
- **DB indexes used:**
  - `products (partner_id, updated_at desc)` for the products read.
  - `order_items_partner_product_idx (partner_id, product_id)
    INCLUDE (quantity, line_total_cents)` (P6.2 migration 0030) —
    makes the GROUP BY in the RPC an index-only scan.
- **Cache strategy:** none — the partner's per-product KPIs must
  reflect every new sale, so the page is uncached (revalidate = 0).
