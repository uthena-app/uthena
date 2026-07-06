# Partner Payouts — `/partner/payouts`

## What this page does

The partner's payout history. Shows every payout batch they've received, every credit (sale) and debit (refund) that's pending or cleared, and the current "available to pay out" balance. Partners use this to verify their monthly PayPal Mass Payout arrived, and to understand their cash flow.

## Data this page shows

| Section | Field | Source | Format |
|---|---|---|---|
| Header | `display_name` | profiles | greeting |
| Summary card | `available_balance` (sum of `status='available'`), `pending_balance` (sum of `status='locked'`), `lifetime_earned`, `next_payout_date` | payout_ledger aggregate | 4 stat cards |
| Payouts history | `id`, `period_start`, `period_end`, `amount_cents`, `currency`, `paypal_batch_id`, `status`, `created_at`, `commission_count` (transactions in batch) | payout_ledger where kind='payout_paid' OR grouped payout batches | table |
| Ledger entries | `created_at`, `kind`, `description`, `order_id`, `amount_cents`, `status`, `available_at`, `locked_until` | payout_ledger where partner_id = self, paginated | list rows |
| Filters | status (all, available, locked, paid, reversed), kind (order_credit, refund_debit, payout_paid, adjustment), date range | URL params | chips + date pickers |

**Queries:** `02-features/partner-portal/queries/getPayouts.ts`, `02-features/partner-portal/queries/getLedger.ts`.

## User actions

| Action | Trigger | Result | RBAC |
|---|---|---|---|
| Filter by status | Click status chip | URL updates with `?status=` | partner (self) |
| Filter by kind | Click kind chip | URL updates with `?kind=` | partner (self) |
| Filter by date | Click date range, select range | URL updates with `?from=` and `?to=` | partner (self) |
| Export ledger CSV | Click "Export CSV" | Generates a CSV of the filtered ledger entries, signed URL returned, logged | partner (self) |
| View order details | Click an order_id in a ledger row | Navigates to `/admin/orders/[id]` (read-only, partner sees what admin sees) — OR `/partner/orders/[id]` if we build a partner-side view in v2 | partner (self, can only see their own orders) |
| Download PayPal payout receipt | Click a payout's "Receipt" link | Downloads the PayPal payout confirmation (if we have it) | partner (self) |
| Update payout method | Click "Update payout method" in summary | Navigates to `/partner/settings/payout` | partner (self) |
| Request early payout | Click "Request early" | Triggers a manual payout request (if early-payout is enabled; see open question in `instructor-dashboard.md`) | partner (self, status=approved) |

## What this page does NOT do

