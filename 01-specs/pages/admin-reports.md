# Admin Reports Queue — `/admin/reports`

## What this page does

The admin's queue of user-submitted reports. Two report kinds in v1: (1) **product reports** — a customer flags a product for IP violation, low quality, misleading description, or wrong category; (2) **review reports** — a user flags a review as spam, abuse, or fake. The page is a two-pane layout: the left list shows all open reports sorted oldest first; the right detail panel shows the reported entity, the reporter's account, the reason + free-text body, and the resolution actions. Resolutions are: dismiss, warn the reporter, take down the reported entity, or ban the author. Bulk dismiss is **out of scope for v1**. Every resolution is audit-logged; every page view is audit-logged (this is the trail we use to defend a "why was this report dismissed" complaint).

## Data this page shows

| Section | Field | Source | Format |
|---|---|---|---|
| Sidebar | moderation nav (Review queue, Reports, Categories, Refunds), users nav (Partners, Affiliates, Customers), system nav (Analytics, Settings) | hard-coded | sidebar |
| Top bar | page title, "Reports" count badge (open only), filter chips (All / Product / Review), "Export log" button | derived | top bar |
| Stats row | open count, products reported, reviews reported, avg time-to-resolution (7d), oldest open age | aggregate over `reports` | 5 stat cards |
| List panel | all `reports` rows with `status='open'` or `='investigating'`, sorted by `created_at asc` (FIFO) | `reports` joined with `auth.users` (reporter) | list of cards |
| List card | `kind` badge, reported entity title (product or review), `reason` chip, `reporter.email` (masked), `created_at`, time-since ("3h ago"), `status` badge | derived | card row |
| Filter chips | kind (all / product / review), status (open / investigating / resolved / dismissed), date range | local state + URL | chips |
| Search | reporter email, reported entity id, free-text on body | URL `?q=` | search input |
| Detail panel header | `reports.id`, `kind`, `reason`, `created_at`, `status` | `reports` | header |
| Detail — Reporter | `auth.users.email`, `profiles.display_name`, account age, last sign-in, prior reports count, prior warnings count | auth.users + profiles + reports aggregate | sub-card |
| Detail — Reported entity | product: `title`, `slug`, `partner.display_name`, `category`, `published_at`, sales count, rating; review: `body`, `rating`, `product.title`, reviewer | products / reviews | sub-card with deep-link to `/admin/products/[id]` or `/admin/reviews` |
| Detail — Body | reporter's free-text explanation | `reports.body` | long text block |
| Detail — History | all status changes + audit rows for this report | `admin_audit_log` filtered | event list |
| Resolution panel | Dismiss / Warn reporter / Take down entity / Ban author buttons (sticky bottom) | derived | action bar |
| Resolution modal | typed confirmation ("type RESOLVE to confirm") for take-down and ban | derived | modal |

**Queries:** `02-features/admin/queries/getReports.ts`, `getReportById.ts`.

## User actions

