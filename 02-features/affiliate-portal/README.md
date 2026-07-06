# Feature: affiliate-portal

Everything an affiliate does: onboarding, dashboard, links, mini-shop
(`/[handle]`), payouts, settings.

- **Specs:** `01-specs/pages/affiliate-onboarding.md` (+ welcome/thanks),
  `affiliate-dashboard.md`, `affiliate-links.md`, `affiliate-minishop.md`,
  `affiliate-shop.md`, `affiliate-settings.md`, `affiliate-settings-payout.md`
- **Owner:** unassigned — claimed by the implementing agent at build start
- **Depends on:** `auth`, `catalog` (via `index.ts`), `00-foundations/money`,
  `00-foundations/data`, `affiliate-onboarding` (P13.1 Slice 1 ships the
  `affiliate_onboarding_drafts` + `handle_reservations` tables + the wizard
  the dashboard eventually links from)
- **Depended on by:** `admin` (affiliate review/approval)

## Status

- [x] **P1.7 — Shell (placeholder)** — `AffiliateShell` + `AffiliateSidebarActive`
      + the `/affiliate` route that renders the placeholder dashboard. The
      role-aware nav link in `/account` now resolves correctly for
      affiliate-role users (no more 404). No data reads yet; the full
      dashboard lands in **P13.3**.
- [x] **P13.1 — Affiliate onboarding wizard (Slice 1)** — wizard route
      shell + 4-state dispatch + handle reservation race-safety + per-step
      schema + audit log. See `02-features/affiliate-onboarding/README.md`
      for the full Slice 1 surface + Slices 2+ deferrals. Per-step forms
      for Payout / Promo methods / Agreement / Submit ship in Slice 2+.
- [ ] P13.2 — Welcome + thanks pages
- [ ] P13.3 — Affiliate shell + dashboard (full version)
- [x] P13.4 — Performance chart
- [~] **P13.5 — Link generator (Slice 1)** — schema foundation (migration
      `0048_affiliate_links_columns.sql`: `disabled_at` + `deleted_at` +
      `utm_source` + `utm_medium` + `utm_campaign` + partial index +
      `get_my_affiliate_link_metrics()` SECURITY DEFINER RPC) +
      `getMyAffiliateLinks` query (RLS-scoped, fail-soft, FNV-1a
      hashed PII-safe logs) + `DefaultLinkHero` + `AllLinksTable` +
      `LinksStatsRow` + `CopyLinkButton` (clipboard API + execCommand
      fallback + success toast) + `RefreshDefaultLinkButton` (empty
      state when no link row yet, calls `ensureDefaultLinkAction`) +
      `/affiliate/links` route + loading + error + not-found surfaces
      + `ensureDefaultLinkAction` server action (5/min/user rate limit)
      + `AffiliateShell` NAV entry. Slice boundary: Slices 2+ (disable /
      enable / soft-delete actions + QR modal + CSV export + UTM
      builder) deferred to STUB-110. **Status filter (originally
      classified as Slice 3) shipped via the P13.6 link-list view
      surface** — see below.
- [x] P13.6 — Link list
- [x] **P13.7 — Link analytics deep** — new migration
      `0049_affiliate_link_analytics.sql` ships THREE SECURITY DEFINER
      RPCs (`get_affiliate_link_hourly_clicks` / `_geo_breakdown` /
      `_device_breakdown` — all hard-clamped + STABLE + auth-gated +
      zero-filled via generate_series+LEFT JOIN where applicable) +
      new query module `getAffiliateLinkAnalytics.ts` (3 RPC wrappers
      with bigint/numeric/ISO coercion + FNV-1a-hashed PII-safe warn
      logs + fail-soft on anon/non-affiliate/RPC error) +
      `<LinkAnalyticsPanel>` orchestrator (RSC) +
      `<HourlyClicksChart>` (inline SVG, peak-bucket `--accent`) +
      `<GeoBreakdownList>` (top 10 + "Other" overflow bucket + ISO→
      human country name lookup) +
      `<DeviceBreakdownList>` (glyphs M/D/T/B + Unknown bucket) +
      wired into `/affiliate/links` between `<DefaultLinkHero>` and
      `<AllLinksTable>`. **v1 caveat:** the `country` + `device_class`
      columns are populated by `/api/affiliate/click` (STUB-105 Slice
      7 — not yet built); the hourly chart works today, the geo +
      device breakdowns show 100% "Unknown" with a help caption until
      the click-track route ships. 70 new tests (21 query + 15 chart +
      16 geo + 17 device); `/affiliate/links` is `452 B / 117 kB`
      first-load JS (+18 B).
- [ ] P13.8 — Public mini-shop `/[handle]`
- [ ] P13.9 — Custom landing pages `/[handle]/[slug]`
- [ ] P13.10 — Promotional assets
- [ ] P13.11 — Settings: profile + payout + API tokens
- [ ] P13.12 — Affiliate email notifications

## What's deferred

- All affiliate dashboard features ship in P13.x. The P1.7 shell is
  the chrome (sidebar + content area + auth gate); the placeholder
  page body is the only content until P13.3 lands.

## Test locally

- `pnpm test 02-features/affiliate-portal` — placeholder shell tests
  + role-gate tests
- Manual: sign in as an affiliate-role user, navigate to `/affiliate`
  → should land on the placeholder dashboard. Sign in as a customer →
  navigate to `/affiliate` → should land on `/403`.

## Open follow-ups

None.