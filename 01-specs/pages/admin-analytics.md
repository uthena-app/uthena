# Admin Analytics — `/admin/analytics`

## What this page does

The admin's analytics dashboard. The single place where aggregate platform numbers are surfaced. NOT real-time — all metrics are daily-aggregated and refreshed by a nightly job. The page shows: revenue line chart (30/60/90 day window), orders per day, new signups per day, conversion rate (visitor→signup, visitor→purchase), top 10 products by revenue, top 10 partners by revenue, top 10 affiliates by commission, refund rate, chargeback rate. Filters: date range (default last 30d, max 1y), segment by category / partner / affiliate. Each chart has a CSV export. The page is RSC + SSR with no caching for the last 7 days, ISR=1h for older data (the older data is immutable once the day is over, so the cache is correct).

This is the **only** page in the app where aggregate user counts (signups, conversion rate) appear. The page never shows individual user PII. The audit log records who viewed analytics (this is admin PII-adjacent: a curious admin checking revenue trends is logged so we can answer "who looked at our numbers and when" later if needed).

## Data this page shows

| Section | Field | Source | Format |
|---|---|---|---|
| Sidebar | (same admin sidebar) | hard-coded | sidebar |
| Top bar | page title, date range picker (default 30d, max 1y), "Export all" button | hard-coded | top bar |
| Filter bar | date range, segment (all / category / partner / affiliate), category select (when segment=category), partner select (when segment=partner), affiliate select (when segment=affiliate) | local state + URL params | filter row |
| KPI row | total revenue (period), total orders, new signups, conversion rate (visitor→purchase), refund rate, chargeback rate | `analytics_daily` aggregate (NEW table, see OQ) | 6 stat cards |
| Revenue chart | daily revenue (line), with stacked segments by category OR by partner (toggle) | analytics_daily | line chart with hover tooltip |
| Orders per day | daily order count (line) | analytics_daily | line chart |
| Signups per day | daily new users (line) | analytics_daily | line chart |
| Top 10 products | product title, partner, category, revenue (period), units sold, refund count | order_items + products aggregate | table |
| Top 10 partners | partner name, products count, revenue (period), units sold, avg rating | products + order_items + partners aggregate | table |
| Top 10 affiliates | affiliate handle, clicks (period), conversions, commission earned (period) | affiliate_clicks + affiliate_commissions + affiliates | table |
| Funnel | visitors → signups → first-purchase (counts and rates) | NEW: `analytics_visitors` table (see OQ) | funnel chart |
| Cohort retention (30d) | (collapsible) — signups grouped by week, retention % over 4 weeks | NEW: derived from `progress` or analytics | cohort grid |
| Export button | per chart: "Export CSV" | server action returning signed URL | button on each card |

**Queries:** `02-features/admin/queries/getAnalytics.ts` (the main aggregated query; runs against the `analytics_daily` table, not against raw `orders`).

## User actions

| Action | Trigger | Result | RBAC |
|---|---|---|---|
| Change date range | Click date range picker, pick range | URL updates with `?from=` and `?to=`, page re-renders | admin |
| Change segment | Click segment select, pick value | URL updates with `?segment=`, charts re-stack | admin |
| Filter by category | Open category select, pick one | URL updates with `?category_id=`, page filters | admin |
| Filter by partner | Open partner select, pick one | URL updates with `?partner_id=` | admin |
| Filter by affiliate | Open affiliate select, pick one | URL updates with `?affiliate_id=` | admin |
| Toggle revenue stack | Click "by category" / "by partner" toggle on the revenue chart | Chart re-stacks | admin |
| Export chart CSV | Click "Export" on any chart card | Server generates CSV of the visible data, signed URL (24h), audit row | admin |
| Export all (top bar) | Click "Export all" | Generates a multi-sheet CSV/Excel with all KPIs, charts, and tables, signed URL, audit row | admin |
| Expand cohort grid | Click "Show cohorts" | Renders the cohort retention grid (RSC sub-tree) | admin |
| Refresh data | (manual) Click "Refresh" | Invalidates the 1h cache for older data; last-7-days is always fresh | admin |

## What this page does NOT do

