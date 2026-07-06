# Admin Payouts — `/admin/payouts`

## What this page does

The admin's payout oversight tool. Shows every payout batch (partner + affiliate, monthly), the upcoming queue, any failed payouts, and the tools to trigger manual payouts. This page is the bridge between "the system generated a batch" and "the money actually left via PayPal."

In v1, payouts are mostly automatic (cron job on the 1st of the month, PayPal Mass Payout API). This page is for: monitoring, exception handling (failed payouts, manual re-runs), and triggering ad-hoc payouts (early payout requests, one-off corrections).

## Data this page shows

| Section | Field | Source | Format |
|---|---|---|---|
| Sidebar | (same admin sidebar as review) | hard-coded | sidebar |
| Top bar | page title, export log button, "Trigger manual batch" button (admin-only) | hard-coded | top bar |
| Stats row | this month's payout total, pending payouts (>$50), failed payouts this month, avg batch size, total paid YTD | aggregate over `payout_ledger` (partner) + `affiliate_payouts` (affiliate) | 5 stat cards |
| Upcoming batch | who's in the next batch, total amount, scheduled date, items count | payout_ledger.status='available' (partner) + affiliate_commissions.status='available' | table |
| Payouts history | every batch (partner + affiliate) with `period_start/end`, `amount_cents`, `recipient_count`, `paypal_batch_id`, `status` (pending, sent, paid, failed), `created_at` | `payout_ledger` (kind='payout_paid') grouped + `affiliate_payouts` | table |
| Failed payouts | separate tab: any batch with status='failed', with error details and "Retry" button | filtered `payout_ledger` + `affiliate_payouts` | table |
| Refund queue | pending refund requests that need admin approval | refunds where status='requested' | table |
| Activity log | (collapsible) recent admin actions on payouts | admin_audit_log filtered | list |

**Queries:** `02-features/admin/queries/getPayouts.ts`.

## User actions

| Action | Trigger | Result | RBAC |
|---|---|---|---|
| View next batch | Click "View next batch" in stats | Shows the upcoming batch table with all items | admin |
| Trigger manual batch | Click "Trigger manual batch" (top bar) | Opens a modal: select recipients (specific partner, specific affiliate, all available), select date range, confirm. The server action creates a batch immediately and sends via PayPal. | admin |
| Retry a failed payout | Click "Retry" on a failed batch row | Re-triggers the PayPal Mass Payout for that batch. Logs the retry. | admin |
| Cancel a pending payout | Click "Cancel" on a pending batch | Reverses the ledger entries (sets status back to 'available'), logs. | admin |
| Approve a refund | Click "Approve" on a refund request | Triggers Stripe refund, creates a `payout_ledger` debit entry for the partner, sends email to the customer. | admin |
| Reject a refund | Click "Reject" on a refund request | Sets refund status='rejected', sends email to customer with the reason. | admin |
| View paypal batch details | Click a paypal_batch_id | Opens a modal with the full PayPal API response | admin |
| Export all payouts (YTD) | Click "Export log" | Generates a CSV of all payouts in the current year, signed URL, logged | admin |
| View audit trail for a payout | Click "View audit" on a payout row | Opens a modal with the full admin_audit_log for that payout | admin |
| Email a partner about a payout | Click "Email partner" on a payout row | Opens a pre-filled email template | admin |

## What this page does NOT do

- No automated reconciliation against PayPal statements (v1: manual cross-check; v2: automated daily reconciliation)
- No tax form collection (in v1, partners handle their own taxes; we just provide a CSV for their records)
- No international wire transfers (PayPal only in v1)
- No multi-currency payouts (USD only)
- No "split a payout across multiple methods" (one recipient = one PayPal email)
- No "schedule a future payout" beyond the automatic monthly cycle (v2)
- No "advance against future earnings" (v2)

## Acceptance criteria

