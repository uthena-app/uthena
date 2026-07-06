# Admin Order Detail — `/admin/orders/[id]`

## What this page does

The admin's single-order view. Everything on `/account/orders/[id]` PLUS the admin-only fields: customer email + IP-hash, full Stripe PaymentIntent ID, fraud score, partner's `payout_ledger` row, affiliate's commission row, every refund against this order, and the complete event log (status changes, refund events, Stripe dispute webhooks). Admin actions: issue manual refund, mark as fraudulent, resend receipt, add internal note. The page embeds the customer-facing order detail as a read-only inline view so the admin sees what the customer sees.

The page is the admin's deep-investigation surface. It is also the place where a destructive action (`mark as fraudulent`) is most consequential — it triggers partner/affiliate reversal ledger entries and customer email, so it requires a typed confirmation.

Server-rendered RSC. No caching (financial data). Every page view + every action is audit-logged. The 404 path is the same as the customer-side spec: if the order doesn't exist, the page returns 404 (we don't differentiate from "exists but not visible" — not relevant here since admin can see all, but consistency).

## Data this page shows

| Section | Field | Source | Format |
|---|---|---|---|
| Header | `#12345` (id), date, status badge, "← Back to orders" link | orders | header |
| Fraud callout | (conditional) warning banner if `orders.ip_address` matches a known fraud pattern (v1: any order with `status='fraudulent'` OR `fraud_score >= 70`) | computed | banner, red |
| Customer panel | display_name, email, customer_since, lifetime_orders, lifetime_spend, last_login_at | profiles + orders (aggregate) | card |
| Order panel | line items (thumbnail, title, tier, unit price, quantity, refunded), money breakdown, payment method (brand + last4) | orders + order_items + products | card (same as customer view) |
| Stripe panel | `stripe_payment_intent_id` (full, copyable), `stripe_checkout_session_id`, `stripe_charge_id` (if captured), payment status from Stripe, fraud_score (if available) | orders + Stripe API (read-only at render time) | card |
| IP / device panel | `ip_address` (full, displayed to admin only), `user_agent`, ip_hash for cross-order matching, signup_ip (if different) | orders | card |
| Partner panel | partner display_name (link to `/admin/partners/[id]`), `payout_ledger` row (kind, amount, status, locked_until) | partners + payout_ledger | card |
| Affiliate panel | (conditional) affiliate handle (link to `/admin/affiliates/[id]`), `affiliate_commissions` row (amount, status, locked_until) | affiliates + affiliate_commissions | card |
| Refunds panel | list of every `refunds` row for this order (id as `R-12345`, requested_at, reason, amount, status, resolved_at, resolved_by) | refunds | table |
| Events panel | complete event log for this order: `admin_audit_log` rows where `target_table='orders' AND target_id=orders.id`, plus Stripe webhook events (`processed_webhooks` where `payload->>'order_id' = orders.id`) | admin_audit_log + processed_webhooks | chronological list |
| Customer-view embed | read-only inline render of `/account/orders/[id]` (same data, no interactive buttons) | composed from `02-features/account/components/OrderDetailReadOnly.tsx` | iframe-style block at bottom |
| Action panel | "Issue manual refund", "Mark as fraudulent", "Resend receipt", "Add internal note" buttons + a "View full audit" link | derived | sticky right rail or bottom bar |

**Queries:**
- `getAdminOrderById(orderId)` in `02-features/admin/queries/getAdminOrderById.ts` — joins orders + order_items + products + profiles + partners + affiliates + (latest) payout_ledger + (latest) affiliate_commissions
- `getOrderRefunds(orderId)` — refunds rows for this order
- `getOrderEvents(orderId)` — `admin_audit_log` rows + `processed_webhooks` rows for this order

## User actions

