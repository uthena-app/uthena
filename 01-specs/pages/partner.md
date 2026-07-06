# Partner Dashboard — `/partner`

> **Note on naming.** The "onboarding" path is at
> `/partner/onboarding` (see `partner-onboarding.md` for the 7-
> step wizard). This spec is for the **dashboard** at `/partner`
> — the partner's home page after they're approved (or while
> pending review).

## What this page does

The partner's home page. Shows:

1. **Status banner** — surfaces the application state:
   - `pending` — "Application under review" (visible while
     `partners.status = 'pending'`)
   - `suspended` — "Account suspended, contact support"
   - `approved` (or no banner) — no banner rendered
2. **KPI grid** (5 cards, P12.4 added "This month"):
   - Products (total) — count of products owned by the partner
   - Published — count where `products.status = 'published'`
   - Pending review — count where `products.status = 'pending_review'`
   - Lifetime sales — sum from `payout_ledger` via the
     `get_partner_lifetime_sales_cents(partner.id)` RPC
     (migration 0029, P6.1)
   - **This month (P12.4)** — sum for the current calendar
     month via `get_partner_month_sales_cents(partner.id)`
     (migration 0038)
3. **Earnings chart (P12.4)** — 30-day bar chart of gross daily
   sales. Inline SVG, no chart library, zero client JS. Headline
   total in the card header.
4. **Recent activity (P12.4)** — last 10 events (sales, refunds,
   payouts) via `get_partner_recent_activity` RPC
   (migration 0038). Order-tied entries link to the order's sale
   surface; payout-only entries don't.
5. **Quick actions** — 4 cards: Upload a course, Manage
   courses, Settings, Payouts (each links to the relevant
   partner page).

The page is gated by `requirePartner()` from
`00-foundations/auth/guards`. Partners with `status = 'pending'`
are NOT redirected — they see the dashboard with the "under
review" banner. Partners with `status = 'suspended'` see the
suspended banner.

If the user is NOT a partner (no `partners` row exists), the
page redirects to `/partner/onboarding` to start the wizard.

## Data this page shows

| Section | Field | Source | Format |
|---|---|---|---|
| Header | `display_name` (greeting) | `profiles.display_name` | H1 |
| Status banner | `partners.status` | `partners` | conditional banner (pending = amber, suspended = red) |
| KPI | `count(products where partner_id = partners.id)` | `products` | integer + "Products" label |
| KPI | `count(products where status='published')` | `products` | integer + "Published" label |
| KPI | `count(products where status='pending_review')` | `products` | integer + "Pending review" label |
| KPI | sum of `payout_ledger.amount_cents where kind='order_sale' and partner_id = partners.id` | `payout_ledger` (via `get_partner_lifetime_sales_cents` RPC, migration 0029) | formatted USD |
| KPI (P12.4) | sum of `payout_ledger.amount_cents where kind='order_sale' and created_at >= month_start and partner_id = partners.id` | `payout_ledger` (via `get_partner_month_sales_cents` RPC, migration 0038) | formatted USD |
| Earnings chart (P12.4) | `array of (day, sales_cents, order_count)` for last 30 days | `payout_ledger` (via `get_partner_daily_sales_series` RPC, migration 0038) | inline SVG bar chart |
| Activity feed (P12.4) | `array of (event_at, event_kind, description, amount_cents, product_title, order_id)` last 10 events | `payout_ledger` ∪ `order_items` (via `get_partner_recent_activity` RPC, migration 0038, deduped on order_id + kind) | vertical timeline |
| Quick action | 4 hard-coded cards linking to /partner/{courses, instructor-upload, settings, payouts} | static | card grid |

## User actions

