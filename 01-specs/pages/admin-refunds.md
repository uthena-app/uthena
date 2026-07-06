# Admin Refund Queue — `/admin/refunds`

## What this page does

The admin's refund approval queue. This is the same queue referenced by `account-refund.md` ("the admin side approve/reject lives here"). Two-pane layout: list of pending refund requests on the left (filterable by status, date, customer, product), detail panel on the right with the order, customer history, refund request details, and the decision panel (Approve full / Approve partial / Reject with reason). Approve issues a Stripe refund and creates the partner/affiliate reversal ledger entries atomically; Reject requires a reason and emails the customer.

The refund lifecycle: `requested` (from the user's `/account/orders/[id]/refund` form) → admin decision → `approved` (we owe the money; Stripe call in flight) → `processed` (Stripe webhook confirms) OR back to `rejected`. The `processed` state is set by the Stripe webhook handler, not by this page.

Server-rendered RSC. No caching. Every page view + every action is audit-logged. This is the highest-stakes page for financial integrity — the rate limit is strict.

## Data this page shows

| Section | Field | Source | Format |
|---|---|---|---|
| Sidebar | same admin shell as `mockups/admin.html` | hard-coded | sidebar |
| Top bar | page title, queue depth badge, "SLA: 24h · avg 8h" callout | hard-coded + computed | top bar |
| Filter bar | status multi-select (requested/approved/rejected/processed), date range, customer search, product select, "Clear" button | local state → URL params | filter bar |
| List panel | every refund request, sorted by oldest-first (FIFO; the SLA pressure demands this), each row: `R-12345`, customer email, order `#12345`, amount, reason, requested_at, "Xh ago" / "Xd ago", status badge | refunds + orders + profiles | list of cards |
| Detail panel header | refund id (`R-12345`), status badge, requested_at, requested_by, "← Back to queue" | refunds | header |
| Detail panel — Order | order id (link to `/admin/orders/[id]`), order date, line items, total, current refund total | orders + order_items | card |
| Detail panel — Customer | display_name, email, customer_since, lifetime_orders, lifetime_refunds, refund_rate (lifetime_refunds / lifetime_orders) | profiles + orders (aggregate) | card |
| Detail panel — Refund request | reason (selected from the 4-option list), reason_details (the user's free text), amount requested, refund_method (Stripe card refund, derived from the original payment), the uploaded proof file (if any) — admin can click to view via signed URL | refunds + file_downloads | card |
| Detail panel — Reversal impact (read-only) | partner share reversal preview: amount the partner's `payout_ledger` will be debited; affiliate commission reversal preview: amount the affiliate's `affiliate_commissions` will be reversed. Shown as a "what will happen" preview before the admin clicks Approve. | computed from orders + order_items + payout_ledger + affiliate_commissions | read-only card |
| Decision panel | "Approve full" / "Approve partial" / "Reject" buttons; on Approve partial: amount input (min $1, max remaining); on Reject: reason textarea (required) | derived | sticky bottom panel |
| Empty state | "No refund requests match these filters" + "Clear filters" button | derived | centered card |

**Queries:**
- `getRefundQueue({ status?, from?, to?, customerEmail?, productId?, page, pageSize })` in `02-features/admin/queries/getRefundQueue.ts` — paginated
- `getRefundDetail(refundId)` in `02-features/admin/queries/getRefundDetail.ts` — single refund + order + customer + reversal impact preview
- `previewRefundReversal(refundId, amount_cents)` in `02-features/admin/queries/previewRefundReversal.ts` — computes the partner/affiliate debit amounts (does NOT mutate)

## User actions

| Action | Trigger | Result | RBAC |
|---|---|---|---|
| Filter by status | Toggle status checkboxes | URL updates with `?status=...`, list re-fetches via RSC | admin |
| Filter by date range | Pick `from` and `to` | URL updates with `?from=&to=` | admin |
| Filter by customer email | Type into the customer email input | URL updates with `?email=...` (debounced 300ms, ILIKE) | admin |
| Filter by product | Pick from the product select | URL updates with `?productId=...` | admin |
| Clear filters | Click "Clear" | Removes filter params | admin |
| Open a refund | Click a list card | Loads detail panel, marks the URL with `?refundId=[id]` (so the URL is shareable) | admin |
| Approve full | Click "Approve full" | Runs `approveRefund(refundId, amount_cents=refunds.amount_cents, actor=admin)` — Stripe refund + `refunds.status='approved'` + `payout_ledger` reversal + `affiliate_commissions` reversal in one transaction. The page polls for the webhook confirmation that flips to `processed` (or the admin refreshes). On success, the row moves out of the `requested` filter. | admin |
| Approve partial | Click "Approve partial" → enter amount → click "Approve partial" in the modal | Same as Approve full, but with a smaller `amount_cents`. The customer's refund is the partial; the reversal preview recalculates based on the new amount. | admin |
| Reject | Click "Reject" → enter reason (required) → click "Reject" in the modal | Sets `refunds.status='rejected', resolved_at=now(), resolved_by=admin.id, resolution_notes=reason`. Sends email to customer. The row moves to the `rejected` filter. | admin |
| View proof file | Click the proof filename in the Refund request card | Generates a signed URL for the file in Bunny Storage (24h TTL), logs to `file_downloads` with `target='refund_proof'`, browser downloads | admin |
| Open the order | Click the order id in the Order card | Navigate to `/admin/orders/[id]` | admin |
| Open the customer | Click the customer display_name in the Customer card | Navigate to `/admin/customers/[id]` (v2) — for v1, this link is disabled with a "Coming in v2" tooltip | admin |

## What this page does NOT do

- No bulk approve (a single click that approves N selected refunds — flagged in the brief as OUT of scope for v1; the rate limit on individual approvals is the primary control)
- No "auto-approve if within window" automation (every request is human-reviewed in v1; heuristics in v2)
- No "approve and ban customer" combined action (banning lives on the customer detail page in v2)
- No "refund to a different payment method" (the refund always goes back to the original Stripe card)
- No "edit the refund amount after approval" (approvals are immutable; corrections go through a second partial refund)
- No "split across line items" UI (refund amount is at the order level; line-item split is internal accounting, not customer-facing)
- No "view as customer" embed on this page (the order detail page has that; this page links to it)
- No real-time push of new refund requests (admins reload to see new entries; the v1 cadence is fine — request volume is low)
- No "claim" / "assign to me" model (one admin, one queue; the page does not need a "claimed by" column in v1)

## Acceptance criteria

- [ ] Page is auth-gated AND requires `profiles.role = 'admin'`; customer/partner/affiliate access returns 403
- [ ] List panel sorts oldest-first by `refunds.requested_at asc` (FIFO; SLA pressure); SLA callout visually flags refunds with `requested_at < now() - interval '24 hours'` (amber border + "Overdue" badge)
- [ ] Default filter is `status='requested'`; all filters work independently and combined (`?status=&from=&to=&email=&productId=`); "Clear filters" removes filter params and resets page 1
- [ ] Detail panel renders the full refund request + the order + the customer + the reversal impact preview (partner debit + affiliate commission reversal amounts shown BEFORE the admin clicks Approve, so the admin can make an informed decision)
- [ ] "Approve full" runs the full atomic flow in a single Postgres transaction: Stripe refund call + `refunds.status='approved'` + `payout_ledger` (kind='refund_debit', amount=-partner_share) + `affiliate_commissions.status='reversed'`; the `processed` state is set later by the Stripe webhook handler
- [ ] "Approve partial" requires an amount ≥ $1 and ≤ `orders.total_cents - sum(refunds.amount_cents where status IN ('approved','processed'))`; Zod validation on both client and server
- [ ] "Reject" requires a non-empty reason (textarea, min 10 chars, max 1000); on submit, sets `refunds.status='rejected', resolved_at=now(), resolved_by=admin.id, resolution_notes=reason` and sends the customer email
- [ ] On success: the list re-fetches, the row leaves the `requested` filter, and a success toast renders. On Stripe API failure: the transaction rolls back, the row stays in `requested`, and a "Stripe error: [message]" inline error renders. On webhook failure: the row is in `approved` but not `processed`; an "Awaiting Stripe confirmation" badge + "Retry webhook processing" link renders
- [ ] "View proof" generates a 24h signed URL via signed-URL flow, logs to `file_downloads` with `target='refund_proof'`, downloads via the browser; empty state shows "No refund requests match these filters" + "Clear filters" button
- [ ] Every page view, detail-panel open, proof view, approval, and rejection writes one row to `admin_audit_log` with action strings `view_refund_queue`, `view_refund_detail`, `view_refund_proof`, `approve_refund` (full before/after + Stripe refund_id in `after.stripe_refund_id`), and `reject_refund` (resolution_notes stored, NOT redacted — admin decisions are auditable)
- [ ] Rate-limited: max 20 approvals and max 50 rejections per admin per hour; exceeding returns 429 and writes `action='rate_limit_triggered'`
- [ ] Page renders in < 700ms p95; no PII in URLs; no `TODO` / `FIXME` in the diff

## Design reference

- Mockup: not yet built — to be created during the admin feature build
- Components: `00-foundations/ui/AdminSidebar.tsx`, `00-foundations/ui/RefundQueueRow.tsx`, `00-foundations/ui/RefundDetailPanel.tsx`, `00-foundations/ui/ReversalImpactCard.tsx`, `00-foundations/ui/DecisionPanel.tsx`, `00-foundations/ui/ConfirmModal.tsx`, `00-foundations/ui/EmptyState.tsx`
- Tokens: `00-foundations/design/tokens.css`
- Theme: dark (default)

## Security

- **Auth required:** YES
- **Allowed roles:** admin (only)
- **RLS policies that apply:** `refunds` (`refunds_admin_all`), `orders` (`orders_admin_all`), `order_items` (inherits via order), `profiles` (`profiles_admin_all` for customer), `payout_ledger` (`payout_ledger_admin_all` for reversal impact preview), `affiliate_commissions` (admin-all implied — flag in Open Questions), `admin_audit_log` (`admin_audit_log_admin_read`)
- **PII displayed:** YES — by design. Customer email, display_name, the customer's reason text, the proof file (if any). All admin views are audit-logged
- **PII in URLs:** NO — refund id is `bigint`, formatted as `R-12345` for display only
- **Audit logged:** YES. `action` values used in `admin_audit_log`: `view_refund_queue` (every page view); `view_refund_detail` (target_id = refund id); `view_refund_proof` (target_id = refund id); `approve_refund` (target_id = refund id; before/after = refund row + new ledger entries; Stripe refund_id in `after.stripe_refund_id`); `reject_refund` (target_id = refund id; after.resolution_notes = the admin's reason — NOT redacted; admin decisions are auditable); `retry_refund_webhook` (target_id = refund id)
- **Rate limiting:** max 20 approvals and max 50 rejections per admin per hour. Exceeding returns 429 and writes `action='rate_limit_triggered'`
- **CSRF:** all server actions on this page are CSRF-protected
- **Stripe API key:** stored in env, never returned to the client
- **Atomic transactions:** the approve flow wraps the Stripe refund call + the `refunds` update + the `payout_ledger` insert + the `affiliate_commissions` update in a single Postgres transaction. If any step fails, the whole thing rolls back. See `02-features/admin/transactions/atomicRefund.ts`
- **Refund amount validation:** the approve action re-checks the amount server-side (client-side validation is for UX only). The amount must be ≤ `orders.total_cents - sum(refunds.amount_cents where status IN ('approved','processed'))`; otherwise the action errors
- **Email security:** the rejection email is sent via Resend's React Email template; the admin's reason is passed as a template variable, escaped by React Email. No header injection risk
- **Proof file access:** proof files are in a private Bunny Storage path; the admin generates a signed URL (24h TTL) via a server action, and the generation is logged
- **Third-party scripts:** none

## Performance

- **Target p95:** < 700ms (list + detail panel, both with joins)
- **Render strategy:** RSC + SSR, no caching
- **Cache:** NONE
- **DB indexes used:** `refunds (status, requested_at)`, `refunds (order_id)`, `orders (id)`, `order_items (order_id)`, `payout_ledger (order_id)`, `affiliate_commissions (order_id)`, `profiles (user_id)`
- **Bundle size budget:** < 50KB added to client bundle (queue list, detail panel, decision panel, modals)
- **Parallel queries:** the page runs `getRefundQueue` + `getRefundDetail` in parallel when both are needed (list view + detail panel open at the same time)
- **Stripe API call:** the approve action makes ONE Stripe API call (refund create). On error, the page surfaces the error inline; the admin can retry by clicking Approve again (idempotent: the `refunds.id` is the Stripe idempotency key)

## Out of scope for v1

- Bulk approve
- Auto-approve heuristics
- "Approve and ban customer" combined action
- "Refund to a different payment method" (always original card)
- "Edit the refund amount after approval" (immutable; corrections via second partial)
- "Split across line items" UI (admin-only accounting detail)
- "Claim" / "assign to me" model
- Real-time push of new refund requests
- "View as customer" embed (lives on the order detail page)
- Per-admin refund approval limits (v2)
- Per-product refund policies (v2)
- Customer-initiated appeal of a rejection (must email support)

## Open questions for human

- **`affiliate_commissions` admin-all RLS policy by name:** same as in `admin-order-detail.md` — the data model implies admin-all but doesn't name the policy. My recommendation: add `create policy "affiliate_commissions_admin_all" on affiliate_commissions for all using (exists (select 1 from profiles where user_id = auth.uid() and role = 'admin'));` in a small migration. The reversal impact preview and the reversal flow both depend on this.
- **Refund SLA: 24h business or 24h wall-clock?** the brief says "refund requests > 24h old" on the dashboard. My recommendation: wall-clock 24h. Simpler to compute, simpler to display. Business hours add complexity (timezone, weekends, holidays) without much benefit. Confirm or switch to business hours.
- **Auto-retry on Stripe failure:** if the Stripe refund call fails (network error, etc.), should the action auto-retry once with exponential backoff, or surface the error to the admin? My recommendation: surface the error. The admin decides whether to retry (one click), or to wait. Auto-retry can mask transient issues and create double-refund risk. Confirm or change.
- **Idempotency on approve:** the `refunds.id` is the Stripe idempotency key. If the admin double-clicks "Approve" and the first call is in flight, the second call uses the same key and Stripe returns the same refund. The DB transaction is also guarded by `select for update` on the refund row. My recommendation: keep this design. Confirm: is using `refunds.id` as the Stripe idempotency key acceptable, or do you want a separate `client_request_id` per attempt (the brief for `account-refund.md` proposed a separate `client_request_id` — that is for the USER's submit; the admin's approve uses `refunds.id` as the natural key)?

---

## Implementation notes

- **Queries** (in `02-features/admin/queries/`): `getRefundQueue(filters, { page, pageSize: 25 })` (paginated, FIFO by `requested_at asc`); `getRefundDetail(refundId)` (refunds + orders + order_items + products + profiles + payout_ledger + affiliate_commissions); `previewRefundReversal(refundId, amount_cents)` (computes proportional partner debit and affiliate reversal without mutating)
- **Server actions** (in `02-features/admin/actions/`): `approveRefund(refundId, amount_cents)` (atomic transaction, `refunds.id` as Stripe idempotency key); `rejectRefund(refundId, reason)` (status update + Resend email); `getSignedRefundProofUrl(refundId)` (24h signed URL + `file_downloads` row with `target='refund_proof'`)
- **`processed` state transition:** handled by the Stripe webhook handler in `04-platform/webhooks/stripe.ts`, NOT by this page. The page shows the `approved` state with an "Awaiting Stripe confirmation" badge if the webhook hasn't fired yet

---

## P14.9 Slice 1 — Read path (2026-06-30 / 2026-07-01)

Slice 1 ships the read path end-to-end: queue list + filter form + stats row + detail panel + reversal impact preview. No destructive actions yet (deferred to STUB-122, gated on Stripe live creds + Bunny Storage creds + Phase 17 SES).

### Migration 0059 — schema foundation + 3 RPCs
- `ALTER TYPE refund_status ADD VALUE IF NOT EXISTS 'approved'` — the new state between `pending` (admin hasn't acted) and `succeeded` (Stripe webhook confirmed). Adds the "Stripe call in flight" tracking that's missing from the legacy 0001 enum.
- `get_admin_refund_stats()` — 5-card counts: total + pending/approved/succeeded/failed/canceled.
- `get_admin_refunds_queue(p_filters jsonb, p_page int, p_per_page int)` — paginated FIFO list. Sort: `requested_at asc`. Filters: status / from / to / customerEmail / productId. `p_per_page` hard-capped at 200, default 25 (matches spec line 28).
- `get_admin_refund_detail(p_refund_id bigint)` — composes refund + order + customer aggregates + reversal impact preview in 1 round-trip via 4 CTEs. Reversal preview uses the same proportional formula as `calculateRefundRoyalty` from `00-foundations/money/cents.ts`.
- New partial index `refunds_pending_fifo_idx (status, requested_at asc) WHERE status = 'pending'` — the SLA-pressure "what's overdue?" view runs index-only.

### Spec/DB vocabulary mapping
The spec uses `requested / approved / processed / rejected` (lines 7-8). The DB enum is `pending / approved / succeeded / failed / canceled`. The mapping is documented at `00-foundations/data/enums.ts#RefundStatus` and surfaces through `REFUND_STATUS_LABEL` in `02-features/admin/refunds/types.ts`:

| Spec vocabulary | DB enum | UI label |
|---|---|---|
| `requested` | `pending` | Requested |
| `approved` (admin committed, Stripe in flight) | `approved` | Approved |
| `processed` | `succeeded` | Processed |
| `rejected` | `failed` | Rejected |
| (legacy) | `canceled` | Canceled |

### Files shipped
- **NEW** `04-platform/migrations/0059_admin_refunds_query.sql` (~280 LOC) — ALTER TYPE + 3 SECURITY DEFINER RPCs + FIFO partial index.
- **NEW** `02-features/admin/refunds/types.ts` (~280 LOC) — RefundQueueRow + RefundDetail + filter parser + label maps + SLA helpers (isRefundOverdue + formatRefundAge).
- **NEW** `02-features/admin/refunds/queries/getAdminRefundStats.ts` — RPC wrapper + defensive coercion + fail-soft.
- **NEW** `02-features/admin/refunds/queries/getAdminRefundsQueue.ts` — RPC wrapper + per-page clamp + bigint coercion.
- **NEW** `02-features/admin/refunds/queries/getAdminRefundDetail.ts` — RPC wrapper + reversal preview + masked email helper (uses `maskEmail` from `@foundations/data/mask`).
- **NEW** `02-features/admin/refunds/actions/writeRefundsViewAuditLog.ts` — best-effort audit writer (queue view → `admin.refunds_queue_viewed`, detail view → `admin.refund_detail_viewed`).
- **NEW** `02-features/admin/refunds/components/RefundStatsCards.tsx` + `.module.css` — 5-card stats row with status-keyed left borders.
- **NEW** `02-features/admin/refunds/components/RefundFilters.tsx` + `.module.css` — URL-driven GET form (status + from + to + customerEmail + productId).
- **NEW** `02-features/admin/refunds/components/RefundQueueList.tsx` + `.module.css` — FIFO table with SLA-overdue visual flag (`data-overdue='true'` → amber border + "Overdue" badge; only on `pending` rows > 24h old). Row click sets `?refundId=` URL param.
- **NEW** `02-features/admin/refunds/components/RefundPagination.tsx` + `.module.css` — URL-driven pager with filter bag preserved.
- **NEW** `02-features/admin/refunds/components/RefundDetailPanel.tsx` + `.module.css` — 5-card detail panel: header (refund id + status + amount + age) + Order + Customer + Refund request (with proof tag) + Reversal impact preview (computed amounts) + Decision panel placeholder (disabled buttons, "Ships in next slice").
- **NEW** `02-features/admin/refunds/index.ts` — barrel re-exports.
- **NEW** `03-app/admin/refunds/page.tsx` (~180 LOC) + `refunds.module.css` + `loading.tsx` — RSC + `dynamic='force-dynamic'` + `requireAdmin()` belt-and-suspenders + 3 Promise.all reads (stats + queue + detail) + per-page-load audit log + 2-pane layout (list left, detail right) when `?refundId=` is set.
- **5 NEW test files** (`types.test.ts` 59 + `getAdminRefundStats.test.ts` 6 + `getAdminRefundsQueue.test.ts` 12 + `getAdminRefundDetail.test.ts` 15 + `writeRefundsViewAuditLog.test.ts` 7 = **99 unit tests**).
- **MODIFIED** `00-foundations/data/enums.ts` — added `'approved'` to RefundStatus union + REFUND_STATUSES array, with a JSDoc block documenting the spec/DB mapping.
- **MODIFIED** `04-platform/migrations/ENUM-AUDIT.md` — `refund_status` row updated to reference the migration 0059 addendum.
- **NEW** `STUBS.md STUB-122` — documents Slices 2+ (Approve / Reject / Retry webhook / Proof view / Rejection email / Reveal-PII) with file paths + rate-limit specs + Stripe/Bunny/SES blockers.

### Spec coverage for Slice 1 (acceptance criteria ticked)
- **#1** auth-gated via `is_admin()` (RPC) + `requireAdmin()` (data layer) + `requireRole(['admin','super_admin'])` (/admin layout). Non-admin access renders the redirect via the /admin layout's gate.
- **#2** FIFO sort + SLA callout: queue RPC orders by `requested_at asc`; SLA overdue visual flag fires via `data-overdue='true'` on `pending` rows > 24h old.
- **#3** Default filter `status='pending'` (spec `requested` ↔ DB `pending`); URL-driven filters (status + from + to + customerEmail + productId); "Clear" button is the `<a href="/admin/refunds">Reset</a>` link in the filter form.
- **#4** Detail panel renders order + customer + reversal impact preview (partner debit + affiliate commission reversal shown BEFORE admin clicks Approve — Slice 2 will add the button).
- **#12** Every page load + every detail-panel open writes one `admin_audit_log` row (`admin.refunds_queue_viewed` for list; `admin.refund_detail_viewed` when `?refundId=` is set) with the active filter bag + page + result count.
- **#14** < 700ms p95: RSC + `dynamic='force-dynamic'` + 3 parallel reads in `Promise.all`; no client JS shipped beyond the existing shared chunks.

### Decisions worth remembering
- **The `approved` enum value is the missing piece between `pending` and `succeeded`.** The legacy 0001 enum conflated "admin hasn't acted yet" with "admin hasn't acted AND Stripe hasn't fired the webhook". Adding `approved` lets the UI track "admin committed; Stripe call in flight" without a JOIN or a metadata hack.
- **Reversal preview is computed in the RPC, not at the page layer.** The proportional formula is the same as `calculateRefundRoyalty` from P6.9 — embedded directly in the SQL CTE for atomicity with the customer aggregates. Surfaced as negative cents (matches `payout_ledger.amount_cents` sign convention: positive = credit, negative = debit).
- **The detail panel's decision buttons are disabled placeholders, not `<form>` actions.** The Slice 1 page-level wire-up is correct; the actions ship in Slice 2 (STUB-122) gated on Stripe live creds + Bunny Storage creds + Phase 17 SES. The disabled buttons communicate the SLA surface without overpromising.
- **Two-pane layout (list + detail) is query-string driven, not a separate route.** `?refundId=<id>` flips the page into detail-mode (the layout grid renders 2 columns); the URL is shareable + the panel survives reload. Mirrors the pattern from prior Phase 14 surfaces.

### Slices 2+ deferred to STUB-122
- (a) Approve full action + atomic transaction wrapping Stripe + payout_ledger + affiliate_commissions
- (b) Approve partial action + amount input + recalculated reversal preview
- (c) Reject action + reason textarea + customer rejection email (Phase 17 gated)
- (d) Retry webhook action (Stripe events.resend with idempotency key)
- (e) Signed-URL proof download (24h TTL + file_downloads audit row)
- (f) Customer rejection email template (React Email)
- (g) Reveal-PII interaction for the detail panel (30s auto-mask + per-reveal audit row)

### Runtime verification notes
- The migration ships idempotent (ALTER TYPE IF NOT EXISTS + early-return guard + every grant wrapped in DO blocks). A re-run against a partially-migrated DB is a no-op.
- The SLA visual flag fires only on `pending` rows > 24h old. Once Slice 2 lands Approve, an admin who clicks Approve will move the row out of `pending` (to `approved`) and the visual flag will disappear on the next refresh — semantically correct (SLA pressure exists only while the admin can still act).
- The reversal preview is a negative number. The Detail panel formats it with `−$X.XX` for partner debit + `−$X.XX` for affiliate reversal. The sign is the admin's signal for "money flows back to the business from these rows".