| Action | Trigger | Result | RBAC |
|---|---|---|---|
| Back to list | Click "← Back to orders" | Navigate to `/admin/orders` (preserves any prior filter via `?back=`) | admin |
| Open partner detail | Click partner display_name in Partner panel | Navigate to `/admin/partners/[id]` | admin |
| Open affiliate detail | Click affiliate handle in Affiliate panel | Navigate to `/admin/affiliates/[id]` | admin |
| Open refund detail | Click a refund row | Navigate to `/admin/refunds?refundId=[id]` (highlights that row in the queue) | admin |
| Issue manual refund | Click "Issue manual refund" | Opens a modal: amount input (default = remaining refundable), reason textarea (required). On confirm: creates a `refunds` row with `status='approved'`, calls Stripe refund, creates the `payout_ledger` reversal + `affiliate_commissions` reversal atomically. Email to customer. | admin |
| Mark as fraudulent | Click "Mark as fraudulent" | Opens a typed-confirmation modal (must type "FRAUD" to enable the button). On confirm: `orders.status='fraudulent'`, revokes `library_grants` for all order items, creates `payout_ledger` reversal (kind='adjustment' or new `fraudulent_reversal` — flag in Open Questions), creates `affiliate_commissions` reversal, emails customer ("Your purchase has been reversed"), emails partner ("A sale has been reversed as fraudulent"). | admin |
| Resend receipt | Click "Resend receipt" | Sends the receipt email (Resend template `order-receipt`) to the customer's email. Logs the resend | admin |
| Add internal note | Click "Add internal note" → type in textarea → save | Inserts a row into `admin_audit_log` with `action='admin_note', target_table='orders', target_id=orders.id, after={note: '...'}` | admin |
| Copy PaymentIntent ID | Click the copy icon next to the Stripe PaymentIntent | Copies the full ID to clipboard | admin |
| View full audit | Click "View full audit" | Navigate to `/admin/audit?table=orders&id=[id]` (v2) — for v1, the events panel on this page IS the audit | admin |

## What this page does NOT do