| Action | Trigger | Result | RBAC |
|---|---|---|---|
| Visit /partner | Authenticated partner | Render dashboard with status + KPIs + chart + feed | partner (any status) |
| Click "Upload a course" | Click quick-action card | Navigate to `/partner/instructor-upload` | partner |
| Click "Manage courses" | Click quick-action card | Navigate to `/partner/courses` (PH13b) | partner |
| Click "Payouts" | Click quick-action card | Navigate to `/partner/payouts` | partner |
| Click "Settings" | Click quick-action card | Navigate to `/partner/settings` | partner |
| Click an activity feed entry | Click an order-tied entry | Navigate to `/partner/payouts` (the existing P6.3 ledger page; P12.11's `/partner/sales` will replace this destination when that surface lands) | partner |
| Hover the chart's bar | Mouse hover on a bar | Browser-native SVG `<title>` tooltip shows `YYYY-MM-DD: $X.XX (N orders)` | partner |

## What this page does NOT do

- No "add new product" inline (the upload flow is a separate page)
- No full notification center (PH19 — observability; the activity
  feed is a lightweight *event* stream, not a settings-driven
  notification surface)
- No recent sales *list* (the feed shows the timeline; the
  paginated sales table is `/partner/sales` — P12.11)
- No payout request button (the cron handles payouts; partners
  see the ledger on `/partner/payouts`)
- No chart drill-down interactions (no zoom, no click-bar-day-
  detail). The v1 chart is read-only.

## Acceptance criteria

- [x] Page is partner-gated (auth + role check); non-partners
  redirect to `/partner/onboarding`
- [x] Pending partners see the amber "under review" banner
- [x] Suspended partners see the red "account suspended" banner
- [x] KPIs render with the actual counts from the DB (not mock
  data) — P6.1 (2026-06-26) wires the Lifetime sales KPI via
  `get_partner_lifetime_sales_cents(partner.id)` (migration 0029);
  the 3 product-count KPIs were already wired in PH13a; **P12.4
  (2026-06-29) wires the This month KPI via
  `get_partner_month_sales_cents(partner.id)` (migration 0038)**
- [x] Quick action cards navigate to the right routes
- [x] P12.4: Earnings chart renders 30 daily bars from
  `get_partner_daily_sales_series`; bars scale to the period max;
  empty series renders a friendly message, not a broken chart
- [x] P12.4: Activity feed renders up to 10 entries with icon +
  description + product title + amount + relative time; order-
  tied entries link to `/partner/sales?order=<id>`; empty feed
  shows "Your first sale will appear here."
- [x] P12.4: All 7 dashboard reads happen in parallel
  (Promise.all), keeping the page render under the 250ms p95
  budget
- [x] Page renders in < 250ms p95 (7 parallel reads — 3 product
  counts + 2 sales RPCs + activity + earnings series)
- [x] No PII in URLs, no `TODO` / `FIXME` in the diff

## Security

- **Auth required:** YES (partner role)
- **RLS:** `partners` row is read for the current user only
  (RLS policy `partners_self_read`); `products` count is
  computed via a count query on `partner_id = auth.uid()'s
  partner.id`; the P12.4 RPCs are SECURITY DEFINER +
  authorization-checked internally (`current_partner_id() =
  p_partner_id or is_admin()`)
- **PII displayed:** the partner's own `display_name` (already
  visible in the shell). No PII in URLs — activity entries
  expose only numeric order_id (internal bigint).
- **Audit logged:** N/A (read-only page)

## Performance

- **Target p95:** < 250ms (P12.4 added 2 more RPCs — total 7
  parallel reads under one Promise.all)
- **Render strategy:** RSC + 7-parallel fan-out (Promise.all at
  the page render + nested Promise.all inside
  getPartnerDashboardSummary)
- **Cache:** none (user-specific)
- **DB indexes used:**
  - `products (partner_id, status)` composite (existing)
  - `payout_ledger_partner_order_sale_idx` (migration 0029;
    supports lifetime + month sales SUMs)
  - `payout_ledger_partner_created_at_idx` (migration 0038;
    supports activity feed date-DESC sort)
  - `order_items_partner_product_idx` (existing; supports the
    activity feed's product_title sub-select)

## Out of scope for v1

- Recent sales list / paginated table (lives on
  `/partner/sales` — P12.11)
- Pending review queue (lives on
  `/partner/courses?status=pending_review`)
- Notification center / settings (PH19 — observability)
- Chart drill-down / click-bar-day-detail interaction (v2)
- Tier-segmented chart (the spec's whitelabel / plr / plr_mrr
  axis is deferred — the platform doesn't yet have a tier
  attribute on products)
- Per-product revenue aggregates on the dashboard itself (lives
  on the partner courses sales surface — P6.2)

## Implementation notes

- (filled by the building agent)
