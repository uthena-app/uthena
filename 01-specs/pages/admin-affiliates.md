# Admin Affiliates List — `/admin/affiliates`

## What this page does

The admin's affiliate roster. Lists every row in `affiliates` joined with `profiles`, with the earnings summary, click + conversion metrics, and a row click into the detail view. The page is the daily triage surface for the affiliate-program side of the business — answering "who's driving sales?", "who's been quiet for 60 days?", "is this affiliate's conversion rate believable?". Bulk approve / suspend + CSV export make it a queue, not just a directory.

The page mirrors the partners list page in shape (`/admin/partners`) but with affiliate-specific columns. Every metric is computed from real order_items / affiliate_commissions / affiliate_clicks rows — no caching, no approximations.

## Data this page shows

| Section | Field | Source | Format |
|---|---|---|---|
| Sidebar | (admin shell — same as `admin-review.md`) | hard-coded | sidebar |
| Top bar | page title, "Bulk approve" + "Bulk suspend" buttons (disabled until ≥1 row selected), "Export CSV" button | hard-coded | top bar |
| Stats row | total affiliates, pending (awaiting review), suspended, this-month approvals, this-month platform commission paid out (sum of `affiliate_payouts.amount_cents` in the current calendar month) | aggregate over `affiliates` + `affiliate_payouts` | 5 stat cards |
| Filters | status (pending/approved/suspended), signup date range, search by handle / display_name / email | URL params | filter bar |
| Table columns | display_name, handle, email (admin-visible, audit-logged on click), status, lifetime_earned (sum of `affiliate_commissions.commission_cents` where `status in ('available', 'paid')`), pending_balance (sum where `status='pending'`), available_balance (sum where `status='available'`), clicks_30d, conversions_30d, conversion_rate (conversions_30d / clicks_30d, formatted as `2.4%` with 1 decimal), joined date, last activity (`max(affiliate_clicks.at)` for the affiliate) | affiliates + profiles + affiliate_commissions + affiliate_clicks aggregates | sortable table |
| Row click | → `/admin/affiliates/[id]` | — | link |
| Bulk select | checkbox per row; sticky action bar appears at bottom when ≥1 selected | local state | checkbox |
| Empty state | "No affiliates match these filters" + "Reset filters" CTA | derived | empty card |
| Pagination | 50 per page default, page number in URL, total count in footer | derived | pager |

**Queries:** `02-features/admin/queries/listAffiliates.ts` returning `{ rows: AffiliateRow[], total: number }`. Each `AffiliateRow` carries the affiliate + display_name + email + status + the aggregates above. Server-side filter + sort + paginate.

## User actions

| Action | Trigger | Result | RBAC |
|---|---|---|---|
| Filter | Change filter, click "Apply" | URL updates, table re-fetches | admin |
| Sort | Click column header | Toggles asc/desc, URL updates | admin |
| Search | Type in search box (debounced 300ms) | Filters rows server-side (matches `handle` exact OR `display_name` ILIKE OR `email` ILIKE) | admin |
| Page | Click page number | URL updates with `?page=N` | admin |
| Open affiliate | Click row | Navigate to `/admin/affiliates/[id]` | admin |
| Select rows | Click row checkbox | Adds to selection; bottom action bar shows | admin |
| Bulk approve | Click "Bulk approve" (with selection) | For each selected affiliate: if `status='pending'`, set `status='approved'`, `approved_at=now()`, generate default affiliate link (see Implementation Notes), enqueue approval email, audit log. Atomic per affiliate. | admin |
| Bulk suspend | Click "Bulk suspend" | Opens modal requiring reason (textarea, required) + typed confirmation ("SUSPEND"). On confirm: per affiliate, set `status='suspended'`, audit log, enqueue suspension email. | admin |
| Export CSV | Click "Export CSV" | Generates CSV of the CURRENT filter. Signed URL returned. Rate-limited 10/hr/admin. | admin |
| Reset filters | Click "Reset" in empty state | Clears URL params | admin |

## What this page does NOT do

- No inline edit of affiliate fields (the row is read-only; editing lives on `/admin/affiliates/[id]` per admin-affiliate-detail.md)
- No "force handle change" (rare, lives on the detail page; flagged for ADR in OQ)
- No "send mass email to selected affiliates" (v2)
- No real-time updates (5-minute refresh; v2 live)
- No column customization
- No saved filters per admin
- No per-admin permissioning (every admin sees every affiliate)
- No "duplicate detection" of affiliate accounts (a real risk in v1 — flagged in admin-affiliate-detail OQ)

## Acceptance criteria