| Action | Trigger | Result | RBAC |
|---|---|---|---|
| Open a report | Click a list card | Loads detail panel, sets `status='investigating'`, sets `resolved_by=null` while investigating, audit row written | admin |
| Filter by kind | Click a kind chip | URL updates with `?kind=`, list re-queries | admin |
| Filter by status | Click a status chip | URL updates with `?status=` | admin |
| Search reports | Type in the search input | URL updates with `?q=` (debounced 300ms) | admin |
| Dismiss | Click "Dismiss" | Sets `status='dismissed'`, records `resolved_by`, `resolved_at`, audit row `action='report_dismissed'` | admin |
| Warn the reporter | Click "Warn reporter" | Sends a templated warning email to the reporter, increments reporter's warnings counter (lives in a new column on profiles — see OQ), audit row `action='report_warned'` | admin |
| Take down the reported entity | Click "Take down" | For product reports: sets `products.status='unpublished'`, audit row on product AND report. For review reports: sets `reviews.status='rejected'`, audit row. Report status → `'resolved'`. | admin |
| Ban the author | Click "Ban author" | For product reports: sets `partners.status='suspended'`, partner cannot upload, existing products unpublished, all pending `payout_ledger` rows paused. For review reports: sets `profiles.status='banned'` (per OQ #3, option b), all sessions revoked via Supabase admin API, `reviews.status='rejected'`. | admin |
| View reported product | Click the product title in the detail panel | Navigate to `/admin/products/[id]` (v2; v1 deep-links to `/products/[slug]` in a new tab) | admin |
| View reported review | Click the review excerpt | Opens the review in a modal (no separate admin review page in v1) | admin |
| Add an internal note | Type in the note textarea, click "Save note" | Saves to `admin_audit_log.after.notes` for this report, audit row | admin |
| Export reports log | Click "Export log" | Generates a CSV of all reports in the filter, signed URL, audit row | admin |
| Bulk dismiss | (not in v1) | — | — |
| Assign to me | (not in v1) | — | — |

## What this page does NOT do

- No bulk dismiss (deliberate: each report wants a human read; bulk dismiss is a foot-gun)
- No automated triage (we don't auto-resolve "obvious" reports in v1; v2 may add a high-confidence spam filter)
- No ML-based "is this review abusive" (admin reads every report)
- No reporter follow-up messaging (the warning email is one-way)
- No public-facing report form UX work (the report submission flow is owned by the catalog and product specs; this page is admin-only)
- No "appeals" workflow (v2)
- No SLA timer (admin-review.md has the SLA, reports don't yet — flag in OQ)
- No Slack notifications (admin checks the queue; v2 has email digest)
- No two-admin collaboration on a single report

## Acceptance criteria

- [ ] Page is auth-gated AND requires `profiles.role = 'admin'`
- [ ] Customer/partner/affiliate access returns 404 (we use 404, not 403, so we don't leak that the route exists)
- [ ] List panel shows the oldest open report first (FIFO by `created_at asc`)
- [ ] Filter chips and search box are reflected in the URL (shareable)
- [ ] Opening a report marks it as `investigating` and writes an `admin_audit_log` row with `action='report_open'`
- [ ] Dismiss sets `status='dismissed'`, writes `report_dismissed` audit row with `before` and `after` JSON
- [ ] Warn sends a templated email to the reporter, increments their warnings counter, writes `report_warned` audit row
- [ ] Take down sets the product's `status='unpublished'` (or review's `status='rejected'`), writes audit rows on BOTH the report and the affected entity, sets report `status='resolved'`
- [ ] Ban author requires typed confirmation ("type RESOLVE to confirm") and sets `partners.status='suspended'` (or `profiles.status='banned'` for review authors, per OQ #3), revokes all sessions, pauses pending payouts, writes audit row
- [ ] Every page view writes an `admin_audit_log` row with `action='report_viewed'` (defensive: protects against "an admin looked at this report and did nothing" later)
- [ ] Email to reporter: warning email is sent only to verified email, includes the report id, includes a one-line summary, no PII of the reported entity
- [ ] All destructive resolutions (take down, ban) require typed confirmation AND are rate-limited to 50 actions per admin per hour
- [ ] Page renders in < 500ms p95
- [ ] No `TODO` / `FIXME` / `HACK` in the diff

## Design reference

- Mockup: `mockups/admin.html` (shared with `admin-review.md`; the sidebar/topbar are the same)
- Components: `00-foundations/ui/AdminSidebar.tsx`, `00-foundations/ui/ReportListCard.tsx`, `00-foundations/ui/ReportDetailPanel.tsx`, `00-foundations/ui/ResolutionBar.tsx`, `00-foundations/ui/ConfirmModal.tsx`

## Security

- **Auth required:** YES
- **Allowed roles:** admin (only)
- **RLS policies that apply:** NEW `reports` table (admin-only read + write; self-only insert from the public report form, see OQ), `products` (admin all), `reviews` (admin all), `partners` (admin all), `auth.users` (admin all via service-role)
- **PII displayed:** yes — the reporter's email (admin only), the reported author's email if it's a review report. Every PII view is audit-logged.
- **PII in URLs:** no
- **Audit logged:** YES — every page view (`report_viewed`), every open (`report_open`), every note save (`report_note`), every resolution (`report_dismissed`, `report_warned`, `report_takedown_product`, `report_takedown_review`, `report_ban_partner`, `report_ban_user`). Audit rows carry `before`/`after` JSON.
- **Email to reporter:** uses Resend; the email template lives in `04-platform/emails/report-warning.tsx`; includes the report id and the canonical reason; never includes the report body verbatim (admin can paraphrase in a "context" field)
- **Take-down atomicity:** the take-down action runs inside a Postgres serializable transaction. The product status flip and the report resolution either both succeed or both fail.
- **Ban atomicity:** same. Suspension of partner + unpublished products + paused payouts all in one transaction.
- **CSRF:** all resolution server actions are CSRF-protected (Next.js origin check + Supabase session cookie)
- **Rate limiting:** 50 destructive resolutions per admin per hour; 200 page views per admin per hour (defends against enumeration attacks on report ids)
- **Idempotency:** every resolution server action takes a `client_request_id` (uuid v4) and the action returns the same response if called twice with the same id (prevents double-resolve on retry)
- **Third-party scripts:** none

## Performance

- **Target p95:** < 500ms
- **Render strategy:** RSC + SSR
- **Cache:** none (real-time queue)
- **DB indexes:** NEW: `reports (status, created_at asc) where status in ('open','investigating')`, `reports (kind, status)`, `reports (reporter_user_id)`, `reports (resolved_by) where resolved_by is not null`
- **Bundle size budget:** < 40KB added to client bundle (list, detail panel, resolution bar, confirm modal)

## Out of scope for v1

- Bulk dismiss
- Automated triage / ML abuse detection
- Reporter appeals
- Public-facing report form UX (owned by catalog and product specs)
- SLA timer on reports
- Slack notifications
- Two-admin collaboration
- Reporter follow-up messaging
- Per-admin performance metrics

## Open questions for human

- **`reports` table:** Already defined in `_data-model.md` as `reports` (consolidated by the data-model track in round 2). This spec's RLS reads, indexes, and column usage are governed by the canonical definition there — do not re-propose schema in this PR. Confirm with the data-model track that the consolidated schema covers: `kind`/`reason`/`status` enums, `target_table` + `target_id` polymorphic pattern, partial index on `(status, created_at asc) where status in ('open','investigating')`, the `reports_admin_all` and `reports_self_insert` policies, and the 72h SLA convention noted in `_data-model.md` §"Rules for this table". My recommendation: rely on the canonical schema; surface any further shape changes (e.g. additional enum values, additional indexes) as follow-up data-model PRs, not as edits to this spec.
- **Reporter warnings counter:** the "warn reporter" action needs a counter. The data model has no such column. Options: (a) add `profiles.warnings_count int default 0` and increment on warn, (b) derive from `admin_audit_log` count where `action='report_warned' and target_id = user.id`. My recommendation: (a) — denormalized counter, with a trigger that re-derives from the audit log nightly as a backstop. The denormalized read is the hot path; the audit log is the source of truth.
- **`auth.users.banned` column:** banning a user (for review abuse) needs a column. Options: (a) add `auth.users.banned boolean` (requires a custom Supabase Auth hook), (b) use `profiles.status` with a new value `'banned'`, (c) revoke all sessions + flag in a new `banned_users` table. My recommendation: (b) — extend `profiles.status` check constraint to include `'banned'`, and the ban action sets the profile to banned + revokes all Supabase sessions via the admin API. (a) requires Supabase Enterprise; (c) is one more table for a one-column fact.
- **SLA for reports:** reviews.md promises 48h SLA for partner uploads. Reports don't have a published SLA. My recommendation: 72h SLA, surfaced as a soft badge, not enforced. If we miss it, the report is just stale — there's no customer-facing consequence in v1.

---

## Implementation notes

- (filled by the building agent)
