# Affiliate Links — `/affiliate/links`

## What this page does

The affiliate's link management page. Lists every affiliate link the affiliate has minted, with performance metrics (clicks, conversions, conversion_rate) and per-row actions (copy URL, copy as QR, disable, delete). v1 supports **one default global link per affiliate** (per `affiliate-dashboard.md`: "Generate a new affiliate link" is not in v1) — the page renders that one link as a prominent card, plus an "All links" table that's mostly a placeholder for v2. The "Create link" button at the top is rendered **disabled with a "Coming in v2" tooltip** in v1. The v1 schema must already support per-product links so the v2 build is just a UI change, not a migration. The shape of v1 (1 link) and v2 (N links) is described here so the data model and component API are forward-compatible.

The page is gated to `profiles.role = 'affiliate'`. Anon visitors redirect to `/login?next=/affiliate/links`; non-affiliates redirect to `/library`.

## Data this page shows

| Section | Field | Source | Format |
|---|---|---|---|
| Header | page title, "Create link" button (disabled, tooltip "Coming in v2") | hard-coded | top bar |
| Stats row | total links, total clicks (30d), total conversions (30d), avg conversion_rate | aggregates | 4 stat cards |
| Featured link (v1) | the one default link: `code`, full URL `uthena.com/?ref=[code]`, `target_path`, clicks_count, conversions_count, conversion_rate, `created_at`, `last_clicked_at` | affiliate_links (the row with `product_id is null` for the affiliate) | large card with copy/QR/disable actions |
| All links table | rows of all `affiliate_links` for the affiliate, with columns: code, target_path (clickable → `/[handle]`, `/products/[slug]`, or `/browse`), UTM parameters, clicks, conversions, conversion_rate, status (active/disabled), created_at, last_clicked_at, actions (copy URL, copy as QR, disable, delete) | affiliate_links | table, paginated 20 rows |
| Filter | by `status` (active / disabled / all) | (client-side filter, no round trip) | select |
| Export | "Export CSV" button | (server action) | button, rate-limited 10/hr |

