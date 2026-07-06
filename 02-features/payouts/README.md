# Feature: payouts (PH08)

Royalty math end-to-end. The `payout_ledger` is the source of truth for "what does Uthena owe each partner" — it's append-only per ADR-0005, signed amounts, and surfaces in three views:

- **Partner view** (`/partner/payouts`): the partner sees their own ledger, summary cards (available / locked / paid), and the running balance.
- **Admin view** (`/admin/payouts`): the admin sees every partner's ledger, can run manual payout batches, and sees the refund queue.
- **Library access via subscription** is computed at READ time via `has_active_subscription(uuid)`, never written per-product.

The 14-day refund window is enforced by a single migration (`0005_payout_ledger_lock_columns.sql`):
- Every `order_sale` row starts as `status='locked'` with `locked_until = now() + 14d` and `available_at = now() + 14d`.
- A daily cron (`04-platform/ci/scripts/cron/release-locked-balances.ts`) flips `locked` → `available` once `available_at < now()`.
- The release uses the index `payout_ledger_release_idx (available_at) where status='locked'` for a cheap, index-only scan.

`onRefund` writes `kind='refund'` rows that negate the original `order_sale` royalty (signed amount). The refund's `library_grants` are revoked with a single UPDATE (`revoked_at` is set once, not in a loop).

Idempotency on the subscription ledger uses a partial unique index on `(stripe_invoice_id) where kind='subscription'`. Stripe retries hit the same invoice id; the `upsert` is a no-op.

## Status

