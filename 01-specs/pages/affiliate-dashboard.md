# Affiliate Dashboard — `/affiliate`

## What this page does

The affiliate portal home. Shows the affiliate's earnings, top-performing products, commission history, and the tools they have for promoting (email swipes, banners, landing page builder). This is the daily check-in page for serious affiliates.

The most important element is the affiliate link itself — pinned at the top, easy to copy, with a "Generate QR code" CTA and a UTM builder. Everything else on the page supports the goal of "more clicks → more conversions → more commissions."

Migration requirement: the current public affiliate root `affiliate.uthena.com/` must land approved affiliates on this dashboard and non-affiliates on the onboarding flow after DNS cutover.

## Data this page shows

| Section | Field | Source | Format |
|---|---|---|---|
| Header | `display_name`, `affiliate.handle`, `affiliate.status` | profiles + affiliates | greeting + status badge |
| Onboarding banner | (only if affiliate.status != 'approved' OR payout method not set) | derived | callout |
| Aff link hero | `affiliate_links[0].code`, full URL with `?ref=`, expiry info, click count, conversion count | affiliate_links | prominent card with copy button |
| UTM builder | `utm_source`, `utm_medium`, `utm_campaign` inputs → generates a tagged URL | local state | inline form |
| Stats (4) | `this_month_earnings`, `total_earned`, `clicks_30d`, `conversion_rate` | orders + affiliate_clicks aggregate | 4 stat cards |
| Top products | `product.title`, `product.thumbnail_url`, `product.price_cents`, `affiliate_commissions.sales_count`, `affiliate_commissions.earned_cents`, `EPC` (earnings per click) | affiliate_commissions joined with products | list with EPC bars |
| Recent commissions | `created_at`, `product.title`, `order_id`, `sale_cents`, `commission_cents`, `status` (pending/locked/available/paid/reversed) | affiliate_commissions | table |
| Tools | grid of 6 tool cards: Email swipes, Banners & ads, Landing page builder, Compliance check, Audience insights, Real-time alerts | hard-coded | grid |
| Resources | affiliate playbook (PDF), private community (Discord), video walkthrough | hard-coded | list |

**Queries:** `02-features/affiliate-portal/queries/getDashboard.ts`.

## User actions

| Action | Trigger | Result | RBAC |
|---|---|---|---|
| Copy affiliate link | Click "Copy" on the link card | Copies to clipboard, toast confirms | affiliate |
| Open legacy affiliate root | Visit `affiliate.uthena.com/` | Redirect to `/affiliate` for approved affiliates; redirect to `/affiliate/onboarding` or signup for others | public URL, affiliate dashboard requires auth |
| Generate QR code | Click "Generate QR" | Shows a QR code modal, downloadable as PNG | affiliate |
| Use UTM builder | Fill in UTM fields, click "Generate URL" | Generates a tagged URL, copies to clipboard | affiliate |
| View all links | Click "All my links (12)" | Navigates to `/affiliate/links` | affiliate |
| View mini-shop | Click "View my mini-shop" in topbar | Navigates to `/[handle]` | affiliate |
| Add product to shop | Click "Add to my shop" on a top product | Adds the product to the affiliate's curated list | affiliate |
| Promote a product | Click "Promote" on a top product | Shows a modal with copy-paste email swipes, banner URLs, UTM suggestions | affiliate |
| Export commissions CSV | Click "Export" on recent commissions | Generates a CSV, signed URL, logged | affiliate |
| Update payout method | Click "Update payout method" | Navigates to `/affiliate/settings/payout` | affiliate |
| Generate a new affiliate link | (not in v1 — only one default link per affiliate; v2 supports per-product links) | — | — |
| Open the compliance tool | Click "Compliance check" | Navigates to `/affiliate/tools/compliance` (v2; not in v1) | — |

## What this page does NOT do

- No real-time click tracking visualization (5-minute refresh; live updates in v2)
- No A/B test of link placement (v2)
- No "top affiliate leaderboard" (out of scope; competitive pressure is anti-team)
- No email marketing automation (v2)
- No "smart link rotation" (v2)
- No "predictive earnings" (v2)
- No co-branded landing page builder UI (v1: a generic builder, not a per-affiliate builder)

## Acceptance criteria

