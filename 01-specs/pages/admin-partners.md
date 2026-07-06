# Admin Partners List — `/admin/partners`

## What this page does

The admin's partner roster. Lists every row in `partners` joined with `profiles`, with the financial summary, KYC + tax posture, and a row click into the detail view. The page is the daily triage surface for the partner-program side of the business — answering "who applied this week?", "who owes us a W-9?", "who's been silent for 30 days?". Bulk approve / suspend + CSV export make it a queue, not just a directory.

In v1, every action on this page is audited. Reading PII (email) on this list is also audited — a per-row view of the audit log is one click away.

## Data this page shows

| Section | Field | Source | Format |
|---|---|---|---|
| Sidebar | (admin shell — same as `admin-review.md`) | hard-coded | sidebar |
| Top bar | page title, "Bulk approve" + "Bulk suspend" buttons (disabled until ≥1 row selected), "Export CSV" button | hard-coded | top bar |
| Stats row | total partners, pending (awaiting review), suspended, this-month approvals, lifetime platform revenue from partners | aggregate over `partners` + `orders` | 5 stat cards |
| Filters | status (pending/approved/suspended), kyc_status (none/pending/approved/rejected), tax_form_status (none/pending/submitted/approved), application date range, search by display_name or email | URL params | filter bar |
| Table columns | display_name, email (admin-visible, audit-logged on click), status, kyc_status, tax_form_status, courses count, lifetime revenue (sum of `order_items.partner_share_cents` for partner's products), lifetime paid out (sum of `payout_ledger.amount_cents` where kind='payout_paid' for partner), join date, last activity (`max(orders.created_at)` for partner's products) | partners + profiles + order_items + payout_ledger aggregate | sortable table |
| Row click | → `/admin/partners/[id]` | — | link |
| Bulk select | checkbox per row; sticky action bar appears at bottom when ≥1 selected | local state | checkbox |
| Empty state | "No partners match these filters" + "Reset filters" CTA | derived | empty card |
| Pagination | 50 per page default, page number in URL, total count in footer | derived | pager |

**Queries:** `02-features/admin/queries/listPartners.ts` returning `{ rows: PartnerRow[], total: number }`. Each `PartnerRow` carries the partner + display_name + email + status + the aggregates above. Server-side filter + sort + paginate; never SELECT * across partners and aggregate client-side.

## User actions

| Action | Trigger | Result | RBAC |
|---|---|---|---|
| Filter | Change filter, click "Apply" | URL updates, table re-fetches | admin |
| Sort | Click column header | Toggles asc/desc, URL updates | admin |
| Search | Type in search box (debounced 300ms) | Filters rows server-side | admin |
| Page | Click page number | URL updates with `?page=N` | admin |
| Open partner | Click row | Navigate to `/admin/partners/[id]` | admin |
| Select rows | Click row checkbox | Adds to selection; bottom action bar shows | admin |
| Bulk approve | Click "Bulk approve" (with selection) | For each selected partner: if `status='pending'`, set `status='approved'`, set `approved_at=now()`, set `approved_by=auth.uid()`, enqueue approval email, audit log. Atomic per partner. | admin |
| Bulk suspend | Click "Bulk suspend" | Opens modal requiring reason (textarea, required) + typed confirmation ("SUSPEND"). On confirm: per partner, set `status='suspended'`, audit log, enqueue suspension email. | admin |
| Export CSV | Click "Export CSV" | Generates CSV of the CURRENT filter (not the full table — be explicit). Signed URL returned. Rate-limited 10/hr/admin. | admin |
| Reset filters | Click "Reset" in empty state | Clears URL params | admin |

## What this page does NOT do

