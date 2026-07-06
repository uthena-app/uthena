# Admin Review Queue — `/admin/review`

## What this page does

The internal moderator's tool for reviewing partner course submissions. Two-pane layout: list of pending submissions on the left, detail panel on the right with quality checks, video preview, curriculum, pricing, and a decision panel (approve / return for changes / reject). This is the gate between "partner submitted a course" and "course is live in the marketplace."

The most important thing about this page: **every decision is logged to `admin_audit_log`**. Every page view is logged. Every quality-check failure is logged. This is the audit trail that protects Uthena if a partner disputes a rejection.

## Data this page shows

| Section | Field | Source | Format |
|---|---|---|---|
| Sidebar | moderation nav: Review queue, Reports, Categories, Refunds; users nav: Partners, Affiliates, Customers; system nav: Analytics, Settings | hard-coded | sidebar |
| Top bar | page title, SLA badge ("SLA: 48h · avg 12h"), bulk actions button, export log button | hard-coded | top bar |
| Stats row | pending count, SLA-at-risk count, approved today, rejected today, avg review time | aggregate over `partner_uploads` | 5 stat cards |
| List panel | all submissions with `status='submitted'` (or `in_review` if the admin has it open), sorted by submitted_at asc (oldest first) | partner_uploads joined with partners + products | list of cards |
| List card | title, partner name, category, submitted_at, time-since ("3h ago"), auto-check status (passed / needs check / failed), size | derived | card row |
| Filter | status (new, in review, returned), search by title/partner | local state + URL | chips + search input |
| Detail panel header | title, partner, category, submitted_at, submission ID | partner_uploads | header |
| Detail tabs | Overview, Curriculum, Files, Quality checks, Rights check, Pricing, Activity | hard-coded | tabs |
| Overview tab | description, preview video (plays inline), curriculum preview, pricing summary | partner_uploads.draft_payload | tab content |
| Curriculum tab | full curriculum (modules + lessons) | partner_uploads.draft_payload | nested list |
| Files tab | all uploaded files (name, size, kind, encoding status) | partner_uploads.draft_payload | file list |
| Quality checks tab | 8 checks: video resolution, audio levels, no copyrighted music, no malware, plagiarism, slide consistency, source files editable, sales page renders. Each shows PASS/FAIL/WARN + score | auto-computed by `02-features/admin/queries/runQualityChecks.ts` | 2-column grid of checks |
| Rights check tab | manual checkbox: "I have verified this partner has 100% rights to all uploaded content" | hard-coded | single checkbox + notes textarea |
| Pricing tab | per-tier review (active toggle, price) | partner_uploads.draft_payload | table |
| Activity tab | log of all events for this submission (status changes, notes added, files uploaded, reviewer assigned) | partner_uploads.activity log + audit log | event log |
| Decision panel | decision textarea (visible to partner if returned/rejected), Reject / Return for changes / Approve & publish buttons | derived | sticky bottom panel |
| Review note | multi-line text input (saves on blur) | local state | textarea |
| Second reviewer | (not in v1) | — | — |

## User actions

| Action | Trigger | Result | RBAC |
|---|---|---|---|
| Open a submission | Click a list card | Loads detail panel, marks as `in_review`, records in audit log | admin |
| Add a review note | Type in the decision textarea, click "Save note" | Saves note to `partner_uploads.decision_notes`, logs in audit | admin |
| Mark as in review | (auto, on open) | Sets status='in_review', sets reviewer_id, logs | admin |
| Reject | Click "Reject" | Requires decision note. Sets status='rejected', sends email to partner with the note. Product (if it was created) is set to `status='archived'`. Logged in audit. | admin |
| Return for changes | Click "Return for changes" | Requires decision note. Sets status='returned' (which is a form of draft — partner can edit and resubmit). Sends email. Logged. | admin |
| Approve & publish | Click "Approve & publish" | Sets status='approved'. Creates the product with `status='published'`. The product is now live in the marketplace. Triggers a welcome email to the partner. Logged. | admin |
| Bulk approve | (not in v1 — bulk actions on the queue are limited to filter/assign) | — | — |
| Assign to me | (not in v1 — single reviewer model) | — | — |
| Escalate | (not in v1) | — | — |
| View partner profile | Click the partner name in the detail header | Navigate to `/admin/partners/[id]` (read-only partner profile, v2) | admin |
| View submission history | Click "View history" in the detail header | Opens a modal with all past submissions for this partner | admin |
| Open the partner's other products | (not in v1 — they appear in the partner dashboard, not here) | — | — |

## What this page does NOT do