- No "edit order" (orders are immutable financial records; corrections go through refunds + adjustments)
- No "edit line items" (the order_items are immutable; corrections go through partial refunds)
- No "void" or "cancel" before payment (orders are paid via Stripe Checkout; pending = not yet paid; failed = Stripe rejected; we don't have an in-flight state to cancel)
- No "resend to a different email" (resend uses the customer's email on file; changing it requires editing `profiles.email` on the customer detail page)
- No "skip the customer email" toggle on the fraud action (the customer MUST be notified; this is a legal requirement, not optional)
- No "manual ledger entry" UI (ledger entries are created by triggers and the existing actions; manual journal entries are admin-only via the platform's database tool, not this UI)
- No "view as customer" iframe with a different session (the embed is the same data rendered with no buttons; we do NOT impersonate the customer)
- No real-time event push (the events panel is RSC; admins reload to see new webhook events)

## Acceptance criteria

- [ ] Page is auth-gated AND requires `profiles.role = 'admin'`; customer/partner/affiliate access returns 403; non-existent order ids return 404
- [ ] The fraud callout renders when `status='fraudulent'` OR `fraud_score >= 70` and is hidden otherwise
- [ ] Customer panel shows display_name, email, customer_since, lifetime_orders, lifetime_spend, last_login_at; Stripe panel shows the FULL `stripe_payment_intent_id` (no truncation), `stripe_checkout_session_id`, and the latest payment status from Stripe
- [ ] Partner panel links to `/admin/partners/[id]` and shows the matching `payout_ledger` row (or "— no ledger row —"); Affiliate panel renders only when `orders.affiliate_id IS NOT NULL` and links to `/admin/affiliates/[id]`
- [ ] Refunds panel lists every `refunds` row for the order (newest first, with id, requested_at, reason, amount_cents, status, resolved_at, resolved_by display_name); Events panel interleaves `admin_audit_log` and `processed_webhooks` rows for the order by timestamp desc
- [ ] "Issue manual refund" modal pre-fills to the remaining refundable amount, requires a reason, and runs the atomic refund flow on submit (Stripe call + refund row + ledger reversal in one transaction)
- [ ] "Mark as fraudulent" requires typing the literal string `FRAUD` to enable the confirm button; on confirm, the page reloads with a "Marked as fraudulent by [admin] at [time]" banner; the action also revokes `library_grants` for all order items
- [ ] "Resend receipt" sends a single email using the `order-receipt` Resend template; "Add internal note" saves to `admin_audit_log` with `action='admin_note', after={note: '...'}`, redacted at 500 chars
- [ ] The customer-view embed renders the same data as `/account/orders/[id]` but with all action buttons removed (read-only)
- [ ] Every page view, action, and copy of the PaymentIntent ID writes one row to `admin_audit_log` with the action strings `view_order_detail`, `issue_manual_refund`, `mark_fraudulent`, `resend_receipt`, `admin_note`, and `copy_payment_intent_id` (the copy is logged because it is a potential exfiltration signal)
- [ ] Page renders in < 800ms p95; no PII in URLs (order id is `bigint`); no `TODO` / `FIXME` in the diff

## Design reference

- Mockup: not yet built — to be created during the admin feature build
- Components: `00-foundations/ui/AdminSidebar.tsx`, `00-foundations/ui/OrderDetailReadOnly.tsx` (re-used from `02-features/account/components/`), `00-foundations/ui/FraudCallout.tsx`, `00-foundations/ui/ActionPanel.tsx`, `00-foundations/ui/ConfirmModal.tsx` (typed-confirmation component), `00-foundations/ui/StripePanel.tsx`, `00-foundations/ui/EventLog.tsx`
- Tokens: `00-foundations/design/tokens.css`
- Theme: dark (default)

## Security

- **Auth required:** YES
- **Allowed roles:** admin (only)
- **RLS policies that apply:** `orders` (`orders_admin_all`), `order_items` (inherits via order), `products` (`products_admin_all`), `profiles` (`profiles_admin_all` for customer + admin actor display_names), `partners` (`partners_admin_all`), `affiliates` (`affiliates_admin_all`), `payout_ledger` (`payout_ledger_admin_all`), `affiliate_commissions` (no specific policy named in `_data-model.md`; admin-all is implied — flag in Open Questions), `refunds` (`refunds_admin_all`), `admin_audit_log` (`admin_audit_log_admin_read`)
- **PII displayed:** YES — by design. Customer email, IP address, user agent, full card brand+last4, full Stripe PaymentIntent ID. All admin views are audit-logged
- **PII in URLs:** NO — order id is `bigint`
- **Audit logged:** YES. `action` values used in `admin_audit_log`:
  - `view_order_detail` — every page view (target_id = order id)
  - `issue_manual_refund` — manual refund submission (target_id = order id; before/after include the amount + reason)
  - `mark_fraudulent` — fraud action (target_id = order id; before = order row, after = order row with status flipped)
  - `resend_receipt` — receipt resend (target_id = order id)
  - `admin_note` — internal note added (target_id = order id; after = { note: '...' })
  - `copy_payment_intent_id` — when the copy button is used (target_id = order id; this is the only "view-only" action that gets its own row, because it's a potential exfiltration signal)
- **Rate limiting on destructive actions:** max 10 manual refunds + max 5 fraud marks per admin per hour. Exceeding returns 429 and writes `action='rate_limit_triggered'`
- **Typed confirmation:** the fraud action requires typing `FRAUD`. The manual refund modal does not require a typed confirmation (the modal itself is the confirmation — a second typed gate would be friction without value)
- **CSRF:** all server actions on this page are CSRF-protected
- **Stripe API key:** stored in env, never returned to the client. The page reads payment-intent status via a server action, never exposes the secret key
- **Atomic transactions:** "Issue manual refund" runs the Stripe refund call + the `refunds` insert + the `payout_ledger` reversal + the `affiliate_commissions` reversal in a single Postgres transaction. If any step fails, the whole thing rolls back (we use a wrapper in `02-features/admin/transactions/atomicRefund.ts`)
- **Reversal email opt-out:** NONE — the customer email on fraud is mandatory (legal notification)
- **Third-party scripts:** none

## Performance

- **Target p95:** < 800ms (multiple panels + the customer-view embed)
- **Render strategy:** RSC + SSR, no caching
- **Cache:** NONE — financial data
- **DB indexes used:** all the ones from `admin-orders.md` plus `payout_ledger (order_id)`, `affiliate_commissions (order_id)`, `refunds (order_id)`, `admin_audit_log (target_table, target_id, at desc)`, `processed_webhooks` is JSONB-scanned (no index — flag in Open Questions if this becomes slow)
- **Bundle size budget:** < 50KB added to client bundle (modal, action panel, event log, embed). The embed re-uses the customer-side components but in a read-only mode
- **Parallel queries:** the page runs `getAdminOrderById`, `getOrderRefunds`, `getOrderEvents` in parallel via `Promise.all` in the RSC loader
- **Stripe API call:** the Stripe panel makes ONE server-side API call to fetch the latest payment-intent status. Cached for 60s in-process to avoid hammering Stripe on reload

## Out of scope for v1

- Edit order / edit line items (immutable financial records)
- Edit billing address
- Skip-customer-email toggle on fraud (legal notification is mandatory)
- Manual ledger entry UI
- "View as customer" impersonation
- Real-time event push
- "Void" or "cancel" pre-payment (orders are paid via Stripe Checkout; no in-flight state)
- "Skip Stripe" path for manual offline refunds (every refund goes through Stripe in v1)
- Per-admin "I've seen this order" acknowledgment tracking
- Per-refund detailed view (refund rows link to the queue, not to a separate detail page in v1)

## Open questions for human

- **Fraud reversal ledger kind:** the data model's `payout_ledger` has kinds `('order_credit', 'refund_debit', 'payout_paid', 'adjustment')`. The fraud reversal is conceptually a refund_debit, but it may also need to cover a payout already paid out. My recommendation: use `kind='adjustment'` with a `description` of "Fraud reversal for order #[id]". This keeps the schema clean. Alternatively, add a new kind `fraudulent_reversal` if we want to filter on it later.
- **Mark-as-fraudulent on an already-paid-out ledger entry:** if a partner was already paid for this order (status='paid' in `payout_ledger`), the fraud reversal creates a NEGATIVE `payout_ledger` row that drives the partner's balance below zero. The next payout will deduct. Confirm OK, or should the fraud action BLOCK if any ledger row is already 'paid'?
- **Two small migrations for this spec to work + library-grant revocation on fraud:** (a) `affiliate_commissions` needs an admin-all RLS policy by name — the data model implies admin-all but doesn't name it. Add `create policy "affiliate_commissions_admin_all" on affiliate_commissions for all using (exists (select 1 from profiles where user_id = auth.uid() and role = 'admin'));` in a small migration. (b) The events panel scans `processed_webhooks.payload->>'order_id' = orders.id` without an index; at v1 scale (< 100K webhooks) this is fine, but add a GIN index on `payload` in a future migration if it becomes slow. (c) Library-grant revocation on fraud: yes, revoke immediately (`library_grants.revoked_at = now()`); the brief is explicit, no 7-day grace.

---

## Implementation notes

- `getAdminOrderById(orderId)` in `02-features/admin/queries/getAdminOrderById.ts` — joins: orders + profiles (customer) + order_items + products + partners + affiliates (via orders.affiliate_id) + (latest) payout_ledger for that order_id + (latest) affiliate_commissions for the first order_item
- `getOrderRefunds(orderId)` in `02-features/admin/queries/getOrderRefunds.ts` — simple select with display_name join on `resolved_by`
- `getOrderEvents(orderId)` in `02-features/admin/queries/getOrderEvents.ts` — UNION of admin_audit_log + processed_webhooks, ordered by timestamp desc, limit 50
- `issueManualRefund(orderId, amount_cents, reason)` in `02-features/admin/actions/issueManualRefund.ts` — atomic transaction (see Security)
- `markOrderFraudulent(orderId, confirmation_string)` in `02-features/admin/actions/markOrderFraudulent.ts` — checks the typed confirmation string equals `FRAUD`; on success, runs the full reversal flow
- The "Mark as fraudulent" action is wrapped in `requireTypedConfirmation('FRAUD')` — a helper in `00-foundations/admin/typed-confirmation.ts` that the action calls before doing any work

### Implementation notes — P14.8 (2026-06-30)

**Slice 1 (this tick)** ships the read path + masked-by-default Overview tab end-to-end. The destructive actions + reveal interactions + customer-view embed + Stripe live status are deferred to Slice 2+ (see STUB-122 in `STUBS.md`).

**Migration `0058_admin_order_detail.sql`** ships 3 SECURITY DEFINER RPCs:
- **`get_admin_order_detail(p_order_id bigint)`** — composes the entire Overview-tab payload in 1 round-trip via 6 CTEs: `o` (the order row + billing_address + IP + UA + Stripe IDs + status + totals + refunded + paid_at + fulfilled_at + created_at + updated_at), `stripe_charge` (probes `orders.metadata->>'stripe_charge_id'` — there's no dedicated column; the Stripe RPC reads metadata directly), `prof` (the customer's profile row by `o.user_id`), `customer_lifetime` (count of paid + partially_refunded + refunded orders + lifetime spend in cents), `partner_ranked` (DISTINCT ON `order_items.partner_id` to pick the first partner_id when multiple items share the order — typical PLR order pattern), `partner_display` (joins the partner's user_id → profiles.display_name), `affiliate_r` (the affiliate row by `o.affiliate_id`, conditional on the column being non-null), `items` (count of order_items rows). Fails closed with no rows when the order doesn't exist; the auth gate is `is_admin()` + the application-layer `requireAdmin()` for defense-in-depth.
- **`get_order_refunds(p_order_id bigint, p_limit int default 50)`** — refunds rows joined with `profiles` (twice — once for `requested_by_display_name`, once for `approved_by_display_name`). Hard-capped at 200 via `LEAST(200, GREATEST(1, p_limit))`. Default per spec "last 50 refunds".
- **`get_order_events(p_order_id bigint, p_limit int default 50)`** — UNION ALL of (a) `admin_audit_log` rows where `target_kind='orders'` AND (`target_id=p_order_id` OR `metadata->>'order_id'=p_order_id` — the dual-key match handles both the new `admin.order_detail_viewed` writes and any legacy `metadata.carries_order_id` writes) with (b) `processed_webhooks` rows where `payload ? 'order_id' AND payload->>'order_id'=p_order_id` — at v1 scale < 100k webhooks the JSONB extract scan is fine (spec OQ line 129b notes the GIN index follow-up). Hard-capped at 200.

All 3 RPCs are SECURITY DEFINER + `set search_path = ''` + REVOKE from PUBLIC + GRANT to authenticated (matches the 0052-0057 hardener pattern).

**Spec OQ resolutions (Slice 1):**
- **(a) `affiliate_commissions_admin_all` policy**: ALREADY SHIPPED in migration 0046 (`0046_affiliate_dashboard.sql:325`); `check:rls` confirms. No new migration needed.
- **(b) GIN index on `processed_webhooks.payload`**: deferred to Phase 18 P18.5 webhook-volume monitoring (out of this stub's scope; will surface as a STUB when the admin's PII-revealed webhook count crosses the ~10K threshold).
- **(c) Library-grant revocation on fraud**: lands with the `markFraudAction` server action in Slice 2 — the sweep query is `UPDATE library_grants SET revoked_at = now() WHERE order_item_id IN (SELECT id FROM order_items WHERE order_id = $1) AND revoked_at IS NULL`. No 7-day grace per spec line 129c.

**New `02-features/admin/order-detail/` module** (12 files; ~1830 LOC + ~720 LOC CSS):
- `queries/parseOrderDetailId.ts` (~50 LOC + 19 unit tests): pure positive-bigint validator — rejects `0` / negative / signed (`+`, `-`) / decimal (`.5`, `1.0`) / scientific (`1e3`) / leading-zero (`007`) / hex / unicode-digit confusables / RTL-override / zero-width / SQL-injection-shaped / CRLF / oversized (> 19 digits) / values > Postgres-bigint-max (9223372036854775807). The first 18 digits always fit; the 19-digit case (only the Postgres-max value itself) is accepted via the BigInt range check, anything 19 digits but > max is rejected.
- `queries/parseOrderDetailTab.ts` (~60 LOC + 8 tests): single 'overview' tab allowlist; default-strip on malformed/oversized/missing; conservative SQL-injection-shaped rejection. Slices 2+ will add 'actions' / 'notes' / 'activity' tabs; the parser will accept them automatically because `ORDER_DETAIL_TABS` is the source of truth.
- `queries/getAdminOrderDetail.ts` (~275 LOC + 9 tests): server query wrapper — `requireAdmin()` gate → `parseOrderDetailId` validation → RPC + defensive coercion (every bigint → `coerceBigint`; nullable bigints → `coerceBigintOrNull`; strings → `coerceString` with trim; unknown status → `'pending'` fallback) → composed payload with `customer_checkout_email_masked` + `ip_masked` pre-computed via `maskEmail` + `maskIp` from `@foundations/data/mask`. Fails closed on any error → null → 404.
- `queries/getOrderRefunds.ts` (~165 LOC + 8 tests): `p_limit` clamping (max 200, default 50, min 1); `RefundStatus` enum narrowing with 'pending' fallback; notes clipped at 500 chars to bound the UI display.
- `queries/getOrderEvents.ts` (~135 LOC + 7 tests): `event_kind` discriminator narrowing ('audit_log' / 'stripe_webhook'); metadata narrowing to `Record<string, unknown> | null`; limit clamping.
- `actions/writeOrderDetailViewAuditLog.ts`: best-effort `admin_audit_log` insert — try/catch + warn log on failure (matches the customer/partner/affiliate audit writer patterns; the page must never block on the audit row).
- `components/OrderDetailTabs.tsx` + `.module.css`: URL-driven tab nav with `data-active` attribute + `aria-current="page"` for screen-reader semantics; `<Link scroll={false}>` so the page doesn't jump on tab switch.
- `components/OrderDetailOverview.tsx` + `.module.css` (~470 LOC + ~510 LOC CSS): composes 6-card grid (Customer / Order / Stripe / IP-device / Partner / Affiliate conditional) + Refunds panel + Events panel. Token-only CSS; mobile responsive (grid collapses to 1-col at 1024px; tables tighten at 700px; events timeline collapses at 480px). All monetary values use `formatMoney(cents, currency)` with `asCurrency` defensive narrowing (`'USD' | 'EUR' | 'GBP'` typed).

**Route `03-app/admin/orders/[id]/page.tsx`** (~150 LOC): RSC + `sensitivePageMetadata` noindex + `force-dynamic` + `requireAdmin()` belt-and-suspenders gate + `parseOrderDetailId` validation + `parseOrderDetailTab` URL parsing + 3-way `Promise.all` of detail + refunds + events (`getAdminOrderDetail` is the heavy round-trip; refunds + events are narrow scans on indexes — `refunds.order_id`, `admin_audit_log.target_id`, `processed_webhooks.payload->>'order_id'`) + best-effort audit row write + AdminShell + breadcrumb + header + tab nav + tab content. The Stripe panel reads via `02-features/admin/orders/` types (re-uses the `ORDER_STATUS_LABEL` + `ORDER_STATUS_KIND` maps from P14.7).

**Route `loading.tsx`** + **`loading.module.css`** (RSC skeleton mirroring the page shape — breadcrumb + header + tab bar + 6-card grid + Refunds + Events sections). **Route `not-found.tsx`** (the 404 surface — "Order not found" + back-to-orders link).

**Tests (60 net new, runs in < 1s):**
- `parseOrderDetailId.test.ts` — 19 tests (canonical accept + Postgres-bigint-max accept + trim + empty/null/undefined rejection + `0` reject + signed reject + decimal reject + scientific reject + leading-zero reject + alphanumeric reject + unicode/zero-width/RTL-override reject + CRLF reject + oversized reject + values-above-Postgres-max reject).
- `parseOrderDetailTab.test.ts` — 8 tests (canonical accept + missing-input default + empty default + oversized default + unknown-tab default + SQL-injection default + array-form first-value handling + tab-list-as-tuple invariant).
- `getAdminOrderDetail.test.ts` — 9 tests (malformed-id short-circuit, empty/null/undefined-id short-circuit, anon-path throws, happy-path full mapping with every column, unknown-status 'pending' fallback, empty-RPC-result null return, RPC-error null + warn, negative-bigint clamping, missing-partner+affiliate null-handling).
- `getOrderRefunds.test.ts` — 8 tests (malformed-id short-circuit, RPC-error empty, empty-result empty, happy-path mapping with status, unknown-status 'pending' fallback, oversized-limit clamping, default-limit forwarding, zero-limit min-clamp).
- `getOrderEvents.test.ts` — 7 tests (malformed-id short-circuit, RPC-error empty, happy-path audit + webhook kinds distinguished, unknown-kind 'audit_log' fallback, metadata-null fallback, oversized-limit clamp, default-limit forwarding).
- `components.test.tsx` (12 tests via `renderToStaticMarkup`) — masked-by-default PII (raw email + raw IP NEVER in the DOM, masked variants always present), fraud-callout conditional render + omit on paid, affiliate-panel conditional render + omit when null, zero-refunds empty state + counter, refund-table row rendering + status pill + cross-link, events-list with both kinds visually distinguished + actor email, partner-empty fallback, refund row conditional on `refunded_cents > 0`, Stripe-panel empty-fallback when no ids recorded, single-tab nav with `data-active` + `aria-current`.

**FLAGGED CHANGES**:
- `00-foundations/data/enums.ts` (shipped code modified) — added `'admin.orders_list_viewed'` + `'admin.order_detail_viewed'` to the `AuditAction` union + `AUDIT_ACTIONS` array. No public API change.
- `02-features/admin/orders/types.ts` (existing module) — re-exported `ORDER_STATUS_LABEL` + `ORDER_STATUS_KIND` from the order-detail Overview component to keep the order-list + order-detail status vocabulary in sync. This was already exported in the types module; the import path is now used by a second consumer (the order detail) but no surface change.

**Out of scope for Slice 2+ (filed as STUB-122)**:
- Reveal interactions for IP + checkout email (30s auto-mask + per-reveal audit rows)
- Issue manual refund action (atomic Stripe refund + refunds row + payout_ledger reversal + affiliate_commissions reversal + audit row)
- Mark as fraudulent action (typed-FRAUD confirmation + library_grants revoke sweep + payout_ledger `kind='adjustment'` reversal + affiliate_commissions reversal + audit row)
- Resend receipt action (Phase 17 SES dependency)
- Copy PaymentIntent ID action (client island + audit row)
- Add internal note (writes to admin_audit_log with `action='admin_note'`, 500-char redaction)
- Action rail (sticky right-rail on desktop ≥ 1024px)
- Stripe live payment-intent status panel (60s in-process cache + Stripe REST API call)
- Customer-view embed (read-only inline render of `/account/orders/[id]`)
