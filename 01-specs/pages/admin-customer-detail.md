# Admin Customer Detail — `/admin/customers/[id]`

## What this page does

The single-customer admin view. The page is the operational hub for everything about one customer account: account status, profile, complete order + refund + review history, library, active sessions, free-form admin notes, and a complete activity timeline. It's the answer to "what's going on with this account?" — the page a fraud responder, a support agent, or a compliance officer opens when something is wrong.

The most distinctive feature on this page vs. the partner/affiliate detail: the **Sessions** tab (active sessions + admin revoke), the **Reviews** tab (unpublish action), and the **Ban** action (irreversible — distinct from suspend). The customer detail is also where the GDPR right-to-deletion request would be processed — flagged in Open Questions because it conflicts with 7-year financial record retention.

**Tabs (9):** Overview · Profile · Orders · Library · Refunds · Reviews · Sessions · Notes · Activity.

## Data this page shows

| Tab | Fields | Source |
|---|---|---|
| Overview | status (active/suspended/banned), lifetime stats (spend, orders count, library count, refund rate, risk score + breakdown), contact (email, signup IP hash — first 8 chars + `...`, last login IP hash — first 8 chars + `...`), signup date, last active, risk score badge with hover breakdown | profiles + orders + refunds + library_grants + risk_signals |
| Profile | editable: `profiles.display_name`, `profiles.bio`, `profiles.locale`, `profiles.timezone`; read-only: email, `profiles.avatar_url`, signup date, role | profiles |
| Orders | paginated `orders` for the customer: order_id, date, items count, total, status badge, payment method (brand+last4), affiliate handle (if any), partner share (if relevant), action: "Manual refund" (links to the refund approval flow) | orders + order_items + products |
| Library | list of `library_grants`: product title, tier, source (purchase/admin_grant/free_promotion/bundle/refund_reversal), granted_at, expires_at, revoked_at (if revoked), action: "Revoke" (with reason) | library_grants + products |
| Refunds | full refund history: order_id, product, amount, status, requested_at, resolved_at, resolution_notes | refunds + orders + order_items + products |
| Reviews | reviews the customer wrote: product, rating, title, body, status (pending/approved/rejected/flagged), helpful_count, created_at, action: "Unpublish" (sets status='flagged', hides from public) | reviews + products |
| Sessions | list of active sessions: device, IP (first 8 chars), last_active, created_at, current_session flag; action per row: "Revoke this session"; bulk action: "Revoke all other sessions" (keeps the current admin's session) | sessions (Supabase Auth `sessions` table — see OQ) |
| Notes | admin-only free-form notes (proposed `customer_admin_notes` table, same shape as `partner_admin_notes` / `affiliate_admin_notes`) | customer_admin_notes (proposed) |
| Activity | every `admin_audit_log` row where `target_table='profiles'` AND `target_id = self.user_id`, plus related rows (orders, refunds, library_grants, reviews, sessions); reverse chronological, filter by action type | admin_audit_log |

**Queries:** `02-features/admin/queries/getCustomerDetail.ts` returns the full customer + tabs data.

## User actions

| Action | Trigger | Result | RBAC |
|---|---|---|---|
| Switch tab | Click tab nav | URL updates with `?tab=...`; tab content swaps | admin |
| Edit profile (Profile tab) | Change field, click "Save" | Updates `profiles`; audit `action='edit_customer_profile'` with before/after JSON | admin |
| Suspend customer (right rail) | Click "Suspend" | Modal: reason (required) + typed confirmation ("SUSPEND"); on confirm: `profiles.status='suspended'`, force-logout all sessions (revoke all sessions in the Sessions tab in the same action), suspension email, audit `action='suspend_customer'`. Banned customers cannot be re-suspended — they must be unbanned first (v2 only — see OQ). | admin |
| Unsuspend customer | Click "Unsuspend" | Modal: optional note + typed confirmation ("UNSUSPEND"); on confirm: `profiles.status='active'`, audit. Does NOT auto-revoke any sessions; the customer can log in again. | admin |
| Ban customer (right rail — visible only if `status in ('active', 'suspended')`) | Click "Ban" | Modal: warning banner ("Ban is IRREVERSIBLE in v1. The account cannot be recovered. Financial records are preserved for 7 years per legal requirements."), reason (textarea, required, ≥ 50 chars), typed confirmation ("type BAN [email] to confirm" — the email is included so the admin must type the customer's actual email, not just "BAN"). On confirm: `profiles.status='banned'`, force-logout all sessions, ban email, audit `action='ban_customer'`. The customer cannot log in. Their data (orders, refunds, library_grants) is NOT deleted (financial retention). | admin (super_admin recommended — see OQ) |
| Issue manual refund (Orders tab) | Click "Refund" on an order row | Opens the manual-refund modal (same flow as admin-refunds.md): amount (pre-filled = order total), reason, typed confirmation. On confirm: Stripe refund + ledger debit + email, all atomic. Audit `action='manual_refund_order'`. | admin |
| Revoke library grant (Library tab) | Click "Revoke" on a grant | Modal: reason (required) + typed confirmation ("REVOKE"); on confirm: sets `library_grants.revoked_at=now()`, audit `action='revoke_library_grant'`. The customer loses access to the product immediately (the file URLs stop generating). The grant row is preserved (not deleted) for audit. | admin |
| Unpublish a review (Reviews tab) | Click "Unpublish" on a review row | Modal: reason (required) + typed confirmation ("UNPUBLISH"); on confirm: sets `reviews.status='flagged'`, audit `action='unpublish_review'`. The review is hidden from the public product page but is preserved in the customer's review history (and admin's audit log). The customer gets a "Your review was unpublished because [reason]" email. | admin |
| Re-approve a flagged review | Click "Re-approve" on a flagged review | Modal: optional note + typed confirmation; on confirm: `reviews.status='approved'`, audit | admin |
| Revoke a single session (Sessions tab) | Click "Revoke" on a session row | Modal: optional reason + typed confirmation ("REVOKE"); on confirm: delete the session row in Supabase Auth, force-logout that device, audit `action='revoke_session'`. The customer is signed out of that device immediately. | admin |
| Revoke all other sessions (Sessions tab — bulk) | Click "Revoke all other sessions" | Modal: reason (required) + typed confirmation ("REVOKE ALL"); on confirm: delete all sessions EXCEPT the current admin's, audit `action='revoke_all_other_sessions'` | admin |
| Add note | Notes tab → write + "Post" | Insert into `customer_admin_notes`, audit | admin |
| Edit / delete note (own, <24h) | Notes tab → "Edit" / "Delete" | Inline edit / soft delete with audit | admin |
| Send email to customer | Right rail → "Email customer" | Pre-filled email template modal (templates: "Refund processed", "Security alert", "Account suspension notice", "Account ban notice", "GDPR data export ready", "General"); audit `action='email_customer'` with template name | admin |
| Process GDPR data export (right rail) | Click "GDPR data export" | Initiates a background job that generates a JSON + CSV bundle of the user's data (orders, refunds, library_grants, reviews, progress, profile, sessions). On completion, the admin gets a signed-URL link (7-day TTL) to download. The customer is emailed a copy too. Audit `action='gdpr_data_export'`. (See OQ on the GDPR-vs-retention conflict — the export EXCLUDES financial records that are still within the 7-year retention window; those are redacted from the export but preserved in the system.) | admin |
| Process GDPR deletion request (right rail) | Click "GDPR deletion request" | Initiates a review workflow. The data is NOT deleted immediately. The request is queued for super-admin review (a separate ADR — see OQ). The admin who opens this writes `action='gdpr_deletion_requested'` and the request appears on the super-admin queue. The customer's account is soft-locked (`status='suspended'` with a `gdpr_pending_deletion` flag — proposed) so no new orders are accepted. | admin |

## What this page does NOT do

- No "permanently delete customer" (we never hard-delete; ban is the strongest state; GDPR deletion is a review workflow, not an immediate action — see OQ)
- No impersonation of the customer's account (v2; gated to super_admin)
- No real-time updates
- No PII in URLs (route uses `user_id` (uuid) — never email or display_name)
- No "refund to a different payment method" (the Stripe refund goes back to the original payment method; if the card is gone, Stripe handles the failure path)
- No "merge with another customer" (v2)
- No customer-side notification of the admin notes (notes are admin-only; the customer never sees them)

## Acceptance criteria

- [ ] Page is auth-gated AND requires `profiles.role = 'admin'`
- [ ] Customer/partner/affiliate access returns 403
- [ ] Invalid user id returns 404 (RLS returns zero rows; loader throws `notFound()`)
- [ ] All 9 tabs render with non-empty content for an active customer; Library tab is empty-state for a customer with no purchases
- [ ] Status badge reflects `profiles.status` (active/suspended/banned)
- [ ] Risk score on Overview tab matches the value computed on the list page (same CTE)
- [ ] Email and signup/last-login IP hashes are masked by default; "Reveal" shows them for 30s, then auto-masks, AND writes `admin_audit_log` with `action='reveal_customer_email'` or `action='reveal_customer_ip'`
- [ ] "Suspend" requires a reason (non-empty after trim) AND a typed confirmation ("SUSPEND")
- [ ] "Suspend" force-revokes all sessions atomically — the customer's existing browser sessions are signed out before the page returns (verified by integration test: a session cookie is invalidated within 1s of the action)
- [ ] "Ban" is irreversible in v1: the modal includes an explicit "this is permanent" warning AND requires the admin to type the customer's actual email (not just "BAN")
- [ ] "Ban" preserves financial records (orders, refunds, ledger) for 7-year retention; the customer's library_grants are NOT revoked by ban (they can still access what they bought — only login is blocked)
- [ ] Banned customers cannot log in (verified by integration test: a banned user with valid credentials is rejected with a "This account is closed" message — NOT a generic auth failure, which would be a UX issue)
- [ ] "Manual refund" links to the same flow as admin-refunds.md; same atomicity, same audit
- [ ] "Revoke library grant" sets `revoked_at`; the file URL generator refuses to sign URLs for revoked grants (verified by integration test: download attempt after revoke returns 403)
- [ ] "Unpublish review" sets `status='flagged'`; the review disappears from the public product page immediately (no ISR delay — SSR re-render)
- [ ] "Revoke session" deletes the Supabase Auth session row; the customer's other-tab is signed out within 1s
- [ ] "Revoke all other sessions" preserves the current admin's session and the current admin's CSRF token (the action must not sign out the admin who is clicking it)
- [ ] "GDPR data export" generates the JSON+CSV bundle async; the admin gets a download link with 7-day TTL
- [ ] "GDPR deletion request" does NOT delete the data; it queues for super-admin review and soft-locks the account
- [ ] Notes are scoped to the customer; cross-customer note leaks are impossible (RLS)
- [ ] Activity tab shows every action across all tabs, in reverse chronological order, paginated
- [ ] Page renders in < 600ms p95
- [ ] No PII in URLs — the route is `/admin/customers/[id]` where `id` is the user's uuid (auth.users.id)
- [ ] No `TODO` / `FIXME` in the diff

## Design reference

- Mockup: `mockups/admin.html` (same shell as the other admin pages)
- Components: `00-foundations/ui/AdminSidebar.tsx`, `00-foundations/ui/TabNav.tsx`, `00-foundations/ui/StatCard.tsx`, `00-foundations/ui/ActionRail.tsx`, `00-foundations/ui/ConfirmModal.tsx`, `00-foundations/ui/RevealField.tsx`, `00-foundations/ui/ActivityLog.tsx`, `00-foundations/ui/NoteThread.tsx`, `00-foundations/ui/SessionRow.tsx` (per-session row with revoke)
- Design tokens: `00-foundations/design/tokens.css`

## Security

- **Auth required:** YES
- **Allowed roles:** admin (only); the "Ban" action additionally requires `super_admin` (proposed role — see OQ)
- **RLS policies that apply:** `profiles` (`profiles_admin_all`), `orders` (`orders_admin_all`), `refunds` (`refunds_admin_all`), `library_grants` (`library_grants_admin_all`), `reviews` (`reviews_admin_all`), `payout_ledger` (`payout_ledger_admin_all`), `progress` (admin-scoped reads), `risk_signals` (`risk_signals_admin_all` — proposed), `admin_audit_log` (`admin_audit_log_admin_read`), `customer_admin_notes` (proposed — admin all, no public read), `sessions` (admin can read all + delete; Supabase Auth `auth.sessions` — see OQ on RLS-on-auth-tables)
- **PII displayed:** yes — email (masked, reveal-audited), IP hashes (truncated, never raw), order details, refund reasons. Every reveal writes `admin_audit_log`.
- **PII in URLs:** NO. The route is `/admin/customers/[id]` where `id` is the user's uuid (the same uuid used by Supabase Auth). Tab navigation is `?tab=orders` only.
- **Audit logged:** YES — every action enumerated in User actions writes to `admin_audit_log` with a distinct `action` string.
- **Suspend / Ban force-logout:** the suspend and ban actions MUST revoke all sessions in the same transaction (or close enough that the customer's next request is rejected). A suspend that leaves the customer logged in is a footgun — they can keep using the account until the session expires. The implementation: Supabase Auth's `admin.signOut(userId)` revokes all refresh tokens.
- **Ban is irreversible in v1:** the spec calls this out. The modal warning + typed-email confirmation is a UX-level guard. The data-model guard is that `banned` → `active` is not a valid transition (no super-admin override UI in v1). The data is preserved (financial retention).
- **GDPR deletion review workflow:** deletion is a request, not an immediate action. The super-admin reviews the request, verifies the customer identity (e.g. via email confirmation), and decides: (a) approve deletion, (b) partial deletion (e.g. PII but keep financial records per retention), (c) reject with reason. The decision is logged. This is bigger than a one-off spec; flag for ADR.
- **GDPR data export — redaction:** the export includes the customer's own data: profile, orders, library_grants, reviews, progress, sessions. It EXCLUDES: (a) financial records still within the 7-year retention window (orders, refunds, ledger — preserved but redacted from the export), (b) other customers' data (the customer is never exported anyone else's info), (c) admin notes about the customer (notes are admin-internal, not the customer's own data). The redaction policy is documented in the export README.
- **CSRF:** all server actions protected by Next.js's built-in action token
- **Rate limiting:** reveal 100/hr/admin; profile edit 60/hr/admin; suspend/unsuspend 20/hr/admin; ban 3/hr/admin (extremely rare — should be reviewed carefully); manual refund 30/hr/admin; revoke library 30/hr/admin; unpublish review 30/hr/admin; revoke session 30/hr/admin; GDPR export 1/hr/admin (each export is a heavy operation); GDPR deletion request 5/hr/admin
- **Third-party scripts:** none. Stripe and Resend are server-side only.

## Performance

- **Target p95:** < 600ms
- **Render strategy:** RSC + SSR. Tabs are server-rendered.
- **Cache:** none
- **DB indexes used:** `profiles (id)`, `orders (customer_id, created_at desc)`, `refunds (order_id)`, `library_grants (user_id, granted_at desc)`, `reviews (user_id)`, `admin_audit_log (target_table, target_id, at desc)`
- **Bundle size budget:** < 60KB added to client bundle (tab nav, action rail, 5+ modals, reveal field, activity log, note thread)

## Out of scope for v1

- Hard-delete customer (ban is the strongest state; GDPR deletion is a review workflow, not an immediate action)
- Merge with another customer
- Impersonation / "view as customer"
- Real-time updates
- "Customer health score" composite (risk score is in v1; broader composite is v2)
- "Reset password on behalf of customer" (the customer uses the standard forgot-password flow)
- "Force logout everywhere" scheduled (v2: periodic forced logout for security)
- Customer-initiated GDPR request UI (admin processes requests from email in v1; self-serve GDPR portal is v2)
- A/B test of customer-facing email copy
- Slack notification on ban (in-app audit log only in v1)
- Cross-customer pattern detection (e.g. "this customer is using a card also used by 5 banned customers" — v2)

## Open questions for human

1. **Ban vs suspend state machine:** the brief asks whether ban is v1 or v2. My recommendation: **ban IS in v1**, as a separate state from suspend, with the irreversible semantics spec'd above. The alternative (defer to v2) means the admin has no tool for "this account must never come back" — a real need for fraud / abuse cases. The data-model change is small (one new enum value on `profiles.status`). Flag for human review.
2. **GDPR right-to-deletion vs 7-year ledger retention conflict:** the brief calls this out. My recommendation — flag for human review:
   - The 7-year retention applies to financial records (orders, refunds, payout_ledger) per US tax law (IRS requires 7 years for 1099 / 1099-K records).
   - The GDPR right-to-deletion (Article 17) allows exceptions for "compliance with a legal obligation" — which the 7-year retention is.
   - My recommendation: **the deletion request is a review workflow, not an immediate action**. The super-admin reviews, then decides:
     - **Approve full deletion:** revoke all `library_grants`, anonymize `profile` (replace PII with `deleted-user-[uuid]` placeholders), KEEP financial records (orders, refunds, ledger). The financial records are linked to the anonymized profile — the customer's name is gone but the IRS-required money trail is preserved.
     - **Approve partial deletion:** revoke library + anonymize profile, but preserve financial records as above.
     - **Reject:** the customer is told why (e.g. "active refund request", "pending chargeback", "legal hold").
   - The decision is logged with `action='gdpr_deletion_decision'`. The customer is emailed the decision.
   - This is a significant workflow; it deserves its own ADR. Flag.
3. **`customer_admin_notes` new table:** same shape as `partner_admin_notes` / `affiliate_admin_notes`. My recommendation: **reuse the same SQL with `customer_id` (or `user_id`) instead of `partner_id`**. Or, alternatively, ONE unified `admin_notes` table with a `target_table` + `target_id` polymorphic FK. The unified table is cleaner but loses the per-target RLS granularity. Flag for human review.
4. **Sessions table:** Supabase Auth manages `auth.sessions` directly. The admin needs to be able to read + delete any session. RLS on `auth.*` is restricted by Supabase. My recommendation: **use Supabase's `service_role` server action in the admin app** (already the pattern for the rest of admin). The service_role can read + delete `auth.sessions`. The RLS-policy approach is not viable for this table. Flag.
5. **GDPR data export format:** JSON only? JSON + CSV? PDF? My recommendation: **JSON (machine-readable, the customer's right) + CSV (human-readable, for the customer's own use)**. Bundle is a zip file. The customer gets an email with a 7-day signed-URL link; the admin gets a copy in their audit log. Flag.
6. **Banned customer's library access:** the spec says ban preserves library_grants (so the customer can still access what they bought). My recommendation: **confirm — ban blocks LOGIN, not access. The customer's library grants remain valid**. If the customer refunds all their purchases, the grants are revoked through the refund flow, not through ban. Rationale: a banned user who paid for content should still have what they paid for, modulo the standard refund window. Flag if the human prefers "ban also revokes all library grants" (stricter, but customer-hostile).

---

## Implementation notes

### P14.2 Slice 1 (2026-06-30) — Read path + Overview tab

**Status:** `[~]` Slice 1 ships the Overview tab end-to-end; Slices 2+ deferred to STUB-115.

**What changed:**

1. **Migration `0053_admin_customer_detail.sql`** — 3 SECURITY DEFINER RPCs:
   - `get_admin_customer_detail(p_user_id uuid)` — full read-only payload for the Overview tab: profile + auth.users (email + last_sign_in_at) + derived stats (lifetime_spend / order_count / library_size / last_active_at / refund_count / refund_rate) + risk breakdown (reuses `get_customer_risk_breakdown` from 0052). Returns 0 rows for admin rows + non-existent profiles (defense-in-depth).
   - `reveal_admin_customer_email(p_user_id uuid)` — returns the raw email for the explicit Reveal click. Writes one `admin_audit_log` row with `action='admin.customer_detail_reveal_email'`. Returns null for admin rows + non-existent profiles.
   - `reveal_admin_customer_first_seen_ip(p_user_id uuid)` — returns the raw IP from the customer's earliest PAID order. Writes one `admin_audit_log` row with `action='admin.customer_detail_reveal_ip'`. Returns null when no orders exist.

   All 3 RPCs are SECURITY DEFINER + `set search_path = ''` + REVOKE from PUBLIC + GRANT to authenticated (matches 0052 + 0021 + 0010). Idempotent (early-return guard + `create or replace`).

2. **`00-foundations/data/mask.ts`** — new pure helpers `maskEmail()` (Stripe/Shopify style: `j***@example.com`) + `maskIp()` (spec's "first 8 chars + `...`" pattern). Stable across rows so admins can recognize repeat values without exposing the local part. +33 unit tests covering canonical shape + defensive fallback branches (null / undefined / non-string / empty / no-@ / leading-@ / etc.) + stability invariant.

3. **`02-features/admin/customers/queries/getAdminCustomerDetail.ts`** — server query wrapping the RPC. `requireAdmin()` gate → `parseCustomerDetailId()` UUID validation → RPC + parallel `orders.first_seen_ip` lookup → defensive mapping (PostgREST bigint-as-string → number coercion; role/status enum coercion; missing-IP fail-soft). Returns null on any error (the page renders a 404). The masked-by-default view (`email_masked` + `first_seen_ip_masked`) is computed in the query so the component never sees raw PII by default.

4. **`02-features/admin/customers/queries/parseCustomerDetailId.ts`** — pure UUID v1-v8 regex validator. Trims whitespace, lowercases the canonical form, rejects SQLi-shaped garbage + CRLF + oversized strings. +14 unit tests.

5. **`02-features/admin/customers/queries/parseCustomerDetailTab.ts`** — pure helper for the `?tab=` URL param. 9-tab allowlist (overview / profile / orders / library / refunds / reviews / sessions / notes / activity). Invalid values fall back to `'overview'`. +10 unit tests.

6. **`02-features/admin/customers/actions/writeCustomerDetailViewAuditLog.ts`** — every page load writes one audit row with `action='admin.customer_detail_viewed'`, `target_kind='profiles'`, `target_id=<user_id>`, `metadata={tab, customer_user_id}`. PII-safe (no email / IP mask / read fields in metadata). Fail-soft on insert error.

7. **Components** — `CustomerDetailTabs.tsx` (URL-driven 9-tab nav, RSC, no client JS, `data-active` CSS attribute selectors for the active bottom-border), `CustomerDetailOverview.tsx` (Overview tab content: status badge + state banner + 4-card lifetime stats + risk badge with breakdown + masked contact dl + suspend/ban state hint), `ComingSoonTab.tsx` (typed panel for the 8 deferred tabs — lists what will land in each tab; deferred work is filed as STUB-115, NOT TODO comments).

8. **Route** — `app/admin/customers/[id]/page.tsx` (RSC + AdminShell + `requireAdmin()` belt-and-suspenders + `notFound()` on invalid UUID / nonexistent profile / RPC 0-rows) + `loading.tsx` (Skeleton mirror) + `not-found.tsx` (404 surface with breadcrumb back to `/admin/customers`). All 4 files hardlinked to `03-app/admin/customers/[id]/` via the existing dual-tree inode-shared directory pattern.

9. **Enums** — `AuditAction` + `AUDIT_ACTIONS` extended with 3 new values: `admin.customer_detail_viewed`, `admin.customer_detail_reveal_email`, `admin.customer_detail_reveal_ip` (the latter two are data-side seams for Slice 2's reveal interaction).

10. **Barrel** — `02-features/admin/customers/index.ts` re-exports `getAdminCustomerDetail` + `parseCustomerDetailId` + `parseCustomerDetailTab` + `CustomerDetailTabs` + `CustomerDetailOverview` + `ComingSoonTab` + `writeCustomerDetailViewAuditLog` + the 3 tab-parser constants/types.

**Files (17 new + 4 modified + 3 in 00-foundations):**
- New: `04-platform/migrations/0053_admin_customer_detail.sql`, `00-foundations/data/mask.ts` + `.test.ts`, `02-features/admin/customers/queries/getAdminCustomerDetail.ts` + `.test.ts`, `02-features/admin/customers/queries/parseCustomerDetailId.ts` + `.test.ts`, `02-features/admin/customers/queries/parseCustomerDetailTab.ts` + `.test.ts`, `02-features/admin/customers/actions/writeCustomerDetailViewAuditLog.ts`, `02-features/admin/customers/components/CustomerDetailTabs.tsx` + `.module.css`, `02-features/admin/customers/components/CustomerDetailOverview.tsx` + `.module.css`, `02-features/admin/customers/components/ComingSoonTab.tsx` + `.module.css`, `app/admin/customers/[id]/page.tsx` + `page.module.css`, `app/admin/customers/[id]/loading.tsx` + `loading.module.css`, `app/admin/customers/[id]/not-found.tsx` + `not-found.module.css`
- Modified: `00-foundations/data/enums.ts` (3 new AuditAction values), `02-features/admin/customers/index.ts` (barrel exports)

**Checks:** all 6 checks green + `pnpm test` includes +90 new tests (33 mask + 14 parseCustomerDetailId + 10 parseCustomerDetailTab + 33 getAdminCustomerDetail); pre-existing 3815/3815 + 1 todo unchanged (the parallel-runner `encryption.test.ts:150` flake + the 6 transient NotificationsSection failures from earlier ticks). **Build clean** (route is RSC, 0 client JS).

**Spec coverage:** Acceptance criteria met for Slice 1: auth-gated (criterion #1) ✅, 404 on invalid id / admin row / nonexistent (criterion #3) ✅, status badge reflects `profiles.status` (#5) ✅, risk score matches list-page CTE (#6 — same RPC, same laterals) ✅, masked-by-default email + IP display (criterion #7 — the static mask) ✅. Slices 2+ owe: customer/partner/affiliate 403 redirect (#2), all 9 tabs render non-empty content (#4), Reveal interaction with 30s auto-mask + per-reveal audit row (#7 second half), Suspend / Unsuspend / Ban actions (#8-#11), Manual refund / Revoke library / Unpublish review / Revoke session actions (#12-#15), GDPR data export + deletion request (#16-#17), Notes scoped to customer (#18), Activity tab reverse-chronological (#19), p95 budget (#20). The Reveal RPCs ship now (Slice 1) so Slice 2 is a UI-only change.

**Next pick:** P14.2 Slice 2 — Reveal interaction + Suspend / Unsuspend actions (≤ 1 tick); or P14.3 (Partners list, first `[ ]` in Phase 14 after P14.2 ships).

**Re-ASK:** No new ASKs from P14.2 Slice 1. The Reveal RPCs are shipped ahead of the UI slice because the data seam is reusable. The masked-by-default view satisfies the spec's "masked by default" criterion. The Reveal interaction ships in Slice 2 with the audit row already in place.