**Phase 6 — partial.** P6.1 + P6.2 + P6.3 (Slice 1 + Slice 2) + P6.4 + P6.5 Slice 1 + P6.6 + P6.7 Slice 1 + P6.8 Slice 1 + **P6.9** shipped.
- P6.1: `get_partner_lifetime_sales_cents` RPC + dashboard wiring.
- P6.2: `get_partner_product_aggregates` RPC + courses-list per-product columns.
- P6.3 Slice 1: URL-driven status/kind/sort filters + partner-timezone date display on `/partner/payouts`.
- P6.3 Slice 2: CSV export — RFC 4180-compliant `buildLedgerCsv` + per-partner in-process rate limit (10/hour, STUB-012) + audit-logged to `admin_audit_log` with hashed identifiers. `ExportCsvButton` lives next to the filter bar on `/partner/payouts`; the export always mirrors the active filter (read from URL via `useSearchParams`). CSV includes all filtered rows (no keyset cap; safety ceiling at 5000 rows records `capped: true` in the audit metadata).
- **P6.4**: `/partner/payouts/[id]` — single ledger entry detail with status timeline + source order card + refund card; `LedgerRow` is now a clickable Link.
- **P6.5 Slice 1**: PayPal email encrypted at rest via `00-foundations/security/encryption.ts` + masked read-only display + audit-log row on every settings update. Bank fields + micro-deposit verification deferred to Slice 2 (STUB-053, gated on Stripe Connect vs Plaid decision).
- **P6.6**: explicit "Request payout" affordance on `/partner/payouts`. `RequestPayoutButton` client island renders 4 states (ready / pending / below minimum / no balance); the `requestPayoutAction` server action atomically inserts one `payout_requests` row + flips the partner's available ledger rows to `pending_payout`; audit row uses `action='payout_requested'` with hashed identifiers + masked PayPal snapshot. Threshold is hardcoded `$50` (MIN_PAYOUT_REQUEST_CENTS = 5000); admin-configurable threshold is a future enhancement.
- **P6.7 Slice 1** (read-only): admin payouts queue at `/admin/payouts` — `getAdminPayoutRequests` query (service-role read with partner-name join + URL-friendly filter options + 6 per-status partial-index COUNTs + defensive mapping) + `<PayoutRequestQueue>` RSC (status filter chips with counts, per-row status pill via `data-status` attribute selectors) + refactored `/admin/payouts/page.tsx` to use `<AdminShell>` (matches `/admin/categories` + `/admin/account-switcher`) + removed inline `style={{ color }}` per AGENTS.md "no inline colors" rule + added `/admin/payouts` to the AdminSidebar nav. P6.7 Slice 2+ (approve/deny actions, "Trigger manual batch" modal, PayPal Mass Payout integration, refund queue section, admin search) deferred to **STUB-057**.
- **P6.8 Slice 1** (read-only): admin partner payouts detail at `/admin/payouts/partner/[id]` — `getAdminPartnerPayouts` query (service-role read of `partners` + `profiles` + `payout_ledger` + `payout_requests` for ONE partner; 3 sequential rounds — Round 1 partner row drives the 404, Round 2 = 8 parallel reads via Promise.all, Round 3 = mapping; defensive ledger + payout_request mapping; PII-safe select — profiles NEVER selects email / ip / user_agent; partners NEVER selects the encrypted `payout_method` JSONB) + `<AdminPartnerPayouts>` RSC composing hero + summary cards + ledger list + payout requests list (all token-only, `data-*` attribute selectors, no inline colors — the existing `LedgerRow.tsx` uses inline `style={{ color }}` from P6.3, so Slice 1 deliberately re-implements a token-only variant inline in `AdminPartnerPayouts` rather than refactor `LedgerRow` and break the partner-context Link coupling) + `/admin/payouts/partner/[id]` route (RSC + AdminShell + `notFound()` short-circuit + hardlinked loading skeleton) + `<PayoutRequestRow>` exported from `PayoutRequestQueue.tsx` + partner name in the queue is now a `<Link>` to the new detail page. P6.8 Slice 2+ (force-adjust + clawback server actions with audit-logged writes, per-partner "Trigger manual batch" modal, email notifications, per-admin rate-limit) deferred to **STUB-058**.
- **P6.9** (royalty engine audit + 2 bugs fixed): full audit at `docs/ROYALTY-ENGINE-AUDIT.md` (419 lines); invariant A (snapshot at order time) verified by reading the code + locked by 4 explicit assertions in `onPaymentSucceeded.test.ts` (16 tests) + `onRefund.test.ts` (15 tests). Bugs #1 (partial refund over-clawback) + #2 (hardcoded USD on refund rows) fixed in this cycle: `onRefund.ts` now uses the new `calculateRefundRoyalty(saleRoyaltyCents, orderTotalCents, refundAmountCents)` helper in `00-foundations/money/cents.ts` for proportional clawback + reads `order.currency` for the refund row. **ADR-0009** documents the snapshot invariant. The 3 remaining bugs (dispute handler missing / silent partial ledger failure / no payment-failure handler) filed as **STUB-061 / STUB-062 / STUB-063** — see `docs/ROYALTY-ENGINE-AUDIT.md` §3 + §6 for resolution paths.
- P6.3 Slice 3 (deferred): pagination UI + date-range filter (`?from=&to=`) — both deferred to Slice 3.
- P6.5 Slice 2 / P6.7 Slices 2+ / P6.8 Slices 2+ / P6.10: pending.

## Layout