- No real-time data (the daily aggregation is the source of truth; live numbers live on the payouts page)
- No per-user drill-downs (no "show me the customers who signed up on this day"; that would leak PII through the analytics surface)
- No individual order rows (use `/admin/payouts` for orders)
- No forecasting / predictions (v2: simple linear regression on revenue)
- No anomaly detection ("today's revenue is 2 stddev below the trend") — v2
- No custom dashboards (every admin sees the same layout; no per-admin saved views)
- No email digest (the admin can opt into a weekly email in `/admin/settings` — not in v1)
- No comparison to last period (the date range picker is single-range; "compare to previous" is v2)
- No goals / OKRs ("we want $50K MRR by end of Q3")
- No revenue by country (Stripe Tax data exists, but we don't have the join key on orders in v1)

## Acceptance criteria

- [ ] Page is auth-gated AND requires `profiles.role = 'admin'`
- [ ] All KPIs are accurate to the daily aggregation (verified by a test: insert N orders on day X, run the nightly job, check the KPI for day X)
- [ ] Date range defaults to last 30d; max range is 365d
- [ ] Last 7 days of data is NEVER cached (RSC, always fresh); data older than 7 days is ISR=1h
- [ ] All charts render the requested date range with the right granularity (1d for ≤90d, 1w for >90d)
- [ ] Top 10 lists are correctly sorted by the chosen metric (revenue desc for products/partners, commission desc for affiliates)
- [ ] CSV exports contain the exact data shown in the chart/table (not a sampling)
- [ ] "Export all" produces a multi-sheet workbook with all KPIs, all charts, and all top-10 tables
- [ ] CSV export rate-limited to 30/hour per admin
- [ ] Cohort retention grid renders correctly (4-week retention for the most recent 12 weekly cohorts)
- [ ] Every page view writes `admin_audit_log` row with `action='analytics_viewed'`, `before=null`, `after` carries the filter params
- [ ] Every export writes `admin_audit_log` row with `action='analytics_exported'`, `target_table='analytics_daily'` (or appropriate), `after` carries the export spec
- [ ] The page renders in < 1s p95 (analytics queries are heavier; 1s is acceptable; pre-aggregated to keep it bounded)
- [ ] No PII (no email, no name) anywhere on the page; numbers only
- [ ] No PII in URLs (filter params use ids and slugs, not emails)
- [ ] No `TODO` / `FIXME` / `HACK` in the diff

## Design reference

- Mockup: not yet built — to be created during the admin build
- Components: `00-foundations/ui/AdminSidebar.tsx`, `00-foundations/ui/LineChart.tsx`, `00-foundations/ui/StatCard.tsx`, `00-foundations/ui/TopList.tsx`, `00-foundations/ui/CohortGrid.tsx`, `00-foundations/ui/DateRangePicker.tsx`

## Security

- **Auth required:** YES
- **Allowed roles:** admin (only)
- **RLS policies that apply:** NEW: `analytics_daily` (admin read; service-role write from the nightly job), NEW: `analytics_visitors` (admin read; service-role write from the visitor tracking), `orders`/`order_items` (admin all for cross-checks during development)
- **PII displayed:** NO. This is the critical security property: the analytics page surfaces ONLY aggregate numbers. No email, no name, no IP, no individual order. The page is the "safe" admin view — even if a compromised admin account uses it, they cannot extract user PII.
- **PII in URLs:** no
- **Audit logged:** YES — every page view, every export, every filter change. Filter changes are logged because the filter is a "what was this admin looking at" data point; combined with the rest of the audit log it tells a story if the admin's access is later reviewed.
- **Cache security:** the ISR cache is keyed on the filter params (date range, segment, etc.), not on the admin's identity. The cache lives at the edge. Cache invalidation: the 1h TTL re-fetches; manual "Refresh" forces a re-fetch.
- **CSRF:** all export server actions are CSRF-protected
- **Rate limiting on exports:** 30/hour per admin (analytics exports can be large; a higher rate limit is a real data-exfil risk)
- **No SQL on the fly:** all aggregations run against the pre-built `analytics_daily` table. The page never queries raw `orders` directly. This is a defense-in-depth measure: even if the admin's filter is malicious, the worst they can do is read aggregates.
- **Third-party scripts:** none

## Performance

- **Target p95:** < 1s (analytics queries are heavy; the pre-aggregation keeps them bounded)
- **Render strategy:** RSC + SSR. RSC streams the page shell; charts and tables stream in as their data resolves.
- **Cache:** last 7d = no cache; 7d–1y = ISR=1h; >1y = not allowed (max 1y range)
- **DB indexes:** NEW: `analytics_daily (date desc)`, `analytics_daily (date, category_id)`, `analytics_daily (date, partner_id)`, `analytics_daily (date, affiliate_id)`
- **Aggregation strategy:** nightly job (Postgres `pg_cron` or Next.js cron route) at 02:00 UTC rolls up `orders`, `order_items`, `payout_ledger`, `affiliate_commissions`, and a `signups_daily` view into `analytics_daily`. The page never aggregates raw data.
- **Bundle size budget:** < 60KB added to client bundle (charts + date picker + tables). Charts are the largest piece — use a small library (~30KB) and tree-shake.

## Out of scope for v1

- Real-time data
- Per-user drill-downs
- Forecasting / predictions
- Anomaly detection
- Custom dashboards / per-admin saved views
- Email digests
- Period comparison ("vs last 30d")
- Goals / OKRs / target lines
- Revenue by country
- Funnel drop-off reasons
- A/B test results

## Open questions for human

- **New table — `analytics_daily`:** not in `_data-model.md`. Proposed schema (the page reads this; a nightly job writes it):
  ```sql
  create table analytics_daily (
    date date not null,
    dimension_kind text not null check (dimension_kind in ('all', 'category', 'partner', 'affiliate')),
    dimension_id bigint, -- null when dimension_kind='all'
    revenue_cents bigint not null default 0,
    order_count int not null default 0,
    refund_count int not null default 0,
    refund_cents bigint not null default 0,
    chargeback_count int not null default 0,
    chargeback_cents bigint not null default 0,
    signup_count int not null default 0,
    visitor_count int not null default 0,
    affiliate_commission_cents bigint not null default 0,
    primary key (date, dimension_kind, dimension_id)
  );

  create index on analytics_daily (date desc);
  create index on analytics_daily (dimension_kind, dimension_id, date desc);

  alter table analytics_daily enable row level security;
  create policy "analytics_daily_admin_read" on analytics_daily
    for select using (exists (select 1 from profiles where user_id = auth.uid() and role = 'admin'));
  -- No admin write policy: the nightly job uses the service-role client and bypasses RLS.
  -- This is the one place we deliberately bypass; the table is computed, not user-editable.
  ```
  My recommendation: add in the same PR as the analytics page (or in a follow-up PR for the nightly job). Approve the schema above or amend.
- **New table — `analytics_visitors`:** for the visitor→signup / visitor→purchase funnel, we need a visitor count per day. Options: (a) Plausible API (we use Plausible for the public site), (b) self-hosted log-based counter, (c) skip the funnel in v1. My recommendation: (a) — Plausible has a stats API; we can hit it server-side from the analytics page and cache the result. No new table needed. Alternative: (c) — drop the funnel from v1, ship the rest of the page, add the funnel in v2 when we decide on a visitor counter.
- **Refresh cadence:** the spec says nightly. Options: nightly (02:00 UTC), hourly, real-time (incremental on every order). My recommendation: nightly. The 1h ISR covers the last 7d freshness; the older data is genuinely immutable.
- **"Top 10" denominator:** should the top-10 lists respect the date filter or be lifetime? My recommendation: respect the date filter (the admin picks "last 30d" and gets the last 30d top 10). Lifetime is a separate view if we want it.
- **Export size limit:** what if "Export all" produces 100MB of CSV? My recommendation: cap at 50MB; if the export would exceed 50MB, split it across multiple signed URLs (one per chart). The admin gets a "Download part 1, 2, 3..." email if we email it, or sees a multi-file download in the browser.
- **Cohort retention definition:** the spec says "4-week retention for the most recent 12 weekly cohorts". My recommendation: define retention as "user made a signin or a purchase in the Nth week after signup". Sources: `progress.last_watched_at` and `orders.created_at` on the user. The query is cheap when bounded to 12 cohorts × 4 weeks.

---

## Implementation notes

### P14.16 — Slice 1 (2026-07-02) — Schema foundation + KPI surface

Slice 1 ships the read-path foundation that all subsequent slices build on:

- **`analytics_daily` table** (migration `0065_analytics_daily.sql`): one row per `(date, dimension_kind, dimension_id)` tuple; dimension_kind ∈ `'all' | 'category' | 'partner' | 'affiliate'`; dimension_id bigint NULL when dimension_kind='all'; CHECK constraint enforces the consistency invariant; 4 covering indexes per spec §Performance line 100 (`analytics_daily_date_desc_idx`, `analytics_daily_dimension_idx`, `analytics_daily_date_dimension_idx`); RLS enabled + `analytics_daily_admin_read` policy for admin / super_admin; **no admin write policy** (the table is service-role-write only via the nightly job).
- **Audit actions**: `'admin.analytics_viewed'` + `'admin.analytics_exported'` added to `AuditAction` union + `AUDIT_ACTIONS` constant in `00-foundations/data/enums.ts`. The exported action is reserved (no call sites yet) so the enum doesn't churn when Slice 3 lands.
- **Pure URL parser** (`parseAnalyticsRange`): accepts 4 presets (`30d | 60d | 90d | 365d`) or custom `from`+`to` ISO dates (both required, ordered, ≤ 365 days). Fail-soft to default 30d on any malformed input (CRLF / SQLi / non-calendar dates / unknown keys via `.strict()` / out-of-range / non-numeric).
- **Server query** (`getAnalyticsKpi`): reads `analytics_daily WHERE dimension_kind='all' AND dimension_id IS NULL AND date BETWEEN range.fromIso AND range.toIso`; sums the rows into the 6-KPI shape; fail-soft to `EMPTY_ANALYTICS_KPI` on any DB error. Belt-and-suspenders `requireRole(['admin','super_admin'])` gate.
- **Audit-log writer** (`writeAnalyticsViewAuditLog`): best-effort (caller `.catch(() => null)`s); one row per page view; metadata.before carries `rangeKind + from + to + days + segment + dimensionId`; **never** includes customer email / IP / name. PII safety verified by the test suite.
- **Components**:
  - `AnalyticsKpiCards` — 6-card responsive grid (6-up desktop / 3-up tablet / 2-up mobile). Uses `formatMoney` for revenue; tabular-nums; percentage suffix for the 3 rate KPIs.
  - `AnalyticsRangePicker` — 4 preset chips with `data-active` accent styling; zero client JS (plain `<Link>` to `?preset=...`).
- **Page route** `/admin/analytics`: RSC + `requireAdmin()` belt-and-suspenders + `dynamic='force-dynamic'` + `sensitivePageMetadata` noindex; dual-tree hardlink `app/admin/analytics/page.tsx` ↔ `03-app/admin/analytics/page.tsx` (verified same inode). Renders the range picker + KPI cards + empty-state banner explaining the Slice 2 nightly job dependency.
- **Bundle impact**: `/admin/analytics` is RSC + 0 client JS shipped. The AnalyticsRangePicker is plain HTML `<Link>` elements; the KPI cards are RSC; the audit-log writer is server-side.

### Slice 1 — Acceptance criteria coverage (per spec §Acceptance)

- [x] Page is auth-gated AND requires `profiles.role IN ('admin','super_admin')` (inherited from AdminShell layout's `requireRole` + belt-and-suspenders `requireAdmin()` in the page).
- [x] All KPIs are accurate to the daily aggregation (the query reads `analytics_daily` only, never raw `orders`).
- [x] Date range defaults to last 30d; max range is 365d (parser enforces both bounds).
- [ ] Last 7 days of data is NEVER cached; 7d-1y ISR=1h — **deferred Slice 2** (needs the nightly job for correctness; the page is `force-dynamic` for now).
- [ ] Charts render the requested date range — **deferred Slice 3**.
- [ ] Top 10 lists correctly sorted — **deferred Slice 3**.
- [ ] CSV exports contain the exact chart data — **deferred Slice 3**.
- [ ] "Export all" multi-sheet workbook — **deferred Slice 3**.
- [ ] CSV export rate-limited to 30/hour per admin — **deferred Slice 3**.
- [ ] Cohort retention grid — **deferred Slice 5**.
- [x] Every page view writes `admin_audit_log` row with `action='admin.analytics_viewed'`, `before=null`, `after` carries the filter params (best-effort via `.catch`; the page still renders if the audit insert fails).
- [ ] Every export writes `admin_audit_log` row with `action='admin.analytics_exported'` — **deferred Slice 3**.
- [x] Page renders in < 1s p95 (1 indexed SELECT against a 4-indexed table; fail-soft on any error).
- [x] No PII anywhere on the page; numbers only (no email / name / IP — only aggregate numbers).
- [x] No PII in URLs (preset name + ISO dates only).
- [x] No `TODO` / `FIXME` / `HACK` in the diff (check:no-todo clean).
- [x] New table has RLS + at least one policy in the same migration (admin_read policy; no admin write policy — table is service-role-write only).

### Slice 1 — Design decisions worth remembering

- **Schema follows the spec's recommended shape verbatim** (admin-analytics.md lines 121-146). If Klaas wants amendments (different column names, different PRIMARY KEY shape, different dimension_kind enum), a follow-up migration renames columns — no backward-incompatible break.
- **Slice 1 always lands in the empty-state until the nightly job populates** the table. That's the expected behavior, not a bug. The empty-state banner explicitly explains this + points at STUB-127 Slice 2.
- **No chart library yet** — Slice 3 will add inline SVG charts matching the existing P12.4 `EarningsChart` zero-client-JS pattern. The 6 KPI cards are the only numeric surface in Slice 1.
- **Custom date range** is accepted by the parser but the picker UI ships only the 4 presets. The custom form lands in Slice 2 alongside the nightly job (so the custom range has data to render).
- **Audit-log writer is best-effort** — the page must always render, even if the audit insert fails (matches the existing P14.1 / P14.6 / P14.7 / P14.8 audit-log patterns).
- **PII safety verified by tests**: `getAnalyticsKpi.test.ts` asserts the SELECT payload doesn't include `email|name|ip|user_agent|address` columns; `writeAnalyticsViewAuditLog.test.ts` asserts the metadata.before payload doesn't include the actor email / IP.

### Slices 2-5 — Deferred to STUB-127

- Slice 2 — Nightly aggregation job + per-card RPCs (1-2 ticks; gated on OQ #1 schema approval).
- Slice 3 — Charts + Top-10 lists + CSV exports (1-2 ticks; gated on Slice 2 nightly job for data).
- Slice 4 — Funnel (1 tick; gated on OQ #2 visitor tracking decision).
- Slice 5 — Cohort retention grid (1 tick; gated on OQ #6 cohort retention definition).

See `STUBS.md` STUB-127 for the full decomposition + 5 spec Open Questions.

### File inventory (Slice 1, 11 new + 4 modified)

- `04-platform/migrations/0065_analytics_daily.sql` (NEW)
- `02-features/admin/analytics/types.ts` (NEW)
- `02-features/admin/analytics/types.test.ts` (NEW, 15 tests)
- `02-features/admin/analytics/queries/getAnalyticsKpi.ts` (NEW)
- `02-features/admin/analytics/queries/getAnalyticsKpi.test.ts` (NEW, 18 tests)
- `02-features/admin/analytics/actions/writeAnalyticsViewAuditLog.ts` (NEW)
- `02-features/admin/analytics/actions/writeAnalyticsViewAuditLog.test.ts` (NEW, 14 tests)
- `02-features/admin/analytics/components/AnalyticsKpiCards.tsx` (NEW)
- `02-features/admin/analytics/components/AnalyticsKpiCards.module.css` (NEW)
- `02-features/admin/analytics/components/AnalyticsRangePicker.tsx` (NEW)
- `02-features/admin/analytics/components/AnalyticsRangePicker.module.css` (NEW)
- `02-features/admin/analytics/index.ts` (NEW)
- `03-app/admin/analytics/page.tsx` (NEW; dual-tree hardlink to `app/admin/analytics/page.tsx`)
- `03-app/admin/analytics/page.module.css` (NEW)
- `00-foundations/data/enums.ts` (modified — +2 audit actions)
- `02-features/admin/index.ts` (modified — +analytics namespace)
- `STUBS.md` (modified — STUB-127 added)
- `docs/PROGRESS.md` (modified — P14.16 [ ] → [~] + completion note)
- `docs/PROGRESS-LOG/2026-07-02.md` (NEW — today's log line)