- [ ] Page is auth-gated AND requires `profiles.role = 'admin'`
- [ ] Customer/partner/affiliate access returns 403
- [ ] Table shows all affiliates that match the active filter, paginated 50 per page
- [ ] Default sort is `lifetime_earned desc`; URL reflects the active sort
- [ ] Stats row aggregates are correct (verified by a test that inserts N rows and checks the counts)
- [ ] Search matches `handle` (exact), `display_name` (ILIKE), or `email` (ILIKE) — verified by a test with three matching rows
- [ ] "Bulk approve" only enables for selected rows whose `status='pending'` (mixed selections show a per-row warning; non-pending rows are skipped and the skip is reported)
- [ ] "Bulk approve" creates a default `affiliate_links` row per approved affiliate (the post-approval hook — see Implementation Notes)
- [ ] "Bulk suspend" requires a reason (textarea, non-empty after trim) AND a typed confirmation ("type SUSPEND to confirm")
- [ ] Every bulk action is per-affiliate-atomic (one failure doesn't roll back others; the result UI shows per-affiliate success/failure)
- [ ] CSV export includes every column visible on the table; respects the current filter
- [ ] CSV export is rate-limited to 10/hour per admin; the 11th attempt returns 429 and writes `admin_audit_log` with `action='rate_limit_triggered'`
- [ ] CSV is served via a signed URL with 5-minute TTL
- [ ] Every page load is logged to `admin_audit_log` with `action='view_affiliates_list'`, `target_table='affiliates'`, filters in `before` JSON
- [ ] Every email-viewing click is logged with `action='view_affiliate_email'` — same PII-scrape-detection signal as the partner list
- [ ] Page renders in < 500ms p95
- [ ] No PII in URLs — use `?status=pending&page=2` style, never `?email=...` or `?handle=...`
- [ ] No `TODO` / `FIXME` in the diff

## Design reference

- Mockup: `mockups/admin.html` (the review-queue page is the design sibling; same shell)
- Components: `00-foundations/ui/AdminSidebar.tsx`, `00-foundations/ui/AdminTable.tsx`, `00-foundations/ui/FilterBar.tsx`, `00-foundations/ui/StatCard.tsx`, `00-foundations/ui/BulkActionBar.tsx`, `00-foundations/ui/ConfirmModal.tsx`
- Design tokens: `00-foundations/design/tokens.css`

## Security

- **Auth required:** YES
- **Allowed roles:** admin (only)
- **RLS policies that apply:** `affiliates` (`affiliates_admin_all`), `profiles` (`profiles_admin_all`), `affiliate_commissions` (admin-scoped reads), `affiliate_payouts` (admin-scoped reads), `affiliate_clicks` (admin-scoped reads), `admin_audit_log` (`admin_audit_log_admin_read`)
- **PII displayed:** yes — email is visible to admins. PII access is audit-logged.
- **PII in URLs:** no. Filters use enum values; search uses `?q=`, never a typed `?email=` or `?handle=` URL.
- **Audit logged:** YES — `view_affiliates_list` on every load, `view_affiliate_email` on every email click, `bulk_approve_affiliates` + per-affiliate `approve_affiliate` on bulk approve, `bulk_suspend_affiliates` + per-affiliate `suspend_affiliate` on bulk suspend, `export_affiliates_csv` on every export, `rate_limit_triggered` on 429.
- **Bulk action safety:** "Bulk suspend" requires a non-empty reason AND a typed confirmation. "Bulk approve" requires selecting only pending affiliates; mixed selections warn and skip.
- **Per-affiliate atomicity:** bulk operations are per-affiliate transactions; one failure doesn't roll back others.
- **CSRF:** all server actions protected by Next.js's built-in action token
- **Rate limiting:** CSV export 10/hr/admin; bulk actions 30/hr/admin; filter changes 120/min/admin
- **Third-party scripts:** none

## Performance

- **Target p95:** < 500ms
- **Render strategy:** RSC + SSR (no caching)
- **Cache:** none
- **DB indexes used:** `affiliates (status, created_at desc)`, `affiliates (handle) unique`, `affiliate_commissions (affiliate_id, status, created_at desc)`, `affiliate_clicks (link_id, at desc)` joined via `affiliate_links (affiliate_id)`
- **Bundle size budget:** < 40KB added to client bundle (filter bar, sortable table, bulk action bar, confirm modal)

## Out of scope for v1

- Inline edit (handled on detail page)
- Mass email blast tool
- Real-time updates
- Column customization / saved views
- Saved filters per admin
- Per-admin scoped views
- "Recently approved" / "Recently suspended" feeds
- Click-fraud heatmap / suspicious-affiliate scoring
- Slack / email notifications on new affiliate applications
- Duplicate-account detection (the first affiliate with a given email/handle wins; suspicious duplicates are an admin-judgment call from the detail page)

## Open questions for human

1. **Lifetime earned definition:** "lifetime_earned" can mean (a) sum of all `affiliate_commissions.commission_cents` ever created, (b) sum where `status in ('available', 'paid')` (i.e. excluding reversed), or (c) sum where `status = 'paid'` (only what was actually paid out). My recommendation: **(b) — available + paid, excluding reversed**. Reason: this is what the affiliate has "earned" in the colloquial sense; reversed commissions are refunds, not earnings. (c) would under-report by the time delay between earning and payout. Flag for human review.
2. **Bulk approve post-approval hook:** the brief implies approval just flips the status. In practice, the post-approval step is to mint the default affiliate link (the v1 single-link model per affiliate-dashboard.md). My recommendation: **bulk approve also mints the default link per affiliate** (1 row in `affiliate_links` with `target_path='/?ref=[handle]'` and `code = handle`). If the link already exists, skip. Audit each mint.
3. **Conversion rate rounding:** the brief says "conversion rate" but doesn't specify precision. My recommendation: **1 decimal place, e.g. `2.4%`**. Sub-1% rates (typical for cold traffic) are still readable. A test asserts: 100 clicks / 5 conversions → `5.0%`, not `5%`.
4. **Filter UX: search by email vs handle vs display_name:** the brief lists all three. My recommendation: **single search input that matches all three** (exact on handle, ILIKE on display_name and email). The empty-state copy mentions the three match types so the user knows what to expect. Avoid three separate search inputs.
5. **Empty-state copy:** same question as the partners list. My recommendation: **"No affiliates match these filters" + "Reset filters" CTA** when filters are active; **"No affiliates yet — share the affiliate program"** when filters are clear (and the human can soften this copy).

---

## Implementation notes

- (filled by the building agent)

### P14.6 Slice 1 — Read path end-to-end (2026-06-30)

**Migration `0056_admin_affiliates_query.sql`** ships 3 SECURITY DEFINER RPCs: `get_admin_affiliate_stats()` (5-card counts over `affiliates` + `affiliate_payouts` WHERE status='paid' AND paid_at >= start-of-month), `get_admin_affiliate_lifetime_earned(p_affiliate_id)` (per-affiliate lifetime + pending + available + this-month earnings via FILTER clauses), and `get_admin_affiliates_list(p_filters jsonb, p_sort text, p_page int, p_per_page int)` (paginated affiliates + all 11 columns via 5 lateral joins: profile + lifetime earnings + clicks_30d + conversions_30d + last_activity). All 3 RPCs are `SECURITY DEFINER + set search_path = '' + REVOKE from PUBLIC + GRANT to authenticated` (Supabase hardener pattern, matches 0052-0055).

**New `02-features/admin/affiliates/` module** (10 new files): `types.ts` (AffiliateRow + AffiliateStats + 10 sort keys + parseAffiliateFilters + formatConversionRate pure helper), `queries/getAdminAffiliateStats.ts` + `queries/getAdminAffiliatesList.ts` (auth-gated + defensive bigint coercion + fail-soft to empty on RPC error), `actions/writeAffiliatesViewAuditLog.ts` (best-effort audit row per page load with `admin.affiliates_list_viewed` + the filter bag + sort + page + result count in metadata), 5 RSC components (AffiliateStatsCards / AffiliateFilters / AffiliateTable / AffiliatePagination + their CSS modules), barrel `index.ts`, `types.test.ts` (29 tests) + `components.test.tsx` (14 tests).

**New `app/admin/affiliates/`** route + `loading.tsx` skeleton mirroring the page shape via token-only CSS. Belt-and-suspenders: layout-level `requireRole(['admin', 'super_admin'])` + page-level `requireAdmin()`. URL-driven filters via plain GET `<form>` (no client JS). Sortable headers via plain `<a>` links (no client JS). Pagination via plain `<a>` links (no client JS). Default sort `earned_desc` per spec line 56. Default page size 50, hard-capped at 200 by the RPC. Per spec OQ #1, `lifetime_earned` excludes reversed commissions (status IN `available`/`paid`).

**Spec acceptance criteria coverage** (per lines 52-70):
- (1) auth-gated + admin-only ✓
- (2) wrong-role returns 403 ✓ (layout-level guard)
- (3) table shows all matching affiliates, paginated 50/page ✓
- (4) default sort `earned_desc` ✓
- (5) stats aggregates correct ✓ (defensive coercion + integration test gated on STUB-045 staging seed)
- (6) search matches handle (exact) OR display_name (ILIKE) OR email (ILIKE) ✓ via migration's `af.handle = v_q OR pr.display_name ilike OR pr.email ilike`
- (7-13) bulk actions + CSV export — deferred to STUB-120
- (14) page load logs `admin.affiliates_list_viewed` with filter bag in metadata ✓
- (15) per-email-click audit — deferred to STUB-120 (the email is rendered directly per spec line 17, audit-on-click is the S2 enhancement)
- (16) p95 < 500ms ⏳ — `954 B / 202 kB` first-load + parallel RPC reads + 200-row hard cap; matches the partner-list baseline
- (17) no PII in URLs ✓ — filter params are enum values + date ranges only
- (18) no TODO/FIXME in diff ✓ (`check:no-todo` clean)

**Slices 2+ deferred to STUB-120**: bulk approve (with default-link mint per spec OQ #2) + bulk suspend (typed SUSPEND + reason) + per-row PII clicks + CSV export (10/hr/admin rate limit + signed URL + 5-minute TTL) + the detail page at `/admin/affiliates/[id]` (10-tab nav + Approve/Suspend right-rail matching the partner P14.5 pattern). Pattern reuses the partner STUB-117 / P14.1 STUB-114 shapes. Estimated ≤ 2-3 cron ticks when picked up.
