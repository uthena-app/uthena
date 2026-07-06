# Admin Dashboard Home — `/admin`

## What this page does

The admin's landing page after sign-in. The at-a-glance health overview of the platform: 8 stat cards (pending reviews, today's orders, MRR, failed payouts, active partners, active affiliates, refund queue depth, suspicious-activity alerts), a 7-day orders/revenue sparkline, a "What needs your attention" panel (top 5 items pulled from across the admin areas), and a recent admin activity feed (last 20 `admin_audit_log` entries). Distinct from `/admin/review` (the submission queue) and `/admin/payouts` (the payout batches) — this is the read-only status board.

This page IS the default landing for any user with `profiles.role = 'admin'` after login. The login spec currently sends every authenticated user to `/library`; the login redirect logic must send admins to `/admin` instead. Flagged in Open Questions.

Server-rendered RSC. Data is real-time — no caching. Every page view is recorded in `admin_audit_log` with `action='view_dashboard'` so we can later see "the admin was here at this time" without an extra audit flow.

## Data this page shows

| Section | Field | Source | Format |
|---|---|---|---|
| Sidebar | same admin shell as `mockups/admin.html` — moderation: Review queue, Refunds, Reports, Categories; users: Partners, Affiliates, Customers; system: Analytics, Settings | hard-coded | sidebar |
| Top bar | page title, environment badge (`prod` / `staging`), current admin's display_name | hard-coded | top bar |
| Stats row | 8 stat cards: pending reviews, today's orders, MRR (USD), failed payouts, active partners, active affiliates, refund queue depth, suspicious-activity alerts | `getAdminDashboardStats()` (see Implementation notes) | 8 cards, 4-up grid on desktop |
| Sparkline | 7-day daily orders count + daily revenue, single line chart | `get7dOrdersRevenueSparkline()` in `02-features/admin/queries/` | small inline chart, no library — SVG |
| Attention panel | top 5 items, each with category badge, entity, "Open" button | `getAttentionItems(limit: 5)` | card list |
| Activity feed | last 20 entries: actor display_name, action verb, target table/id, at timestamp, IP | `getRecentAdminActivity(limit: 20)` over `admin_audit_log` | chronological list, newest first |

**MRR definition:** sum of `total_cents` for `orders` where `status='paid'` AND `created_at >= now() - interval '30 days'`, divided by 1 (i.e. trailing-30-day revenue, not strictly monthly-recurring — we are not a subscription product; "MRR" is a label the admin expects). Flag the definition in Open Questions.

## User actions

| Action | Trigger | Result | RBAC |
|---|---|---|---|
| Open an attention item | Click the "Open" button on an attention card | Navigate to the canonical page (e.g. `/admin/review`, `/admin/refunds`, `/admin/payouts`) | admin |
| Open a stat card | Click any of the 8 stat cards | Navigate to the underlying list page with the relevant filter applied (e.g. clicking "Pending reviews" goes to `/admin/review?status=submitted`) | admin |
| Open an activity entry | Click an activity log row | Navigate to the target entity's admin page (e.g. click an `approve_product` entry → `/admin/products/[id]`) | admin |
| Open the review queue from sidebar | Click sidebar "Review queue" | Navigate to `/admin/review` | admin |
| Open the refund queue from sidebar | Click sidebar "Refunds" | Navigate to `/admin/refunds` | admin |
| Sign out | Click user avatar in sidebar | Sign out, redirect to `/login` | admin |

## What this page does NOT do

