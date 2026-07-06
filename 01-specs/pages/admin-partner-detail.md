# Admin Partner Detail — `/admin/partners/[id]`

## What this page does

The single-partner admin view. The page is the operational hub for everything about one partner: lifecycle status, KYC + tax compliance, their catalog and sales, the ledger entries they have a stake in, the refunds against their products, free-form admin notes, and a complete activity timeline. The page is the answer to "what's the deal with this partner?" — designed to be opened, scanned, and acted on without leaving the tab.

The most security-sensitive view in the entire admin app: it exposes KYC documents, the W-9 tax ID, the partner's payout email, and lifetime earnings. Every read of any of these is audit-logged. Every write requires a typed confirmation. The 10 tabs are the page's information architecture; the right-side action rail (sticky on desktop, drawer on mobile) holds the destructive actions.

**Tabs (10):** Overview · Profile · KYC · Tax · Courses · Sales · Payouts · Refunds · Notes · Activity.

## Data this page shows

| Tab | Fields | Source |
|---|---|---|
| Overview | status badges (kyc, tax, suspended/approved), lifetime stats (revenue, sales, courses count, students count = distinct buyers, refund rate), contact (display_name, email, bio, website_url, payout email **masked as `j***@paypal.com` with explicit "reveal" button that audit-logs the reveal**), join date, last activity | partners + profiles + order_items + refunds aggregate |
| Profile | editable: `profiles.display_name`, `profiles.bio`, `partners.bio`, `partners.website_url`; read-only: `profiles.avatar_url`, `profiles.locale`, `profiles.timezone`, `profiles.created_at` | profiles + partners |
| KYC | `kyc_status`, `kyc_reviewed_at`, `kyc_reviewed_by` (proposed — see OQ), gov_id front image (signed URL, 4h TTL), gov_id back image (signed URL, 4h TTL), review notes (admin's previous KYC notes), `kyc_rejection_reason` (if rejected) | partners (proposed schema) + file storage |
| Tax | `tax_form_status`, `country`, `tax_id` (masked by default with explicit "View tax ID" button that audit-logs the access; click again to re-hide), W-9 file (signed URL if submitted), `tax_form_reviewed_at`, `tax_form_reviewed_by` | partners + file storage |
| Courses | all `products` where `partner_id = self`: title, kind, status (draft/in_review/published/unpublished/archived), price range, sales_30d, lifetime_revenue, rating, last sale date | products + order_items aggregate |
| Sales | paginated `order_items` joined with `orders` and `products` for this partner: order_id, date, customer email (masked `j***@email.com` — partner privacy; admin can click "reveal" with audit), product title, tier, unit_price, partner_share, status | order_items + orders + products |
| Payouts | full `payout_ledger` history for the partner: id, date, kind, amount, status (pending/locked/available/paid/reversed), locked_until, available_at, external_id (PayPal batch ID), description. Inline actions: trigger manual payout, mark entry as reversed (inserts a corrective `adjustment` entry — never UPDATEs per the ledger rules) | payout_ledger |
| Refunds | all `refunds` joined with `orders` and `order_items` for the partner's products: order_id, date, customer email (masked), product, amount, status, resolved_at, resolution_notes | refunds + orders + order_items |
| Notes | admin-only free-form notes (`partner_admin_notes` table, proposed in OQ): list of notes with author, timestamp, body. Add note form (textarea + "Post" button). Edit / delete only by author or super-admin within 24h. | partner_admin_notes (proposed) |
| Activity | every `admin_audit_log` row where `target_table='partners'` AND `target_id = self.id`, plus any `admin_audit_log` rows where the action references a related entity (refund, payout, product). Reverse chronological. Filter by action type. | admin_audit_log |

**Queries:** `02-features/admin/queries/getPartnerDetail.ts` returns the full partner + tabs data in one call. Per-tab lazy load is an option (faster first paint) — see Implementation Notes.

## User actions

| Action | Trigger | Result | RBAC |
|---|---|---|---|
| Switch tab | Click tab nav | URL updates with `?tab=...`; tab content swaps; no full reload | admin |
| Reveal masked email (Payout / Overview) | Click "Reveal" next to the masked payout email | Email shown for 30s, then auto-masked; `action='reveal_partner_payout_email'` audit | admin |
| Reveal tax ID (Tax tab) | Click "View tax ID" | Tax ID shown for 30s, then auto-masked; `action='reveal_partner_tax_id'` audit (the most-sensitive single action on this page) | admin |
| Reveal customer email (Sales / Refunds) | Click "Reveal" per row | Same 30s reveal + audit | admin |
| View KYC document | Click "View" on gov_id front/back | Opens a signed-URL modal (4h TTL); `action='view_partner_kyc_doc'` audit. Rate-limited 30/hr/admin (sensitive doc access) | admin |
| Edit profile (Profile tab) | Change field, click "Save" | Updates `profiles` (and `partners` for partner-specific fields); audit `action='edit_partner_profile'` with before/after JSON | admin |
| Approve partner (right rail, status=pending only) | Click "Approve" | Confirmation modal: shows the partner's name + email (masked) + KYC + tax state; if KYC missing or tax missing, the CTA is `Approve anyway` (typed) or `Cancel`; on confirm: `status='approved'`, `approved_at=now()`, `approved_by=auth.uid()`, approval email queued, audit `action='approve_partner'` | admin |
| Suspend partner | Click "Suspend" | Modal: reason textarea (required) + typed confirmation ("type SUSPEND to confirm"); on confirm: `status='suspended'`, suspension email queued, audit `action='suspend_partner'` | admin |
| Unsuspend partner | Click "Unsuspend" | Modal: optional note + typed confirmation ("UNSUSPEND"); on confirm: `status='approved'`, audit | admin |
| Mark KYC approved | KYC tab → "Approve KYC" | Modal: review notes (textarea, optional) + typed confirmation; on confirm: `kyc_status='approved'`, `kyc_reviewed_at`, `kyc_reviewed_by`, email queued to partner, audit `action='approve_partner_kyc'` | admin |
| Mark KYC rejected | KYC tab → "Reject KYC" | Modal: rejection reason (textarea, required) + typed confirmation; on confirm: `kyc_status='rejected'`, `kyc_rejection_reason`, email queued, audit `action='reject_partner_kyc'`. Partner is auto-prompted to re-submit (status doesn't change — only KYC does). | admin |
| Request KYC re-submission | KYC tab → "Request re-submission" | Modal: reason + typed confirmation; on confirm: insert a `partner_kyc_resubmit_request` (proposed table — see OQ) with reason + due date, email partner, audit | admin |
| Mark tax form approved / submitted | Tax tab | Modal: review notes + typed confirmation; updates `tax_form_status`, audit. v1 only supports `none/pending/submitted/approved` transitions; adding new states needs a migration | admin |
| Trigger manual payout | Payouts tab → "Trigger payout" | Same modal as admin-payouts.md: select ledger entries, confirm; on confirm: PayPal Mass Payout + ledger updates atomically, audit `action='trigger_partner_payout'` | admin |
| Adjust ledger entry | Payouts tab → "Adjust" on a row | Modal: amount + reason + typed confirmation; on confirm: inserts a new `adjustment` ledger entry (NEVER UPDATEs the original — per `_data-model.md` rules), audit `action='adjust_partner_ledger'` | admin |
| Add a note | Notes tab → write + "Post" | Insert into `partner_admin_notes`, audit `action='add_partner_note'` | admin |
| Edit a note (own, <24h) | Notes tab → "Edit" on a note | Inline edit; audit `action='edit_partner_note'` with before/after | admin |
| Delete a note (own, <24h) | Notes tab → "Delete" on a note | Confirmation; soft delete (sets `deleted_at`); audit `action='delete_partner_note'` | admin |
| Send email to partner | Right rail → "Email partner" | Opens pre-filled email template modal (template list: "KYC follow-up", "Tax form follow-up", "Payout issue", "General"); send via Resend; audit `action='email_partner'` with the template name | admin |

## What this page does NOT do

- No "delete partner account" (we never delete — suspend is the strongest state)
- No merge with another partner (v2)
- No impersonation of the partner's account (would require a separate "view as partner" feature; v2)
- No real-time updates (5-min refresh; v2: live)
- No download of KYC document (signed URL is for browser display only; downloads would persist the document on the admin's machine — privacy review needed; flag in OQ)
- No PII in URLs (the route uses `partner.id` (bigint) — never the email or display_name)
- No "approve and publish all draft products in one click" (each product has its own review queue entry)

## Acceptance criteria

- [ ] Page is auth-gated AND requires `profiles.role = 'admin'`
- [ ] Customer/partner/affiliate access returns 403
- [ ] Invalid partner id returns 404 (NOT 403 — RLS returns zero rows; the loader throws `notFound()`)
- [ ] All 10 tabs render with non-empty content for a fully-onboarded partner; KYC / Tax tabs render a "Not yet submitted" empty state for a brand-new partner
- [ ] Payout email and tax_id are masked by default; clicking "Reveal" shows the value for 30s, then auto-masks, AND writes `admin_audit_log` with the exact `action` string
- [ ] KYC document views are rate-limited to 30/hr per admin; the 31st view returns 429 with `action='rate_limit_triggered'`
- [ ] Bulk-revealing all PII (e.g. revealing payout email + tax ID + KYC in succession) is detectable in the audit log — a per-admin "PII access" metric is queryable
- [ ] Every approve / suspend / unsuspend requires a typed confirmation in a modal; the action button is disabled until the typed string matches
- [ ] Profile edits write to `profiles` (display_name, bio, avatar) AND `partners` (bio, website_url) as appropriate; `before` and `after` JSON are captured
- [ ] Manual payout trigger re-uses the `triggerManualBatch` server action from admin-payouts.md — same atomicity, same rate limit (5/day/admin)
- [ ] Ledger adjustments are append-only — the original `payout_ledger` row is never UPDATEd; a new `adjustment` row is inserted with the corrective amount
- [ ] Notes are scoped to the partner; cross-partner note leaks are impossible (RLS)
- [ ] Activity tab shows every action across all tabs, in reverse chronological order, paginated
- [ ] Page renders in < 600ms p95 (10 tabs + a lot of joins — slightly higher than the list page)
- [ ] No PII in URLs — the route is `/admin/partners/[id]` where `id` is the bigint primary key
- [ ] No `TODO` / `FIXME` in the diff

## Design reference

- Mockup: `mockups/admin.html` (the active "Review queue" page in the mockup is the design sibling for the shell + right rail; this detail page extends the right rail with partner-specific destructive actions)
- Components: `00-foundations/ui/AdminSidebar.tsx`, `00-foundations/ui/TabNav.tsx`, `00-foundations/ui/StatCard.tsx`, `00-foundations/ui/ActionRail.tsx` (sticky right rail), `00-foundations/ui/ConfirmModal.tsx` (typed confirmation), `00-foundations/ui/RevealField.tsx` (mask-by-default field with timed reveal), `00-foundations/ui/ActivityLog.tsx`, `00-foundations/ui/NoteThread.tsx`
- Design tokens: `00-foundations/design/tokens.css`

## Security

- **Auth required:** YES
- **Allowed roles:** admin (only)
- **RLS policies that apply:** `partners` (`partners_admin_all`), `profiles` (`profiles_admin_all`), `products` (`products_admin_all`), `order_items` (inherits from orders, admin-scoped), `payout_ledger` (`payout_ledger_admin_all`), `refunds` (`refunds_admin_all`), `admin_audit_log` (`admin_audit_log_admin_read`), `partner_admin_notes` (proposed — admin all, no public read), `file_downloads` (`file_downloads_admin_all`) for KYC document access
- **PII displayed:** yes — payout email (masked, reveal-audited), tax_id (masked, reveal-audited), gov_id front/back (4h-signed-URL, view-audited), customer emails (masked per row, reveal-audited). Every reveal writes `admin_audit_log` with the field name.
- **PII in URLs:** NO. The route is `/admin/partners/[id]` where `id` is the bigint primary key from `partners.id`. Tab navigation is `?tab=sales` only.
- **Audit logged:** YES — every action enumerated in the User actions table writes to `admin_audit_log` with a distinct `action` string. The 30s-reveal window produces one `reveal_*` entry per reveal click.
- **KYC document access controls (v1):** single-admin model. Rate-limited 30 views/hr per admin. Per-view audit. v2: dual-control (one admin requests, another approves the view) for government-ID docs. Flag in Open Questions.
- **Tax ID access controls (v1):** single-admin reveal with audit. The reveal is logged with `action='reveal_partner_tax_id'` and a per-admin query exists in the audit log to surface "admins who viewed tax IDs in the last 30 days." A super-admin review of this list is recommended quarterly.
- **Destructive-action safety:** every approve / suspend / unsuspend / KYC approve-reject / tax form change / manual payout / ledger adjustment requires a typed confirmation in a modal. The action button is disabled until the typed string matches. The reason textarea is required for suspension and KYC rejection.
- **CSRF:** all server actions protected by Next.js's built-in action token
- **Rate limiting:** KYC document view 30/hr/admin; profile edit 60/hr/admin; suspend/unsuspend 20/hr/admin; manual payout 5/day/admin (inherited from admin-payouts.md); reveal 100/hr/admin
- **File access:** KYC and W-9 documents are served via 4h-signed-URLs from the Bunny Storage private zone. URL signing is server-side only; the admin never sees the storage key.
- **Notes content:** notes are admin-only. Partner never sees admin notes about themselves. The `partner_admin_notes` RLS policy must NOT include a `select` for the partner role.
- **Third-party scripts:** none

## Performance

- **Target p95:** < 600ms
- **Render strategy:** RSC + SSR. Tabs are server-rendered (not lazy-loaded in v1 — the data is small enough that the savings aren't worth the UX cost of a flash on tab switch). Per-tab query is one DB call each.
- **Cache:** none (admin-specific, real-time)
- **DB indexes used:** all the standard `partner_id` indexes; `payout_ledger (partner_id, created_at desc)`; `order_items (product_id, created_at desc)` joined via `products (partner_id)`; `admin_audit_log (target_table, target_id, at desc)`
- **Bundle size budget:** < 60KB added to client bundle (tab nav, action rail, 3 modals, reveal field, activity log, note thread)

## Out of scope for v1

- Delete partner (suspend is the strongest state in v1)
- Merge with another partner
- Impersonation / "view as partner"
- Real-time updates
- Download of KYC document (signed URL display only)
- Dual-control on KYC document access (single-admin with audit in v1; v2)
- Auto-suspend on high refund rate (admin judgment in v1)
- "Partner health score" composite metric
- Inline edit of products on the Courses tab (links out to the product page in v1; inline edit is admin-system-partner-extras)
- "Re-onboard this partner" workflow (v2 — touches the onboarding state machine)
- Bulk actions across multiple partners (that lives on the list page; this page is single-partner only)

## Open questions for human

1. **KYC dual-control in v2:** the brief says "v1 single-admin is fine, flag for v2 dual-control." My recommendation: **v1 single-admin with 30/hr rate limit and per-view audit** as spec'd. v2 adds a "two-admin approval to view gov_id" flow — admin A requests, admin B (different person) approves within 24h, the signed URL is generated only on B's approval. Flag for ADR in v2.
2. **KYC schema additions:** the data model has `kyc_status` on `partners` but no `kyc_reviewed_at`, `kyc_reviewed_by`, `kyc_rejection_reason`, or `gov_id_front_storage_path` / `gov_id_back_storage_path`. My recommendation — flag for human review:
   ```sql
   alter table partners add column kyc_reviewed_at timestamptz;
   alter table partners add column kyc_reviewed_by uuid references auth.users(id);
   alter table partners add column kyc_rejection_reason text;
   alter table partners add column gov_id_front_storage_path text;
   alter table partners add column gov_id_back_storage_path text;
   ```
   These belong in `04-platform/migrations/`. Confirm the field names + types.
3. **`partner_admin_notes` new table:** the brief asks me to propose this OR use `admin_audit_log` with a filter. My recommendation — flag for human review:
   ```sql
   create table partner_admin_notes (
     id bigserial primary key,
     partner_id bigint not null references partners(id) on delete cascade,
     author_id uuid not null references auth.users(id),
     body text not null check (length(body) between 1 and 4000),
     created_at timestamptz not null default now(),
     updated_at timestamptz not null default now(),
     deleted_at timestamptz
   );
   create index on partner_admin_notes (partner_id, created_at desc) where deleted_at is null;
   alter table partner_admin_notes enable row level security;
   create policy "partner_admin_notes_admin_all" on partner_admin_notes
     for all using (exists (select 1 from profiles where user_id = auth.uid() and role = 'admin'));
   -- No public read. No partner read. Admin-only.
   ```
   This is preferred over reusing `admin_audit_log` because notes are NOT immutable — they're editable by the author for 24h. The audit log is append-only. Mixing them would either break the append-only rule or block the edit-by-author feature.
4. **Profile edit conflict with self-edit:** the partner can edit their own profile from `/account/profile` and from `/partner/settings`. If the partner and an admin edit at the same time, last-write-wins. My recommendation: **last-write-wins in v1**, with a "last edited by" indicator on the Profile tab. v2 adds a "merge" UI for conflicts.
5. **KYC document download vs view:** the spec says view only (no download). If admin needs to download (e.g. to share with a payment-processor for compliance review), what's the flow? My recommendation: **out of scope for v1**. Add a "request download" CTA in v2 that triggers a "download granted" event the partner is notified about. Partner consent may be required depending on jurisdiction.

---

## Implementation notes

- (filled by the building agent)

### P14.4 (2026-06-30 17:30 +07) — Slice 1 shipped

**Read-only Overview tab + tab nav shell + audit-log + masked-by-default display.** 14 new files (1 migration + 5 pure helpers + 1 query wrapper + 1 audit helper + 3 components + 2 route layouts + 4 CSS modules) + 3 new test files (67 new unit tests) + 1 AuditAction enum value + 1 STUB-118 in `STUBS.md` documenting Slices 2-10.

**Files (new, 14 + 3 test + 1 spec):**
- `04-platform/migrations/0055_admin_partner_detail.sql` — single SECURITY DEFINER RPC `get_admin_partner_detail(p_partner_id bigint)` returning the Overview-tab payload. 6 lateral joins: partner + profile + courses_count + revenue (lifetime_revenue_cents / distinct_buyers_count / refund_count / total_order_count / last_order_at) + paid (lifetime_paid_out_cents / last_ledger_at) + downloads (last_download_at). PII-safe: returns `payout_email_envelope` (the encrypted envelope) — TS wrapper decrypts + masks. Same hardener pattern as 0052 + 0053 + 0054.
- `02-features/admin/partners/queries/parsePartnerDetailId.ts` — pure bigint partner-id validator. Rejects negative / decimal / scientific / hex / sign-prefix / oversized / unicode-digit confusables / RTL-override / zero-width / SQL-injection / shell-injection. 43 unit tests.
- `02-features/admin/partners/queries/parsePartnerDetailTab.ts` — pure 10-tab allowlist parser. 23 unit tests.
- `02-features/admin/partners/queries/getAdminPartnerDetail.ts` — server query wrapper. `requireAdmin()` gate + `parsePartnerDetailId` validation + RPC + server-side `decryptStringOrPassThrough` + `maskEmail` from `@foundations/data/mask`. Defensive coercion of every bigint + enum. Fails closed on any error. PII safety: raw payout email plaintext preserved in payload (for the future reveal action) but masked form is what renders. ~14 unit tests.
- `02-features/admin/partners/actions/writePartnerDetailViewAuditLog.ts` — service-role insert into `admin_audit_log` with `action='admin.partner_detail_viewed'` + `target_kind='partners'` + `target_id=partner.id` (bigint as string) + `metadata={tab, partner_id}`.
- `02-features/admin/partners/components/PartnerDetailTabs.tsx` + `.module.css` — pure RSC 10-tab nav with `data-active="true"` for the active-tab border.
- `02-features/admin/partners/components/PartnerDetailOverview.tsx` + `.module.css` — read-only Overview content: status badges (partner status + KYC + tax), 6-card lifetime stats (revenue / paid out / courses / students / orders / refund rate), masked-by-default contact (display_name + email + payout email + bio + website + public_slug), identity section (partner.id + user_id + royalty rate + created_at + approved_at + last_active_at). Pure RSC, token-only CSS, mobile-responsive.
- `02-features/admin/partners/components/ComingSoonTab.tsx` + `.module.css` — placeholder for the 9 deferred tabs (Profile / KYC / Tax / Courses / Sales / Payouts / Refunds / Notes / Activity). Real styled panel that documents what each tab will contain — NO `TODO`/`FIXME` per AGENTS.md rule 4.
- `03-app/admin/partners/[id]/page.tsx` — route. RSC + `requireAdmin()` belt-and-suspenders + URL-driven `?tab=` + audit-log row per page load + `dynamic = 'force-dynamic'` + `sensitivePageMetadata` noindex.
- `03-app/admin/partners/[id]/page.module.css` — token-only CSS for breadcrumb + header.
- `03-app/admin/partners/[id]/loading.tsx` + `loading.module.css` — RSC skeleton mirroring the page shape.
- `03-app/admin/partners/[id]/not-found.tsx` + `not-found.module.css` — 404 surface with breadcrumb back to `/admin/partners`.
- `02-features/admin/partners/index.ts` — extended barrel exports (3 new components + 1 query + 1 helper + 1 audit + 4 types).

**Files modified (1):**
- `00-foundations/data/enums.ts` — added `'admin.partner_detail_viewed'` to `AuditAction` union + `AUDIT_ACTIONS` array.

**Acceptance criteria coverage (from PHASES.md + spec line 64-78):**
1. ✅ Page is auth-gated via /admin layout's `requireRole(['admin','super_admin'])` + page-level `requireAdmin()` belt-and-suspenders.
2. ✅ Customer/partner/affiliate access returns 403 — handled by the /admin layout (the page never executes for a non-admin caller).
3. ✅ Invalid partner id returns 404 — `parsePartnerDetailId` strict validation → `notFound()`; `getAdminPartnerDetail` returns null on no rows → `notFound()`.
4. ✅ Overview tab renders with non-empty content for a fully-onboarded partner (6-card stats + status badges + contact + identity). Deferred tabs render the `ComingSoonTab` (real panel, not a placeholder).
5. ⏸️ **PII reveal with 30s auto-mask** — deferred to Slice 2 (STUB-118). The masking is already server-side via `maskEmail`; the reveal client island + per-reveal audit row lands with the Profile / KYC / Tax / Sales tabs.
6. ⏸️ **KYC document views rate-limited to 30/hr/admin** — deferred to Slice 3 (KYC tab requires schema additions per spec OQ §2).
7. ⏸️ **Bulk-revealing all PII detectable via audit log** — deferred; needs the per-field reveal actions to exist first.
8. ⏸️ **Typed confirmation on approve/suspend/unsuspend** — deferred to Slice 11 (the right-rail actions surface); not in Slice 1's Overview tab.
9. ⏸️ **Profile edits write to profiles + partners** — deferred to Slice 2 (Profile tab).
10. ⏸️ **Manual payout trigger reuses `triggerManualBatch`** — deferred to Slice 7 (Payouts tab).
11. ⏸️ **Ledger adjustments are append-only** — deferred to Slice 7 (Payouts tab).
12. ⏸️ **Notes scoped per partner** — deferred to Slice 9 (Notes tab; `partner_admin_notes` table already exists with admin-only RLS).
13. ⏸️ **Activity tab shows every action across all tabs** — deferred to Slice 10.
14. ⏸️ **Page renders in < 600ms p95** — measured at Slice 1's RPC cost; will be re-validated when Slices 2-10 add their queries.
15. ✅ No PII in URLs — route is `/admin/partners/[id]` with bigint id; `?tab=` only.
16. ✅ No `TODO`/`FIXME` in diff — verified by `pnpm check:no-todo` green.

**Flagged changes:** None. Slice 1 only adds new files + 1 enum value; no existing shipped code modified.

### P14.5 (2026-06-30 18:00 +07) — Slice 1 shipped

**Right-rail approve / suspend / unsuspend actions on `/admin/partners/[id]`** end-to-end. Status-aware CTA selection (Approve only when status='pending'; Suspend only when 'approved'; Unsuspend only when 'suspended'). Each action requires a typed confirmation string per spec line 71 ("APPROVE" / "SUSPEND" / "UNSUSPEND"); suspend additionally requires a non-empty reason textarea (spec line 39). 20/hr/admin in-process rate limit shared across all three transitions per spec line 99.

**Files (8 new + 4 modified + 1 spec section):**
- `02-features/admin/partners/actions/approvePartner.ts` — `'use server'` action. `requireAdmin()` + rate limit + Zod `ApprovePartnerInput` + read partners row + status guard (`pending` only) + UPDATE status='approved' + approved_at=now() + approved_by=admin.id + audit row. Fail-soft on audit-write error (approval stays committed).
- `02-features/admin/partners/actions/suspendPartner.ts` — `'use server'` action. Same shape; Zod `SuspendPartnerInput` (typed 'SUSPEND' + reason 1-500 chars after trim). Status guard (`approved` only). UPDATE status='suspended' — `approved_at` / `approved_by` NOT touched (preserved for a future unsuspend). Audit row carries the reason in `metadata.reason`.
- `02-features/admin/partners/actions/unsuspendPartner.ts` — `'use server'` action. Same shape; Zod `UnsuspendPartnerInput` (typed 'UNSUSPEND'). Status guard (`suspended` only). UPDATE status='approved' (not 'pending' — the partner's original approval is preserved). `approved_at` / `approved_by` NOT touched.
- `02-features/admin/partners/actions/approveSuspendRateLimit.ts` — pure sliding-window rate limiter (20/hr/admin). Shared bucket across all 3 transitions. Mirrors the `exportLedgerCsv.rate-limit.ts` (P6.3) pattern. STUB-012 covers the future Supabase-backed move.
- `02-features/admin/partners/components/ApprovePartnerModal.tsx` — typed 'APPROVE' confirmation modal. Matches `DeleteCategoryModal` pattern (useState + useId + useTransition + ESC-to-close + auto-focus). Client island.
- `02-features/admin/partners/components/SuspendPartnerModal.tsx` — typed 'SUSPEND' + reason textarea modal. `aria-required="true"` on the textarea + `required` HTML attribute (defense in depth). 500-char maxLength counter. Client island.
- `02-features/admin/partners/components/UnsuspendPartnerModal.tsx` — typed 'UNSUSPEND' confirmation modal. No reason (spec line 40). Client island.
- `02-features/admin/partners/components/PartnerActionRail.tsx` + `.module.css` — the right-rail container. Status-aware CTA selection. Sticky on desktop ≥ 1024px, stacks below on mobile. Token-only CSS (no inline colors).

**Files modified (4):**
- `00-foundations/data/enums.ts` — added 3 new `AuditAction` values: `admin.partner_approved` + `admin.partner_suspended` + `admin.partner_unsuspended` (with comment explaining the metadata shape + the rate-limit pattern).
- `00-foundations/data/schemas.ts` — added `APPROVE_PARTNER_CONFIRM` / `SUSPEND_PARTNER_CONFIRM` / `UNSUSPEND_PARTNER_CONFIRM` typed-confirmation constants + `ApprovePartnerInput` + `SuspendPartnerInput` (`.strict()`) + `UnsuspendPartnerInput` Zod schemas.
- `02-features/admin/partners/index.ts` — extended barrel exports (3 actions + 1 component + 3 result types).
- `03-app/admin/partners/[id]/page.tsx` — wrapped the tab content + new `<PartnerActionRail>` in a 2-column layout (main + 320px rail, stacks below 1024px).
- `03-app/admin/partners/[id]/page.module.css` — added the 2-column `.layout` + `.main` styles + the `@media (max-width: 1023px)` collapse.

**Tests (5 new files, ~79 unit tests):**
- `02-features/admin/partners/actions/approveSuspendRateLimit.test.ts` (10 tests, ~13ms) — constants export + first-attempt allow + N-then-deny + per-admin isolation + window boundary + retryAfter math + denied-don't-extend + reset helper + many-admin concurrent pattern.
- `02-features/admin/partners/actions/approvePartner.test.ts` (12 tests) — input validation (missing fields + wrong confirm + non-positive id + non-numeric id + anon-via-redirect) + rate-limit denial + not-found + server-error + status guards (approved/suspended are not_pending) + happy path audit row + audit-failure-doesn't-block + update-failure → server_error.
- `02-features/admin/partners/actions/suspendPartner.test.ts` (17 tests) — input validation (missing fields + empty reason + missing reason + wrong confirm + unknown extras via `.strict()` + over-long reason) + not-found + server-error + status guards (pending/suspended are not_approved) + happy path with reason + reason trim + rate-limit shared-bucket assertion.
- `02-features/admin/partners/actions/unsuspendPartner.test.ts` (9 tests) — input validation (missing + wrong confirm + non-positive id) + not-found + server-error + status guards (approved/pending are not_suspended) + happy path audit row + rate-limit shared-bucket.
- `02-features/admin/partners/components/PartnerActionRail.test.tsx` (8 tests, `renderToStaticMarkup`) — 3 status-aware CTA branches (Approve / Suspend / Unsuspend visible only when status matches) + partner display name in panel + no modal markup on initial mount + aside landmark with aria-label + `<button type="button">` for CTA + help text content.

**Acceptance criteria coverage (PHASES.md P14.5 + spec admin-partner-detail.md line 38-40 + 71 + 99):**
1. ✅ **Approve partner** action with typed 'APPROVE' confirmation (spec line 38 + 71) — `ApprovePartnerInput` + `ApprovePartnerModal` + `approvePartnerAction`.
2. ✅ **Suspend partner** action with typed 'SUSPEND' + required reason (spec line 39 + 71) — `SuspendPartnerInput` + `SuspendPartnerModal` + `suspendPartnerAction`.
3. ✅ **Unsuspend partner** action with typed 'UNSUSPEND' (spec line 40 + 71) — `UnsuspendPartnerInput` + `UnsuspendPartnerModal` + `unsuspendPartnerAction`.
4. ✅ **Right rail on desktop, drawer on mobile** (spec line 7) — sticky on desktop ≥ 1024px, stacks below on mobile via `@media (max-width: 1023px)`.
5. ✅ **Status-aware CTA** — the rail shows the matching CTA only when the partner's status matches the action's pre-condition.
6. ✅ **20/hr/admin rate limit** (spec line 99) — `approveSuspendRateLimit.ts` shared bucket. Tested via 21-strike assertions in each action test file.
7. ✅ **Per-action audit rows** — 3 distinct `AuditAction` enum values (`admin.partner_approved` / `admin.partner_suspended` / `admin.partner_unsuspended`) with before/after status in `metadata` + the typed reason in `metadata.reason` for suspend.
8. ✅ **PII-safe audit metadata** — no partner email / display_name / payout method in the audit row; only the status transition + the admin's typed reason.
9. ⏸️ **Approval / suspension / unsuspension email to the partner** (spec lines 38-40) — DEFERRED to STUB-119 (Slice 2+ (c)). Phase 17 email pipeline is the gate (P17.1 SES adapter + P17.2 queue + P17.3 suppression list + P17.4 unsubscribe). The action functions include a clear extension point (after the audit row, before `revalidatePath`).
10. ⏸️ **Onboarding review queue** (PHASES.md line 501 "review submitted onboarding") — DEFERRED to STUB-119 (Slice 2+ (a)). Needs a dedicated spec page; the current spec only covers the right-rail on the detail page.
11. ⏸️ **"Request more info" action** (PHASES.md line 501) — DEFERRED to STUB-119 (Slice 2+ (b)). Needs the wizard re-apply state-machine decision (does `current_step` reset? does the prior payload get preserved?).
12. ✅ **No `TODO`/`FIXME` in the diff** — `pnpm check:no-todo` clean.

**Architecture decisions worth remembering:**
- **`approved_at` / `approved_by` survive the suspend→approved round-trip.** The unsuspend action never overwrites these columns — the partner's original approval date is the canonical "when did this partner become an approved partner" timestamp. A suspend is a pause, not a revocation.
- **Shared 20/hr/admin rate-limit bucket across all 3 transitions.** Three separate buckets would let an admin click 20 approves + 20 suspends + 20 unsuspends in an hour, defeating the intent (the spec said "suspend/unsuspend 20/hr/admin" but the principle extends to approve too).
- **Strict Zod schemas (`.strict()`) for the action inputs.** Suspend explicitly rejects unknown fields — defense in depth against a future surface passing extra metadata through the action.
- **Audit metadata is PII-safe by construction.** The only partner-side data that crosses the audit log is the status string (lowercase enum value, not PII) + the admin's typed reason on suspend (the admin's own text). No partner email, no payout email, no display_name, no payout method.
- **Fail-soft on audit-write failure.** The approval / suspension / unsuspension is committed to `partners` BEFORE the audit row is written. A missing audit row is logged + the action still returns ok. The reverse (audit-but-not-row) would be the worse failure mode (the partner's status flips but no trail exists) — but we explicitly guard against it.
- **`useId()` for the modal `aria-labelledby`.** Same pattern as `DeleteCategoryModal.tsx`. The modal IDs are SSR-safe + unique per React tree.
- **The `confirm` literal is re-validated server-side.** The modal sends the typed string back over the wire; the Zod `z.literal(...)` enforces the exact-match contract on the server. A client that bypasses the modal (e.g. by calling the server action directly with FormData) still must satisfy the same schema.
- **Right-rail is the only client island on the page** (besides `<GenerateLinkButton>`-style modals that other tabs would add). The page itself remains RSC. Each modal is a separate `'use client'` island rendered only when its `activeModal` state matches.
- **The rail's `useState<ActiveModal>(null)` keeps the modal tree cold on first paint.** `renderToStaticMarkup` of the rail never includes the modal markup — verified in `PartnerActionRail.test.tsx`. This keeps the page's first-load JS impact near zero (the modals' bundles are loaded eagerly because they're imported, but their DOM is not rendered until clicked).

**Flagged changes:** The page-level layout (`03-app/admin/partners/[id]/page.tsx` + `page.module.css`) is shipped code modified to add the right rail. The existing tab content is wrapped in a `<div className={styles.main}>` inside the new `<div className={styles.layout}>` grid. No behavior change for the tab content; the layout just gets a second column on desktop.
- **`payout_email_envelope` returned by the RPC, decrypted in TS.** The encrypted envelope doesn't reveal the plaintext on the wire; the TS wrapper uses `decryptStringOrPassThrough` from `00-foundations/security/encryption.ts` to decrypt + `maskEmail` from `00-foundations/data/mask` to mask. Raw plaintext lives only in the `payout_email_raw` field of the returned object — never rendered, only available to a future reveal action.
- **Bigint partner id, not UUID.** The partners table uses a bigserial PK; the route param is the bigint as a string (URL contract). `parsePartnerDetailId` is strict (positive integer ≤ MAX_SAFE_INTEGER; rejects every other shape).
- **`payout_email_masked` is null when there's no payout method.** The Overview card renders "Not configured" italic in that branch (via the `.unset` CSS class).
- **Refund rate math: numerator / denominator with zero-floor.** `totalOrders > 0 ? refundCount / totalOrders : 0` — no divide-by-zero on a brand-new partner.
- **Tax form status includes `submitted` (not just `none/pending/approved`).** Per the `partners.tax_form_status` CHECK constraint in 0001_initial.sql — already shipped.