**Server actions** in `02-features/affiliate-portal/actions/links.ts`:
- `getMyLinks()` — RSC. Reads all `affiliate_links` rows for the affiliate (in v1 that's exactly 1 row), aggregates 30d clicks + conversions.
- `getLinkMetrics(linkId)` — read-only fetch of clicks + conversions + conversion_rate for one link. Used by the "Detail" modal in v2; not surfaced as a separate route in v1 (the data is on the card).
- `disableLink(linkId)` / `enableLink(linkId)` — flips a `disabled_at` timestamp on the row. A disabled link still resolves (302 to the target_path) but the `?ref=` cookie is NOT set, so no commission is attributed. The action is rate-limited 30/min/user (defense against click-disabling griefing).
- `deleteLink(linkId)` — soft-delete in v1 (sets `deleted_at`). Hard-delete in v2 after the click/conversion history is anonymized per the data-retention rule. Rate-limited 10/hr/user.
- `exportLinksCsv()` — generates a CSV of all the affiliate's links + 30d metrics, writes to Bunny Storage, returns a 24h signed URL. Rate-limited 10/hr/user. Audit row `links_csv_exported`.

**Schema additions** (flagged in Open Questions; need a migration if the v1 table needs new columns):
- v1's `affiliate_links` table already supports per-product links (`product_id bigint references products(id)` is nullable for the global case) — no schema change required for the data model itself.
- v1 needs: `disabled_at timestamptz`, `deleted_at timestamptz` columns (for the disable / soft-delete actions). The current schema in `_data-model.md` does not include these. Flag in OQ.

## User actions

| Action | Trigger | Result | RBAC |
|---|---|---|---|
| Open the page | Direct nav to `/affiliate/links` | Render the one default link + the (mostly empty) table | affiliate (self) |
| Filter by status | Open the status select, pick | Table re-filters client-side | affiliate (self) |
| Copy URL | Click "Copy" on a link row | Copies the full URL to clipboard, toast confirms | affiliate (self) |
| Copy as QR | Click "Copy as QR" | Opens QR modal (reuses the QrModal from affiliate-dashboard.md), shows a scannable QR for the URL, downloadable as PNG | affiliate (self) |
| Disable a link | Click "Disable" on a link row | Confirmation inline, server action, row badge flips to "Disabled", audit row | affiliate (self) |
| Enable a disabled link | Click "Enable" on a disabled row | Confirmation inline, server action, row badge flips to "Active", audit row | affiliate (self) |
| Delete a link | Click "Delete" on a link row | Confirmation modal ("This will soft-delete the link. Historical clicks + conversions are preserved for reporting."), server action, row disappears (filtered out by default), audit row | affiliate (self) |
| Export CSV | Click "Export CSV" | Server action returns a 24h signed URL, audit row, rate-limited 10/hr | affiliate (self) |
| Click target_path on a row | Click a target_path link | Navigates to `/[handle]` (global shop link), `/products/[slug]` (per-product link), or `/browse` (catalog link), in a new tab | affiliate (self) |
| Try to create a link | Click the disabled "Create link" button | Tooltip: "Per-product links are coming in v2. Your global link above is the only link in v1." | affiliate (self) |

## What this page does NOT do

- No "Create link" flow in v1 (the button is rendered disabled with the v2 tooltip)
- No A/B testing of link placement
- No smart link rotation
- No link cloaker / domain masking
- No "deep link" generator (UTM builder is on the dashboard, not here)
- No scheduled disable / enable ("disable this link for 7 days")
- No bulk actions (no "select all + delete" — too easy to nuke your own links)
- No real-time click counter (5-minute refresh, same as dashboard)
- No QR code analytics (a QR is a copy artifact; clicks from a QR-scanned URL are tracked identically to a typed URL)

## Acceptance criteria

- [ ] Page is auth-gated AND requires `profiles.role = 'affiliate'`; anon visitors redirect to `/login?next=/affiliate/links`; non-affiliates redirect to `/library`
- [ ] In v1, exactly **one** `affiliate_links` row exists for the affiliate (the default global link with `product_id is null`); if the row doesn't exist (e.g. legacy data), the page shows the empty state "Your default link is being generated" with a "Refresh" button (server action `ensureDefaultLink()` creates it idempotently)
- [ ] The default link card shows: full URL `uthena.com/?ref=[code]`, `target_path` (typically `/[handle]`), `clicks_count`, `conversions_count`, `conversion_rate` (clicks > 0 only — `null` if no clicks), `created_at`, `last_clicked_at` (or "—" if never clicked)
- [ ] The "Create link" button is rendered disabled with a `Coming in v2` tooltip; clicking it does not navigate
- [ ] The "All links" table renders the one default link in v1; columns are exactly: code, target_path, utm_source / utm_medium / utm_campaign, clicks, conversions, conversion_rate, status, created_at, last_clicked_at, actions
- [ ] Status filter (active / disabled / all) re-filters the table client-side without a server round trip
- [ ] "Copy URL" works on all browsers (clipboard API with fallback) and shows a success toast
- [ ] "Copy as QR" opens a QR modal with a real, scannable QR code; the modal has a "Download PNG" button
- [ ] "Disable" flips the link to disabled state (sets `disabled_at`); a disabled link still resolves on click but the `?ref=` cookie is NOT set and no commission is attributed (verified by a test: click a disabled link, observe no `affiliate_clicks` row inserted)
- [ ] "Delete" is a soft-delete (sets `deleted_at`); deleted links are filtered out of the table by default; historical clicks + conversions are preserved on `affiliate_clicks` and `affiliate_commissions` (the data is on the click/commission rows, not the link row)
- [ ] CSV export includes: code, target_path, utm_*, clicks_30d, conversions_30d, conversion_rate_30d, status, created_at, last_clicked_at, deleted_at (null for non-deleted). Rate-limited to 10/hr/user; every export writes an `links_csv_exported` row to `admin_audit_log` with the export row count
- [ ] The page renders in < 350ms p95 (RSC, one indexed read on `affiliate_links`, one aggregate on `affiliate_clicks`)
- [ ] All actions are keyboard-navigable with `--border-3` focus rings; mobile responsive at 360px, 768px, 1280px; no PII in URLs, no `TODO` / `FIXME` / `HACK` in the diff, no console errors

## Design reference

- Mockup: not yet built — to be created during the affiliate portal build (`mockups/affiliate-links.html`)
- Design tokens: `00-foundations/design/tokens.css`
- Theme: both
- Components: `00-foundations/ui/LinkCard.tsx` (default link hero), `00-foundations/ui/LinkTable.tsx`, `00-foundations/ui/QrModal.tsx` (reused from `affiliate-dashboard.md`), `00-foundations/ui/StatusBadge.tsx`, `00-foundations/ui/StatCard.tsx`

## Security

- **Auth required:** YES — `requireRole(['affiliate'])` then `user_id = auth.uid()` on every server action
- **Allowed roles:** affiliate (any status; pending affiliates can see the page but their global link is not yet minted — the empty state shows)
- **RLS policies that apply:**
  - `affiliate_links` — `affiliate_links_self_read` (the affiliate sees only their own), `affiliate_links_self_update` (for disable/enable); DELETE is not allowed at RLS for self (soft-delete only; the server action with `service_role` is the writer, after audit row is written)
  - `affiliate_clicks` — `affiliate_clicks_self_read_aggregated` (the affiliate sees counts but not the raw click rows — privacy-respecting analytics)
  - `affiliate_commissions` — `affiliate_commissions_self_read` (for conversions_count)
  - `admin_audit_log` — admin read only; server actions use `service_role` to insert
- **PII displayed:** no. The page shows the affiliate's own links + their own performance metrics.
- **PII in URLs:** no — only the affiliate's own IDs (server-side, never query-stringed)
- **Disable semantics:** a disabled link still resolves on click (so old shared URLs don't 404), but the click is NOT recorded as an affiliate click and the `?ref=` cookie is NOT set. This is the "soft disable" pattern: existing customers who already clicked the link still convert (and the conversion is attributed to the previous click), but new traffic is not attributed. Verified by integration test: click a disabled link, then load any Uthena page, then check `affiliate_clicks` — the row is absent.
- **Rate limiting:**
  - `disableLink` / `enableLink` — 30/min/user
  - `deleteLink` — 10/hr/user
  - `exportLinksCsv` — 10/hr/user
  - `ensureDefaultLink` — idempotent, 5/min/user
- **Audit logged:**
  - `disableLink` — `action='affiliate_link_disabled'`, `target_id` = link id
  - `enableLink` — `action='affiliate_link_enabled'`, `target_id` = link id
  - `deleteLink` — `action='affiliate_link_soft_deleted'`, `target_id` = link id
  - `exportLinksCsv` — `action='links_csv_exported'`, `target_id` = export id, with row count
  - `ensureDefaultLink` — `action='affiliate_link_ensured'`, `target_id` = link id (only logged when a new row is created, not on the idempotent no-op)
- **CSRF:** server actions use Next.js's built-in origin check + Supabase Auth session cookie
- **Click fraud detection:** clicks are logged with IP hash + UA hash (per `affiliate_clicks` schema in `_data-model.md`); patterns (e.g. > 100 clicks from same IP in 1h on a single link) are flagged for admin review. The detection is shared infrastructure with the dashboard and is not re-implemented on this page.
- **Third-party scripts:** none

## Performance

- **Target p95:** < 350ms
- **Render strategy:** RSC + SSR for the table; the QR modal is a small client component
- **Cache:** none — page is user-specific and shows live metrics
- **DB indexes used:** `affiliate_links (affiliate_id)`, `affiliate_clicks (link_id, at desc)`, `affiliate_commissions (affiliate_id, status, created_at desc)`
- **Bundle size budget:** < 30KB added to client bundle (table, copy buttons, QR modal trigger, status filter). Reuses the platform `<Table>` primitive.

## Out of scope for v1

- "Create link" flow (button rendered disabled with v2 tooltip)
- Per-product link creation UI
- A/B testing of link placement
- Smart link rotation
- Link cloaker / domain masking
- UTM builder (lives on `/affiliate` dashboard)
- Scheduled disable / enable
- Bulk actions
- Real-time click counter (5-minute refresh)
- QR code analytics
- Branded short URLs (e.g. `uthena.co/marcus`)

## Open questions for human

1. **Schema additions to `affiliate_links`:** v1 needs two columns the current schema in `_data-model.md` doesn't have: `disabled_at timestamptz` (nullable) and `deleted_at timestamptz` (nullable). Proposed migration (please confirm or amend):

   ```sql
   alter table affiliate_links
     add column disabled_at timestamptz,
     add column deleted_at timestamptz;

   create index on affiliate_links (affiliate_id) where deleted_at is null;
   -- Most queries should skip soft-deleted rows. The partial index keeps the working set small.
   ```

   Also flag: should `clicks_count` and `conversions_count` on `affiliate_links` be denormalized counters (current schema) or computed on read (always-correct but slower)? My recommendation: **keep the denormalized counters**, updated by trigger on `affiliate_clicks` / `affiliate_commissions` insert. Reasons: the dashboard and this page both want p95 < 500ms, and a `count(*)` on `affiliate_clicks (link_id, at desc)` per render is fine at v1 scale (10-100K clicks) but won't be at 10M+ clicks. Confirm the migration above.

2. **The default global link is created when?** In `affiliate-onboarding.md` the spec ends at "application submitted, status=pending." The default link is created on **admin approval** (status='approved'). The page here handles the "the row doesn't exist yet" case with an "ensureDefaultLink" server action. Alternative: create the link at application submit (status=pending) so the affiliate can see the URL even before approval — but the link is inactive until approval. My recommendation: **create on approval**, match the onboarding spec. The empty-state + "Refresh" UX is the safe fallback for the data-race window. Confirm.

3. **Disable vs. delete trade-off:** disable keeps the row + preserves attribution history (a previous click that converts post-disable still attributes correctly). Delete (soft) removes the link from the active list but keeps historical click/commission rows for reporting. The spec supports both. Question: should "Delete" require a 7-day cooling-off period (a "Restore" link on a confirmation page) so an accidental delete is recoverable? My recommendation: **yes, 7-day restore window via a `?show=deleted` filter on this page** (admin-style trash UX). Cheap to build (just show rows with `deleted_at` within the last 7 days) and saves a support ticket per accidental delete. Confirm.

4. **CSV export contents:** the spec lists 11 columns. Should the export include the **per-link 30d click timeline** (e.g. one row per day per link) or just the aggregate row? My recommendation: **aggregate row only** in v1. A daily timeline is a v2 feature when affiliates ask for it; the raw click data is on `affiliate_clicks` if a manual SQL query is needed. Confirm the v1 column list above.

---

## Implementation notes

- **2026-06-30 (P13.5 Slice 1)** — schema foundation (migration `0048_affiliate_links_columns.sql`: `disabled_at` + `deleted_at` + `utm_source` + `utm_medium` + `utm_campaign` + partial index `affiliate_links_active_idx (affiliate_id, created_at desc) WHERE deleted_at IS NULL` + `get_my_affiliate_link_metrics()` SECURITY DEFINER RPC) + `getMyAffiliateLinks` query (single Round-1 read of affiliates row + Round-2 `Promise.all` of affiliate_links + the metrics RPC; FNV-1a hashed `affiliate_id` in every log payload; bigint-as-string defensive coercion) + `LinksStatsRow` + `DefaultLinkHero` (mono URL block + CopyLinkButton + disabled "Create link" CTA with v2 tooltip + 4-cell stats strip + empty-state-with-Refresh fallback) + `CopyLinkButton` client island (clipboard API + `document.execCommand('copy')` legacy fallback + 1.6s "Copied" flip + platform Toast success) + `RefreshDefaultLinkButton` client island + `AllLinksTable` (RSC, 10-col table per acceptance #5) + `ensureDefaultLinkAction` server action (5/min/user rate limit + idempotent RPC call) + `/affiliate/links` RSC route + `loading.tsx` + `error.tsx` + `not-found.tsx` + `AffiliateShell` NAV entry.
- **2026-06-30 (P13.6)** — **status filter (spec acceptance #6) shipped**. `AllLinksTable` lifted to `'use client'` with 3-state chip group (Active / Disabled / All) wired to `?status=`. Pure helpers `parseStatusFilter` + `applyStatusFilter` are exported from the component file. Default-strip pattern keeps the canonical URL at `/affiliate/links`. Per-link metrics columns (clicks / conversions / conversion_rate) shipped as part of P13.5 Slice 1 — P13.6 owns the status filter + the chip group + the "Showing X of Y" summary + the filtered empty state. 32 unit tests in `AllLinksTable.test.tsx` cover parseStatusFilter (4 incl. SQLi fallback) + applyStatusFilter (5 incl. no-mutation + empty-list) + the chip group (default → active chip pressed; `?status=disabled` → disabled chip pressed; `?status=all` → all chip pressed; garbage value → fallback to active) + the "Showing X of Y" summary + the filtered empty state ("No links match the \"disabled\" filter.") + the codebase convention (active chip uses `aria-pressed` + `data-active`, NOT `disabled` — matches `VaultFilterBar` / `DownloadHistoryFilters`). All 6 checks green + full test suite 3671/3673 (1 pre-existing `encryption.test.ts:150` parallel-runner flake passes 54/54 in isolation — unrelated to P13.6) + `pnpm build` clean (60 routes; `/affiliate/links` is `434 B / 117 kB` first-load JS, +20 B from the new client-island chip group + URL-state hooks).
- **2026-06-30 (P13.7)** — **Link analytics deep shipped**. New migration `0049_affiliate_link_analytics.sql` ships three SECURITY DEFINER RPCs:
  - `get_affiliate_link_hourly_clicks(p_affiliate_id, p_hours_back default 24)` — 24 zero-filled hour buckets (UTC, truncated to the hour; hard-clamped to [1, 168] = 1 week). The chart's X axis is guaranteed to render at any data sparsity via `generate_series` + `LEFT JOIN`.
  - `get_affiliate_link_geo_breakdown(p_affiliate_id, p_days_back default 30)` — top countries + click counts + `share_pct` (numeric 5,2); the `'Unknown'` literal row covers NULL `country` values; LIMIT 256 (defensive ceiling).
  - `get_affiliate_link_device_breakdown(p_affiliate_id, p_days_back default 30)` — same shape on `device_class`; LIMIT 32 (defensive ceiling).
  All three `STABLE + set search_path = '' + REVOKE from PUBLIC + GRANT to authenticated` (Supabase hardener pattern); auth gate `current_affiliate_id() = p_affiliate_id OR is_admin()` → unauthorized callers receive zero rows.

  New query module `02-features/affiliate-portal/queries/getAffiliateLinkAnalytics.ts` (3 functions + types) — wraps the RPCs with bigint-as-string defensive coercion (`coerceBigint`) + numeric share coercion (`coerceShare` clamped 0..100, NULL when window is empty) + ISO timestamptz coercion (`coerceIso`). All 3 functions fail-soft: anon → `[]`, non-affiliate (no `affiliates` row) → `[]`, RPC error → `[]` + `warn` log with FNV-1a hashed `affiliate_id` (raw `999` / `42` / etc. NEVER appears in any log payload). 21 unit tests.

  New components:
  - `<HourlyClicksChart>` — RSC + inline SVG, zero client JS. 24-bar chart with peak bucket highlighted via `--accent`; rest use `--teal`. X axis labels at 00/06/12/18 (the 4 natural hour-marks). Headline total clicks in the header. "Peak hour" callout below the chart. Empty state with help text. 15 unit tests.
  - `<GeoBreakdownList>` — RSC, list-with-bar surface. Top 10 countries + "Other (n)" overflow bucket. ISO 3166-1 alpha-2 → human name lookup for ~40 common codes (US → "United States (US)"). Unknown bucket dim styling + help caption explaining the click-track route's geo enrichment is pending. 16 unit tests.
  - `<DeviceBreakdownList>` — RSC, same surface on `device_class`. Known classes get a 2-letter glyph (M/D/T/B) + colored bar. Unknown bucket dim + help caption. 17 unit tests.
  - `<LinkAnalyticsPanel>` — RSC orchestrator. Composes the 3 sub-components via 3 parallel RPC reads (Promise.all); the 2 breakdown sections render side-by-side on desktop, stacked ≤1024px.

  Wired into `/affiliate/links` page between `<DefaultLinkHero>` and `<AllLinksTable>`. All 6 checks green + `pnpm test` 3741/3741 (+70 from P13.7: 21 query + 15 chart + 16 geo + 17 device) + `pnpm build` clean (60 routes; `/affiliate/links` is `452 B / 117 kB` first-load JS — +18 B from the orchestrator import; shared first-load JS unchanged at 101 kB since all 3 sub-components are RSC + inline SVG).

  **v1 caveat (documented in migration 0049 stub register):** the `country` + `device_class` columns on `affiliate_clicks` are populated by the click-track route (`/api/affiliate/click` — STUB-105 Slice 7, not yet built). Until then:
  - The hourly chart renders correctly today (the `at` column is always populated by any future INSERT).
  - The geo breakdown shows 100% "Unknown" with a help caption explaining the enrichment pipeline is pending.
  - The device breakdown shows 100% "Unknown" with the same caption.

  Once `/api/affiliate/click` ships, the click-track route writes `country` + `device_class` columns via IP→country + UA→device helpers, and the breakdowns fill in automatically (no P13.7 follow-up work needed).

- **Still owed (STUB-110)**:
  - Slice 2 — `disableLink` / `enableLink` / `deleteLink` server actions (Zod-validated, RLS-scoped, 30/min/user for disable+enable, 10/hr/user for delete, audit rows `affiliate_link_disabled` / `affiliate_link_enabled` / `affiliate_link_soft_deleted`). Plus the RLS update policy amend so self-service DELETE is reachable (currently service-role only). Plus the `affiliate_links_public_read_code` anon SELECT policy amendment to exclude disabled rows.
  - Slice 3 — QR code modal (spec acceptance #8) — server-side SVG via the `qrcode` npm package + client modal with PNG download button + `/api/affiliate/qr/[code]` route.
  - Slice 4 — `exportLinksCsv` action (spec acceptance #11) reusing the P6.3/P12.11/STUB-105 CSV pattern (Zod-validated filters + 10/hr/affiliate rate limit + audit row `links_csv_exported` with hashed identifiers + row count). Plus the UTM builder UI on the DefaultLinkHero card (3 input fields + tagged URL generator + Copy button).