- No "edit a stat" or override computed values (the stats are derived; if they are wrong, fix the underlying data, not the display)
- No real-time push (the page is RSC with a normal reload — we don't open a WebSocket to push "new order arrived"; admins who want live data use the underlying list pages)
- No "mark as read" on the activity feed (it's a feed, not an inbox)
- No "subscribe to digest" of the attention items (in-app + email digest is v2; flag)
- No per-admin customization of which stat cards appear (the 8 cards are fixed; v2: drag-to-reorder)
- No benchmarking vs prior period ("this week vs last week") — the trend is in the sparkline, the stats are point-in-time
- No "fake" or "demo" data path. If data is empty (zero orders today, zero failed payouts), the cards show `0`, not a placeholder

## Acceptance criteria

- [ ] Page is auth-gated AND requires `profiles.role = 'admin'` (loader throws `requireRole(['admin'])`)
- [ ] Customer/partner/affiliate access returns 403 (not 404 — this is a deliberate security signal, not "doesn't exist")
- [ ] The 8 stat cards render with the correct counts for: `partner_uploads` with `status='submitted'`, `orders` with `status='paid'` AND `created_at >= now() - interval '24 hours'`, trailing-30d paid order total, `payout_ledger` with `status='available'` AND `available_at <= now()` AND a failed PayPal payout indicator, `partners` with `status='approved'`, `affiliates` with `status='approved'`, `refunds` with `status='requested'`, and a suspicious-activity counter (see Open Questions)
- [ ] The sparkline renders 7 daily buckets with non-zero days highlighted; missing days show as a flat segment, not a gap
- [ ] The attention panel shows the top 5 items, each with: a category badge, a short label (e.g. "Refund R-12345 — 26h old"), and an "Open" button. Each item is one row, not collapsible
- [ ] The activity feed shows the last 20 `admin_audit_log` rows in `at desc` order, each with actor display_name, action verb in plain English (e.g. "Approved product", not `approve_product`), target short id, timestamp ("3m ago"), and IP address
- [ ] Every page view writes one row to `admin_audit_log` with `action='view_dashboard'`, `target_table=null`, `target_id=null`
- [ ] Page renders in < 600ms p95 (8 stat counts + sparkline + activity feed, all in parallel; no blocking serial queries)
- [ ] Empty state: a brand-new install with no orders, no payouts, no refunds renders with all stats as `0`, sparkline as a flat line at 0, and the activity feed showing only the dashboard's own view entry
- [ ] No PII in URLs, no `TODO` / `FIXME` in the diff

## Design reference

- Mockup: not yet built — to be created during the admin feature build
- Components: `00-foundations/ui/AdminSidebar.tsx`, `00-foundations/ui/StatCard.tsx`, `00-foundations/ui/Sparkline.tsx`, `00-foundations/ui/AttentionCard.tsx`, `00-foundations/ui/ActivityFeed.tsx`
- Tokens: `00-foundations/design/tokens.css`
- Theme: dark (default)

## Security

- **Auth required:** YES
- **Allowed roles:** admin (only)
- **RLS policies that apply:** `orders` (`orders_admin_all`), `partner_uploads` (`partner_uploads_admin_all`), `payout_ledger` (`payout_ledger_admin_all`), `refunds` (`refunds_admin_all`), `partners` (`partners_admin_all`), `affiliates` (`affiliates_admin_all`), `admin_audit_log` (`admin_audit_log_admin_read`)
- **PII displayed:** YES — by design. Admin views show the admin's display_name + email, plus the actor display_names in the activity feed. All admin views are audit-logged, so the "who saw what when" is recorded
- **PII in URLs:** NO — all navigation uses `bigint` ids, never emails
- **Audit logged:** YES — every page view writes one row to `admin_audit_log` with `action='view_dashboard'`. Every stat-card click writes `action='view_dashboard_section', target_table=<section>'`. Every activity-feed click writes `action='view_audit_target', target_table=<table>, target_id=<id>`
- **Rate limiting on the page itself:** none (read-only). Mutations from the dashboard (e.g. clicking through to a refund and approving) are rate-limited at the destination action
- **CSRF:** page is read-only RSC; no server actions on this page
- **Suspicious-activity definition:** see Open Questions. The v1 default is `orders where status='fraudulent' OR (created_at >= now() - interval '24 hours' AND customer has >= 3 orders in 24h)`
- **Third-party scripts:** none

## Performance

- **Target p95:** < 600ms (the dashboard runs 3 parallel queries: stats, sparkline, activity — plus the attention panel; all in one RSC pass)
- **Render strategy:** RSC + SSR, no caching
- **Cache:** NONE — the data is real-time; every navigation re-queries. CDN-caching is wrong here (admins expect live counts)
- **DB indexes used:** `orders (status, created_at desc)`, `partner_uploads (status) where status='submitted'`, `payout_ledger (status, available_at) where status='available'`, `refunds (status, requested_at)`, `admin_audit_log (at desc)`, `partners (status) where status='approved'`, `affiliates (status) where status='approved'`
- **Bundle size budget:** < 30KB added to client bundle (the sparkline is inline SVG; no chart library)
- **Parallel queries:** the 3 main queries run in parallel via `Promise.all` in the RSC loader; the attention panel runs in parallel with the others

## Out of scope for v1

- Customizable stat cards (drag-to-reorder)
- "This week vs last week" benchmarking
- Real-time WebSocket push of stat changes
- "Mark activity as read" / activity filtering
- Email digest of the attention items
- Per-admin dashboard preferences (which cards, what order)
- Mobile-optimized admin (admins use desktop; the sidebar collapses but the stat grid is desktop-first)
- Multi-currency display (USD only)

## Open questions for human

- **Login redirect for admins:** the existing `01-specs/pages/login.md` says the post-login default is `/library`. Admin users should land on `/admin` instead. My recommendation: update the login spec to check `profiles.role` and redirect: `admin` → `/admin`, everyone else → `/library`. The `?next=` param still wins when present. Confirm this is the right place to handle it (alternatively: middleware, or a `/post-login` route that does the dispatch).
- **MRR definition for a non-subscription product:** strictly speaking, "MRR" is monthly-recurring revenue and we don't have subscriptions. My recommendation: label it "Last 30d revenue" in the UI to be honest, but call the data field `mrr_cents` in the API for compatibility with the admin's mental model. Or: rename to "30d revenue" in both UI and data. Lean toward the rename.
- **Suspicious-activity counter definition:** the brief says "suspicious-activity alerts" but the data model has no `risk_score` or `fraud_signals` table today. My recommendation: ship v1 with a simple definition (`count of orders.status='fraudulent' in last 24h` + `count of orders with 3+ same-customer orders in 24h`); flag the proper fraud-score system in `_followups.md` as v2.
- **Attention panel sort:** oldest-first (FIFO) or by severity (fraudulent > failed payouts > overdue refunds > overdue reviews)? My recommendation: severity-ordered, then oldest as tiebreaker. The admin who logs in wants to see the most urgent thing first.

---

## Implementation notes

- `getAdminDashboardStats(): Promise<{ pending_reviews: number, todays_orders: number, mrr_cents: bigint, failed_payouts: number, active_partners: number, active_affiliates: number, refund_queue_depth: number, suspicious_activity: number }>` — single Postgres function (or 8 small `count(*)` queries) in `02-features/admin/queries/getAdminDashboardStats.ts`
- `get7dOrdersRevenueSparkline(): Promise<Array<{ day: Date, orders: number, revenue_cents: bigint }>>` in `02-features/admin/queries/get7dOrdersRevenueSparkline.ts` — one `date_trunc('day', created_at)` over the last 7 days
- `getAttentionItems(limit: 5): Promise<Array<{ kind: 'overdue_review' | 'refund_overdue' | 'failed_payout' | 'partner_application_old' | 'affiliate_application_old', label: string, href: string }>>` in `02-features/admin/queries/getAttentionItems.ts`
- `getRecentAdminActivity(limit: 20): Promise<Array<{ id: bigint, actor_display_name: string, action: string, target_table: string | null, target_id: string | null, at: Date, ip: string | null }>>` joins `admin_audit_log` with `profiles` (for actor display_name)