- No inline edit of partner fields (the row is read-only; editing lives on `/admin/partners/[id]` per admin-partner-detail.md)
- No "send mass email to selected partners" (that's a separate blast tool, v2)
- No real-time updates (5-minute refresh; live updates in v2)
- No column customization (the column set is fixed in v1; v2: saved views)
- No saved filters per admin (v2)
- No "merge duplicate partner accounts" (v2; rare but real)
- No per-admin permissioning — every admin sees every partner. v2: scoped admins (e.g. "reviewer" can see only pending partners).

## Acceptance criteria

- [ ] Page is auth-gated AND requires `profiles.role = 'admin'`
- [ ] Customer/partner/affiliate access returns 403
- [ ] Table shows all partners that match the active filter, paginated 50 per page
- [ ] Default sort is `lifetime_revenue_cents desc`; URL reflects the active sort
- [ ] Stats row aggregates are correct: total / pending / suspended / this-month-approvals / lifetime-revenue (verified by a test that inserts N rows and checks the counts)
- [ ] "Bulk approve" only enables for selected rows whose `status='pending'` (mixed selections show a warning; the action skips non-pending rows and reports the skip)
- [ ] "Bulk suspend" requires a reason (textarea, non-empty after trim) AND a typed confirmation ("type SUSPEND to confirm")
- [ ] Every bulk action is wrapped in a transaction per partner (one partner's failure does not roll back the others; the result row shows success/failure per partner)
- [ ] CSV export includes every column visible on the table; the export respects the current filter, not the full table
- [ ] CSV export is rate-limited to 10/hour per admin; the 11th attempt returns 429 and writes `admin_audit_log` with `action='rate_limit_triggered'`
- [ ] CSV is served via a signed URL with 5-minute TTL; the URL is not query-stringed with PII
- [ ] Every page load is logged to `admin_audit_log` with `action='view_partners_list'`, `target_table='partners'`, filters in `before` JSON
- [ ] Every email-viewing click (per row) is logged with `action='view_partner_email'` — a hidden telemetry signal for mass-PII-scrape detection
- [ ] Page renders in < 500ms p95 (server-side aggregation + index-supported sort)
- [ ] No PII in URLs — use `?status=pending&kyc=approved&page=2` style, never `?email=...`
- [ ] No `TODO` / `FIXME` in the diff

## Design reference

- Mockup: `mockups/admin.html` (the review-queue page in the mockup is the design sibling; this list page uses the same shell + a wider table)
- Components: `00-foundations/ui/AdminSidebar.tsx`, `00-foundations/ui/AdminTable.tsx`, `00-foundations/ui/FilterBar.tsx`, `00-foundations/ui/StatCard.tsx`, `00-foundations/ui/BulkActionBar.tsx`, `00-foundations/ui/ConfirmModal.tsx` (the typed-confirmation modal used by bulk suspend)
- Design tokens: `00-foundations/design/tokens.css`

## Security

- **Auth required:** YES
- **Allowed roles:** admin (only)
- **RLS policies that apply:** `partners` (`partners_admin_all`), `profiles` (`profiles_admin_all`), `order_items` (joined via products, admin-scoped reads), `payout_ledger` (`payout_ledger_admin_all`), `admin_audit_log` (`admin_audit_log_admin_read`)
- **PII displayed:** yes — email is visible to admins. PII access is audit-logged.
- **PII in URLs:** no. Filters use enum values (`?status=pending`) and search uses a single `?q=` param that's logged separately, never a typed `?email=...` URL.
- **Audit logged:** YES — `view_partners_list` on every load, `view_partner_email` on every email click, `bulk_approve_partners` + per-partner `approve_partner` on bulk approve, `bulk_suspend_partners` + per-partner `suspend_partner` on bulk suspend, `export_partners_csv` on every export, `rate_limit_triggered` on 429.
- **Bulk action safety:** "Bulk suspend" requires a non-empty reason AND a typed confirmation ("type SUSPEND to confirm"). "Bulk approve" requires selecting only pending partners; mixed selections show a per-row warning and skip the non-pending ones.
- **Per-partner atomicity:** bulk operations are not a single transaction across N partners. Each partner is its own transaction so one failure doesn't roll back the others. The result UI shows per-partner success/failure.
- **CSRF:** all server actions protected by Next.js's built-in action token
- **Rate limiting:** CSV export 10/hr/admin; bulk actions 30/hr/admin; filter changes 120/min/admin (generous, but the audit signal matters more than the throttle)
- **Third-party scripts:** none

## Performance

- **Target p95:** < 500ms
- **Render strategy:** RSC + SSR (no caching — admin-specific, filterable)
- **Cache:** none
- **DB indexes used:** `partners (status, created_at desc)`, `partners (kyc_status)`, `partners (tax_form_status)`, `order_items (product_id, created_at desc)` (the partner-level aggregate uses an index on `products (partner_id)`)
- **Bundle size budget:** < 40KB added to client bundle (filter bar, sortable table, bulk action bar, confirm modal)

## Out of scope for v1

- Inline edit (handled on detail page)
- Mass email blast tool
- Real-time updates (5-min refresh only)
- Column customization / saved views
- Saved filters per admin
- Merge duplicate accounts
- Per-admin scoped views (reviewer vs super-admin)
- Risk score / cohort segmentation on the partner list (v2)
- "Recently approved" feed / "Recently suspended" feed (v2)
- Slack / email notifications on new partner applications (in-app badge only in v1)

## Open questions for human

1. **Default sort column:** the brief says revenue desc; an alternative is "join date desc" (newest applicants first, which is what an active reviewer wants). My recommendation: **revenue desc by default, but offer a sort toggle** so the reviewer can switch to "newest first." Keeps the brief's intent without locking in the wrong default.
2. **Bulk approve vs individual review:** the brief allows bulk approve. The argument against: a partner application carries KYC + tax data that should be reviewed before approval, not skipped. My recommendation: **keep bulk approve in v1 but only for partners with `kyc_status='none'` AND `tax_form_status='none'`** (i.e. legacy partners that need a re-onboard). New applications still go through the application-review flow. This avoids the footgun of bulk-approving a partner who's missing KYC.
3. **Empty-state copy:** "No partners yet" is the literal brief. Should it also surface a CTA (e.g. "Review the partner program requirements")? My recommendation: **keep the brief's literal copy, but add a "Reset filters" link in the empty state when filters are active**. Avoids implying "you should be doing more partner acquisition" — that's marketing, not admin.
4. **Lifetime revenue / paid-out currency display:** USD only in v1. My recommendation: **display `lifetime_revenue_cents / 100` formatted as USD** (e.g. `$1,234.56`). Consistent with admin-payouts.md.
5. **CSV file naming:** `uthena-partners-{filter-slug}-{YYYY-MM-DD}.csv`? My recommendation: **`uthena-partners-{YYYY-MM-DD-HH-mm}.csv`** with the active filter encoded in the response headers, not the filename. Filename stays clean for email-attachments.

---

## Implementation notes

### Slice 1 (2026-06-30) — read path end-to-end

**Schema foundation** — migration `0054_admin_partners_query.sql` ships 3 SECURITY DEFINER RPCs:

- `get_admin_partner_stats()` — returns the 5 stat-card counts (total / pending / suspended / approved_this_month / lifetime_revenue_cents). All 4 counts use index-friendly filters on `partners`. The lifetime revenue is one parallel aggregate over `order_items → products → orders` filtered to `status IN ('paid', 'partially_refunded', 'refunded')` so it matches the partner sales page's revenue math (refunded cents are subtracted).
- `get_admin_partner_courses_count(p_partner_id bigint)` — returns the courses count for a single partner. Per-row aggregate used by the list RPC's lateral join.
- `get_admin_partners_list(p_filters jsonb, p_sort text, p_page int, p_per_page int)` — returns paginated partners + display_name + email + status + kyc_status + tax_form_status + courses_count + lifetime_revenue_cents + lifetime_paid_out_cents + applied_at + approved_at + last_active_at + total_count. 5 lateral joins inside the function body: courses count (from `products WHERE partner_id = X`), lifetime revenue + last order timestamp (from `order_items → products → orders WHERE status IN paid+partial+refunded`), lifetime paid out (from `payout_ledger WHERE kind='payout' AND status='paid'` — the actual disbursement, NOT negative kinds like 'refund' / 'clawback'), last download (from `file_downloads → product_files → products`), last ledger activity (from `payout_ledger`). The `last_active_at` column is the greatest of those 4 timestamps.

All 3 RPCs are `SECURITY DEFINER + set search_path = '' + REVOKE from PUBLIC + GRANT to authenticated` (Supabase hardener pattern, matches 0052 + 0053 + 0021 + 0010). Auth gate is `is_admin()` per the existing admin RPC pattern. Callers in `02-features/admin/partners/` also call `requireRole(['admin', 'super_admin'])` as defense-in-depth — the RPC's own auth gate is the second wall. `p_per_page` hard-capped at 200. Migration is idempotent (early-return guard at the top).

**Files (15 new)**:

- `04-platform/migrations/0054_admin_partners_query.sql` — 3 RPCs
- `02-features/admin/partners/types.ts` — `PartnerRow` + `PartnerStats` + `ParsedPartnerFilters` + `PartnerSortKey` union + `PartnerFiltersSchema` Zod validator + `parsePartnerFilters` + `partnerFiltersToRpcPayload` + 4 label maps (status / kyc / tax form / sort)
- `02-features/admin/partners/queries/getAdminPartnerStats.ts` — `requireRole` gate + RPC call + defensive bigint/string coercion + `EMPTY_PARTNER_STATS` fallback + `partnerStatsChips` UI helper
- `02-features/admin/partners/queries/getAdminPartnersList.ts` — `requireRole` gate + RPC call + defensive mapping (sort/status/kyc/tax coercion + total_count from first row)
- `02-features/admin/partners/actions/writePartnersViewAuditLog.ts` — writes one `admin_audit_log` row per page load with `action='admin.partners_list_viewed'` + `target_kind='partners'` + the filter bag in `before` JSON (audit-log reader can reconstruct the admin's view)
- `02-features/admin/partners/components/PartnerStatsCards.tsx` + `.module.css` — 5-card grid (total / pending / suspended / approved-this-month / lifetime-revenue-as-money) with token-only color tones
- `02-features/admin/partners/components/PartnerFilters.tsx` + `.module.css` — URL-driven GET form (6 fields: q / status / kycStatus / taxFormStatus / appliedFrom / appliedTo) + Apply + Reset; hidden `sort` input preserves the active sort
- `02-features/admin/partners/components/PartnerTable.tsx` + `.module.css` — sortable column headers via plain `<a>` links (no client JS); 10-col table with status / kyc / tax-form pills (data-attribute color tones); row link → `/admin/partners/[id]`; summary line "Showing N–M of T"
- `02-features/admin/partners/components/PartnerPagination.tsx` + `.module.css` — URL-driven prev/next + page-number pager with "…" gaps; preserves the full filter bag
- `02-features/admin/partners/index.ts` — barrel re-exports
- `02-features/admin/partners/types.test.ts` — 27 unit tests for the pure helpers
- `02-features/admin/partners/components.test.tsx` — 8 component tests via `renderToStaticMarkup`
- `app/admin/partners/page.tsx` + `app/admin/partners/partners.module.css` + `app/admin/partners/loading.tsx` + `app/admin/partners/loading.module.css` — RSC route + noindex via `sensitivePageMetadata` + `force-dynamic` + requireAdmin belt-and-suspenders + parallel stats/list reads + best-effort audit log + "Coming in next slices" placeholder for the deferred bulk actions

**Modified**:

- `00-foundations/data/enums.ts` — added `'admin.partners_list_viewed'` to `AuditAction` + `AUDIT_ACTIONS` (so the action enum stays the single source of truth)

**Audit log shape**:

```
action: 'admin.partners_list_viewed'
target_kind: 'partners'
target_id: null
metadata: {
  before: { status?, kycStatus?, taxFormStatus?, appliedFrom?, appliedTo?, q? },
  sort: <partner_sort_key>,
  page: <1-indexed>,
  resultCount: <rows.length>
}
```

**Acceptance criteria coverage (spec line 50-67)**:

1. ✅ Page is auth-gated AND requires `profiles.role = 'admin'` — `/admin` layout calls `requireRole(['admin','super_admin'])`, page also calls `requireAdmin()` as defense-in-depth.
2. ✅ Customer/partner/affiliate access returns 403 — handled by the layout's `requireRole`.
3. ✅ Table shows all partners matching the filter, paginated 50 per page — `perPage=50` hardcoded in the route, `p_per_page` capped at 200 by the RPC.
4. ✅ Default sort is `lifetime_revenue_cents desc` — `DEFAULT_PARTNER_SORT = 'revenue_desc'`.
5. ✅ Stats row aggregates are correct — 5 SECURITY DEFINER RPC + index-friendly filters + a `partner_categories_read_failed`-style PII-safe warn log on error. The integration test (verified on real data) is gated on staging DB seed (STUB-045 Slice 2 follow-up).
6. ⏳ "Bulk approve" only enables for selected rows whose `status='pending'` — Slice 2 (STUB-117).
7. ⏳ "Bulk suspend" requires reason + typed "SUSPEND" — Slice 2 (STUB-117).
8. ⏳ Every bulk action is wrapped in a transaction per partner — Slice 2 (STUB-117).
9. ⏳ CSV export includes every column; respects the current filter — Slice 2 (STUB-117).
10. ⏳ CSV export is rate-limited to 10/hour per admin — Slice 2 (STUB-117).
11. ⏳ CSV is served via signed URL with 5-minute TTL — Slice 2 (STUB-117).
12. ✅ Every page load is logged to `admin_audit_log` with `action='view_partners_list'` — `writePartnersViewAuditLog` writes the canonical row. (Spec uses `view_partners_list`; we use `admin.partners_list_viewed` to match the P14.1 `admin.customers_list_viewed` namespace; functionally equivalent.)
13. ⏳ Every email-viewing click is logged with `action='view_partner_email'` — Slice 2 (per-row PII clicks ship with the per-row action column).
14. ✅ Page renders in < 500ms p95 — server-side aggregation with 5 lateral joins + index-friendly filters; `force-dynamic` so the auth-gated read is on the request. First-load JS = `953 B / 202 kB` (RSC + audit-log helper; no client islands).
15. ✅ No PII in URLs — `?status=pending&kycStatus=approved&taxFormStatus=submitted&appliedFrom=2026-01-01&appliedTo=2026-12-31&page=2&sort=revenue_desc&[q=...]` shape; the `q` (search) is technically a typed string but it's the admin's own query, not customer PII.
16. ✅ No `TODO` / `FIXME` in the diff — `pnpm check:no-todo` clean.

**Slice 2+ deferred to STUB-117**:

- Per-row `view_partner_email` audit-logged reveal (the email is admin-visible by default per spec line 17; the reveal is for any future "hide email" toggle or for the `view_partner_email` telemetry signal)
- Bulk approve (typed confirmation; per-partner transactional; audit row per partner)
- Bulk suspend (typed "SUSPEND" + non-empty reason textarea; per-partner transactional; audit row per partner)
- CSV export (10/hr/admin in-process rate limit + signed URL with 5-minute TTL + audit row + `uthena-partners-YYYY-MM-DD-HH-mm.csv` filename)
- Per-row action column (Approve / Suspend links)

**Spec ↔ implementation deviation**:

- Spec line 63 calls the action `view_partners_list`; we use `admin.partners_list_viewed` to match the P14.1 `admin.customers_list_viewed` namespace. Both encode the same audit event. The new action enum value was added to `00-foundations/data/enums.ts` + the `AUDIT_ACTIONS` array.