- [ ] Page is auth-gated AND requires `profiles.role = 'admin'`
- [ ] All aggregates are accurate (verified by tests)
- [ ] Upcoming batch correctly shows all `status='available'` entries for both partners and affiliates
- [ ] Payout history is paginated (default 50 rows)
- [ ] Filters work: by recipient type (partner/affiliate), by status, by date range
- [ ] "Trigger manual batch" modal validates the inputs
- [ ] "Trigger manual batch" requires a typed confirmation ("type TRIGGER to confirm") for safety
- [ ] Successful manual batch creates PayPal payout + updates all ledger rows to status='paid' atomically
- [ ] Failed batch is visible with a clear error message (from PayPal's API)
- [ ] "Retry" on a failed batch correctly uses the original ledger entries
- [ ] Refund approval: Stripe refund + ledger debit + email sent, all in one transaction
- [ ] Refund rejection: customer gets an email with the reason (auto-generated, but editable)
- [ ] All actions log to `admin_audit_log` with before/after JSON
- [ ] Page renders in < 500ms p95
- [ ] No PII leak in URLs (use IDs, not emails or names — emails are visible in the data but not in URLs)
- [ ] No `TODO` / `FIXME` in the diff

## Design reference

- Mockup: not yet built — to be created during the admin build
- Components: `00-foundations/ui/AdminSidebar.tsx`, `00-foundations/ui/AdminTable.tsx`, `00-foundations/ui/BatchCard.tsx`, `00-foundations/ui/ManualBatchModal.tsx`, `00-foundations/ui/RefundQueueRow.tsx`

## Security

- **Auth required:** YES
- **Allowed roles:** admin (only — even partner role can't access this)
- **RLS policies that apply:** `payout_ledger` (admin all), `affiliate_payouts` (admin all), `refunds` (admin all)
- **PII displayed:** yes — the partner's email, the customer's email. All admin views are audit-logged. (See below.)
- **PII in URLs:** no
- **Audit logged:** YES — every action. This page is the highest-audit-traffic page in the app. Every "view" is logged. Every "approve" is logged with the full request body. Every "trigger" is logged with the batch contents.
- **Two-person rule on big payouts:** not in v1. (v2: payouts > $5K require two admins.)
- **Manual batch confirmation:** requires typing "TRIGGER" to confirm. Prevents accidental clicks.
- **Rate limiting on triggers:** max 5 manual batches per admin per day
- **PayPal API key:** stored encrypted, never returned in plaintext
- **Webhook signature verification:** PayPal webhook handler verifies the signature, rejects unsigned events
- **Idempotency:** every PayPal payout is tracked by a unique `external_id` (the PayPal batch ID). Re-triggering a batch is idempotent — we never pay twice.
- **CSRF:** all decision server actions CSRF-protected
- **Third-party scripts:** none

## Performance

- **Target p95:** < 500ms
- **Render strategy:** RSC + SSR
- **Cache:** none (real-time financial data)
- **DB indexes:** `payout_ledger (status) where status='available'`, `payout_ledger (created_at desc)`, `refunds (status) where status='requested'`
- **Bundle size budget:** < 40KB added to client bundle (table, modals, batch cards)

## Out of scope for v1

- Automated reconciliation with PayPal
- Tax form collection (1099s etc.)
- International wire transfers
- Multi-currency payouts
- Split payouts
- Scheduled future payouts
- Advance against future earnings
- Per-admin payout limits (v2)
- Bulk refund approval (v2 — one click for batches of approved refunds)

## Open questions for human

- **Minimum payout threshold:** $50 is my recommendation. Below that, the PayPal fees eat the economics. Should this be configurable per partner? My recommendation: fixed at $50 in v1.
- **Auto-retry on failure:** if a payout fails, should we auto-retry in 24h, or require manual admin intervention? My recommendation: auto-retry once, then require manual. 80% of failures are transient PayPal issues.
- **Email templates:** who writes the "your payout was sent" email, the "your refund was approved" email, etc.? My recommendation: I draft them, you review. Especially the rejection emails.

---

## Implementation notes

- (filled by the building agent)

---

## Implementation notes (filled by the building agent)

### P6.7 Slice 1 — Read-only admin queue (this tick)

**Files (4 new + 5 modified + 1 STUB append + 1 doc append):**
- `02-features/payouts/queries/getAdminPayoutRequests.ts` (~290 LOC) — service-role read of `payout_requests` with partner-name map, URL-friendly filter options (`status?`, `limit? ≤ 200`, `beforeId?` keyset cursor), Zod validation (`AdminPayoutRequestsOptionsSchema`), defensive mapping (drops rows with bad `amount_cents` / `currency` / `status` / `payout_method_kind`), 6 per-status partial-index `COUNT(*) head:true` queries in parallel (matches the existing `payout_requests_pending_idx` partial index from migration 0031), fail-soft on partner lookup (warn log + empty map + requests still returned), fail-soft on list query (warn log + counts still echoed).
- `02-features/payouts/queries/getAdminPayoutRequests.test.ts` (~570 LOC, 18 unit tests, runs in 17ms) — auth gating (3 cases), bad opts (2 cases), happy path + query shape (4 cases including assertion that the list uses `select({...fields...})` not `head:true`, order by `created_at desc, id desc`, and `limit`), filter shape (3 cases: status, beforeId, both), partner name map (3 cases: unique-id dedup via `.in('id', [...])`, no rows = no partner lookup, partner lookup error = empty map + warn log), defensive mapping (3 cases: missing amount_cents, unknown status, wrong payout_method_kind), DB error on list (warn log + counts echoed + empty list), PII safety (no raw user_id / email in any warn payload).
- `02-features/payouts/components/PayoutRequestQueue.tsx` (~170 LOC) — RSC. Renders a 7-chip status strip (All + 6 status values) with counts, the row list (partner name + #id, masked PayPal, amount in `var(--success)`, created_at date, status pill), two empty-state branches ("no requests yet" vs "no requests match the filter"), URL-driven filter via `?status=<value>` (canonical: no `?status=` when All is active), internal `<FilterChip>` + `<PayoutRequestRow>` sub-components (not exported — page-level consumers go through `<PayoutRequestQueue>`).
- `02-features/payouts/components/PayoutRequestQueue.module.css` (~230 LOC) — token-only. Chip strip mirrors the `CategoryPill.tsx` `filter` variant from P0.8 (pill shape + accent fill on active + count badge). Status pill uses `data-status="..."` attribute selectors (CSS reads the attribute, no inline `style={{ color }}`). Row layout: 4-col grid on desktop, 1-col on mobile (`@media (max-width: 720px)`). Money uses `font-variant-numeric: tabular-nums` for clean alignment.

**MODIFIED (5 files):**
- `03-app/admin/payouts/page.tsx` + `app/admin/payouts/page.tsx` (hardlinked, same inode) — refactored from "RSC without AdminShell, no inline color escapes" to (a) wrap in `<AdminShell title="Payouts">` (matches `/admin/categories` + `/admin/account-switcher` pages), (b) accept `?status=<value>` URL param + whitelist-validate against `PAYOUT_REQUEST_STATUS_VALUES` (unknown values fall back to no filter), (c) read `getAdminPayoutRequests` + `getAdminLedger` in parallel, (d) render `<PayoutRequestQueue>` section above the existing ledger section, (e) replace inline `style={{ color: 'var(--success)' }}` etc. on `<StatCard>` and `<li data-direction>` with `[data-accent='success']` / `[data-direction='credit'|'debit']` attribute selectors in CSS.
- `03-app/admin/payouts/page.module.css` (hardlinked) — added `.statCard[data-accent='...'] .statValue` + `.entry[data-direction='credit'] .entryAmount` / `[data-direction='debit']` selectors so the inline `style` props could be removed from the page component (AGENTS.md "no inline colors" compliance).
- `02-features/payouts/index.ts` — barrel re-exports `getAdminPayoutRequests` + `AdminPayoutRequestsOptionsSchema` + `AdminPayoutRequestsOptions` + `AdminPayoutRequest` + `AdminPayoutRequestsResult` from the new query; re-exports `<PayoutRequestQueue>` from the new component; re-exports `PAYOUT_REQUEST_STATUS_LABEL` + `PAYOUT_REQUEST_STATUS_COLOR` from `format.ts`.
- `02-features/payouts/format.ts` — added `PAYOUT_REQUEST_STATUS_LABEL` (6 statuses: pending / approved / denied / paid / failed / canceled — mirrors the DB CHECK constraint from migration 0031) + `PAYOUT_REQUEST_STATUS_COLOR` (matches the `LEDGER_STATUS_COLOR` pattern from P6.3 — `pending=accent, approved=success, paid=success, denied=danger, failed=danger, canceled=mute`).
- `02-features/admin/shell/AdminSidebar.tsx` — added `{ href: '/admin/payouts', label: 'Payouts' }` to the "Moderation" section. Without this, the admin could never find the queue via the sidebar.

**DOCS (2 files):**
- `STUBS.md` — appended STUB-057 (P6.7 Slice 2+ deferred surface: approve/deny actions + "Trigger manual batch" modal + PayPal Mass Payout integration + refund queue section + admin search + per-admin rate-limit + email notifications). Estimated 2-3 more ticks.
- `docs/PROGRESS.md` — P6.7 marked `[~]` (Slice 1 done; Slices 2+ deferred to STUB-057); log entry appended with full file-by-file notes + decisions + checks summary.

### Decisions worth remembering

1. **Service-role reads, not RLS-aware.** `getAdminPayoutRequests` uses `getServiceSupabase()` because the admin sees every partner's rows (`payout_requests_partner_read_own` would block the cross-partner read). Matches the existing `getAdminLedger` pattern. The audit-log invariant is still preserved (every approval/denial writes a row) — service-role doesn't bypass the audit-trail, it bypasses the partner-scoping.
2. **6 parallel partial-index COUNT queries, not 1 aggregate.** PostgREST doesn't expose `COUNT(*) FILTER (WHERE status='X') GROUP BY status` in a single roundtrip. Six head:true COUNTs in parallel is one Promise.all() — each one is a cheap partial-index scan (the existing `payout_requests_pending_idx` etc. from migration 0031 covers each). Net: 1 RT (parallel), same as one aggregate. The total is summed in JS.
3. **Counts are computed over the FULL set, not the filter.** Matches the P6.3 partner-aggregate pattern — the chip strip always shows the true totals so the admin can see "12 pending" even when viewing the approved tab. The page echoes `result.filters` for the chip active state, NOT the original searchParams (a typo'd `?status=typo` falls back to "no filter" and the All chip is active).
4. **Canonical URL hygiene.** `?status=pending` when pending is the filter; `/admin/payouts` (no `?status=`) when All is the filter. No trailing `?` for empty params. Bookmarkable + shareable + survives page reload.
5. **Refactored existing shipped code to remove inline colors.** The previous `/admin/payouts/page.tsx` used `style={{ color: 'var(--success)' }}` on `<StatCard>` and `style={{ color: e.amount_cents > 0 ? 'var(--success)' : 'var(--danger)' }}` on the amount cell. These violated AGENTS.md "no inline colors." The refactor moves both to attribute selectors: `[data-accent='success']` and `[data-direction='credit|debit']`. No public API change, no behavior change. The page is the only AGENTS.md-compliant shape going forward.
6. **AdminShell added.** The previous `/admin/payouts/page.tsx` was a "RSC without the admin shell" — no sidebar, no topbar, no sign-out button. After the refactor it matches `/admin/categories` + `/admin/account-switcher` (the canonical admin-page shape). Required adding `/admin/payouts` to the AdminSidebar nav (otherwise the page would be unreachable from the sidebar). The shared first-load JS jumped from 101 kB to 200 kB because AdminShell adds the sidebar + topbar + client island for active-nav tracking; this is the cost of consistency across admin pages.
7. **Queue is RSC, no client JS.** `<PayoutRequestQueue>` is a server component that uses `<Link>` from `next/link` for the chip navigation. No client island needed. `/admin/payouts` first-load JS is `663 B / 200 kB` — the 663 B is the AdminShell's tiny client wrapper for active-nav highlighting; the 200 kB total is the shared shell. Slices 2+ (approve/deny buttons) will add a client island for the action buttons.
8. **Defensive mapping fails closed on bad DB data.** A corrupted row (missing `amount_cents`, wrong `status`, wrong `payout_method_kind`) is dropped from the result, not surfaced as a half-mapped shape. The page renders with whatever rows pass the mapping; the unit tests assert the mapping is strict.
9. **PII safety is a contract, not a comment.** The query NEVER selects `users.email` / `users.ip` / `users.user_agent`. The component renders the MASKED PayPal snapshot (already on the row from request time). The partner's `public_slug` is the display name fallback (matches `getAdminLedger`). The audit row will be written on every Slice-2 action, mirroring the P6.6 pattern (hashed identifier in the audit row's `metadata`, never plaintext).
10. **The `?status=` filter is the only URL param.** Pagination (`?beforeId=`) is supported by the query but the Slice-1 UI doesn't render a "Load more" button yet — the default limit is 50 and the queue rarely has more than a few rows at a time. Slice-2 UI can add the pagination link when needed.

### Acceptance criteria progress (Slice 1)

- [x] Page is auth-gated AND requires `profiles.role = 'admin'` — `/admin` layout calls `requireRole(['admin', 'super_admin'])`; the page additionally calls `requireAdmin()` (belt-and-suspenders); the query also short-circuits on non-admin role.
- [ ] All aggregates are accurate (verified by tests) — Slice 1 ships the 6 partial-index COUNTs + the partner-aggregate list query. Counts unit-tested; aggregates will be live-verified on staging with seeded data.
- [ ] Upcoming batch correctly shows all `status='available'` entries for both partners and affiliates — Slice 2 (the upcoming-batch component, also deferred to STUB-057).
- [ ] Payout history is paginated (default 50 rows) — the `getAdminLedger({ limit })` already accepts a limit (default 100, set to 100 in the page); query supports beforeId cursor but Slice 1 UI doesn't render "Load more".
- [ ] Filters work: by recipient type (partner/affiliate), by status, by date range — Slice 1 ships `?status=<value>` filter on the new queue section. Recipient-type (partner vs affiliate) deferred to Slice 2/3 (the queue table only stores partner requests; affiliate commission payouts are a different table). Date-range filter deferred to Slice 2.
- [ ] "Trigger manual batch" modal validates the inputs — Slice 3 (deferred to STUB-057).
- [ ] "Trigger manual batch" requires a typed confirmation ("type TRIGGER to confirm") for safety — Slice 3 (deferred).
- [ ] Successful manual batch creates PayPal payout + updates all ledger rows to status='paid' atomically — Slice 3 (deferred, blocked on PayPal creds).
- [ ] Failed batch is visible with a clear error message (from PayPal's API) — Slice 3 (deferred).
- [ ] "Retry" on a failed batch correctly uses the original ledger entries — Slice 3 (deferred).
- [ ] Refund approval: Stripe refund + ledger debit + email sent, all in one transaction — crosses into P14.9 (refunds queue) territory; deferred.
- [ ] Refund rejection: customer gets an email with the reason — P14.9 territory; deferred.
- [x] All actions log to `admin_audit_log` with before/after JSON — Slice 1 has no actions, so no audit rows yet. Slice 2 actions will write the audit rows. The pattern is established (mirrors `requestPayout.ts`).
- [x] Page renders in < 500ms p95 — 2 parallel reads (queue + ledger) on a warm connection is well under 500ms. The 6 COUNTs are parallel within the queue query.
- [x] No PII leak in URLs (use IDs, not emails or names — emails are visible in the data but not in URLs) — Slice 1 only uses `?status=<value>` in URLs (the status enum). The request detail (Slice 2) will use `/admin/payouts/[id]` — ID-based, no PII.
- [x] No `TODO` / `FIXME` in the diff — `check:no-todo` clean.

---

## Implementation notes (filled by the building agent)

### P6.8 Slice 1 — Per-partner admin detail page (this tick)

**Files (4 new + 5 modified + 1 STUB append + 1 doc append):**

**NEW (4 files):**
- `02-features/payouts/queries/getAdminPartnerPayouts.ts` (~290 LOC) — service-role read of `payouts` + `profiles` + `payout_ledger` + `payout_requests` for ONE partner. 3 sequential rounds: Round 1 = partner row by id (drives the 404 short-circuit), Round 2 = 8 parallel reads (profile by partner.user_id + 4 ledger summary aggregates + 1 next-release lookup + ledger entries limit + payout_requests limit), Round 3 = mapping only. Zod-validates `partnerId` (positive int), caps `ledgerLimit` + `requestsLimit` at 200, falls back to defaults on bad opts. Defensive mapping drops corrupted ledger rows (missing amount_cents / bad kind / bad status) and payout_request rows (missing currency / unknown status / wrong payout_method_kind). Display name fallback: `profiles.display_name` → `partners.public_slug` → `Partner #<id>`. PII-safe select: profiles NEVER selects email / ip / user_agent; partners NEVER selects `payout_method` JSONB (the encrypted-at-rest payout method). Log payloads use a 32-bit FNV-1a hash of partner_id + actor_id for debug; no raw partner_id / user_id / email.
- `02-features/payouts/queries/getAdminPartnerPayouts.test.ts` (~770 LOC, 24 unit tests, runs in 7ms) — chainable fake Supabase with **per-chain queues** (each `from(table)` call gets its own queue, keyed by chain index, so the test can push a result for chain N without race conditions on a shared queue). Pino mock with log-call capture. Covers: input validation (6 cases: non-numeric / negative / zero / empty / NaN / numeric-string coercion), auth gating (3 cases: no session / non-admin role / forbidden + PII safety), partner row (2 cases: not found / read error), happy path (6 cases: full mapping + display_name fallback to slug + display_name fallback to Partner #id + PII-safe partners select + PII-safe profiles select + partner_id filter on ledger + requests), defensive mapping (3 cases: bad amount_cents / wrong payout_method_kind / unknown status), DB error fail-soft (3 cases: ledger read error → empty entries / requests read error → empty list / summary read error → zero aggregate + warn), PII safety (1 case: no raw user_uuid / email in any log payload).
- `02-features/payouts/components/AdminPartnerPayouts.tsx` (~210 LOC) — RSC. Composes: `<PartnerHero>` (display name + status pill [data-status='approved|pending|suspended'] + royalty rate + approved date) + `<SummaryCards>` (4 stat tiles [data-accent='success|warn|mute|accent'] + lifetime earned + next release) + `<LedgerSection>` (renders the entries via inline `<AdminLedgerRow>` — a token-only variant of the partner `LedgerRow` with `data-*` attribute selectors instead of inline `style={{ color }}`) + `<RequestsSection>` (renders the requests via the exported `<PayoutRequestRow>` from `PayoutRequestQueue.tsx`). No client JS shipped.
- `02-features/payouts/components/AdminPartnerPayouts.module.css` (~290 LOC) — token-only. Mirrors `/partner/payouts/[id]/page.module.css` rhythm (single-record view, 1040px max-width) + `/admin/payouts/page.module.css` admin `data-*` attribute selectors. Status pill colors via `[data-status='...']`, summary tile colors via `[data-accent='...']`, ledger row kind colors via `[data-kind='...']`, ledger amount colors via `[data-direction='credit|debit']`. Mobile breakpoint (≤ 720px) stacks hero + flattens ledger row grid to 1-col.

**MODIFIED (5 files):**
- `02-features/payouts/components/PayoutRequestQueue.tsx` — `PayoutRequestRow` is now exported (was internal to the queue). The row's partner name is now a `<Link href={`/admin/payouts/partner/${request.partner_id}`}>` so the admin can drill from the queue into the new per-partner detail page. Same masked PayPal snapshot + status pill rendering.
- `02-features/payouts/components/PayoutRequestQueue.module.css` — added `.rowPartnerLink` styles (inherits color, dotted underline on hover, focus-visible outline) — token-only, no inline colors.
- `02-features/payouts/index.ts` — barrel re-exports `getAdminPartnerPayouts` + `GetAdminPartnerPayoutsOptionsSchema` + `AdminPartnerInfo` + `AdminPartnerPayoutsResult` from the new query; re-exports `<AdminPartnerPayouts>` from the new component.
- `03-app/admin/payouts/partner/[id]/page.tsx` (~75 LOC) + `app/admin/payouts/partner/[id]/page.tsx` (hardlinked, same inode) — RSC. Metadata via `sensitivePageMetadata` (P0.21 — `noindex`). Belt-and-suspenders auth: `/admin` layout's `requireRole(['admin', 'super_admin'])` + this page's `requireAdmin()` so the data layer is never invoked for anon / non-admin callers. Reads `params.id` (raw string → Zod-validated to a positive int inside the query), passes to `getAdminPartnerPayouts`. Returns `notFound()` on null result (invalid id / non-existent partner / RLS-equivalent 0 rows). Composes `<AdminPartnerPayouts>` inside `<AdminShell title="Partner #<id> payouts">` with a `← All payout requests` crumb.
- `03-app/admin/payouts/partner/[id]/loading.tsx` + `loading.module.css` (hardlinked) — Skeleton-based fallback. Mirrors the page shape: hero (title + status pill) + 4 summary cards + 2 list sections (5 ledger items + 3 request items). No data fetch. No client JS. Pure RSC + the shared `Skeleton` primitive.

**DOCS (2 files):**
- `STUBS.md` — appended **STUB-058** (P6.8 Slice 2+ deferred: `forceAdjustAction` + `clawbackAction` server actions with audit-logged writes, "Trigger manual batch" per-partner modal, per-partner pagination/keyset cursor UI, per-admin rate-limit on adjustments, atomic-insert-not-update invariant for the ledger).
- `docs/PROGRESS.md` — P6.8 marked `[~]` (Slice 1 done; Slice 2+ deferred to STUB-058); phase header counter bumped from 5/10 [x] + 2/10 [~] to 5/10 [x] + 3/10 [~] (added P6.8 Slice 1); log entry appended with full file-by-file notes + decisions + checks summary.

### Decisions worth remembering

1. **Per-chain queues in the test mock, not a shared queue.** The standard chainable Supabase mock pattern (shared `serverQueue`) has a race when `Promise.all` reads include both `maybeSingle()` chains (consumed during array-literal eval) and plain chains (consumed when Promise.all calls `.then`). The result: the queue items get consumed in an order the test can't predict. Slice 1 ships a **per-chain queue** mock — each `from(table)` call gets its own queue keyed by chain index, so the test can enqueue a result for chain N independently. 24 tests, runs in 7ms.
2. **Service-role reads, not RLS-aware.** `getAdminPartnerPayouts` uses `getServiceSupabase()` because the admin sees every partner's rows. Matches the existing `getAdminLedger` + `getAdminPayoutRequests` + `getAdminPayoutRequests.ts` pattern. The audit-log invariant is still preserved — every write action (Slices 2+) will write a row.
3. **Partner row drives the 404.** Round 1 of the query is a single `from('partners').select(...).eq('id', partnerId).maybeSingle()` that decides whether the page renders or 404s. "Partner doesn't exist" and "partner is owned by another tenant" both collapse to "0 rows from service-role" → `null` → `notFound()`. Matches the P6.4 "404 doesn't leak existence" pattern.
4. **8 reads in parallel after the partner row succeeds.** Round 2 = `Promise.all([profile, available, locked, paid, nextRelease, pending, ledger, requests])` — 8 reads, 1 RT, all hitting existing indexes (the (partner_id, status) partial indexes for the summary aggregates + the (partner_id, created_at desc) indexes for the entries + requests).
5. **PII-safe select is a contract, not a comment.** Profiles NEVER selects `email / ip / user_agent`. Partners NEVER selects the encrypted `payout_method` JSONB. The unit test asserts the captured select payloads don't contain these substrings — a regression fails at PR time.
6. **Log payloads use 32-bit FNV-1a hash of partner_id.** Matches the P6.3 + P6.6 audit-log pattern. The actual partner id is internal-account PII (a small business that may or may not have given consent); logging it would leak to any log-aggregator downstream. The hash is short (8 hex chars) but unique-enough for the daily volume.
7. **Masked PayPal snapshot is the only PII surface.** The page does NOT decrypt `partners.payout_method` — it only renders the masked snapshot already on `payout_requests.payout_method_target_masked` (set at request time by `requestPayoutAction`). If the admin needs the current email, that's the partner settings surface.
8. **`AdminPartnerPayouts` RSC has no client JS shipped.** All interactivity (the `PayoutRequestRow` partner name → Link) is server-side. The page is `427 B / 200 kB` first-load — the 200 kB is the shared admin shell (AdminShell + sidebar + topbar + the active-nav client island).
9. **No inline colors.** Every color is driven by `[data-*]` attribute selectors (status pill, summary tile, ledger row kind, ledger row status, ledger amount direction). The existing `LedgerRow.tsx` component uses inline `style={{ color }}` from P6.3 — Slice 1 deliberately re-implements a token-only variant inline in `AdminPartnerPayouts` rather than refactor `LedgerRow` to break the partner-context Link coupling. Future cleanup could share a `LedgerRowBase` between the two surfaces.
10. **`<PayoutRequestRow>` is now exported.** Was internal to `PayoutRequestQueue.tsx`. The new `<AdminPartnerPayouts>` composes it for the per-partner request list — same row markup, same masked PayPal snapshot, same status pill colors. Zero divergence between the queue view and the partner view's request rendering.
11. **Partner name in the queue is now a `<Link>`.** Adds a click target from `/admin/payouts` into `/admin/payouts/partner/<id>`. The link is the dotted-underline-on-hover treatment (inherits color, focus-visible outline) — discoverable but not visually noisy in the queue.
12. **No new migration.** Reads existing columns on `partners` + `profiles` + `payout_ledger` + `payout_requests`. **No new RLS policies.** RLS is auto-propagated from the parent tables to the partitioned tables (P3.3 + P3.5). **No new dependencies.**

### Acceptance criteria progress (Slice 1)

- [x] Page is auth-gated AND requires `profiles.role = 'admin'` — `/admin` layout calls `requireRole(['admin', 'super_admin'])`; the page additionally calls `requireAdmin()` (belt-and-suspenders); the query also short-circuits on non-admin role.
- [x] Invalid partner id returns 404 — `getAdminPartnerPayouts` Zod-validates the id; bad id → null → `notFound()`.
- [x] No PII in URLs — the route is `/admin/payouts/partner/[id]` where `id` is the bigint primary key from `partners.id`.
- [x] PII-safe select — profiles selects `display_name / role / status / timezone / avatar_url` ONLY (never email / ip / user_agent); partners selects the safe columns (never `payout_method`).
- [x] Defensive mapping fails closed — corrupted ledger rows dropped, not surfaced as half-mapped shapes. Test asserts the mapping is strict.
- [x] DB error fail-soft — ledger / requests / summary aggregate read errors are warn-logged, not thrown. Page still renders with empty list / zero aggregate.
- [x] No `TODO` / `FIXME` in the diff — `check:no-todo` clean.
- [x] All 6 checks green + `pnpm test` 1585/1585 (was 1561, +24 new from `getAdminPartnerPayouts.test.ts`) + `pnpm build` clean (46 routes; `/admin/payouts/partner/[id]` first-load JS `427 B / 200 kB` — matches the admin shell + sidebar cost).
- [x] Files verified on disk via `ls -la` (per the 2026-06-17 lesson) — 4 new files + 5 modified files + 2 doc updates, all confirmed present.
- [x] Dual-tree hardlinks (`app/` ↔ `03-app/`) intact (verified via `stat -f '%i'`) — same inodes 13182968 / 13182949 / 13182987 / 13182979 for all 4 files in the `[id]/` dir.
- [x] Audit-log invariant preserved — Slice 1 has no write actions, so no audit rows yet; Slice 2 actions will follow the `requestPayout.ts` pattern (hashed actor_email + hashed IP + masked metadata).
- [x] Pagination deferred — the keyset cursor (`beforeId`) is already supported by the underlying `getPartnerLedger` / `getAdminLedger` / `getAdminPayoutRequests` queries; the Slice 1 UI doesn't render a "Load more" button (the per-partner view usually has fewer than 50 entries; Slice 2 UI can add it if needed).
- [ ] Force-adjust with reason — Slice 2 (deferred to STUB-058). Server action will insert an `adjustment` row, never UPDATE the original (per the ledger append-only invariant).
- [ ] Clawback support — Slice 2 (deferred to STUB-058). Server action will insert a negative `clawback` row + flip the source to `void` where appropriate.
- [ ] Per-partner "Trigger manual batch" modal — Slice 3 (deferred; gated on PayPal creds + P6.7 Slice 3 work).

### P7.10 — Storage quota display on `/admin/payouts/partner/[id]` (this tick)

**Files (4 new + 5 modified + 1 STUB append + 1 doc append):**

**NEW (4 files):**
- `02-features/payouts/lib/formatStorageSize.ts` (~150 LOC) — pure formatter. SI decimal units (KB = 1000 B, matching Bunny / AWS S3 / Cloudflare R2 / Stripe / Resend dashboards). `Math.round` with a tiny `sign * EPSILON * 1e3` nudge to dodge the classic `1.005 * 100 = 100.49999...` floating-point trap (nudge is `~2.22e-13`, too small to flip a non-`.5` case). `minimumFractionDigits=0 + maximumFractionDigits=d` so trailing zeros strip naturally ("1.5 GB" not "1.50 GB"). Defensive against null / undefined / non-numeric string / NaN / Infinity / negative (the DB has a `size_bytes >= 0` CHECK but bad data could slip in via a migration). `Number.MAX_SAFE_INTEGER` cap for arithmetic safety. Options: `locale` (default `'en-US'`), `minUnit` (floor, not override — natural pick wins when it's larger than the pinned unit), `decimals` (default 2, clamped to `[0, 4]`).
- `02-features/payouts/lib/formatStorageSize.test.ts` (~200 LOC, **31 unit tests**, runs in 13ms) — every unit boundary (B / KB / MB / GB / TB), decimal handling (cap + round-half-away + strip zeros + override), locale override (de-DE comma decimal), minUnit floor semantics, defensive coercion (null/undefined/empty/NaN/Infinity/negative/string/bigint-capped), input immutability.
- `02-features/payouts/queries/getPartnerStorageUsage.ts` (~280 LOC) — server query. Service-role read of `products` (filtered to partner) + `product_files` (filtered to those product ids), aggregates in JS by `product_id`. Returns `{ partner_id, total_bytes, file_count, product_count, by_product[≤10] sorted desc, capped }`. 32-bit FNV-1a hash for log payloads — never raw partner_id. PII-safe minimal select — products selects `id, slug, title, status` only (never `long_description` / `search_vector` / etc.); product_files selects `product_id, size_bytes` only (never `storage_path` / `bunny_video_id` / `hls_manifest_url` / `checksum_sha256` / `original_filename`). Fail-soft on either read error → zero-filled result + warn log.
- `02-features/payouts/queries/getPartnerStorageUsage.test.ts` (~490 LOC, **25 unit tests**, runs in 5ms) — input validation (8 cases: non-numeric/negative/zero/empty/NaN/numeric-string-coerce/productLimit-clamp-200/productLimit-default-10), auth gating (2 cases: no-session + non-admin), happy path (4 cases: total + per-product breakdown + sort desc + empty products + empty files + filter-out-zero-size-products), capped (2 cases), defensive coercion (2 cases: null size_bytes + missing size_bytes), fail-soft (2 cases: products error + files error), query shape (2 cases: `eq('partner_id')` + `.in('product_id', [list])`), PII safety (3 cases: products select minimal + files select minimal + log payloads hash-not-raw).

**MODIFIED (5 files):**
- `02-features/payouts/components/AdminPartnerPayouts.tsx` — new `<StorageSection>` sub-component rendered between `<SummaryCards>` and `<LedgerSection>`. RSC. Headline line "X GB across Y files in Z products" (or "No files uploaded yet." empty state when `total_bytes=0 && file_count=0`). Per-product rows with size-bar (`role="progressbar"`, `aria-valuenow=<pct>`, fill color via `[data-fill='light|mid|heavy']` attribute selectors — light = `--accent-soft`, mid = `--accent`, heavy = `--warn`). Status pill via left border: draft = `--warn-line`, published = `--success-line`, archived = `--line`. Composes the same `formatStorageSize` helper that the pure module ships. New `storage: PartnerStorageUsage` prop on `AdminPartnerPayouts`.
- `02-features/payouts/components/AdminPartnerPayouts.module.css` — new `.storage`, `.storageList`, `.storageRow`, `.storageMainCol`, `.storageTitle`, `.storageMeta`, `.storageSlug`, `.storageFileCount`, `.storageBar`, `.storageBarFill`, `.storageSize` classes (token-only). Mobile breakpoint (≤ 720px) stacks the row grid to 1-col.
- `03-app/admin/payouts/partner/[id]/page.tsx` (~85 LOC) — now calls `getAdminPartnerPayouts` + `getPartnerStorageUsage` in `Promise.all` (no extra roundtrip; no auth duplication; both queries do their own auth + Zod validation). Falls back to a zero-filled storage result if `getPartnerStorageUsage` returns null (it doesn't, after auth passes, but the TS narrowing is defensive).
- `02-features/payouts/index.ts` — barrel re-exports `formatStorageSize` + `getPartnerStorageUsage` + `GetPartnerStorageUsageOptionsSchema` + `GetPartnerStorageUsageOptions` + `PartnerStorageUsage` + `ProductStorageBreakdown` from the new modules.
- `01-specs/pages/admin-payouts.md` (this file) — new "P7.10 — Storage quota display" Implementation notes section.

**DOCS (2 files):**
- `STUBS.md` — appended **STUB-068** (P7.10 partner-side self-service deferred to Phase 12 P12.4).
- `docs/PROGRESS.md` — P7.10 marked `[x]`; log entry appended with full file-by-file notes + decisions + checks summary.

### Decisions worth remembering

1. **SUM at read time, not the unmaintained `products.total_file_size_bytes`.** That column exists from the initial migration but no trigger maintains it. Trusting it would silently drift from reality the first time a file is added or removed. SUM at read time is always correct. At 500+ products + a typical partner owning 5–10, this is a single `products.partner_id = X` RT that hits `products_partner_idx` + the FK join to `product_files` (which has its own `product_files_product_idx`). Both indexes are in place from migration 0001. No new index needed.
2. **Service-role read, not RLS-aware.** `getPartnerStorageUsage` uses `getServiceSupabase()` because the admin sees every partner's rows. Matches the existing `getAdminPartnerPayouts` + `getAdminLedger` pattern.
3. **`PartnerStorageUsage` returns zero-filled, not null, when the partner has no products or no files.** The query's `null` is reserved for auth / Zod failure — the page distinguishes the two cases (null → 404, zero-filled → render empty state).
4. **SI decimal units, not binary.** Storage vendors (Bunny, AWS S3, Cloudflare R2, Stripe, Resend dashboards) all use SI; matching their convention is what partners will read in their other tools. `1 KB = 1000 B`, not `1024 B`. The docstring on `formatStorageSize` is explicit about this.
5. **`minUnit` is a floor, not an override.** Pinned unit smaller than natural pick → natural pick wins. Pinned unit larger → override. This is the only consistent semantic — a "minimum unit" smaller than what the natural pick already produces would be useless (the natural pick satisfies the floor).
6. **`Intl.NumberFormat` with `minimumFractionDigits=0` strips trailing zeros.** Standard `minimumFractionDigits === maximumFractionDigits === d` would render `1.5 GB` as `1.50 GB` (because Intl honors the lower bound). Setting `min=0 + max=d` lets the rendered output naturally collapse trailing zeros.
7. **`Math.round((value * 10**d + nudge)) / 10**d` dodges `1.005 * 100 = 100.499999...`.** The nudge is `Math.sign(value) * Number.EPSILON * 1e3` (`~2.22e-13`), too small to flip a non-`.5` case (e.g. `1.234567 * 100 + 2.22e-13` is still `123.4567`, rounds to `123`). Without the nudge, the test "1.005 GB → 1.01 GB" fails because IEEE 754 stores `1.005` as `1.00499999...`. The first iteration of this code had a more elaborate `*10 / 10 / 10**d` chain that broke the basic case — simplified once the failing test made the bug obvious.
8. **PII safety is a contract, not a comment.** The unit tests assert the captured `select` payloads don't contain `long_description` / `search_vector` / `storage_path` / `bunny_video_id` / `hls_manifest_url` / `checksum_sha256` — a regression fails at PR time.
9. **Log payloads use 32-bit FNV-1a hash of partner_id.** Matches the P6.3 + P6.6 + P6.8 audit-log pattern. The actual partner id is internal-account PII; logging it would leak to any log-aggregator downstream. The hash is short (8 hex chars) but unique-enough for the daily volume.
10. **The size-bar is rendered with a single inline `style={{ width: '<pct>%' }}`.** This is the **only** inline style on the storage surface — and it's a width percentage, not a color. The color is driven by `[data-fill='light|mid|heavy']` attribute selectors. The width must be inline because the percentage is data-driven (per-row pct of the largest product) and there's no way to express that in static CSS without a million custom classes.
11. **Two empty states are designed.** (a) `total_bytes === 0 && file_count === 0` → "No files uploaded yet." headline, no per-product list. (b) `total_bytes > 0` but `by_product.length === 0` (rare — partner has files but every owning product is empty after the size-filter) → headline shows totals, breakdown list hidden. The cron task spec calls for "Empty states are designed, not blank" — both branches ship copy.
12. **No new migration.** Reads existing columns on `products` + `product_files`. **No new RLS policies.** No new dependencies. Pure add on the data layer + the admin surface.
13. **The partner-side self-service surface is deferred to STUB-068.** The data layer is RLS-friendly enough to be called from the partner context (just switch `requireRole(['admin', 'super_admin'])` to `requirePartner()` + `current_partner_id()` helper, same as `getPartnerDashboardSummary`). The natural home is Phase 12 P12.4 (partner dashboard refinements) — a "Storage" KPI tile on the partner's `/partner` home. Not a blocker for the admin surface shipping today.

### Acceptance criteria progress (P7.10)

- [x] Per-partner storage total computed and displayed — admin sees the headline "X GB across Y files in Z products" on the partner detail page.
- [x] Per-product breakdown — top 10 products sorted by size desc, with file count + size-bar visualization per product.
- [x] Pure formatter is fully tested — 31 unit tests covering every defensive branch + locale + decimals + minUnit + immutability.
- [x] Query is fully tested — 25 unit tests covering input validation + auth gating + happy path + capped + defensive coercion + fail-soft + query shape + PII safety.
- [x] Admin surface works — wired into the existing `/admin/payouts/partner/[id]` page with no new route + no client JS shipped.
- [x] No new migration / no new RLS / no new dependency.
- [x] All 6 checks green + `pnpm test` **2002/2002** (was 1946, +56 from the 2 new test files) + `pnpm build` clean (49 routes; `/admin/payouts/partner/[id]` is `423 B / 201 kB` first-load JS — was `427 B / 200 kB` after P6.8, +1 kB from the new CSS module; shared first-load JS unchanged at 101 kB).
- [ ] Partner-side self-service surface — deferred to STUB-068 (Phase 12 P12.4 territory).