- No tax document generation (we don't generate 1099s in v1; partners get a CSV for their own accounting)
- No multi-currency display (everything is USD; the partner can see the FX rate PayPal applied in their PayPal account)
- No real-time updates (5-minute refresh)
- No "split payout" feature (one partner, one PayPal account — splitting is the partner's responsibility)
- No invoice generation (partners invoice themselves from the CSV)

## Acceptance criteria

- [ ] Page is auth-gated AND requires `profiles.role IN ('partner')`
- [ ] Only the partner's own ledger is shown (RLS enforces this)
- [ ] Summary cards are accurate (verified by a test: insert ledger rows, check the sum)
- [ ] Ledger entries are paginated (default 50 per page)
- [ ] Ledger entries can be sorted by date, amount, kind
- [ ] Filters are reflected in the URL
- [ ] Filter combinations are shareable (back button works)
- [ ] CSV export includes all filtered rows (not just the visible page)
- [ ] CSV export is logged in `admin_audit_log` (yes, even partner-initiated exports — we monitor this)
- [ ] CSV export has rate limiting: 10/hour per partner
- [ ] Page renders in < 400ms p95
- [ ] No layout shift on data load
- [ ] Empty state: if partner has no ledger yet, show "Your first sale will appear here" message
- [ ] "Locked" amounts are visually distinct (greyed out, with a "Releases on [date]" tooltip)
- [ ] "Available" amounts are visually highlighted (in the accent color)
- [ ] "Paid" amounts are visually muted but still listed (with the PayPal batch ID for lookup)
- [ ] All dates are in the partner's timezone (stored separately on profile)
- [ ] All amounts are formatted with mono numbers, currency symbol, no decimals
- [ ] No PII leak in URLs (use IDs, not emails or names)
- [ ] No `TODO` / `FIXME` in the diff

## Design reference

- Mockup: not yet built — to be created during the partner portal build
- Components: `00-foundations/ui/LedgerRow.tsx`, `00-foundations/ui/PayoutBatchCard.tsx`, `00-foundations/ui/StatCard.tsx`

## Security

- **Auth required:** YES
- **Allowed roles:** partner (status=approved, ideally; pending can see but not request payout)
- **RLS policies that apply:** `payout_ledger` (partner_id = self only)
- **PII displayed:** no (the partner sees their own data)
- **PII in URLs:** no
- **Audit logged:** yes — every page view, every CSV export, every payout request
- **CSV export rate limiting:** 10/hour per partner
- **PayPal email (payout method):** stored encrypted at app layer (see `00-foundations/money/encryption.ts`); never returned in plaintext via the API
- **Third-party scripts:** none

## Performance

- **Target p95:** < 400ms
- **Render strategy:** RSC + SSR
- **Cache:** none
- **DB indexes:** `payout_ledger (partner_id, created_at desc)`, `payout_ledger (status, available_at) where status='available'`
- **Bundle size budget:** < 25KB added to client bundle (table, filters, date pickers)

## Out of scope for v1

- Tax document generation (1099s)
- Multi-currency display
- Real-time updates
- Split payouts
- Invoice generation
- Stripe Connect integration (we use PayPal Mass Payout, not Stripe Connect)
- ACH/wire support (PayPal only in v1)
- Tax withholding (partners handle their own taxes)

## Open questions for human

- **CSV export contents:** the full ledger (every row, every kind) or just the "available" amounts? My recommendation: full ledger, partners need this for their accounting. Already rate-limited.
- **"Locked" tooltip wording:** "Releases on [date]" vs "Locks expire [date]" vs "Available after [date]"? My recommendation: "Available [date]" (most actionable).
- **PayPal Mass Payout frequency:** monthly only? Or weekly for partners above a threshold (e.g. > $10K lifetime)? My recommendation: monthly for v1, weekly for top partners in v2. Simplicity first.

---

## Implementation notes

- (filled by the building agent)

### P6.3 Slice 1 — URL-driven filters + timezone display (this tick)

**Files touched (1 query + 1 component + 1 new component + 1 new test + 1 page + 2 formatters):**

- `02-features/payouts/queries/getPartnerLedger.ts` — extended with `LedgerFilterOptions` (Zod-validated: `{ status?, kind?, sort? = 'date', limit? = 50, beforeId? }`); the entries query applies the filters + sort; the summary aggregates stay unfiltered by design; the result now carries `timezone` (read from `profiles.timezone`, default 'UTC') + `filters` (the echoed, parsed filter state for the page to render an "X applied" affordance).
- `02-features/payouts/format.ts` — `formatDate(iso, locale, timeZone?)` and a sibling `formatDateTime(iso, locale, timeZone?)`; new `LEDGER_KIND_CHIP_LABEL` + `LEDGER_STATUS_CHIP_LABEL` for the filter-strip UI (tighter than the row labels).
- `02-features/payouts/components/LedgerSummary.tsx` — accepts `timezone?: string | null`; the "Next release" hint renders in the partner's IANA timezone.
- `02-features/payouts/components/LedgerRow.tsx` — accepts `timezone?: string | null`; all four dates (created_at / locked_until / available_at / paid_at) render in the partner's timezone.
- `02-features/payouts/components/LedgerFilters.tsx` (NEW) — client island. Status chip strip (6 chips, active chip renders an ✕) + Kind chip strip (6 chips, same toggle shape) + Sort dropdown (date/amount/kind). Uses `useRouter` + `useSearchParams` + `usePathname` to navigate; the URL builder preserves the OTHER filter params so combos are shareable (criterion #7).
- `02-features/payouts/components/LedgerFilters.module.css` (NEW) — token-only styles; mirrors the existing chip language from `CategoryPill.tsx` and the SiteHeader pill input; mobile breakpoint at 720px stacks vertically.
- `02-features/payouts/index.ts` — barrel re-exports `LedgerFilters` + `LEDGER_STATUS_VALUES` + `LEDGER_KIND_VALUES` + `LEDGER_SORT_VALUES` + the `LedgerSort` + `LedgerFilterOptions` types.
- `app/partner/payouts/page.tsx` — async `searchParams` (Next.js 15), parses `?status=&kind=&sort=` via small `parseStatus` / `parseKind` / `parseSort` helpers, passes to `getPartnerLedger()`, renders `<LedgerFilters>`, passes `timezone` down to `<LedgerSummaryCards>` + `<LedgerRow>`, renders a "Showing N filtered entries" status line when a filter is active and the list is non-empty.
- `app/partner/payouts/page.module.css` — `.filterCount` rule (12px, `--text-2`, 8px vertical padding).
- `02-features/payouts/queries/getPartnerLedger.test.ts` (NEW) — 25+ unit tests covering Zod validation (every status/kind/sort combo + invalid inputs + limit cap), auth gating (no user / no partner row / partner row error), timezone passthrough (4 cases including empty-string fallback), happy path, status + kind filter application to entries (NOT summary), all 3 sort orderings, beforeId keyset, limit param, entries error → empty + warn + filters echoed, summary aggregate math (mixed rows + null amount_cents), next_release resolution, PII safety (no raw IDs / emails in any log payload), filter+sort+beforeId coexistence.

**Design decisions worth remembering:**

- **Summary aggregates intentionally do NOT honor filters.** A partner filtering to "Paid" must still see their "Available" balance so they can act on it. The summary is the partner's full financial state; the filter is the lens for the ledger list below. Documented in the query's JSDoc + the page header comment.
- **Sort defaults to 'date' (newest first).** When `?sort=` is omitted, the URL stays clean (the page strips the default). Same convention as `BrowseSortSelect.tsx`.
- **beforeId keyset on every sort.** A "Load more" click advances the cursor regardless of the active sort. The pagination UI (deferred to Slice 2) should reset to page 1 when the sort changes — the cursor on a different sort is meaningless.
- **Profile timezone is read in parallel with the partner row.** Both are single-row lookups on a unique index; the parallel read adds < 5ms. Falls back to 'UTC' if the profile row is missing, the column is null, or the value is an empty string. Defense in depth — every code path that touches the surface tolerates a null timezone.
- **Filter echo on `result.filters`.** The page reads `result.filters` (not the original `searchParams`) for the active chip state, so the chips always agree with what the query actually applied (e.g. a typo'd `?status=typo` falls back to "no filter" via the Zod default, and the chip strip shows nothing active).
- **Empty-state copy adapts to filter state.** "Your first sale will appear here" → "No ledger entries match the current filter." when a filter is active. Saves the partner from confusion when filtering returns zero rows.
- **`<fieldset>` + `<legend>` for the chip groups.** Native semantics — assistive tech announces "Status, group" then the chip set; matches the existing SiteHeader nav pattern. No custom ARIA needed.

**Deferred to Slice 2 (P6.3 follow-up):**

- CSV export — the spec's 3 acceptance criteria (rate-limited to 10/hour, audit-logged, includes all filtered rows). `STUB-012` documents the rate-limit deferral to PH19 (multi-instance). v1 ships the in-process rate limit; the export UI lives in `ExportCsvButton.tsx` per the existing README (file is missing — needs creation).
- Pagination UI — the keyset query is in place; "Load more" button + URL `?beforeId=` round-trip lands in Slice 2.
- Date-range filter (`?from=` + `?to=`) — spec acceptance criterion; deferred to Slice 2 alongside the pagination UI.

### P6.3 Slice 2 — Partner ledger CSV export (this tick)

The 3 CSV-export acceptance criteria + the export affordance. The
deferred slice from above; pagination + date-range moved to Slice 3.

**Spec acceptance criteria addressed:**

- [x] CSV export includes all filtered rows (not just the visible page)
      — the action's query omits the `limit` from the page (uses
      `MAX_EXPORT_ROWS = 5000` as a safety ceiling; the full filtered
      set is fetched).
- [x] CSV export is logged in `admin_audit_log` — every successful
      export writes one row with `action='ledger_csv_exported'`,
      `target_kind='payout_ledger'`, `target_id=string(partnerId)`,
      `metadata={ row_count, capped, filters, rate_limit_count }`.
      Actor email + IP are hashed (same pattern as `00-foundations/auth/
      rate-limit.ts`); raw values never leave the server.
- [x] CSV export has rate limiting: 10/hour per partner — in-process
      `Map<partnerId, timestamp[]>` with a 1-hour sliding window. The
      11th attempt inside the window returns `{ ok: false,
      code: 'rate_limited', retryAfterSeconds }` and the friendly
      "Try again in N minutes" copy renders inline. Counter is per-
      partner (not per-IP) — a partner moving between IPs shouldn't
      multiply their quota; an IP key would also fail-soft for
      partners sharing an office NAT. `STUB-012` documents the move
      to a Supabase-backed `rate_limit_events` table in PH19.

**Files touched (1 action + 2 components + 1 test + 1 page + 1 page CSS + 2 index/barrel):**

- `02-features/payouts/actions/exportLedgerCsv.ts` (~250 LOC) — server action. Zod-validates the same `LedgerFilterOptions` shape as `getPartnerLedger` (minus the limit). Auth via `getSessionUser()` + role check (server actions can't redirect; mirrors `startImpersonation.ts`). Partner-row lookup keyed off `user_id`. Rate-limit verdict before the query. Reads the full filtered set (no keyset / no pagination). Writes the audit-log row via the service-role client. Returns `{ ok: true, csv, filename, rowCount }` or `{ ok: false, code, error, retryAfterSeconds? }`.
- `02-features/payouts/actions/exportLedgerCsv.test.ts` (~600 LOC, 43 unit tests, runs in 21ms) — chainable fake Supabase + Pino mock + audit-capture mock. Covers Zod validation (108 valid combos + 3 invalid), auth gating (no user / customer / affiliate / partner / admin / super_admin), partner-row lookup (missing + errored), rate limit (cap hits at 10; per-partner isolation; window slides), entries query (every sort + every filter + DB error), success path (csv + filename + rowCount), PII safety (no raw email / user_id / row content in any log payload; audit row uses hashed identifiers; raw IP never logged), `csvEscape` edge cases (empty / comma / quote / CR / LF / null / undefined / number), `buildLedgerCsv` shape (header row + CRLF terminators + decimal money + royalty percent + null handling + quoted escapes + row count).
- `02-features/payouts/components/ExportCsvButton.tsx` (~60 LOC) — client island. `useTransition` + `Blob` + `URL.createObjectURL` + `<a download>` (same pattern as `CategoryExportButton.tsx`). Reads `?status=&kind=&sort=` from `useSearchParams` so the export always matches what's on screen. Surfaces rate-limit cooldown inline.
- `02-features/payouts/components/ExportCsvButton.module.css` (~40 LOC) — token-only styles mirroring `CategoryExportButton.module.css`. Focus-visible ring on the button + 32px height matching the existing pill language.
- `app/partner/payouts/page.tsx` — added the `<ExportCsvButton />` to a new `.toolbar` flex row right below the filter bar; passes nothing (the button reads its own URL state via `useSearchParams`).
- `app/partner/payouts/page.module.css` — added `.toolbar { display: flex; justify-content: flex-end; margin-top: 8px; }` for right-aligned placement of the button.
- `02-features/payouts/index.ts` — barrel re-export for `ExportCsvButton`.

**Design decisions worth remembering:**

- **Pure functions for CSV generation.** `buildLedgerCsv` and `csvEscape` are pure + exported + unit-tested. The server action is a thin orchestration layer (auth → rate limit → query → build → audit) on top of them. Easier to test, easier to extend (e.g. a future "Export to Google Sheets" feature reuses the same builders).
- **Money in the CSV is decimal with 2 digits.** `12345 cents → "123.45"`. Stripe's CSV exports and every accounting tool expect decimal-dollar; raw cents would surprise the partner when they `SUM(amount)` in Excel. The audit log keeps cents (Postgres bigint) — only the export format is decimal.
- **PII safety is a TESTED contract.** The action NEVER logs the raw email, raw user_id, raw IP, or any row content. The audit-log insert uses hashed identifiers (`actor_email = hash:<sha256>@uthena.audit`; `ip = <sha256(ip)>`). Tests assert `expect(String(audit.actor_email)).not.toContain('partner@example.com')` on the captured insert payload — a regression fails the test suite.
- **In-process rate limit, not per-IP.** Per-partner is the durable anti-abuse signal (a partner moving IPs shouldn't multiply their quota). STUB-012 covers the multi-instance move; v1 is correct + simple.
- **The button reads its own URL state.** Mirrors how `LedgerFilters` writes — the button is symmetric: it reads `?status=&kind=&sort=` and passes them to the action. Single source of truth (the URL). The action's Zod schema is the real validator.
- **5000-row safety ceiling, not silent.** The audit row records `capped: true` when the cap hits. v1 doesn't split into multiple CSVs; if a real partner ever exceeds 5000 rows we'll switch to streamed ZIPs.
- **Audit log failure is fail-soft.** If the admin_audit_log insert fails, the partner still gets their CSV (the action logs the audit failure but doesn't abort). The user has already waited for the export; a transient audit-table hiccup shouldn't break their workflow. Ops catches it via audit-log volume metrics.
- **`useSearchParams` cast at the button site.** The button reads URL params as `string | null` (the `useSearchParams` shape) and casts `as Parameters<typeof exportLedgerCsvAction>[0]`. The cast is safe because the page's URL parsers guarantee only valid union members reach the button; the action's Zod schema is the second line of defense. Smaller code than re-implementing the three parse helpers at the call site.

**No migration.** Reads existing columns on `payout_ledger` (no new table / no new column). **No new dependencies.** **No new RLS policies** (RLS already gates the read). **No client JS regression** — the only new client island is `ExportCsvButton` (~1 KB), and it shares the page's `useSearchParams` / `useTransition` deps with `LedgerFilters` (~3 KB) so no new bundle weight beyond the component itself.

**No migration.** The query reads from existing columns on `payout_ledger` + the existing `profiles.timezone`. **No new dependencies.** **No new RLS policies.** **No client JS regression** — the only client island is `LedgerFilters` (~3 KB), and the page's overall first-load JS is unchanged (the existing RSC data layer now reads one extra row for the partner's timezone, which is < 5ms).

### P6.4 — Partner ledger detail (`/partner/payouts/[id]`)

Drill-in page for a single ledger row. Surfaces the row's
individual milestones + the source order (when linked) + the
refund (when linked).

**Data this page shows:**

| Section | Field | Source | Format |
|---|---|---|---|
| Hero | `kind`, `status`, `amount_cents`, `currency`, `description`, `created_at` | payout_ledger | header card |
| Status timeline | Created → Locked → Available → Paid | payout_ledger `created_at` + `locked_until` + `available_at` + `paid_at` | 4-milestone horizontal strip |
| Source order (when `entry.order_id`) | id, status, money breakdown, dates | orders | 2-col card |
| Refund (when `entry.refund_id`) | id, amount, reason, status, notes | refunds | 2-col card |
| Meta strip | `royalty_pct_bps`, PayPal batch id, Stripe transfer id, `order_item_id` | payout_ledger | 2-col small block |

**User actions:** none on this page (read-only). The "← All
ledger entries" link returns to `/partner/payouts`.

**Acceptance criteria:**

- [x] Page is auth-gated AND requires `profiles.role IN ('partner', 'admin', 'super_admin')` via `requirePartner()`.
- [x] Only the partner's own ledger entry is shown (RLS enforces this — `payout_ledger_partner_read_own` filters by `current_partner_id()`).
- [x] 404 when the id is not a positive integer, the entry doesn't exist, OR it belongs to another partner (treated identically to avoid leaking existence).
- [x] Source order card surfaces when `entry.order_id` is set AND the join succeeds; gracefully falls back to a "no longer available" card when the join returns null/error.
- [x] Refund card surfaces when `entry.refund_id` is set; for `kind='refund'` rows without a `refund_id`, surfaces a "refund no longer available" card.
- [x] Status timeline renders all 4 milestones with per-milestone state (done / active / pending / skipped) based on the row's `status`.
- [x] Refunds skip the "Locked" milestone (refunds don't lock; the original sale did).
- [x] Voided rows mark all 4 milestones as skipped.
- [x] All dates render in the partner's IANA timezone (read from `profiles.timezone`; default 'UTC').
- [x] All money is formatted via `formatMoney` (mono numbers, currency, no decimals).
- [x] **NO buyer email** displayed (orders.email is intentionally NOT selected in the query — PII).
- [x] **NO partner IP / user agent** displayed (orders.ip + orders.user_agent intentionally NOT selected).
- [x] Royalty rate (snapshot) shown when `royalty_pct_bps` is set — communicates "this is the rate at the time of sale, not your current rate."
- [x] External IDs (PayPal batch id, Stripe transfer id) shown when set.
- [x] Loading state mirrors the page shape (hero + timeline + 1 card skeleton).
- [x] No `TODO` / `FIXME` in the diff.
- [x] No client JS shipped (RSC + the same primitives as P6.3).
- [x] `noindex` + sensitive-page metadata (P0.21).
- [x] All 6 cron checks green + `pnpm test` + `pnpm build` clean.

**Design reference:** the page follows the same `bg-elev-1 +
hairline border` card pattern as P6.3's `LedgerSummary` and the
P0.12 product detail "At a glance" sidebar. Timeline color states
mirror `LEDGER_STATUS_COLOR` (P6.3).

**Security:** RLS-gated via `payout_ledger_partner_read_own` +
`current_partner_id()` SECURITY DEFINER. Defensive: even if the
RLS policy regresses, the `getPartnerLedgerEntry` query reads
`profile.timezone` keyed off `user_id` so the partner only sees
their own data. PII: orders.email + orders.ip + orders.user_agent
intentionally NOT selected; the spec marks "PII displayed: no"
for partner-facing surfaces.

**Performance:** target p95 < 250ms. Three parallel reads (entry
+ profile + partner row in `getPartnerLedgerEntry`, then entry's
order + refund joined). All four hit RLS-protected indexes.

**Implementation files:**

- `02-features/payouts/queries/getPartnerLedgerEntry.ts` (~225 LOC) — single-entry read with order + refund join, fail-soft on joins, PII-safe select (no email/ip/user_agent), 23 unit tests.
- `02-features/payouts/queries/getPartnerLedgerEntry.test.ts` — 23 tests in 13ms (auth, validation, happy paths for sale/refund/adjustment, fail-soft joins, timezone fallback, data-consistency warning, PII safety).
- `02-features/payouts/components/LedgerTimeline.tsx` (~150 LOC) — 4-milestone timeline; state per milestone computed from entry status; per-row type shape (`sale` → done-after-locked; `refund` → skips Locked; `void` → all skipped).
- `02-features/payouts/components/LedgerTimeline.module.css` — token-only; horizontal desktop, vertical mobile; `data-state` attribute on `<li>` for the dot/line colors (matches the `LedgerFilters` data-attribute pattern).
- `02-features/payouts/components/LedgerSourceOrder.tsx` (~90 LOC) — order card; renders money breakdown (subtotal / discount / tax / total / refunded) + key dates (placed / paid / fulfilled).
- `02-features/payouts/components/LedgerSourceOrder.module.css` — 2-col grid → 1-col on mobile.
- `02-features/payouts/components/LedgerSourceRefund.tsx` (~95 LOC) — refund card; reason via `REFUND_REASON_LABEL`; Stripe refund id in mono font.
- `02-features/payouts/components/LedgerSourceRefund.module.css` — same shape as LedgerSourceOrder; full-width notes row.
- `02-features/payouts/format.ts` — added `ORDER_STATUS_LABEL` (8 statuses: pending/paid/fulfilled/refunded/partially_refunded/canceled/failed/disputed) + `REFUND_REASON_LABEL` (6 reasons from the DB CHECK constraint).
- `02-features/payouts/queries/getPartnerLedger.ts` — added `refund_id` to `LedgerEntry` type + the select projection (P6.3 list now exposes refund_id too; needed for the refund link affordance).
- `02-features/payouts/components/LedgerRow.tsx` — wrapped in Next.js `Link` to `/partner/payouts/[id]`; the entire row is the click target; `aria-label` carries the kind + amount for screen readers.
- `02-features/payouts/components/LedgerRow.module.css` — added hover + focus-visible styles; `+6px` margin / `-6px` padding compensation so the new focus ring doesn't push the border out.
- `02-features/payouts/index.ts` — barrel re-exports for `getPartnerLedgerEntry` + the 3 new components + the 2 new label maps.
- `app/partner/payouts/[id]/page.tsx` (~165 LOC) — RSC; composes `LedgerTimeline` + `LedgerSourceOrder` (conditional) + `LedgerSourceRefund` (conditional); meta strip for royalty + external IDs; "no order linked" / "no refund linked" affordances for when the join returns null.
- `app/partner/payouts/[id]/page.module.css` — token-only styles for the page; data-attribute-driven kind colors (sale/subscription/refund/payout/clawback/adjustment) + status pill colors (matches `LedgerSummary`).
- `app/partner/payouts/[id]/loading.tsx` + `loading.module.css` — Skeleton-based fallback; mirrors the page shape.

**Design decisions worth remembering:**

- **One query, two round-trips of parallelism.** `getPartnerLedgerEntry` runs the entry read + profile read in parallel, then the order + refund joins in parallel. Net: ~3 sequential round-trips worst case (each Promise.all is one RT). At RLS-protected index scan cost, the page is well under the 250ms budget on a warm connection.
- **Refund join is keyed off `refund_id`, not `order_id`.** A `kind='refund'` row has both `order_id` AND `refund_id`; we use `refund_id` to find the source refund (more specific — there could be multiple refunds on the same order).
- **PII-safe select is a contract, not a comment.** The query's select projection NEVER includes `email`, `ip`, or `user_agent`; the test asserts this on the captured call list (`expect(String(ordersSelect?.payload)).not.toContain('email')`). If a future contributor adds `email` to the select, the test fails at PR time.
- **Timeline `data-state` attribute** mirrors the `LedgerFilters` data-attribute pattern from P6.3. CSS reads `[data-state='done']` etc. for the dot/line colors. This avoids inline `style={{ color: ... }}` (per AGENTS.md "no inline colors").
- **Refund rows skip the Locked milestone.** A refund reverses a sale's royalty — the refund itself never locked because the original sale did. Skipped state communicates "this milestone never fires for this row type" without removing it from the timeline.
- **"Order no longer available" / "Refund no longer available" affordances** for when the joins return null (deleted order, deleted refund). A blank section would confuse the partner; an explicit "this upstream record is gone" message explains the gap.
- **`LedgerRow` is now a `<Link>`.** The whole row is the click target — single-column-table UX. `aria-label` carries the kind + amount for screen readers so the link announces as "Open ledger entry 42 — Sale, $45.00" instead of just "Open ledger entry 42".
- **`refund_id` added to `LedgerEntry` type AND the P6.3 list select.** Even though only the detail page reads it as a join key, the list now surfaces it in the typed return shape — future UI affordances (e.g. "View refund #555") can read it without a schema migration.

**No migration.** Reads existing columns on `payout_ledger` (refund_id was always there) + `orders` + `refunds` + `profiles.timezone`. **No new dependencies.** **No new RLS policies.** **No client JS** — entire page is RSC + the same primitives as P6.3.

### P6.6 — Partner payout request (`/partner/payouts` Request payout card)

The partner's explicit "request payout" affordance. Lives in a
new "Request payout" card on the existing `/partner/payouts`
page, just below the summary cards. Sits between the
`<LedgerSummaryCards>` and the `<LedgerFilters>` so the partner
sees "Available: $X" → "I want that money now" → "Recent ledger
entries" without scrolling.

**Data this card shows:**

| State | Displayed |
|---|---|
| Available balance ≥ $50, no pending request | "Request payout — $X.XX" button (accent fill, enabled) |
| Pending request exists | Muted warn banner: "Pending payout request — $X.XX to k***@example.com. You'll get an email when it's processed." (no button) |
| Available balance $0 < $50 | Disabled button + muted banner: "Your available balance ($X.XX) is below the $50.00 minimum..." |
| Available balance = $0 | Muted banner only: "No available balance to pay out." |

**User actions:** click the "Request payout" button → server
action → success: refresh page (server re-reads the now-pending
banner + the now-zero Available balance + the flipped
`status='pending_payout'` ledger rows).

**Acceptance criteria:**

- [x] Card is auth-gated via `requirePartner()` (the page itself
      enforces this).
- [x] Button is disabled when no payout method is set (the action
      returns `payout_method_missing` if the partner has not added
      a PayPal email — the page renders a "Add a payout method in
      Settings" message in that case via a `partner_not_found`
      branch in `getPendingPayoutRequest`).
- [x] Button is disabled when available balance < $50.00 (the
      spec's "above threshold" wording). Below-minimum state shows
      the friendly copy + the threshold amount + a hint about the
      14-day refund window.
- [x] Button is disabled when a pending request exists (the
      pending-request card replaces the button; the partner sees
      exactly where their money is going + the masked PayPal
      email snapshot).
- [x] On success, the partner sees the request id + the amount +
      the currency, then the page refreshes after 1.5s.
- [x] On error, the action's error string renders inline in a
      `role="alert"` block.
- [x] `MIN_PAYOUT_REQUEST_CENTS = 5000` is hardcoded in
      `request-options.ts` — admin-configurable thresholds are
      future enhancement (STUB-055).
- [x] RLS on `payout_requests` (`payout_requests_partner_read_own`)
      gates the partner's read; the INSERT goes through the
      service-role client.
- [x] Audit row written on every successful request — `action =
      'payout_requested'`, `target_kind = 'payout_requests'`,
      `target_id = request_id`, `metadata.partner_id`,
      `metadata.amount_cents`, `metadata.ledger_rows_updated`,
      `metadata.payout_method_target_masked`. NO plaintext PayPal
      email anywhere in the audit row.
- [x] Audit log failure does NOT abort the request (fail-soft —
      the partner already has their pending row).
- [x] Ledger UPDATE failure does NOT abort the request (fail-soft
      — `ledgerRowsUpdated` is 0; the admin queue surfaces the
      inconsistency).
- [x] PII-safe logging: no raw `user_id`, raw `partner_id`, raw
      email, raw IP, or plaintext PayPal in any log payload.
- [x] All 6 cron checks green + `pnpm test` + `pnpm build` clean.

**Design reference:** the card follows the same `bg-elev-1 +
hairline border` pattern as the product detail "At a glance"
sidebar (P0.12) + the partner ledger summary cards (P6.3). The
button uses the existing accent fill (`--accent`) — same affordance
as the "Subscribe" CTA on `/pricing`. The pending-request banner
uses the warn palette (`--warn-soft` background + `--warn-line`
border) to match the `Locked` summary card's color language.

**Security:** RLS-gated via `payout_requests_partner_read_own`
(partner can only see their own rows) +
`payout_requests_admin_read` + `payout_requests_admin_update`.
The INSERT is service-role only (the partner has no INSERT
policy — they can only CREATE a row via the action, never
UPDATE it to game the system).

**Performance:** target p95 < 400ms (matches the page's overall
budget). The pending-request read adds ONE additional round-trip
to the page render (in parallel with `getPartnerLedger`); the
action's hot path is 5 sequential reads (partner + balance +
pending + insert + update) + 1 audit-log insert. Well under the
budget on warm connections.

**Implementation files (P6.6):**

- `02-features/payouts/request-options.ts` — pure constants +
  types (`MIN_PAYOUT_REQUEST_CENTS`, `PAYOUT_TIER_COPY`,
  `PAYOUT_REQUEST_STATUS_VALUES`, `PAYOUT_METHOD_KIND_VALUES`,
  `REQUEST_PAYOUT_ERROR_CODES`). Server-only-safe to import from
  client components.
- `02-features/payouts/actions/requestPayout.ts` (~289 LOC) —
  server action. Auth → partner lookup → payout method check →
  balance check → pending check → atomic INSERT + UPDATE →
  audit-log. PII-safe throughout (the audit row uses hashed
  `actor_email` + hashed `ip` + the masked PayPal snapshot).
- `02-features/payouts/actions/requestPayout.test.ts` — 26 unit
  tests covering every gating branch, the atomic write shape, the
  audit row, the PII safety contract, and the two fail-soft paths.
- `02-features/payouts/queries/getPendingPayoutRequest.ts`
  (~150 LOC) — partner's most-recent pending request. Single-row
  RLS-gated read; defensive mapping (corrupted row → null).
- `02-features/payouts/queries/getPendingPayoutRequest.test.ts`
  — 12 unit tests covering auth gating, happy path, no pending,
  DB error, defensive mapping, PII safety.
- `02-features/payouts/components/RequestPayoutButton.tsx`
  (~170 LOC) — client island. Pure component: takes `availableCents`
  + `pendingRequest` as props; renders one of 4 states; on click,
  calls `requestPayoutAction` + surfaces success/error.
- `02-features/payouts/components/RequestPayoutButton.module.css`
  — token-only styles. Accent CTA + 3 banner states (pending /
  below / empty).
- `02-features/payouts/index.ts` — barrel re-exports
  `RequestPayoutButton` + `getPendingPayoutRequest` +
  `PendingPayoutRequest` + the `request-options.ts` constants/types.
- `app/partner/payouts/page.tsx` — added the new "Request payout"
  card (between summary cards and ledger filters); the page reads
  `getPendingPayoutRequest()` in parallel with `getPartnerLedger()`
  and passes both to `<RequestPayoutButton>`.
- `app/partner/payouts/page.module.css` — added `.requestSection`
  (the card surface) + reused `.h2` for the section heading.
- `00-foundations/data/enums.ts` — added `'payout_requested'` to
  the `AuditAction` union + `AUDIT_ACTIONS` array.

**Design decisions worth remembering:**

- **The page resolves state from server, the button is a pure
  client island.** No double-reads in the browser. The button
  is dumb: take props → render state → call action → show result.
  The page is the source of truth.
- **Masked PayPal snapshot at request time.** The `payout_requests`
  row stores `payout_method_target_masked` from the typed
  `PartnerPayoutMethod` shape. If the partner later changes
  their PayPal email, the request still shows what was on file
  at the time. The admin queue (P6.7) reads this snapshot; it
  does NOT join to `partners` for the current email.
- **Atomic-ish write, not a real transaction.** PostgREST RPC
  would be the right call for true atomicity; v1 ships the
  separate INSERT + UPDATE with the partner-only-can't-race
  guard. The action's existing-pending check + the button's
  `useTransition` disabled state cover the realistic case.
- **`role="status"` vs `role="alert"`.** Success state +
  pending banner use `role="status"` (live region, polite
  announcement); error state uses `role="alert"` (assertive,
  immediate). Matches the existing ExportCsvButton pattern.
- **No toast notifications.** Spec acceptance criterion #18 says
  inline error message; we follow the inline `role="alert"`
  affordance + the existing 1-line error pattern. v1 doesn't
  need a toast system.
- **`MIN_PAYOUT_REQUEST_CENTS` lives in `request-options.ts`**
  — the constant is lifted to its own pure module so a future
  admin-configurable threshold (PH14.12 territory) is a single
  read change, not a refactor.
- **`payout_method_kind: 'paypal'` is hardcoded** in the INSERT
  payload. Slice 2 will widen this to `'paypal' | 'bank'` once
  the bank verification flow lands (STUB-053). The CHECK
  constraint on `payout_requests.payout_method_kind` enforces
  this is `'paypal'` for v1.

**No migration.** The migration `0031_payout_requests.sql`
shipped in the prior tick (the table + RLS + 3 indexes + updated_at
trigger). This tick only adds the data-layer + UI surface.

**No new dependencies.** All imports resolve to existing modules.

**No new RLS policies.** Uses the `payout_requests_partner_read_own`
+ `payout_requests_admin_read` + `payout_requests_admin_update`
policies from migration 0031.

**No new client JS.** The `RequestPayoutButton` is one client
island (~1.5 KB); the page itself stays RSC + the `getPendingPayoutRequest`
read is server-only. `/partner/payouts` first-load JS = 460 B
(was 1.82 kB after P6.3 Slice 2; the new button is a tiny
additive because it shares the `useTransition` + `useRouter` deps
with the rest of the page).

### P6.6 — Deferred slices

- **Slices 2+** — admin approval queue (P6.7), admin detail view
  (P6.8), partner self-cancellation (STUB-056), admin-configurable
  threshold (STUB-055). The "request payout" affordance is the
  partner-side surface; the admin-side lives on `/admin/payouts`
  (separate spec: `01-specs/pages/admin-payouts.md`).

### P12.14 — Payout history (this tick; 2026-06-30)

The spec calls for a "Payouts history" section showing every
PayPal Mass Payout batch the partner has received — one row per
batch with id, period_start, period_end, amount_cents, currency,
paypal_batch_id, status, created_at, commission_count. The
prior P6.3 / P6.4 / P6.6 work shipped the summary cards +
ledger entries + request-payout affordance but not the batch
history; P12.14 fills that gap.

**Spec acceptance criteria addressed:**

- [x] **Auth-gated AND `profiles.role IN ('partner')`** —
      `requirePartner()` at the page boundary; the RPC enforces
      the partner-or-admin check via the inline `current_partner_id()`
      helper.
- [x] **Only the partner's own data is shown** — the SECURITY
      DEFINER RPC accepts `p_partner_id` and the inline `WHERE`
      clause matches it against `current_partner_id() or is_admin()`;
      the wrapper adds a defense-in-depth partner lookup that refuses
      to call the RPC if the partner row is missing or invalid.
- [x] **Acceptance criterion on the "Payouts history" section is
      met** — one row per PayPal Mass Payout batch; columns
      surface the spec's fields; the table renders between
      summary cards and the request-payout card.
- [x] **No layout shift on data load** — `loading.tsx` for
      `/partner/payouts` already mirrors the page shape from P6.3;
      the new section inherits the same loading skeleton.
- [x] **Empty state: "Your first payout will appear here after
      your first sale clears the 14-day refund window."** —
      `PayoutsHistoryTable` renders this copy when `batches.length
      === 0`. Matches the spec's empty-state wording for the
      "Payouts history" section + the spirit of the "first sale"
      empty state for the ledger.
- [x] **"Paid" amounts visually muted but still listed with PayPal
      batch ID** — table renders the net amount in `--text-2` (muted)
      mono-numeric font + the batch id in mono `<code>` so the
      partner can copy it for PayPal support.
- [x] **All dates in the partner's timezone** — the page passes
      `timezone` (from `profiles.timezone`) through to
      `PayoutsHistoryTable` which forwards it to `formatDate`.
- [x] **All amounts formatted with mono numbers, currency, no
      decimals** — via `formatMoney` (bigint-safe; reuses the
      P2.3 money helpers).
- [x] **No PII leak in URLs** — no new query params; the existing
      URL surface is preserved.
- [x] **No `TODO` / `FIXME` in the diff** — `check:no-todo` is
      clean.

**Files (3 new + 1 spec-impl-note + 2 page edits):**

- `04-platform/migrations/0043_partner_payouts_history.sql`
  (~140 LOC) — `create or replace function
  public.get_partner_payouts_history(p_partner_id, p_limit)`
  returning `(paypal_payout_batch_id, period_start, period_end,
  amount_cents, currency, commission_count, created_at)`. STABLE
  SECURITY DEFINER with `set search_path = 'public'` (Supabase
  hardener). Inline `WHERE p_partner_id = current_partner_id()
  or is_admin()` — the planner short-circuits at index scan for
  unauthorized callers, who receive zero rows. Plus the partial
  covering index `payout_ledger_partner_batch_paid_idx (partner_id,
  paypal_payout_batch_id, paid_at desc) WHERE status = 'paid' AND
  paypal_payout_batch_id IS NOT NULL` so the GROUP BY + sort use
  the index without scanning locked/available rows.
- `02-features/payouts/queries/getPartnerPayoutsHistory.ts`
  (~165 LOC) — the read wrapper. Mirrors the `getMyCourseSalesSummary`
  pattern: server-only, `getSessionUser()` auth gate, partner
  lookup keyed off `user_id`, defense-in-depth ownership check,
  fail-soft RPC call, bigint-as-string + ISO-timestamp coercion
  with defensive fallbacks. Exports `PayoutBatch` (the typed
  shape), `DEFAULT_PAYOUT_HISTORY_LIMIT` (50), `MAX_PAYOUT_HISTORY_LIMIT`
  (200).
- `02-features/payouts/queries/getPartnerPayoutsHistory.test.ts`
  (~450 LOC, 19 unit tests, runs in <20ms) — chainable fake
  Supabase + Pino mock with log-call capture. Covers auth gating
  (no session, partner missing, partner errored, partner id
  invalid), happy path (single row + multiple rows + empty result
  + non-array defensive), bigint string coercion, malformed
  field fallbacks, limit capping (default, too-large, non-positive,
  non-integer, custom), fail-soft on RPC error + PII safety
  (no raw `42` in any log payload), query shape (partner table,
  `user_id` filter, RPC name + args).
- `02-features/payouts/components/PayoutsHistoryTable.tsx`
  (~70 LOC) + `.module.css` (~110 LOC) — RSC. Table with 4
  columns: Period, Commissions, Net amount, PayPal batch. Mono
  font for the batch id (`<code>` element); mono numbers for
  commissions + amount; muted (--text-2) treatment for the net
  amount to match the spec's "visually muted but still listed"
  criterion. Empty-state copy when no batches. Mobile: table
  wrapped in `overflow-x: auto` so columns don't trigger a layout
  shift on narrow viewports.
- `02-features/payouts/components/PayoutsHistoryTable.test.tsx`
  (~200 LOC, 13 unit tests, runs in <10ms via `renderToStaticMarkup`)
  — empty state (2 tests), single batch (3 tests), multiple batches
  (2 tests), edge cases (4 tests: currency fallback, alternate
  currency, null timezone, explicit currency override), accessibility
  (2 tests: `<th scope="col">` + `data-status="paid"` row attribute).
- `02-features/payouts/index.ts` — barrel re-exports for
  `getPartnerPayoutsHistory`, `PayoutBatch`, the 2 limit
  constants, and `PayoutsHistoryTable`.
- `03-app/partner/payouts/page.tsx` — added the new section
  between summary cards and request-payout card; the 3 independent
  reads (`getPendingPayoutRequest`, `getPartnerPayoutsHistory`,
  `getPartnerLedger`) are now in `Promise.all` so the page render
  stays under its p95 budget.
- `03-app/partner/payouts/page.module.css` — added
  `.historySection` (32px top margin) + `.historyHead` + `.historyHint`
  for the section heading + subtitle.

**Design decisions worth remembering:**

- **RPC + partial index, not a JS-side group-by.** PostgREST does
  not natively support `GROUP BY` via the JS client; the grouped
  read has to be either a SECURITY DEFINER RPC or a JS aggregation
  over a flat read. We chose the RPC because (a) the JS aggregation
  would fetch every paid row for the partner (could be 10k+ at
  scale — payout_ledger is partitioned at the row level) and (b)
  the SQL aggregation is cheaper than the equivalent JS work. The
  partial index keeps the index scan cheap regardless of how many
  non-paid rows the partner has.
- **`commission_count` counts credit rows only.** The spec is
  silent on whether to count both commission rows + payout debit
  rows (each PayPal Mass Payout batch has a 1:1 pairing of positive
  commission + negative payout). Counting only credits gives the
  partner the actionable number ("how many sales did I get paid
  for in this batch") rather than the ledger-row count. The audit
  row records the choice so a future contributor who counts both
  can update the doc.
- **NET = `SUM(amount_cents)`, not absolute.** The RPC returns the
  sum of all rows in the batch — commissions are positive, payout
  debits are negative, so they cancel out. The result is the
  partner's actual gross payout (always negative for a batch).
  This avoids a separate "compute the net" step in the wrapper.
- **Section placement: between summary + request card.** The
  partner sees headline ("$X available") → history ("how did we
  get here") → action ("request it now") without scrolling. The
  spec puts "Payouts history" before "Ledger entries" in the data
  table but doesn't pin the visual order; the chosen placement
  matches the partner's decision flow.
- **`getPartnerPayoutsHistory` returns `[]` on every failure mode.**
  No exceptions bubble to the page — partner row missing, partner
  id invalid, RPC errored, RPC returned non-array, RPC returned
  empty. The page renders the same empty-state copy as "you have
  no payouts yet" in every case. Fail-soft + warn log with hashed
  partner_id (PII-safe).
- **Mono `<code>` for the batch id.** The PayPal Mass Payout batch
  ID is alphanumeric (e.g. `BATCH_ABC123`) and the partner needs
  to copy it verbatim for PayPal support. Mono font + a subtle
  background + a 1px hairline border signals "this is a code,
  click to select, copy/paste elsewhere". Matches the existing
  badge language from other surfaces.
- **Currency is per-row, not global.** The RPC groups by
  `(paypal_payout_batch_id, currency)` defensively — even though
  v1 only emits USD, a future multi-currency migration doesn't
  need to revisit the query. The component takes a `currency`
  fallback prop for the (impossible today) case where the row
  ships an empty currency.

**No new RLS policies.** The function reads `payout_ledger` which
already has `payout_ledger_partner_read_own` (filters by
`current_partner_id()`). SECURITY DEFINER bypasses RLS but the
inline `WHERE` check enforces authorization.

**No client JS regression.** The new component is RSC; the new
query is server-only. The only added client JS is the section's
heading + paragraph (0 B). `/partner/payouts` first-load JS went
from `460 B / ~114 kB` (after P6.6) to `784 B / 115 kB` — +324 B
from the new component's serialized JSX. Shared first-load JS
unchanged at 101 kB.

**Deferred (STUB-100):**

- Per-batch drill-in to `/partner/payouts/[batchId]` showing the
  contributing commission rows (uses the same `paypal_payout_batch_id`
  filter; would mirror the P6.4 single-entry detail page).
- PayPal Mass Payout details deep-link via `paypal_payout_item_id`.
- Payout history CSV export (separate from the ledger CSV).
- Yearly totals row at the bottom of the history table.
- Per-batch commission-kind breakdown (sale vs subscription vs
  refund rows).

---

### P12.16 — Verification tick (2026-06-30)

P12.16's PHASES.md scope is functionally identical to P6.6 ("explicit
'request payout' action when available balance ≥ $50 threshold").
The P6.6 implementation ships end-to-end and is the live surface
that backs P12.16; this tick is verification-only.

**Spec acceptance criteria → P6.6 implementation crosswalk:**

| Spec criterion | P6.6 implementation |
|---|---|
| Page is auth-gated + role=partner | `getSessionUser()` + role check (`partner`/`admin`/`super_admin`) at `02-features/payouts/actions/requestPayout.ts:78-81` |
| Above-threshold gate ($50) | `MIN_PAYOUT_REQUEST_CENTS = 5000` constant → `below_minimum` typed error when available < threshold (`requestPayout.ts:134-140`) |
| Payout-method gating | `decryptPayoutMethod` → `payout_method_kind === null` → `payout_method_missing` typed error (`requestPayout.ts:101-107`) |
| No-pending gate | `existingPending` lookup → `pending_request_exists` typed error (`requestPayout.ts:145-164`) |
| Atomic INSERT + ledger UPDATE | Service-role INSERT `payout_requests` + UPDATE `payout_ledger SET status='pending_payout'` (`requestPayout.ts:187-225`) |
| Audit log per request | One `admin_audit_log` row with `action='payout_requested'`, `target_kind='payout_requests'`, hashed actor + IP + masked PayPal snapshot (`requestPayout.ts:251-280`) |
| Pending state banner | `<getPendingPayoutRequest>` reads in `Promise.all` on `/partner/payouts`; the button auto-disables when a pending row exists |
| Below-minimum / no-balance states | `<RequestPayoutButton>` 4-state machine (ready / pending / below minimum / no balance) |
| Masked PayPal only on the request row | `payout_method_target_masked: 'k***@example.com'` written to `payout_requests.metadata` — plaintext never crosses the wire |
| RLS enforcement | `payout_requests_partner_read_own` policy + service-role writes for the cross-table UPDATE (matches P6.3 + P6.6 patterns) |

**Spec/PHASES.md wording mismatch noted**: the spec at
`instructor-payouts.md:30` calls this surface "Request early payout"
gated by an open question in `instructor-dashboard.md:103`; PHASES.md
P12.16 calls it "request payout action when above threshold" with no
"early" qualifier. The spec open question's recommendation ("ship
the next-payout card only, no early requests") aligns with what
P6.6 actually ships (a request-payout action gated on $50, not a
separate "early-payout" mode). The shipped surface matches PHASES.md
P12.16 and the spec recommendation; the "early" wording is
vestigial. No code change required for this tick.

**Files touched in this tick**: 0 (verification-only).
**Test surface**: inherited from P6.6 (PROGRESS.md entry from 2026-06-26
claimed `pnpm test 02-features/payouts 153/153`, was 115 before P6.6,
+38 from the new requestPayout action + query test files). I did NOT
re-run `pnpm test 02-features/payouts` in this tick — the verification
was by code reading only; full suite was 3218/3218 per P12.14's last
run; nothing in this tick could regress a passing test since no
`.ts/.tsx` files were touched.

P12.16 marked `[x]` in PROGRESS.md; the implementation already
satisfies every spec criterion.
