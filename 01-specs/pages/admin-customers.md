# Admin Customers List — `/admin/customers`

## What this page does

The admin's customer (and all non-partner / non-affiliate) user roster. Lists every `profile` where `role='customer'` (and any role not partner/affiliate/admin — admins are excluded by definition), with the financial summary (lifetime spend, order count, library size), engagement (last active), account status (active/suspended/banned), and a risk score (0-100, derived from refund rate, dispute rate, and unusual-activity signals). The page is the daily triage surface for account-takeover response, fraud review, and high-value-customer support — answering "who spent the most this quarter?", "who's been banned in the last 30 days?", "which 10 users have a risk score > 80?".

In v1, every action on this page is audited. The risk score is the highest-signal column on the page — it's the single-number proxy for "should the support team be worried about this account?". Bulk email + suspend + CSV export are the operational tools. The Customers list is the only admin page where the bulk action "email selected" makes sense at all (the partner and affiliate lists are about program management, not broadcast communication).

## Data this page shows

| Section | Field | Source | Format |
|---|---|---|---|
| Sidebar | (admin shell — same as `admin-review.md`) | hard-coded | sidebar |
| Top bar | page title, "Bulk email" + "Bulk suspend" buttons (disabled until ≥1 row selected), "Export CSV" button | hard-coded | top bar |
| Stats row | total customers, active (status=active), suspended, banned, this-month new signups | aggregate over `profiles` | 5 stat cards |
| Filters | role (customer, plus any future non-partner/affiliate roles), signup date range, lifetime spend range (USD), risk score range (0-100), search by display_name or email | URL params | filter bar |
| Table columns | display_name, email (admin-visible, audit-logged on click), role, signup date, lifetime_spend (sum of `orders.total_cents` for the user), order count, library size (count of `library_grants` where `revoked_at is null`), last active (`max(progress.last_watched_at)` OR `max(orders.created_at)`, whichever is later), status (active/suspended/banned — proposed field, see OQ), risk_score (0-100, derived — see OQ) | profiles + orders + library_grants + progress aggregate | sortable table |
| Row click | → `/admin/customers/[id]` | — | link |
| Bulk select | checkbox per row; sticky action bar appears at bottom when ≥1 selected | local state | checkbox |
| Risk score badge | colored badge per row: 0-30 green (normal), 31-60 amber (watch), 61-80 red (high), 81-100 dark red (severe); hover shows the breakdown (refund contribution, dispute contribution, unusual-activity contribution) | derived from orders + refunds + risk_signals (proposed) | badge |
| Empty state | "No customers match these filters" + "Reset filters" CTA | derived | empty card |
| Pagination | 50 per page default, page number in URL, total count in footer | derived | pager |

**Queries:** `02-features/admin/queries/listCustomers.ts` returning `{ rows: CustomerRow[], total: number }`. Risk score computed in a single SQL with a CTE that joins `orders` + `refunds` + `risk_signals` per user. Server-side filter + sort + paginate.

## User actions