- [ ] Page is auth-gated AND requires `profiles.role IN ('affiliate')`
- [ ] `affiliate.uthena.com/` routes to this dashboard for approved affiliates after DNS cutover; non-affiliates are routed to onboarding
- [ ] Only the affiliate's own data is shown (RLS enforced)
- [ ] Affiliate link is correct: `uthena.com/?ref=[handle]`
- [ ] "Copy" button works on all browsers (clipboard API with fallback)
- [ ] "Generate QR" produces a real, scannable QR code
- [ ] UTM builder generates valid URLs (parameters are URL-encoded)
- [ ] Top products list shows EPC correctly (EPC = total_earned / total_clicks, for those products)
- [ ] Top products are sorted by EPC desc by default
- [ ] Stats are accurate (verified by a test: insert N clicks + N conversions, check the stats)
- [ ] "Add to my shop" toggles a flag on the affiliate's curated list
- [ ] Recent commissions table is paginated (default 20 rows)
- [ ] CSV export includes all filtered rows
- [ ] CSV export is rate-limited (10/hour per affiliate)
- [ ] Page renders in < 500ms p95
- [ ] No layout shift on data load
- [ ] No PII leak in URLs (use handle, not email or name)
- [ ] No `TODO` / `FIXME` in the diff

## Design reference

- Mockup: `mockups/affiliate.html`
- Components: `00-foundations/ui/StatCard.tsx`, `00-foundations/ui/CommissionTable.tsx`, `00-foundations/ui/EpcRow.tsx`, `00-foundations/ui/QrModal.tsx`

## Security

- **Auth required:** YES
- **Allowed roles:** affiliate (any status, but onboarding banner shows for non-approved)
- **RLS policies that apply:** `affiliates` (self only), `affiliate_links`/`affiliate_clicks`/`affiliate_commissions`/`affiliate_payouts` (self only)
- **PII displayed:** no (the affiliate sees their own data)
- **PII in URLs:** no — only the handle (publicly known) and the affiliate's own IDs
- **Audit logged:** yes — every page view, every CSV export, every QR generation
- **CSV export rate limiting:** 10/hour per affiliate
- **PayPal email (payout method):** encrypted at app layer, never returned in plaintext
- **Cookie tracking:** the affiliate's `?ref=` is captured in a first-party cookie, 30-day TTL. See `02-features/affiliate-portal/actions/trackClick.ts`.
- **Click fraud detection:** clicks are logged with IP hash + UA hash. Patterns (e.g. > 100 clicks from same IP in 1h) are flagged for review.
- **Third-party scripts:** none

## Performance

- **Target p95:** < 500ms
- **Render strategy:** RSC + SSR
- **Cache:** none (affiliate-specific)
- **DB indexes:** `affiliate_links (affiliate_id)`, `affiliate_clicks (link_id, at desc)`, `affiliate_commissions (affiliate_id, status, created_at desc)`
- **Bundle size budget:** < 30KB added to client bundle (table, copy buttons, UTM builder)

## Out of scope for v1

- Real-time click tracking
- A/B test of link placement
- Top affiliate leaderboard
- Email marketing automation
- Smart link rotation
- Predictive earnings
- Per-product affiliate links (one default link per affiliate only)
- Compliance check tool (admin enforces; v2)
- Discord community integration (manually managed in v1)

## Open questions for human

- **EPC definition:** earnings per click (total earned / total clicks) for a product? Or for a specific affiliate-product pair? My recommendation: per affiliate-product pair. More actionable.
- **Top products list sort:** EPC desc (most profitable per click) or sales count desc (most popular)? My recommendation: EPC desc by default, with a sort toggle.
- **Handle availability:** do we reserve handles on signup, or generate them automatically? My recommendation: generate automatically (e.g. `marcus-reyes-media` from display name), allow the affiliate to change it once after approval. Lock the handle after that.
- **Multi-affiliate attribution:** if a buyer clicks affiliate A's link, then affiliate B's link, who gets the commission? My recommendation: last-click attribution (affiliate B). First-click is more "fair" but harder to explain. Last-click is industry standard.

---

## Implementation notes

### P13.4 — Performance chart (2026-06-30, shipped)

Slice 1 ships the time-series chart on the `/affiliate` dashboard. Renders
clicks + conversions + revenue over the last 30 days. Pure RSC + inline SVG,
zero client JS, zero chart library.