```
02-features/payouts/
├── queries/
│   ├── getPartnerLedger.ts        — partner's own ledger + balance summary
│   │                                (P6.3 Slice 1: + status/kind/sort filters + timezone)
│   ├── getPartnerLedger.test.ts   — 31+ unit tests (P6.3 Slice 1)
│   ├── getPartnerLedgerEntry.ts   — single ledger entry detail
│   │                                (P6.4: + order + refund joins + PII-safe select)
│   ├── getPartnerLedgerEntry.test.ts — 23 unit tests (P6.4)
│   ├── getPendingPayoutRequest.ts — partner's most-recent pending payout request (P6.6)
│   ├── getPendingPayoutRequest.test.ts — 12 unit tests (P6.6)
│   ├── getAdminPayoutRequests.ts  — admin's full payout_requests queue (P6.7 Slice 1)
│   │                                (service-role + partner-name join + URL-driven filter)
│   ├── getAdminPayoutRequests.test.ts — 18 unit tests (P6.7 Slice 1)
│   ├── getAdminPartnerPayouts.ts  — admin's per-partner view: full ledger + summary
│   │                                + payout requests for ONE partner (P6.8 Slice 1)
│   ├── getAdminPartnerPayouts.test.ts — 24 unit tests (P6.8 Slice 1; per-chain queues)
│   └── getAdminLedger.ts          — admin's full ledger view
├── actions/
│   ├── releaseLockedBalances.ts   — admin force-flips locked→available (manual)
│   ├── markLedgerPaid.ts          — admin marks a batch as paid (PayPal batch id)
│   ├── exportLedgerCsv.ts         — partner CSV export (P6.3 Slice 2)
│   │       ├── Zod-validates filters (same shape as getPartnerLedger)
│   │       ├── in-process rate limit: 10/hour/partner (STUB-012)
│   │       ├── audit-logs to admin_audit_log with hashed identifiers
│   │       └── exports buildLedgerCsv + csvEscape (pure functions, unit-tested)
│   ├── requestPayout.ts           — partner "request payout" server action (P6.6)
│   │       ├── typed RequestPayoutResult union (no free-form input)
│   │       ├── 5 gating branches (auth / partner / method / balance / pending)
│   │       ├── atomic INSERT payout_requests + UPDATE payout_ledger to pending_payout
│   │       └── audit row uses action='payout_requested' + masked PayPal snapshot
│   └── requestPayout.test.ts      — 26 unit tests (P6.6)
├── components/
│   ├── LedgerRow.tsx              — single ledger row, wrapped in Next Link (P6.4)
│   │                                (P6.3: timezone-aware dates; P6.4: + click target)
│   ├── LedgerRow.module.css       — token-only styles + hover/focus-visible (P6.4)
│   ├── LedgerSummary.tsx          — 4 stat cards (P6.3: timezone-aware "Next release" hint)
│   ├── LedgerSummary.module.css   — token-only styles for the summary grid
│   ├── LedgerFilters.tsx          — client island: status/kind chips + sort dropdown (P6.3)
│   ├── LedgerFilters.module.css   — token-only styles for the filter bar
│   ├── ExportCsvButton.tsx        — client island: triggers exportLedgerCsvAction + download
│   ├── ExportCsvButton.module.css — token-only styles
│   ├── RequestPayoutButton.tsx    — client island: 4-state "request payout" CTA (P6.6)
│   ├── RequestPayoutButton.module.css — token-only styles (accent CTA + 3 banner states)
│   ├── LedgerTimeline.tsx         — 4-milestone locked-window timeline (P6.4)
│   ├── LedgerTimeline.module.css  — token-only styles for the timeline
│   ├── LedgerSourceOrder.tsx      — source-order card (P6.4)
│   ├── LedgerSourceOrder.module.css
│   ├── LedgerSourceRefund.tsx     — refund card (P6.4)
│   ├── LedgerSourceRefund.module.css
│   ├── PayoutRequestQueue.tsx     — RSC: status chip strip + request list (P6.7 Slice 1)
│   │                                (P6.8 Slice 1: + Link on partner name → partner detail)
│   ├── PayoutRequestQueue.module.css — token-only styles for the queue
│   ├── AdminPartnerPayouts.tsx    — RSC: hero + summary cards + ledger + requests list
│   │                                for the per-partner admin view (P6.8 Slice 1)
│   └── AdminPartnerPayouts.module.css — token-only styles for the per-partner view
├── filter-options.ts              — pure constants/types for ledger filters (P6.3 Slice 1)
├── request-options.ts             — MIN_PAYOUT_REQUEST_CENTS + PayoutRequestStatus /
│                                    PayoutMethodKind / RequestPayoutErrorCode (P6.6)
├── format.ts                      — money / formatDate(iso, locale, timeZone) / labels
│                                    (P6.4: + ORDER_STATUS_LABEL + REFUND_REASON_LABEL)
│                                    (P6.7: + PAYOUT_REQUEST_STATUS_LABEL +
│                                          PAYOUT_REQUEST_STATUS_COLOR)
└── index.ts
```