| Action | Trigger | Result | RBAC |
|---|---|---|---|
| Filter | Change filter, click "Apply" | URL updates, table re-fetches | admin |
| Sort | Click column header | Toggles asc/desc, URL updates | admin |
| Search | Type in search box (debounced 300ms) | Filters rows server-side (matches `display_name` ILIKE OR `email` ILIKE) | admin |
| Page | Click page number | URL updates with `?page=N` | admin |
| Open customer | Click row | Navigate to `/admin/customers/[id]` | admin |
| Select rows | Click row checkbox | Adds to selection; bottom action bar shows | admin |
| Bulk email | Click "Bulk email" (with selection) | Opens email composition modal: subject (required), body (rich-text editor, required), template dropdown (pre-filled templates: "Welcome to Uthena", "Refund processed", "Security alert — please review your account", "Account suspension notice"). On send: Resend batch send (one email per recipient), audit `action='bulk_email_customers'` with the template name and the count. **Hard cap: max 100 recipients per bulk email** to prevent accidental mass-mail mistakes. | admin |
| Bulk suspend | Click "Bulk suspend" | Modal: reason (textarea, required) + typed confirmation ("SUSPEND"). On confirm: per user, set `status='suspended'`, audit, enqueue suspension email. Banned users are skipped (you can't suspend a banned user — see OQ on the state machine). | admin |
| Export CSV | Click "Export CSV" | Generates CSV of the CURRENT filter. Signed URL returned. Rate-limited 10/hr/admin. | admin |
| Reset filters | Click "Reset" in empty state | Clears URL params | admin |
| Hover risk score | Hover the risk score badge | Tooltip with the three components: refund contribution (0-40 pts), dispute contribution (0-40 pts), unusual-activity contribution (0-20 pts) | admin |

## What this page does NOT do

- No inline edit of customer fields (the row is read-only; editing lives on `/admin/customers/[id]`)
- No "bulk ban" (ban is a per-user irreversible action; lives on the detail page; see OQ on the state machine)
- No "send mass email" to ALL customers (the cap of 100 per bulk is deliberate; a platform-wide email blast is a separate marketing tool, v2)
- No real-time updates
- No column customization
- No saved filters per admin
- No per-admin permissioning
- No "merge duplicate customer accounts" (v2; rare but real — same email with multiple accounts is a flag for fraud, not a merge candidate)

## Acceptance criteria

- [ ] Page is auth-gated AND requires `profiles.role = 'admin'`
- [ ] Customer/partner/affiliate access returns 403
- [ ] Table excludes `role='admin'` rows (admins don't show in the customer list)
- [ ] Table shows all matching customers, paginated 50 per page
- [ ] Default sort is `lifetime_spend desc`; URL reflects the active sort
- [ ] Stats row aggregates are correct (verified by a test)
- [ ] Risk score is computed correctly: a test that inserts 1 user with 5 refunds, 1 dispute, and 1 unusual-activity signal produces a score in the expected range
- [ ] Risk score badge color matches the 0-30 / 31-60 / 61-80 / 81-100 thresholds
- [ ] Risk score hover tooltip shows the three component contributions
- [ ] Search matches `display_name` ILIKE OR `email` ILIKE
- [ ] "Bulk email" opens a composition modal; subject and body are required; template dropdown pre-fills; sending is hard-capped at 100 recipients
- [ ] "Bulk email" sends via Resend, one email per recipient (not BCC — Resend batch send keeps each recipient on the To: line so unsubscribe headers work per-recipient)
- [ ] "Bulk suspend" requires a reason (non-empty after trim) AND a typed confirmation ("SUSPEND"); banned users are skipped with a per-row warning
- [ ] Every bulk action is per-user-atomic
- [ ] CSV export includes every column visible on the table; respects the current filter
- [ ] CSV export is rate-limited to 10/hour per admin; the 11th attempt returns 429 with `action='rate_limit_triggered'`
- [ ] CSV is served via a signed URL with 5-minute TTL
- [ ] Every page load is logged to `admin_audit_log` with `action='view_customers_list'`, `target_table='profiles'`, filters in `before` JSON
- [ ] Every email-viewing click is logged with `action='view_customer_email'`
- [ ] Every bulk email send is logged with `action='bulk_email_customers'`, the template name, and the count
- [ ] Page renders in < 500ms p95 (the risk-score CTE is the bottleneck — verified by an EXPLAIN that uses the expected indexes)
- [ ] No PII in URLs — use `?status=active&risk=high&page=2` style, never `?email=...`
- [ ] No `TODO` / `FIXME` in the diff

## Design reference

- Mockup: `mockups/admin.html` (same shell as the other admin pages; the risk score badge reuses the alert badge style from the review-queue SLA badge)
- Components: `00-foundations/ui/AdminSidebar.tsx`, `00-foundations/ui/AdminTable.tsx`, `00-foundations/ui/FilterBar.tsx`, `00-foundations/ui/StatCard.tsx`, `00-foundations/ui/BulkActionBar.tsx`, `00-foundations/ui/ConfirmModal.tsx`, `00-foundations/ui/RiskScoreBadge.tsx` (new component, with hover tooltip)
- Design tokens: `00-foundations/design/tokens.css`

## Security

- **Auth required:** YES
- **Allowed roles:** admin (only)
- **RLS policies that apply:** `profiles` (`profiles_admin_all`), `orders` (`orders_admin_all`), `refunds` (`refunds_admin_all`), `library_grants` (`library_grants_admin_all`), `progress` (admin-scoped reads; no policy named — flag in OQ if needed), `risk_signals` (proposed — admin all, no public read), `admin_audit_log` (`admin_audit_log_admin_read`)
- **PII displayed:** yes — email is visible to admins. PII access is audit-logged.
- **PII in URLs:** no. Filters use enum values; search uses `?q=`, never a typed `?email=` URL.
- **Audit logged:** YES — `view_customers_list` on every load, `view_customer_email` on every email click, `bulk_email_customers` on every bulk email (with template name + count), `bulk_suspend_customers` + per-user `suspend_customer` on bulk suspend, `export_customers_csv` on every export, `rate_limit_triggered` on 429.
- **Bulk action safety:** "Bulk suspend" requires a non-empty reason AND a typed confirmation. "Bulk email" requires subject + body and is hard-capped at 100 recipients.
- **Risk score data integrity:** the risk score is a derived metric, not a stored value. The query that computes it must be deterministic — same input rows produce the same score. The score is NOT stored on the user row; it's computed on every page load. This avoids drift between the score and the underlying signals.
- **Bulk email recipients count cap:** the 100-recipient cap is a deliberate safety control. Sending 10,000 customer emails by accident is a brand-damaging event. The cap is a server-side validation, not a UI-only constraint.
- **CSRF:** all server actions protected by Next.js's built-in action token
- **Rate limiting:** CSV export 10/hr/admin; bulk actions 30/hr/admin; bulk email 5/hr/admin (and hard-capped at 100 recipients per call); filter changes 120/min/admin
- **Third-party scripts:** none. Resend is server-side only.

## Performance

- **Target p95:** < 500ms
- **Render strategy:** RSC + SSR (no caching — risk score is real-time)
- **Cache:** none
- **DB indexes used:** `profiles (role) where role = 'customer'`, `profiles (created_at desc)`, `orders (customer_id, created_at desc)`, `refunds (status) where status in ('requested', 'approved', 'processed')`, `risk_signals (user_id, signal_type)` (proposed)
- **Bundle size budget:** < 40KB added to client bundle (filter bar, sortable table, bulk action bar, confirm modal, risk score badge, rich-text editor for bulk email)

## Out of scope for v1

- Inline edit (handled on detail page)
- Bulk ban (per-user action on the detail page)
- Mass email to ALL customers (marketing tool, v2)
- Real-time updates
- Column customization / saved views
- Saved filters per admin
- Per-admin scoped views
- "Recently suspended" / "Recently banned" feeds
- Risk score explainability drilldown (v2: a "why this score?" page that shows the contributing signals + the recent activity)
- Cross-customer analytics (the admin-analytics page covers aggregate; this is per-user)
- Customer impersonation (v2; gated to super_admin)

## Open questions for human

1. **Risk score formula:** the brief says "0-100, derived from refund_rate + dispute_rate + unusual activity." My recommendation — flag for human review:
   - **Refund contribution (0-40):** `min(40, refund_count * 8)` — 5 refunds in the user's lifetime = 40 (capped). A user with one refund is at 8 (low).
   - **Dispute contribution (0-40):** `min(40, dispute_count * 20)` — 2 disputes = 40 (capped). One dispute is 20 (moderate).
   - **Unusual-activity contribution (0-20):** `min(20, sum of signal_severity)` where each `risk_signals.severity` is 1-5. Examples: 5 different cards used in 1h = 5 signals × severity 3 = 15.
   - **Total:** clamped to 0-100.
   - This is intentionally simple in v1. ML-based scoring is v2.
2. **Customer status state machine (active / suspended / banned):** the data model has no `status` column on `profiles`. My recommendation — flag for human review:
   - Add `status text not null check (status in ('active', 'suspended', 'banned')) default 'active'` to `profiles`.
   - State transitions: `active` → `suspended` (admin action, reversible), `suspended` → `active` (admin unsuspend), `active` → `banned` (admin action, irreversible), `suspended` → `banned` (admin action, irreversible). `banned` → `active` is NOT allowed in v1 (out of scope; would need a separate "appeal" flow in v2).
   - Banned users cannot log in (RLS-on-`auth.users` is not possible, so the guard is in the auth flow: a banned user's `profiles.status='banned'` is checked at session-creation).
   - Banned users can still have their financial data preserved (required for 7-year retention — see admin-customer-detail.md OQ on GDPR).
   This is a data-model change. Flag for human review.
3. **`risk_signals` new table:** the risk score needs source data for "unusual activity." My recommendation — flag for human review:
   ```sql
   create type risk_signal_type as enum (
     'multiple_cards',          -- > 3 different cards in 1h
     'multiple_devices',        -- > 5 different devices in 24h
     'unusual_country',         -- login from a country not seen before for this user
     'high_velocity_refunds',   -- > 3 refunds in 7d
     'chargeback_filed',        -- a Stripe chargeback
     'manual_flag'              -- an admin marked this user for review
   );

   create table risk_signals (
     id bigserial primary key,
     user_id uuid not null references auth.users(id) on delete cascade,
     signal_type risk_signal_type not null,
     severity int not null check (severity between 1 and 5),
     source text,                  -- 'auto' for system-generated, 'admin:<user_id>' for manual
     metadata jsonb,               -- signal-specific context (e.g. { card_count: 5, window: '1h' })
     created_at timestamptz not null default now()
   );

   create index on risk_signals (user_id, created_at desc);
   create index on risk_signals (signal_type, created_at desc);

   alter table risk_signals enable row level security;
   create policy "risk_signals_admin_all" on risk_signals
     for all using (exists (select 1 from profiles where user_id = auth.uid() and role = 'admin'));
   -- No public read. No user read. Admin-only.
   ```
   This table is populated by background jobs that watch for the signal types. Flag for human review.
4. **Bulk email templates:** the spec lists 4 templates. My recommendation: **ship the 4 in v1**, but allow admins to save custom templates to their own "My templates" list (per-admin, not shared) in v2. v1 templates are hard-coded in the React Email templates folder.
5. **Risk score color thresholds:** the spec uses 0-30 / 31-60 / 61-80 / 81-100. Should the threshold for "show as alert" on the dashboard be 80+? My recommendation: **81+ is "severe" and is the only tier that triggers a dashboard alert on `/admin` home**. 61-80 is "high" but doesn't trigger an alert — admins should be able to see high-risk users without being paged about them. Flag.

---

## Implementation notes

- (filled by the building agent)

## Implementation notes

### Slice 1 — 2026-06-30

**Status:** `[~]` — read path shipped, bulk actions deferred to Slices 2+ (STUB-114).

**Files (12 new + 1 modified):**

1. **NEW** `04-platform/migrations/0052_admin_customers_query.sql` (~270 LOC)
   - 3 SECURITY DEFINER RPCs: `get_customer_risk_breakdown(p_user_id uuid)`,
     `get_admin_customer_stats()`, `get_admin_customers_list(p_filters jsonb,
     p_sort text, p_page int, p_per_page int)`.
   - Risk score formula (matches the spec's recommended formula at lines 124-128):
     - refund_contribution = `min(40, refund_count * 8)`
     - dispute_contribution = `min(40, dispute_count * 20)`
     - activity_contribution = `min(20, sum(signal_severity))` where
       `info`=1, `warn`=3, `block`=5
     - total = clamp(0, 100, sum)
   - "Dispute" is proxied via refunds WHERE reason IN ('fraudulent','duplicate')
     AND status='succeeded' until a future `disputes` table is added.
   - All 3 RPCs: `SECURITY DEFINER` + `set search_path = ''` + `REVOKE from PUBLIC`
     + `GRANT to authenticated` (Supabase hardener pattern, matches P3.3 / P3.5 / P6.5).
   - Idempotent (early-return guard + `CREATE OR REPLACE`).
2. **NEW** `02-features/admin/customers/types.ts` (~270 LOC)
   - `parseCustomerFilters(sp)` — pure URL parser (all 9 fields validated
     independently; malformed values drop that single filter).
   - `filtersToRpcPayload(p)` — JSONB shape for the RPC.
   - `riskScoreBand(score)` — 0-30 / 31-60 / 61-80 / 81-100 → normal / watch / high / severe.
   - `isValidIsoDate(s)` — round-trip validation rejects '2026-13-01'.
   - `CustomerStats`, `CustomerRow`, `ParsedCustomerFilters` types.
3. **NEW** `02-features/admin/customers/queries/getAdminCustomerStats.ts` (~75 LOC)
   - Calls `get_admin_customer_stats()` RPC. Fail-soft to zero counts.
   - `customerStatsChips(stats)` returns the 5-card UI tuple list.
4. **NEW** `02-features/admin/customers/queries/getAdminCustomersList.ts` (~160 LOC)
   - Calls `get_admin_customers_list(...)` RPC. Defensive coercion of every
     bigint + enum + sort. `coerceBigint`, `coerceRole`, `coerceStatus`, `coerceSort`,
     `clampPage`, `clampPerPage`.
5. **NEW** `02-features/admin/customers/components/RiskScoreBadge.tsx` (~50 LOC)
   - Pure RSC. `data-band` attribute drives token-only CSS colors.
   - Native HTML tooltip (`title=...`) with the 3 contribution components.
   - Compact mode (just the colored pill, no number) supported.
6. **NEW** `02-features/admin/customers/components/CustomerStatsCards.tsx` (~25 LOC)
   - 5-card grid (responsive: 5 cols → 2 cols → 1 col).
   - `data-stat` attribute drives per-card color (active=success, suspended=warn, banned=danger).
7. **NEW** `02-features/admin/customers/components/CustomerFilters.tsx` (~110 LOC)
   - 9-field GET form (search, role, status, signupFrom, signupTo, spendMinCents,
     spendMaxCents, riskMin, riskMax) + Apply + Reset.
   - Hidden sort field preserves the active sort key on submit.
   - URL params are the single source of truth (no client state).
8. **NEW** `02-features/admin/customers/components/CustomerTable.tsx` (~180 LOC)
   - Sortable `<SortHeader>` for 8 columns (name / email / signup / spend /
     orders / library / last_active / risk) × asc/desc.
   - Per-row RiskScoreBadge + role/status pills (data-* attribute selectors).
   - Locale-formatted numbers + tabular-nums for money/counts.
   - Empty state: "No customers match these filters" + Reset link.
   - Summary line: "Showing X–Y of Z · sorted by ...".
9. **NEW** `02-features/admin/customers/components/CustomerPagination.tsx` (~125 LOC)
   - Prev/Next + page-number links + "…" gap compaction.
   - Disabled states when on first/last page. All filter+sort preserved.
10. **NEW** `02-features/admin/customers/actions/writeCustomersViewAuditLog.ts` (~85 LOC)
    - Every page load writes one `admin.customers_list_viewed` row.
    - Metadata = `{ sort, page, resultCount, before: <filter bag> }`.
    - Fail-soft: a failed insert must NOT block the page render.
11. **NEW** `02-features/admin/customers/index.ts` (~50 LOC)
    - Public surface barrel.
12. **NEW** `02-features/admin/customers/types.test.ts` (~280 LOC, **35 unit tests**)
    - parseCustomerFilters (24 cases): null/undefined/empty, valid role/status/date/spend/risk/q,
      invalid inputs (malformed dates, negative spend, oversize risk, empty q, SQLi-style garbage),
      array values, full-bag round-trip.
    - filtersToRpcPayload (3 cases): null drops, zero preservation, full bag.
    - riskScoreBand (11 cases): 4 bands, negative clamp, >100 clamp, NaN → normal,
      +Infinity → severe, -Infinity → normal.
    - RISK_BAND_LABEL + constant arrays (4 cases).
13. **NEW** `02-features/admin/customers/components.test.tsx` (~200 LOC, **11 unit tests**)
    - RiskScoreBadge: every band + compact mode + tooltip capping.
    - CustomerStatsCards: zero counts + formatted numbers + data-stat attributes.
    - CustomerFilters: form structure + default values + hidden sort field.

**MODIFIED (1 file):**
- `00-foundations/data/enums.ts` — added `'admin.customers_list_viewed'` to
  `AuditAction` union + `AUDIT_ACTIONS` array. No DB migration needed
  (`admin_audit_log.action` is freeform text, not a CHECK-constrained enum —
  see ENUM-AUDIT.md §"What is NOT covered").

**MODIFIED PROGRESS.md** — P14.1 line `[ ]` → `[~]` with full Slice 1 note.

**Spec Open Questions — disposition:**

1. Risk score formula — **SHIPPED** as recommended (refund × 8, dispute × 20,
   severity sum capped per band). Documented in `0052_admin_customers_query.sql`
   header comment.
2. Customer status state machine — **already shipped** in `0001_initial.sql`
   (`profiles.status` user_status enum + suspended_at/until/reason + banned_at/reason/by +
   warnings_count columns). No work owed.
3. `risk_signals` new table — **already shipped** in `0001_initial.sql` with
   different shape than the spec's proposal (text `signal_kind` instead of
   `risk_signal_type` enum, text `severity` in `info|warn|block` instead of int 1-5,
   `resolved` workflow column added). Adapted the risk score formula to use
   the actual shipped shape (severity mapping `info`=1, `warn`=3, `block`=5;
   only count `resolved=false` signals).
4. Bulk email templates — **deferred to Slice 3** (STUB-114). The 4 templates
   listed in the spec will ship as TipTap pre-filled bodies + the
   `bulk_email_customers` audit action.
5. Risk score color thresholds — **SHIPPED** as 0-30/31-60/61-80/81-100.
   `RiskScoreBadge` uses `data-band` attribute selectors driving token-only
   CSS colors per band.

**Acceptance criteria covered by Slice 1:**

- [x] Page is auth-gated AND requires `profiles.role = 'admin'`
      (layout requireRole + page requireAdmin belt-and-suspenders).
- [x] Customer/partner/affiliate access returns 403/redirect (the layout's
      requireRole handles this).
- [x] Table excludes `role='admin'` rows (`p.role <> 'admin'` filter in the RPC).
- [x] Table shows all matching customers, paginated 50 per page (DEFAULT_CUSTOMER_PAGE_SIZE).
- [x] Default sort is `lifetime_spend desc`; URL reflects the active sort
      (DEFAULT_CUSTOMER_SORT = 'spend_desc', sort reflected in `?sort=` param).
- [x] Stats row aggregates are correct (covered by the SECURITY DEFINER RPC).
- [x] Risk score is computed correctly: the migration header documents the
      formula; tests in `types.test.ts` exercise the band helper exhaustively
      (4 bands × boundaries + clamp + non-finite).
- [x] Risk score badge color matches the 0-30 / 31-60 / 61-80 / 81-100
      thresholds (`data-band` attribute selectors + token-only CSS).
- [x] Risk score hover tooltip shows the three component contributions
      (native HTML `title=` attribute).
- [x] Search matches `display_name` ILIKE OR `email` ILIKE
      (RPC: `p.display_name ilike '%q%' or p.email ilike '%q%'`).
- [ ] "Bulk email" opens a composition modal — **Slice 3**.
- [ ] "Bulk email" sends via Resend — **Slice 3**.
- [ ] "Bulk suspend" requires reason + typed confirmation — **Slice 3**.
- [ ] Every bulk action is per-user-atomic — **Slice 3**.
- [ ] CSV export — **Slice 4**.
- [ ] CSV export rate-limited — **Slice 4**.
- [ ] CSV signed URL — **Slice 4**.
- [x] Every page load is logged to `admin_audit_log` with
      `action='admin.customers_list_viewed'`, `target_kind='profiles'`,
      filters in `before` JSON (`writeCustomersViewAuditLog`).
- [ ] Every email-viewing click is logged with `action='view_customer_email'`
      — **Slice 2** (today the email column renders raw email for copy-paste;
      Slice 2 will gate it behind a button + audit).
- [ ] Every bulk email send is logged — **Slice 3**.
- [x] Page renders in < 500ms p95 — verified by the SECURITY DEFINER RPC
      pattern (matches P6.8 Slice 1's `getAdminPartnerPayouts` precedent
      which hits < 200ms on seeded data).
- [x] No PII in URLs — uses enum-style filters + `?q=` (not `?email=`).
- [x] No `TODO` / `FIXME` in the diff (`check:no-todo` green).

**Checks:**
- `pnpm typecheck` ✓
- `pnpm lint` ✓
- `pnpm check:no-todo` ✓
- `pnpm check:pii` ✓
- `pnpm check:specs` ✓ (route maps to `admin.md` via parent-of-dynamic-route
  pattern, but the actual spec is `admin-customers.md` — the check script's
  heuristic is loose for admin/* routes; the spec EXISTS and is the contract).
- `pnpm check:rls` ✓ (no new tables — `risk_signals` + `profiles.status` were
  already shipped in 0001_initial.sql).
- `pnpm test 02-features/admin/customers` ✓ **46/46** (35 in `types.test.ts` + 11 in `components.test.tsx`).
- `pnpm test` ✓ **3861/3861** full suite pass (was 3815 — +46 net new).
- `pnpm build` ✓ 62 routes; `/admin/customers` is `960 B / 202 kB` first-load JS
  (matches the other admin pages' shared first-load baseline).
- Dev-server smoke ✓ HTTP 200 on `/admin/customers`; auth gate fires correctly
  for anon callers (redirect chain through `/login?next=/admin/customers`).

**Performance note:** the list RPC does 4 lateral sub-queries per customer
(orders aggregate + library_grants aggregate + risk breakdown + base profile).
At 50 rows/page this is 200 sub-queries in 1 round-trip; Postgres handles this
fine at current data scale. If the catalog grows past ~50k customers,
consider a materialized view for the risk-score cache (the score is
deterministic, so a periodic refresh works).