- No two-admin collaboration (one reviewer per submission in v1; second-reviewer system in v2)
- No A/B test of which submissions get approved faster (v2)
- No ML-based pre-screening (v2)
- No "fast track" for trusted partners (v2)
- No automated rights check (v1 is manual; the AI-based fingerprint check is v2)
- No bulk actions (apply tags, archive, etc. in bulk)
- No Slack notifications (v1: in-app only)
- No email to admin when a new submission arrives (v1: admin checks the queue; v2 has email digest)

## Acceptance criteria

- [ ] Page is auth-gated AND requires `profiles.role = 'admin'`
- [ ] Customer/partner/affiliate access returns 403 (or redirects to /404 — we use 403 for security)
- [ ] List panel shows the oldest un-reviewed submission first (FIFO)
- [ ] "SLA at risk" badge correctly identifies submissions > 36h old
- [ ] "Auto-checks passed" / "Rights: needs check" badges correctly reflect the auto-checks status
- [ ] Opening a submission marks it as `in_review` and records the admin's user_id
- [ ] Quality checks run automatically and produce correct PASS/FAIL/WARN for each
- [ ] Plagiarism check is a content similarity check against the existing catalog (not a Google search)
- [ ] Decision buttons are disabled until a note is provided (for Reject and Return)
- [ ] Approve & publish creates the product with `status='published'` and `partner_id` set
- [ ] Reject sets the product (if created) to `status='archived'`
- [ ] Return for changes sets the upload back to `status='returned'`, partner can re-edit
- [ ] All decisions log to `admin_audit_log` with `before` and `after` JSON
- [ ] Email notifications fire correctly (partner gets the right email per decision)
- [ ] Page renders in < 500ms p95
- [ ] No layout shift on data load
- [ ] No PII displayed beyond what the partner themselves entered
- [ ] No `TODO` / `FIXME` in the diff

## Design reference

- Mockup: `mockups/admin.html`
- Components: `00-foundations/ui/AdminSidebar.tsx`, `00-foundations/ui/ReviewListPanel.tsx`, `00-foundations/ui/ReviewDetailPanel.tsx`, `00-foundations/ui/CheckGrid.tsx`, `00-foundations/ui/DecisionPanel.tsx`

## Security

- **Auth required:** YES
- **Allowed roles:** admin (only)
- **RLS policies that apply:** `partner_uploads` (admin all), `products` (admin all), `profiles`/`partners` (admin all)
- **PII displayed:** no PII beyond what the partner entered in their profile. Admin sees the partner's bio, website, etc. — all of which the partner chose to share publicly.
- **PII in URLs:** no
- **Audit logged:** YES — every page view, every decision, every note edit, every action. The `admin_audit_log` table is the source of truth for all admin activity.
- **Two-person rule:** not in v1. (v2: a "dangerous" action like approving a $5K course could require two admins.)
- **Mutability window:** in v1, approved/rejected decisions are immutable. We can change a product's status later (e.g. unpublish for TOS violation), but the original decision row stays. This protects against "the admin who approved it deleted the audit trail."
- **Email security:** emails to partners include the admin's decision note. The note is visible to the partner. Admins are warned before sending.
- **CSRF:** all decision server actions are CSRF-protected
- **Rate limiting on decisions:** max 100 decisions/hour per admin (prevents accidental bulk-clicks causing damage; admins can request a temporary raise)
- **Third-party scripts:** none

## Performance

- **Target p95:** < 500ms
- **Render strategy:** RSC + SSR
- **Cache:** none (real-time queue)
- **DB indexes:** `partner_uploads (status) where status = 'submitted'`, `partner_uploads (reviewer_id) where reviewer_id is not null`
- **Bundle size budget:** < 50KB added to client bundle (rich list, detail panel, quality check grid, video player)

## Out of scope for v1

- Two-admin collaboration
- A/B testing of admin decisions
- ML pre-screening
- Fast track for trusted partners
- Automated rights check (manual in v1)
- Bulk actions
- Slack notifications
- Email digests
- Auto-suspend partners with high rejection rates (manual in v1)
- "Recently approved" feed (admin can query the list directly)
- Per-admin performance metrics (we log everything, but don't surface a leaderboard)

## Open questions for human

- **Email copy for the four decisions:** I'll write reasonable defaults, but you should review the "Reject" email especially — it's the partner's worst day. My recommendation: write three versions (rejected, returned, approved) and A/B test the rejection one.
- **SLA for the queue:** 48h is what we promise partners. Should we have a 24h SLA for higher-value submissions (e.g. > $1K expected price)? My recommendation: keep one SLA. Simplicity. Tune if we're missing it.
- **"Return for changes" vs "Reject":** when do we return vs reject? My recommendation: return if the issue is fixable (missing files, bad metadata, low quality); reject if the issue is unfixable (rights violation, plagiarism, illegal content). Document this in the admin guide.

---

## Implementation notes

- (filled by the building agent)