## Hot-path design (500+ courses, 10k+ users)

- **Single aggregate for the partner "available balance"** — `sum(amount_cents) where partner_id=$1 and status='available'`. Index: `payout_ledger_partner_available_idx (partner_id) where status='available'`. The `/partner/payouts` page renders this in a single round-trip; no N+1.
- **Ledger read is paged server-side** — `limit 50 offset $page` via PostgREST range headers. Default 50 rows, with "Load more" (no offset math; we use keyset pagination on `(created_at desc, id desc)`).
- **No per-product writes ever** — the subscription library access is computed at read time, not stored per (user, product) row.
- **Refund reversal is a single UPDATE + single batched INSERT** — not a per-item loop.
- **Cron uses an index-only scan** — `payout_ledger_release_idx (available_at) where status='locked'`. At 10k orders/day the cron touches ~10k rows in one UPDATE; the partial index keeps it fast (typically < 100ms).
- **P6.3 — Summary aggregates run unfiltered** — the partner's "Available / Locked / Paid" headline numbers always reflect their full financial state. The URL-driven filter is the lens on the ledger list below, not on the summary. This avoids the trap of "Available: $0" when the partner filters to "Paid".
- **P6.3 — Timezone is read once per request** — `profiles.timezone` is fetched in parallel with the partner row. All four dates in the ledger render via `Intl.DateTimeFormat` with `timeZone: profile.timezone`, so the partner sees dates in their local time.
- **P6.4 — Detail page joins in two parallel batches** — entry + profile in Promise.all (1 RT), then order + refund in Promise.all (1 RT). Net 3 sequential round-trips worst case; well under the 250ms p95 budget on warm connections.
- **P6.4 — PII-safe select is a contract** — `getPartnerLedgerEntry` NEVER selects `orders.email`, `orders.ip`, or `orders.user_agent`. The unit test asserts the captured select payload doesn't contain these strings, so a regression fails the test suite.
- **P6.4 — Refund row always has `refund_id`** — the `onRefund` trigger sets it; we treat its absence on `kind='refund'` as a data inconsistency (warn log, do not 404).
- **P6.4 — 404 doesn't leak existence** — "entry doesn't exist" and "entry belongs to another partner" both return null from the query (RLS collapses them to "0 rows"). The page renders the same 404 surface, so a partner can't enumerate other partners' ledger ids.
- **P6.4 — Timeline `data-state` attribute** — the 4 milestone `<li>` elements carry `data-state="done|active|pending|skipped"`; CSS reads `[data-state="done"] .dot` etc. for the colors. No inline `style={{ color }}` (per AGENTS.md "no inline colors").
- **P6.4 — Refunds skip the Locked milestone** — refunds reverse a sale; the original sale did the locking. The timeline renders the Locked dot as `skipped` (dashed border + 45% opacity) so the partner sees the full 4-step journey even when one milestone doesn't apply to their row type.
- **P6.4 — `LedgerRow` is a Next.js `Link`** — the entire row is the click target; no separate "View" button. `aria-label` carries the kind + amount for screen-reader semantics. The +6px/-6px margin/padding compensation keeps the bottom border aligned with the previous layout.
- **P6.3 Slice 2 — CSV export mirrors the active filter** — the button reads `?status=&kind=&sort=` from `useSearchParams` and passes them straight to `exportLedgerCsvAction`. The action's Zod schema is the real validator; the page's URL parsers guarantee only valid union members reach the button.
- **P6.3 Slice 2 — Per-partner rate limit, not per-IP** — the limit is keyed on `partner_id` (the resolved numeric partner id from the partners table), not on the user's IP. A partner moving between IPs/locations shouldn't be able to multiply their export quota; an IP limit would also fail-soft for partners sharing an office NAT.
- **P6.3 Slice 2 — Audit log uses hashed identifiers** — `actor_email = hash:<sha256>@uthena.audit` (matches the P1.2 rate-limit pattern); `ip = <sha256(ip)>`; `target_id = string(partnerId)` (numeric, no leak — the partner already knows their own id; admins need it for cross-table lookup). `metadata` carries `row_count`, `capped`, `filters`, `rate_limit_count` — no row content.
- **P6.3 Slice 2 — CSV is RFC 4180-compliant** — CRLF line terminators (Excel + Google Sheets compatible), header row, double-quoted fields with embedded commas / quotes / newlines. `csvEscape` is exported + unit-tested independently. `buildLedgerCsv` is a pure function — no I/O, no side effects.
- **P6.3 Slice 2 — Money in the CSV is decimal with 2 digits** — `12345 cents → "123.45"`. The spec asks for "full ledger for accounting"; decimal-dollar is what every accounting tool expects (Stripe exports the same way). ISO 8601 dates (UTC) sort correctly in spreadsheets.
- **P6.3 Slice 2 — 5000-row cap is logged, not silent** — if a partner's filtered ledger exceeds the cap, the audit row records `capped: true` + the row count. v1 doesn't split into multiple CSVs; if we ever see a real partner hit it, we switch to a streamed ZIP. STUB-012 covers the multi-instance move of the rate limiter; this cap is the same axis.
- **P6.6 — The page resolves state from server, the button is a pure client island** — `getPartnerLedger` returns the available balance; `getPendingPayoutRequest` returns the partner's most-recent pending row (or null). The `RequestPayoutButton` client island accepts those two as props and renders one of 4 states (ready / pending / below minimum / no balance). No double-reads in the browser; the page is the source of truth.
- **P6.6 — Atomic insert + update, NOT a transaction** — `requestPayoutAction` does (1) INSERT `payout_requests` then (2) UPDATE `payout_ledger SET status='pending_payout'` via the service-role client. These are not in a real DB transaction (PostgREST RPC would be the right shape for true atomicity); the partner can't race themselves because the existing-pending check + the available-balance check gate the read-side, and the button is disabled after click via `useTransition`.
- **P6.6 — Masked PayPal snapshot, not plaintext** — the `payout_requests` row stores `payout_method_target_masked = 'p***@example.com'` (read from the typed `PartnerPayoutMethod` shape returned by `decryptPayoutMethod`). If the partner later changes their PayPal email, the request still shows what was on file at the time. The audit row mirrors the masked snapshot in `metadata.payout_method_target_masked`.
- **P6.6 — Fail-soft audit log** — if the `admin_audit_log` insert fails after a successful `payout_requests` insert, the partner STILL gets their pending request (the action logs the audit failure and returns ok=true). Ops catches the gap via audit-log volume metrics. Same pattern as `exportLedgerCsv`.
- **P6.6 — Fail-soft ledger update** — if the UPDATE on `payout_ledger` fails after the INSERT, the action returns ok=true with `ledgerRowsUpdated: 0`. The request row already exists; the admin sees the request on P6.7 and can reconcile manually. The page re-reads after success; a partner who somehow got here would see their pending banner but with ledger rows still in `available` state (the admin queue surfaces the inconsistency).
- **P6.6 — `MIN_PAYOUT_REQUEST_CENTS` is hardcoded** — `$50` (5000 cents). Admin-configurable thresholds are a future enhancement (the spec's open question on "lower threshold with manual approval" is deferred — STUB-055 covers it). The hardcoded constant lives in `request-options.ts` so it can be lifted to a `platform_settings` read in a future tick without touching the action or the button.
- **P6.7 Slice 1 — Service-role reads, not RLS-aware** — `getAdminPayoutRequests` uses `getServiceSupabase()` because the admin sees every partner's rows (the `payout_requests_partner_read_own` policy would block the cross-partner read). Matches the existing `getAdminLedger` pattern.
- **P6.7 Slice 1 — 6 parallel partial-index COUNT queries, not 1 aggregate** — PostgREST doesn't expose `COUNT(*) FILTER (WHERE status='X') GROUP BY status` in one roundtrip. Six `select('*', { count: 'exact', head: true }).eq('status', X)` queries in `Promise.all` is one parallel RT — each is a cheap partial-index scan (the existing `payout_requests_pending_idx` etc. from migration 0031 covers each). Total is summed in JS. Net cost: 1 RT, same as one aggregate.
- **P6.7 Slice 1 — Counts are computed over the FULL set, not the filter** — the chip strip always shows the true totals so the admin sees "12 pending" even when viewing the approved tab. The page echoes `result.filters` for the chip active state, NOT the original searchParams (a typo'd `?status=typo` falls back to "no filter" and the All chip is active). Mirrors the P6.3 partner-aggregate pattern.
- **P6.7 Slice 1 — Canonical URL hygiene** — `?status=pending` when pending is the filter; `/admin/payouts` (no `?status=`) when All is the filter. No trailing `?` for empty params. Bookmarkable + shareable + survives page reload.
- **P6.7 Slice 1 — Queue is RSC, no client JS** — `<PayoutRequestQueue>` uses `<Link>` from `next/link` for chip navigation. No client island needed. Slices 2+ (approve/deny buttons) will add a client island.
- **P6.7 Slice 1 — Status pill via `data-status` attribute** — CSS reads `[data-status='pending']` / `[data-status='paid']` / `[data-status='denied']` / `[data-status='failed']` / `[data-status='canceled']` for the color variants. No inline `style={{ color }}`. Same pattern as P6.4's `LedgerTimeline`.
- **P6.7 Slice 1 — Defensive mapping fails closed** — a corrupted row (missing `amount_cents`, wrong `status`, wrong `payout_method_kind`) is dropped, not surfaced as a half-mapped shape. The page renders with whatever rows pass.
- **P6.7 Slice 1 — Existing shipped code refactored to remove inline colors** — `/admin/payouts/page.tsx` previously used `style={{ color: 'var(--success)' }}` on `<StatCard>` and `style={{ color: e.amount_cents > 0 ? 'var(--success)' : 'var(--danger)' }}` on the amount cell. Both moved to attribute selectors (`[data-accent='...']` and `[data-direction='credit|debit']`). No public API change, no behavior change.
- **P6.7 Slice 1 — AdminShell refactor added sidebar + topbar + signout** — `/admin/payouts` previously was a "RSC without the admin shell" (no sidebar, no topbar). After the refactor it matches `/admin/categories` + `/admin/account-switcher`. Required adding `/admin/payouts` to the AdminSidebar nav. Shared first-load JS jumped 101 kB → 200 kB (the shell + sidebar client island); this is the cost of consistency across admin pages.

## Stubs

- **STUB-011** — the 14-day refund window is hard-coded in `onPaymentSucceeded` and in the cron. Admin can't change it without a code deploy. PH18 wires a `platform_settings.refund_window_days` read.
- **STUB-012** — the partner's CSV export of their own ledger is rate-limited to 10/hour via a per-partner key in `processed_webhooks` or a separate `rate_limit_events` table. v1: in-process rate limit (good enough for a single-server deploy); v2: Supabase-backed rate limit when we go multi-instance.
- **STUB-046+** — pagination UI (keyset query is in place via `beforeId`; needs "Load more" link + URL round-trip) + date-range filter (`?from=&to=`) — both deferred to Slice 3.
- **STUB-055** — `MIN_PAYOUT_REQUEST_CENTS` is hardcoded to $50 in `request-options.ts`. Admin-configurable thresholds (lower threshold with manual approval for new partners) are deferred; the constant is a single-file lift when the `platform_settings.minimum_payout_threshold_cents` row lands (PH14.12 territory).
- **STUB-057** — P6.7 Slice 1 ships the read-only queue (getAdminPayoutRequests + `<PayoutRequestQueue>` + refactored `/admin/payouts`). Slice 2+ deferred: approve / deny server actions + atomic UPDATE on payout_ledger; "Trigger manual batch" modal with typed-confirmation; PayPal Mass Payout API integration (gated on creds; mirrors the Stripe wrapper from P2.5); refund queue section (crosses into P14.9); admin search / per-partner drilldown; per-admin rate-limit on manual batches (spec calls for "max 5/day/admin"); partner approval/denial email notifications (Phase 17 territory).
- **STUB-058** — P6.8 Slice 1 ships the read-only per-partner admin view (getAdminPartnerPayouts + `<AdminPartnerPayouts>` + `/admin/payouts/partner/[id]` route + exported `<PayoutRequestRow>` from the queue + partner name link in the queue). Slice 2+ deferred: `forceAdjustAction` server action (INSERTS a new `adjustment` row, never UPDATEs the original — per the ledger append-only invariant) + audit row `action='ledger_force_adjust'`; `clawbackAction` server action (INSERTS a negative `clawback` row + flips the source to `status='void'` where appropriate); per-partner "Trigger manual batch" modal with typed-confirmation ("type TRIGGER") + PayPal Mass Payout API integration (gated on creds); per-partner pagination UI ("Load more" link using the `beforeId` keyset cursor); email notifications (Phase 17 territory); per-admin rate-limit on adjustments (spec calls for "max 5/day/admin" — wire into the Supabase-backed table when P18.8 ships).
- **STUB-061** — P6.9 surfaced during the royalty engine audit: no `charge.dispute.created` / `charge.dispute.closed` webhook handler in `04-platform/webhooks/stripe/`. New `onDisputeCreated` + `onDisputeClosed` handlers needed (pattern is a near-clone of `onRefund.ts`). `payout_ledger_kind` enum needs a `'dispute'` value (or reuse `kind='refund'` with a metadata flag). Stripe Dashboard webhook subscription is a human step. 1-2 ticks.
- **STUB-062** — P6.9 surfaced: partial grant/ledger insert failure on payment success is silently dropped. `onPaymentSucceeded.ts:120-160` catches `grantErr`/`ledgerErr` separately and logs at warn level, but the order is already marked `paid` — webhook retries short-circuit because `order.status === 'paid'`. Fix: retry the inserts in-place before flipping to paid, OR a separate admin repair tool. 1-2 ticks.
- **STUB-063** — P6.9 surfaced: no payment-failure webhook handler. Orders stay in `status='awaiting_payment'` forever when payment fails; cart lines are never reverted to `active`. New `onPaymentFailed` handler needed (covers `payment_intent.payment_failed`, `checkout.session.expired`, `checkout.session.async_payment_failed`). Stripe Dashboard subscription is a human step. 1-2 ticks.
- **STUB-059 / STUB-060** — RESOLVED in P6.9 cycle. The hardcoded-USD refund row (Bug #2) is fixed by reading `order.currency` in `onRefund.ts`. The partial-refund over-clawback (Bug #1) is fixed by the new `calculateRefundRoyalty` helper. Both bugs are now mechanically locked by tests; see `docs/ROYALTY-ENGINE-AUDIT.md` §3 + §8 for the audit trail and ADR-0009 for the invariant.
- **STUB-056** — partner self-cancellation of a pending request. The action enforces "no second pending request" via the existing-pending check but doesn't expose a way to cancel a pending request. PH6.6 ships the create-side; the cancel-side waits on the P6.7 admin approval UI (a partner shouldn't be able to cancel an admin-reviewing request).- **P6.8 Slice 1 — Per-chain queues in the test mock, not a shared queue** — the standard chainable Supabase mock pattern (shared `serverQueue`) has a race when `Promise.all` reads include both `maybeSingle()` chains (consumed during array-literal eval) and plain chains (consumed when Promise.all calls `.then`). The result: the queue items get consumed in an order the test can't predict. Slice 1 ships a **per-chain queue** mock — each `from(table)` call gets its own queue keyed by chain index, so the test can enqueue a result for chain N independently. 24 unit tests in `getAdminPartnerPayouts.test.ts`, runs in 7ms.
- **P6.8 Slice 1 — Service-role reads, not RLS-aware** — `getAdminPartnerPayouts` uses `getServiceSupabase()` because the admin sees every partner's rows (the `payout_ledger_partner_read_own` policy would block the cross-partner read). Matches the existing `getAdminLedger` + `getAdminPayoutRequests` pattern. The audit-log invariant is still preserved — every write action (Slices 2+) will write a row.
- **P6.8 Slice 1 — Partner row drives the 404** — Round 1 of the query is a single `from('partners').select(...).eq('id', partnerId).maybeSingle()` that decides whether the page renders or 404s. "Partner doesn't exist" and "partner is owned by another tenant" both collapse to "0 rows from service-role" → `null` → `notFound()`. Matches the P6.4 "404 doesn't leak existence" pattern.
- **P6.8 Slice 1 — 8 reads in parallel after the partner row succeeds** — Round 2 = `Promise.all([profile, available, locked, paid, nextRelease, pending, ledger, requests])` — 8 reads, 1 RT, all hitting existing indexes (the (partner_id, status) partial indexes for the summary aggregates + the (partner_id, created_at desc) indexes for the entries + requests).
- **P6.8 Slice 1 — PII-safe select is a contract** — profiles NEVER selects `email / ip / user_agent`. Partners NEVER selects the encrypted `payout_method` JSONB. The unit test asserts the captured select payloads don't contain these substrings — a regression fails at PR time. The actual customer-facing email + PayPal email + IP / user_agent are NOT exposed on this page; the admin sees only the masked PayPal snapshot from `payout_requests.payout_method_target_masked`.
- **P6.8 Slice 1 — Log payloads use 32-bit FNV-1a hash of partner_id + actor_id** — matches the P6.3 + P6.6 audit-log pattern. The actual partner id is internal-account PII; logging it would leak to any log-aggregator downstream. The hash is short (8 hex chars) but unique-enough for the daily volume.
- **P6.8 Slice 1 — `<PayoutRequestRow>` is now exported** — was internal to `PayoutRequestQueue.tsx`. The new `<AdminPartnerPayouts>` composes it for the per-partner request list — same row markup, same masked PayPal snapshot, same status pill colors. Zero divergence between the queue view and the partner view's request rendering.
- **P6.8 Slice 1 — Partner name in the queue is now a `<Link>`** — adds a click target from `/admin/payouts` into `/admin/payouts/partner/<id>`. The link is the dotted-underline-on-hover treatment (inherits color, focus-visible outline) — discoverable but not visually noisy in the queue.
- **P6.8 Slice 1 — No client JS shipped** — the page is `427 B / 200 kB` first-load. The 200 kB is the shared admin shell (AdminShell + sidebar + topbar + active-nav client island); the per-partner RSC is essentially free.
- **P6.9 — Snapshot invariant is read-only by design** — `onPaymentSucceeded` and `onRefund` NEVER re-query `partners.royalty_pct_bps`. They read `order_items.royalty_cents` + `order_items.royalty_pct_bps` and propagate those values to `payout_ledger`. A future refactor that "optimizes" by re-deriving from the live partner row fails 4 explicit test assertions across `onPaymentSucceeded.test.ts` + `onRefund.test.ts`.
- **P6.9 — Proportional refund math via the helper, not inline arithmetic** — `calculateRefundRoyalty(saleRoyaltyCents, orderTotalCents, refundAmountCents)` is the single source of truth for refund clawback math. Floor semantics + clamp-at-full-sale-royalty means we never over-claw a partner on a partial refund. The 18 tests in `cents.test.ts` + the "proportional refund math" suite in `onRefund.test.ts` lock the helper's contract.
- **P6.9 — Refund row currency matches the order's currency** — `onRefund.ts:127` reads `order.currency` (the order row already includes `currency` in the initial select at line 50) and propagates it to every refund ledger row. Multi-currency catalogs (EUR/GBP) now produce correctly-tagged refund rows; the partner's per-currency aggregates stay balanced. Locked by the "refund ledger row currency is propagated from order.currency (EUR stays EUR)" test.
- **P6.9 — ADR-0009 documents the invariant** — `docs/adr/0009-royalty-snapshot-invariant.md` is the contract. Any future change to the royalty / ledger flow must update the ADR alongside the code.
