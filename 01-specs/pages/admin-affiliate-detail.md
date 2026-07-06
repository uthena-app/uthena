# Admin Affiliate Detail — `/admin/affiliates/[id]`

## What this page does

The single-affiliate admin view. The page is the operational hub for everything about one affiliate: lifecycle status, links, click + conversion analytics, commission + payout history, the mini-shop they're curating, free-form admin notes, and a complete activity timeline. It's the answer to "what's this affiliate doing?" — and the action surface for handle squatting resolution, suspicious-click investigation, and mini-shop curation conflicts.

The most distinctive capability on this page vs. the partner detail: the Links and Clicks tabs are deep analytics surfaces (the affiliate's job is clicks + conversions, so the admin needs the data to evaluate them). The Mini-shop tab also matters more here than anywhere else — the affiliate-curated shop is the visible face of the affiliate program, and admin's "force feature" power is the override for cases where the affiliate's curation conflicts with platform goals.

**Tabs (9):** Overview · Profile · Links · Clicks · Commissions · Payouts · Mini-shop · Notes · Activity.

## Data this page shows

| Tab | Fields | Source |
|---|---|---|
| Overview | status badge, lifetime earned, available balance, pending balance, conversion rate (lifetime), EPC (lifetime earnings / lifetime clicks), handle, public mini-shop URL (`uthena.com/[handle]`), payout email (masked as `j***@paypal.com` with explicit "Reveal" button that audit-logs), join date, last activity, last payout date + amount | affiliates + profiles + affiliate_commissions + affiliate_clicks + affiliate_payouts aggregates |
| Profile | editable: `affiliates.handle` (admin can change it; flag in OQ — see "force handle change"), `affiliates.bio`, `profiles.display_name`, `profiles.avatar_url`; read-only: `profiles.locale`, `profiles.timezone`, `profiles.email`, payout email (masked) | affiliates + profiles |
| Links | all `affiliate_links` for the affiliate: code, target_path, UTM parameters, clicks_count, conversions_count, conversion_rate, status (active/disabled — see OQ on adding `active` to schema), created_at, last_clicked_at (proposed — see OQ), admin actions per row | affiliate_links |
| Clicks | time-series chart of `affiliate_clicks` per day for the last 30 days (stacked by link if multiple), plus a recent-clicks table: at, link code, ip_hash (first 8 chars + `...`), ua_hash (first 8 chars + `...`), referer | affiliate_clicks |
| Commissions | paginated `affiliate_commissions`: order_id, date, product title, commission_cents, status (pending/locked/available/paid/reversed), locked_until, available_at | affiliate_commissions + orders + products |
| Payouts | all `affiliate_payouts` for the affiliate: period_start/end, amount_cents, commission_count, paypal_batch_id, status (pending/sent/paid/failed), created_at | affiliate_payouts |
| Mini-shop | list of products the affiliate has curated for their shop, with `is_featured` badge; admin can feature/unfeature any product (force override on affiliate's choice — see OQ) | `affiliate_curated_products` (proposed) + products |
| Notes | admin-only free-form notes (proposed `affiliate_admin_notes` table — same shape as `partner_admin_notes`); add / edit-own-within-24h / soft-delete | affiliate_admin_notes (proposed) |
| Activity | every `admin_audit_log` row where `target_table='affiliates'` AND `target_id = self.id`, plus related rows (links, clicks, commissions, payouts). Reverse chronological, filter by action type. | admin_audit_log |

**Queries:** `02-features/admin/queries/getAffiliateDetail.ts` returns the full affiliate + tabs data. Per-tab lazy load optional.

## User actions

| Action | Trigger | Result | RBAC |
|---|---|---|---|
| Switch tab | Click tab nav | URL updates with `?tab=...`; tab content swaps | admin |
| Reveal payout email (Overview) | Click "Reveal" | Email shown for 30s, then auto-masked; `action='reveal_affiliate_payout_email'` audit | admin |
| Edit profile (Profile tab) | Change field, click "Save" | Updates `affiliates` (handle, bio) + `profiles` (display_name, avatar); audit `action='edit_affiliate_profile'` with before/after JSON | admin |
| Force handle change (Profile tab) | Click "Change handle" button | Modal: new handle (with live availability check — same as affiliate-onboarding.md's `checkHandleAvailability`), reason (textarea, required, 50+ chars explaining squatting/abuse), typed confirmation ("type CHANGE HANDLE to confirm"). On confirm: update `affiliates.handle`, release the old handle into a 30-day cool-off reservation so the previous owner can't re-grab it, send email to affiliate, audit `action='force_change_affiliate_handle'`. RARE action — should be logged with a "rare action" tag for review. | admin (super-admin only — see OQ) |
| Approve affiliate (right rail, status=pending only) | Click "Approve" | Modal: shows affiliate's handle + email (masked) + their promo_methods; on confirm: `status='approved'`, `approved_at=now()`, generate default `affiliate_links` row (code = handle, target_path = `/?ref=[handle]`), approval email, audit `action='approve_affiliate'` | admin |
| Suspend affiliate | Click "Suspend" | Modal: reason (required) + typed confirmation ("SUSPEND"); on confirm: `status='suspended'`, suspension email, audit | admin |
| Unsuspend affiliate | Click "Unsuspend" | Modal: optional note + typed confirmation ("UNSUSPEND"); on confirm: `status='approved'`, audit | admin |
| Disable link (Links tab) | Click "Disable" on a link row | Modal: reason (required) + typed confirmation ("DISABLE"); on confirm: set `affiliate_links.active=false` (proposed column — see OQ), audit `action='disable_affiliate_link'`. The link still appears in the table but with a "Disabled" badge; the URL stops resolving (the click-tracking endpoint returns 404 for disabled links) | admin |
| Re-enable link | Click "Re-enable" on a disabled link | Modal: typed confirmation; on confirm: `active=true`, audit | admin |
| Delete link | Click "Delete" on a link row | Modal: reason (required) + typed confirmation ("DELETE"); on confirm: hard delete (the `affiliate_clicks` rows have `on delete cascade` per data model), audit `action='delete_affiliate_link'`. The click data is lost — flag this is destructive and irreversible | admin |
| Feature product on mini-shop (Mini-shop tab) | Click "Feature" on a product row | Atomic: sets all other products for this affiliate to `is_featured=false`, sets the clicked product to `is_featured=true`, audit `action='feature_product_on_mini_shop'`. The affiliate gets a "Uthena featured [product] on your shop" email | admin |
| Unfeature product | Click "Unfeature" on a featured product | Sets `is_featured=false` (the row stays on the mini-shop, just not featured), audit | admin |
| Add note | Notes tab → write + "Post" | Insert into `affiliate_admin_notes`, audit | admin |
| Edit / delete note (own, <24h) | Notes tab → "Edit" / "Delete" | Inline edit / soft delete with audit | admin |
| Send email to affiliate | Right rail → "Email affiliate" | Pre-filled email template modal (templates: "Payout issue", "Click fraud warning", "Handle change notification", "General"); audit `action='email_affiliate'` with template name | admin |

## What this page does NOT do

- No "delete affiliate account" (we never delete — suspend is the strongest state)
- No impersonation of the affiliate's account (v2)
- No real-time click updates (5-min refresh; v2 live)
- No PII in URLs (the route uses `affiliate.id` bigint, never email or handle)
- No "bulk force-feature across all affiliates" (single-affiliate action only; cross-affiliate curation lives in the catalog mgmt, not here)
- No editing of click data (clicks are immutable; corrections are admin notes)

## Acceptance criteria

- [ ] Page is auth-gated AND requires `profiles.role = 'admin'`
- [ ] Customer/partner/affiliate access returns 403
- [ ] Invalid affiliate id returns 404 (RLS returns zero rows; loader throws `notFound()`)
- [ ] All 9 tabs render with non-empty content for an active affiliate; Clicks tab is empty-state for a brand-new affiliate
- [ ] Payout email is masked by default; "Reveal" shows it for 30s, then auto-masks, AND writes `admin_audit_log` with `action='reveal_affiliate_payout_email'`
- [ ] "Force handle change" is gated to `super_admin` role (a new role; see OQ); the regular admin role sees the button but it's disabled with a tooltip
- [ ] "Force handle change" requires a reason of ≥ 50 chars AND a typed confirmation ("CHANGE HANDLE")
- [ ] "Force handle change" releases the old handle into a 30-day cool-off reservation (proposed `handle_cool_off` table — see OQ) so the previous owner can't re-grab it
- [ ] Bulk-revealing payout email + clicking through multiple clicks tabs is detectable in the audit log (per-admin PII access metric is queryable)
- [ ] Every approve / suspend / unsuspend / disable link / delete link / force feature requires a typed confirmation in a modal; the action button is disabled until the typed string matches
- [ ] Disabling a link immediately causes the click-tracking endpoint to return 404 for that link (verified by integration test: click after disable → 404)
- [ ] Deleting a link cascades to `affiliate_clicks` (per the data model); the Clicks tab removes the deleted link's rows on next load
- [ ] Force-feature is atomic: when admin features product A, the previous featured product (if any) is automatically unfeatured in the same transaction
- [ ] The affiliate receives an email when admin force-features a product on their mini-shop (so they're not surprised by it the next time they look)
- [ ] Notes are scoped to the affiliate; cross-affiliate note leaks are impossible (RLS)
- [ ] Activity tab shows every action across all tabs, in reverse chronological order, paginated
- [ ] Page renders in < 600ms p95
- [ ] No PII in URLs — the route is `/admin/affiliates/[id]` where `id` is the bigint primary key
- [ ] No `TODO` / `FIXME` in the diff

## Design reference

- Mockup: `mockups/admin.html` (same shell as the other admin pages)
- Components: `00-foundations/ui/AdminSidebar.tsx`, `00-foundations/ui/TabNav.tsx`, `00-foundations/ui/StatCard.tsx`, `00-foundations/ui/ActionRail.tsx`, `00-foundations/ui/ConfirmModal.tsx`, `00-foundations/ui/RevealField.tsx`, `00-foundations/ui/ActivityLog.tsx`, `00-foundations/ui/NoteThread.tsx`, `00-foundations/ui/ClicksChart.tsx` (30-day stacked time series), `00-foundations/ui/HandleEditor.tsx` (live availability check)
- Design tokens: `00-foundations/design/tokens.css`

## Security

- **Auth required:** YES
- **Allowed roles:** admin (only); the "Force handle change" action additionally requires `super_admin` (proposed role — see OQ)
- **RLS policies that apply:** `affiliates` (`affiliates_admin_all`), `profiles` (`profiles_admin_all`), `affiliate_links` (admin-scoped reads), `affiliate_clicks` (admin-scoped reads), `affiliate_commissions` (admin-scoped reads), `affiliate_payouts` (admin-scoped reads), `admin_audit_log` (`admin_audit_log_admin_read`), `affiliate_admin_notes` (proposed — admin all, no public read), `handle_cool_off` (proposed — admin all, no public read)
- **PII displayed:** yes — payout email (masked, reveal-audited), customer emails NOT shown on this page (affiliates don't see customer PII and neither do admins on this tab), click ip_hash + ua_hash (truncated, NOT raw — privacy-respecting per `_data-model.md`)
- **PII in URLs:** NO. The route is `/admin/affiliates/[id]` where `id` is the bigint primary key from `affiliates.id`. Tab navigation is `?tab=clicks` only.
- **Audit logged:** YES — every action enumerated in User actions writes to `admin_audit_log` with a distinct `action` string. The 30s-reveal window produces one `reveal_*` entry per reveal click.
- **Force handle change — super-admin gated:** the "force handle change" action is the highest-stakes action on this page. The recommendation is to introduce a `super_admin` role (`profiles.role='super_admin'`) and gate this single action on it. The regular `admin` role can see the button but it's disabled with a tooltip explaining the super-admin requirement.
- **Force handle change — cool-off period:** after a force-change, the OLD handle is reserved in `handle_cool_off` for 30 days. Any new account that tries to claim the old handle during cool-off is rejected. This prevents "I lose my handle to admin abuse and someone else immediately snags it."
- **Destructive-action safety:** every approve / suspend / unsuspend / disable link / delete link / force-feature requires a typed confirmation in a modal. The action button is disabled until the typed string matches. The reason textarea is required for suspension, link disable, link delete, and force-handle-change.
- **Click data immutability:** the admin can disable or delete a link (which deletes clicks via cascade) but cannot edit individual click rows. Click timestamps + IP hashes are forensic data; editing them would defeat the purpose.
- **CSRF:** all server actions protected by Next.js's built-in action token
- **Rate limiting:** reveal 100/hr/admin; profile edit 60/hr/admin; suspend/unsuspend 20/hr/admin; force-handle-change 3/hr/admin (extremely rare); disable/delete link 30/hr/admin; feature/unfeature product 30/hr/admin
- **Third-party scripts:** none

## Performance

- **Target p95:** < 600ms
- **Render strategy:** RSC + SSR. Tabs are server-rendered.
- **Cache:** none
- **DB indexes used:** `affiliates (id)`, `affiliate_links (affiliate_id)`, `affiliate_clicks (link_id, at desc)`, `affiliate_commissions (affiliate_id, created_at desc)`, `affiliate_payouts (affiliate_id, created_at desc)`, `admin_audit_log (target_table, target_id, at desc)`
- **Bundle size budget:** < 60KB added to client bundle (tab nav, action rail, 4 modals, reveal field, activity log, note thread, clicks chart)

## Out of scope for v1

- Delete affiliate (suspend is the strongest state)
- Merge with another affiliate (rare but real; v2)
- Impersonation / "view as affiliate"
- Real-time click updates
- Per-affiliate commission rate override (all affiliates earn 20% in v1; per-affiliate rates are v2)
- "Affiliate health score" composite
- A/B test of mini-shop layouts
- Automatic click-fraud detection (manual in v1; v2 has a flagging rule engine)
- Per-affiliate payout threshold override (all affiliates have $50 minimum in v1)
- Bulk link creation (one global link per affiliate in v1; per-product links in v2 — schema design accommodates both from the start)
- Email blast to top-N affiliates (v2)

## Open questions for human

1. **Handle squatting detection + recovery flow:** the brief asks for both. My recommendation — flag for human review:
   - **Detection:** a nightly job (cron) flags affiliate handles that match (a) brand names (cross-reference a brand-list table — proposed), (b) common squatting patterns (e.g. `admin`, `support`, `help`, `uthena` — already in the reserved list, so these should never have been approved), (c) very similar to existing high-traffic handles (Levenshtein distance < 2 from any handle with > 100 clicks/30d). Flagged handles appear in an "Action needed" badge on the admin list page; the detail page shows the matching evidence.
   - **Recovery:** the "force handle change" action (gated to super_admin) is the recovery. Cool-off period of 30 days on the old handle. The affiliate gets a 7-day warning email before the force-change, giving them a chance to change it themselves.
   - This is bigger than a one-off spec; the handle squatting system deserves its own ADR. Flag.
2. **Super-admin role:** the recommendation above proposes a `super_admin` role distinct from `admin`. My recommendation: **add `super_admin` to the `profiles.role` enum in `_data-model.md`**, gate the most-destructive actions on it (force handle change, force feature on partner's shop, manual ledger reversal, etc.), and create a `super_admin_init` migration that backfills the human's account. Flag for human review.
3. **Schema additions for `affiliate_links`:** the data model lacks `active` (for the disable action) and `last_clicked_at` (for the Links tab's "last clicked" column). My recommendation — flag for human review:
   ```sql
   alter table affiliate_links add column active boolean not null default true;
   alter table affiliate_links add column last_clicked_at timestamptz;
   create index on affiliate_links (affiliate_id, active) where active = true;
   -- The last_clicked_at is updated by the click-tracking endpoint on each click
   ```
   These belong in `04-platform/migrations/`.
4. **`affiliate_curated_products` new table:** the data model has no table for the affiliate's mini-shop curation. My recommendation — flag for human review:
   ```sql
   create table affiliate_curated_products (
     id bigserial primary key,
     affiliate_id bigint not null references affiliates(id) on delete cascade,
     product_id bigint not null references products(id) on delete cascade,
     is_featured boolean not null default false,
     why_i_picked_this text,    -- the affiliate's own note per the affiliate-shop.md spec
     added_at timestamptz not null default now(),
     unique (affiliate_id, product_id)
   );
   create unique index on affiliate_curated_products (affiliate_id) where is_featured = true;
   -- The partial unique index enforces "at most one featured product per affiliate" at the DB level.
   alter table affiliate_curated_products enable row level security;
   create policy "affiliate_curated_public_read" on affiliate_curated_products
     for select using (true);  -- public on the mini-shop
   create policy "affiliate_curated_self_all" on affiliate_curated_products
     for all using (affiliate_id in (select id from affiliates where user_id = auth.uid()));
   create policy "affiliate_curated_admin_all" on affiliate_curated_products
     for all using (exists (select 1 from profiles where user_id = auth.uid() and role in ('admin', 'super_admin')));
   ```
   Note: the partial unique index means the admin's force-feature action must unset the old featured product in the same transaction. The `affiliate_shop.md` spec also writes to this table — confirm the field names match.
5. **`affiliate_admin_notes` new table:** same shape as `partner_admin_notes`. My recommendation: reuse the same SQL with `affiliate_id` instead of `partner_id`. Confirms the symmetry.
6. **`handle_cool_off` new table:** for the 30-day cool-off reservation. My recommendation — flag for human review:
   ```sql
   create table handle_cool_off (
     handle text primary key,                          -- the cool-off'd handle, lowercased
     original_affiliate_id bigint not null references affiliates(id) on delete cascade,
     forced_by_admin_id uuid not null references auth.users(id),
     forced_at timestamptz not null default now(),
     cool_off_until timestamptz not null               -- forced_at + 30 days
   );
   create index on handle_cool_off (cool_off_until);   -- for janitor
   alter table handle_cool_off enable row level security;
   create policy "handle_cool_off_admin_read" on handle_cool_off
     for select using (exists (select 1 from profiles where user_id = auth.uid() and role in ('admin', 'super_admin')));
   -- No public read. The janitor job uses service_role to clean expired rows.
   ```

---

## Implementation notes

- (filled by the building agent)