**Migration** — `04-platform/migrations/0047_affiliate_daily_performance.sql`
ships one SECURITY DEFINER RPC: `get_affiliate_daily_performance(p_affiliate_id,
p_days_back int default 30)` returning one row per day with three series
(clicks_count / conversions_count / revenue_cents). `p_days_back` is hard-
clamped to `[7, 365]` to defend against pathological input. The RPC always
returns exactly N rows (zero-filled via `generate_series` + LEFT JOIN) so the
chart's X axis is guaranteed to render at any data sparsity. The "reversed"
status filter on `affiliate_commissions` matches the dashboard KPI
denominator, so the chart and the KPI cards agree. STABLE + `set search_path
= ''` + `REVOKE from PUBLIC` + `GRANT to authenticated` (matches the P6.1 +
P12.4 RPC patterns). No new tables, no new RLS, no new columns — reuses the
four tables + their indexes from migration 0046.

**Query** — `02-features/affiliate-portal/queries/getAffiliateDailyPerformance.ts`
wraps the RPC. Two sequential reads (affiliate row + RPC), fail-soft to `[]`
on any read error or anon. Log payloads use the FNV-1a hashed affiliate_id
(matches the pattern in `getAffiliateDashboard.ts` and
`getPartnerDashboardExtras.ts`). 15 unit tests cover: anon gating, non-
affiliate gating, RPC-error fail-soft + hashed logging, happy-path mapping
with bigint-as-string defensive coercion, day-string coercion (accepts bare
`YYYY-MM-DD` and full ISO-prefix variants; rejects malformed strings to `''`),
negative-value clamping, non-array payload fallback, default + custom
`daysBack` forwarding. PII safety asserted on every log payload.

**Component** — `02-features/affiliate-portal/components/PerformanceChart.tsx`
+ `.module.css`. Inline SVG, RSC, zero client JS. Three headline tiles
(Clicks / Conversions / Revenue) sum the series, plus a 30-day bar chart of
revenue + click-dot markers + conversion-square markers overlaid. X axis
labels first/mid/last day. Empty state ("No clicks or conversions in the
last N days.") renders when the entire series is zero. Legend (3 chips) is
present visually + read by screen readers via `aria-label="Chart legend"` +
the legend item labels. Token-only CSS via `--teal` (revenue bars + headline
eyebrow), `--success` (click dots), `--warn` (conversion squares),
`--bg-elev-1/2` + `--line` (card chrome). 12 unit tests via
`renderToStaticMarkup` cover: headline aggregations, conversion rate
calculation, "—" placeholder when clicks=0, title/subtitle, empty-state
copy, SVG presence + viewBox, axis label count, legend attributes + absence
in empty state, null-series fallback, defensive narrowing.

**Wired** — `/affiliate` page reads `getAffiliateDashboard` +
`getAffiliateDailyPerformance({daysBack: 30})` in `Promise.all` (no extra
round-trip). Chart renders between the KPI grid and the "next slices"
upcoming list. Single entry in the `index.ts` barrel for the query,
component, and `AffiliateDailyPerformancePoint` type.

**Decisions worth remembering**

- **Bar chart + markers, not 3 separate line charts.** A 3-line chart at
  30 data points is unreadable at the dashboard's chart width (720px). The
  bar (revenue) is the primary metric; click + conversion markers overlay
  their respective scales so the full picture is visible at a glance
  without a double-Y-axis.
- **`revenue_cents` denominator == KPI card denominator** — both filter
  out `status='reversed'` commissions. The dashboard's numbers must
  agree: if a commission is reversed, the chart's revenue + the KPI card's
  "Lifetime earned" + "This month" all exclude it. The same filter lives in
  `get_affiliate_summary` and `get_affiliate_daily_performance` so the
  SQL stays consistent.
- **Total clicks / conversions / revenue on the headline tiles**, not on
  each bar — the page has `formatMoney` for the money number and locale
  formatting for the integer counts; per-bar `<title>` tooltips (via the
  native SVG `<title>` element) still give the full per-day breakdown on
  hover.
- **`STABLE` + auth-gated RPC, not a regular view.** A view would have to
  rely on RLS for auth scoping, which loses the per-affiliate identity
  check (current_affiliate_id() can be checked inside the RPC). SECURITY
  DEFINER is the right shape for "compute a derived read for the calling
  user."
- **`generate_series` + LEFT JOIN, not `ORDER BY day` + group** — the
  latter would drop empty days, breaking the X axis. `generate_series` is
  the canonical Postgres pattern for "fill a date window."
