# ADR-0008: Admin area RBAC model (single admin role, all actions audit-logged, no dual-control in v1)

**Date:** 2026-06-12
**Status:** Accepted
**Deciders:** Human, platform agent
**Supersedes:** none
**Superseded by:** none

## Context

The Uthena v2 admin area covers the highest-stakes operations in the platform:

- Approving and rejecting partner course submissions (`/admin/review`)
- Reviewing refund requests (`/admin/payouts` refund queue)
- Triggering manual payout batches, including retrying failed payouts
- Moderating content reports (`/admin/reports` — product, review, affiliate, partner)
- Managing platform settings (`/admin/settings`)
- Suspending and banning customers, partners, and affiliates (`/admin/customers/[id]`, `/admin/partners/[id]`, `/admin/affiliates/[id]`)
- Issuing and revoking DMCA takedowns (`dmca.md`)

Every one of these is an action that can move real money, take down real content, or affect a real person's ability to earn a living on the platform. The question is: **what's the right authorization and audit model for the admin role in v1?**

The `profiles.role = 'admin'` value (introduced in the original data model, see `01-specs/pages/_data-model.md` "Roles") is the only admin-level grant in v1. Every admin sees the same data and has the same actions. The RLS policies that gate the admin tables (e.g. `partners_admin_all`, `orders_admin_all`) are permissive — they allow the action if the caller's role is `admin`, with no further scoping.

The risks this poses:

1. **A compromised admin account can do anything.** No "second pair of eyes" required for high-value actions.
2. **A single rogue or careless admin can move money, take down content, or ban users with no friction.**
3. **The audit log is the only backstop.** Every action writes to `admin_audit_log`, but if the log isn't reviewed in time, the damage is done.
4. **Sub-roles would help** — a "moderator" who can resolve reports but not approve refunds; a "support" who can read user data but not edit it. But sub-roles are a v2 design effort.

The question we're answering with this ADR: **is the v1 single-admin-role model safe enough to ship, given that we will have one or two human admins at launch?**

## Considered options

### Option A: Single admin role, all actions audit-logged, no dual-control, no sub-roles (this ADR's decision)

- **Pros:** Ships in v1. RLS policies are simple (one pattern: `exists (select 1 from profiles where user_id = auth.uid() and role = 'admin')`). Audit log is the sole backstop. We can add sub-roles and dual-control in v2 without a migration, because the audit log already exists.
- **Cons:** One compromised admin account = full access. No protection against admin error. No "second pair of eyes" on a >$5K payout.
- **Mitigations built into v1:** MFA is mandatory for any account with `profiles.role = 'admin'` (enforced via Supabase Auth's TOTP requirement, configured at the project level, not per-user — every admin has it on by default). Rate limiting on destructive actions. Typed confirmation on manual payouts. The audit log is the source of truth for after-the-fact review.

### Option B: Sub-roles in v1 (e.g. `admin_moderator`, `admin_support`, `admin_finance`)

- **Pros:** Least-privilege by design. A moderator can resolve reports but can't trigger a payout. A support agent can read a user's profile but can't ban them. The blast radius of a compromised account is smaller.
- **Cons:** **This is a v1-scope-time explosion.** Every RLS policy that today says `role = 'admin'` becomes a per-action permission check. Every server action that today calls `requireRole(['admin'])` becomes a per-action `requirePermission(actionName)`. The data model needs a `permissions` join table. The admin UI needs to scope every page by role. None of this is hard in isolation, but in aggregate it's weeks of work that doesn't ship customer value.
- **Verdict:** Defer to v2. The single-role model is the right v1 default for a 1–2-person admin team.

### Option C: Dual-control (two-person rule) for high-value actions in v1

- **Pros:** A >$5K payout requires two admins to approve. A permanent ban requires two admins. The "compromised single account" scenario becomes "compromised TWO accounts in coordination" — much higher bar.
- **Cons:** **Operational friction at v1 scale.** If we have one admin, dual-control is a deadlock. If we have two, every high-value action requires both to be online at the same time (or a queue). Adds latency to refunds, payouts, and DMCA removals.
- **Verdict:** Defer to v2, contingent on having ≥ 2 admins.

### Option D: No admin role at all — service-role-only admin actions

- **Pros:** No admin UI in the app. Admins use SQL or a separate terminal. Maximum safety (no admin password to phish).
- **Cons:** **No admin is the wrong answer for a content moderation workload.** Reports queue up overnight. Refunds take 3 days. Partner onboarding decisions take a week. This is not viable for a real platform.
- **Verdict:** Not viable.

## Decision

**v1 ships with a single `admin` role (plus a `super_admin` role for the platform owner only), all actions audit-logged, no dual-control, no sub-roles, with the following safety net:**

### 1. Single admin role, no scoped sub-roles; `super_admin` is a distinct role for the platform owner

`profiles.role = 'admin'` is the only admin grant for staff admins. The platform owner (the human who runs the platform) has `profiles.role = 'super_admin'`. In v1, **`super_admin` has the same visibility as `admin`** — it exists as a distinct value so v2 can scope destructive actions (force handle change, force feature on partner's shop, manual ledger reversal) to it, but in v1 every admin (including the super_admin) can do everything. RLS policies use the pattern:

```sql
create policy "X_admin_all" on X
  for all using (
    exists (select 1 from profiles where user_id = auth.uid() and role in ('admin', 'super_admin'))
  );
```

The `super_admin` role extension is from `admin-affiliate-detail.md` Open Questions §2 (handle squatting / force-handle-change). In v1, the `super_admin_init` migration backfills the human's account. Sub-roles (`admin_moderator`, `admin_support`, `admin_finance`) are a v2 design. See "v2 work" below.

### 2. Principle of least privilege at the action layer

Even though every admin can do everything, the **server actions** are scoped by action name, not by "admin can do anything." Each admin server action:

- Has a single, named purpose (`approveSubmission`, `triggerManualPayout`, `resolveReport`, `suspendCustomer`).
- Logs to `admin_audit_log` with `action`, `target_table`, `target_id`, `before`, `after`, `ip_address`. The `action` string is dot-namespaced with the actor class as the first segment (`admin.approve_submission`, `partner.create_api_token`, `system.cron.daily_payout_batch`).
- Returns a structured result (`{ ok, error?, audit_log_id }`).
- Has a Vitest test that asserts the audit log row was written with the right shape.

The "admin can do anything" pattern is rejected at code review. **Every action is explicitly named and tested.**

### 3. Audit logging is required for every action — polymorphic actor

`admin_audit_log` is the source of truth for after-the-fact review. It is **polymorphic on the actor** — every row has exactly one of `admin_id`, `partner_id`, or `system_source` set (a CHECK constraint enforces this). The pattern (in `00-foundations/auth/audit.ts`):

```ts
// In an admin server action
const auditId = await logAdminAction({
  actor: { kind: 'admin', admin_id: userId },
  action: 'admin.approve_submission',
  target_table: 'partner_uploads',
  target_id: uploadId,
  before: previousState,
  after: newState,
  ip_address: request.headers.get('x-forwarded-for'),
});

// In a partner self-service action (e.g. /partner/settings/api creating a token)
const auditId = await logAdminAction({
  actor: { kind: 'partner', partner_id: userId },
  action: 'partner.create_api_token',
  target_table: 'api_tokens',
  target_id: tokenId,
  after: { name, scopes },
  ip_address: request.headers.get('x-forwarded-for'),
});

// In a system cron
const auditId = await logAdminAction({
  actor: { kind: 'system', system_source: 'cron:daily-payout-batch' },
  action: 'system.cron.daily_payout_batch',
  target_table: 'payout_ledger',
  target_id: batchId,
  after: { count, total_cents },
});
```

- `admin_audit_log` is **append-only**. No UPDATE policy. No DELETE policy. A migration that adds an UPDATE or DELETE policy is a CI failure.
- The log is reviewed weekly by the human in charge. The review is documented in `05-ops/runbooks/admin-audit-review.md`.
- The log is retained indefinitely (until the user requests deletion under GDPR Article 17, which deletes the user's PII from the log but preserves the audit shape — see `05-ops/compliance/gdpr.md` and the v2 work below).
- **The polymorphic actor pattern** (added in the round-2 spec consolidation) was driven by `partner-settings-api.md` Open Questions §"Audit table — api_token_audit vs reuse of admin_audit_log": the partner's self-service actions (creating / revoking an `api_token`) also need an audit trail, and a separate `partner_audit_log` table would mean two retention policies, two query surfaces, and two sets of RLS tests. One table, polymorphic actor, one retention policy. The table name `admin_audit_log` is preserved for v1 (renaming in v2 is cheap; updating 30+ spec references is not).

### 4. Rate limiting on destructive actions

Rate limits (enforced at the server action layer, not in the DB):

| Action class | Limit | Why |
|---|---|---|
| Approve / reject partner submission | 100 / hour / admin | Prevents accidental bulk-clicks (see `admin-review.md` Security) |
| Approve / reject refund | 50 / hour / admin | Refunds are financial; 50/hr is 1/min, which is fast enough |
| Trigger manual payout batch | 5 / day / admin | A manual batch is a 30+ minute operation; 5/day is generous |
| Resolve report (mark resolved / dismissed) | 200 / hour / admin | Reports are low-stakes but high-volume |
| Suspend / ban user | 10 / hour / admin | Bans are user-visible and reversible, but we want a friction point |
| Edit platform_settings | 30 / hour / admin | Settings changes are rare; a burst is suspicious |
| Create / revoke api_token on behalf of a partner (admin-initiated) | 5 / hour / admin | Rare operation |

Rate-limited requests return HTTP 429 and write an `admin_audit_log` row with `action='rate_limit_triggered'`. The threshold can be raised temporarily via `platform_settings` (e.g. during a moderation backlog burndown) but never above 10× the default.

### 5. Typed confirmation on manual payouts and bans

- **Manual payout batch trigger** requires the admin to type `TRIGGER` (verbatim) into a confirmation input. This is the pattern from `admin-payouts.md` Security §"Manual batch confirmation."
- **Permanent ban** (as opposed to temporary suspend) requires the admin to type `BAN` and provide a reason ≥ 20 characters. The reason is stored on the audit log row and on the user's profile (`banned_at`, `banned_reason`).
- The confirmation input is rendered on a server-only page (no client-side bypass).

### 6. MFA is mandatory for admin accounts

Supabase Auth is configured (at the project level, not per-user) to require TOTP MFA for any account with `profiles.role = 'admin'`. The config is in `04-platform/auth/supabase-config.md`. New admin accounts are bootstrapped with a one-time recovery code stored in the team's password manager (1Password); the admin sets up their TOTP on first login.

### 7. The ban vs. suspend state machine

The customer-side ban/suspend state machine is explicit (from `admin-customer-detail.md` Open Questions; codified here for the data model and the spec writers):

```
active (default)
  ├── suspended (admin action; reversible; duration: 7d, 30d, or indefinite)
  │     └── active (admin lift; reason logged)
  └── banned (admin action; IRREVERSIBLE without manual DB intervention by the platform owner)
        └── (no recovery path in v1; banned user cannot re-register with same email)
```

| Field | Type | Default | Notes |
|---|---|---|---|
| `profiles.status` | enum | `'active'` | `active` / `suspended` / `banned` |
| `profiles.suspended_at` | timestamptz | null | set on suspend; cleared on lift |
| `profiles.suspended_until` | timestamptz | null | null = indefinite suspend |
| `profiles.suspended_reason` | text | null | admin's typed reason |
| `profiles.banned_at` | timestamptz | null | set on ban; never cleared in v1 |
| `profiles.banned_reason` | text | null | admin's typed reason (≥ 20 chars) |
| `profiles.banned_by` | uuid | null | the admin who banned |

The same fields apply to `partners.status` and `affiliates.status` (already enums `pending/approved/suspended`; we add a `banned` value in v1 — see the "data model" consequence below).

**Suspension** stops the user from logging in (the auth layer checks `profiles.status` post-MFA) but preserves their data (library grants, payouts ledger, etc.). **Ban** is for repeat offenders and ToS violators. The difference is the recovery path.

The data-model doc will get the new fields in a follow-up migration (this is an additive change, not a rewrite). The relevant specs (`admin-customer-detail.md`, `admin-partner-detail.md`, `admin-affiliate-detail.md`) already reference the state machine in their Open Questions; this ADR is the canonical source.

### 8. What the admin cannot do in v1

- **Cannot delete a user.** No `DELETE /admin/customers/[id]` action. The user is `banned` (status set) but the row stays. This preserves the audit trail and the payout ledger.
- **Cannot edit `payout_ledger`.** The ledger is append-only (see ADR-0005). Corrections are new `adjustment` rows, never edits to the original.
- **Cannot issue a refund over $X without a typed confirmation.** (X is configured in `platform_settings`; default $500.)
- **Cannot change the role of another admin.** Role changes go through a separate `update_role` server action that requires a second admin's typed confirmation (this is a v1 half-step toward dual-control — see below).
- **Cannot view plaintext API tokens** (the `token_hash` is column-level GRANT-revoked from non-service roles).
- **Cannot view plaintext partner/affiliate payout methods** (the `payout_method jsonb` is encrypted at the app layer with libsodium; the admin sees the metadata, not the email — same pattern as the existing `partners.payout_method` column).

### 9. The "half-step" toward dual-control in v1: role changes

A "change someone's role" action is the highest-stakes admin action in v1. Even though we don't have a true two-person rule, we implement a **typed-confirmation gate** in v1:

- `update_role` action requires the admin to type the target role verbatim (e.g. `partner`).
- An `admin_audit_log` row is written with `action='update_role'`, `target_table='profiles'`, `target_id=userId`, `before={role: 'customer'}`, `after={role: 'partner'}`.
- The user being role-changed gets an email ("Your account role was updated to X by an admin").
- The action rate limit is 1 / hour / admin.

In v2, this action gets a full second-admin approval (the change is staged in a `pending_role_changes` table and a second admin clicks "approve" in their own session).

## v2 work (explicitly deferred)

The following are **out of scope for v1** and are listed in `01-specs/pages/_data-model.md` "What we deliberately DON'T do":

1. **Sub-roles** (`admin_moderator`, `admin_support`, `admin_finance`, `admin_finance_payouts`, etc.). v2 introduces a `permissions` join table and per-action checks. The v1 single-role model is the prerequisite for this — once we know which actions are used most, we can scope them. The `super_admin` role in v1 is a **distinct value** (not a scoped sub-role); it's the platform owner and has the same visibility as `admin` in v1.
2. **Dual-control (two-person rule)** for high-value actions:
   - Payouts > $5K: two admins must approve, with a typed confirmation from each
   - Permanent bans: two admins
   - DMCA counter-notice restorations: two admins
   - `update_role` actions: two admins (replaces the v1 typed-confirmation gate)
3. **Per-admin action quotas** (e.g. "admin A can approve max 20 submissions/day"). v1 has the global rate limits above; per-admin quotas are a v2 control.
4. **Admin action "step-up" auth** (re-prompt for password / re-confirm TOTP for high-value actions). v1 relies on the session timeout (4 hours) and the typed-confirmation gate. v2 adds re-auth on demand.
5. **Anomaly detection on the audit log** (e.g. "this admin triggered 10 manual payouts in 1 hour, is that normal?"). v1 is human-reviewed weekly. v2 adds automated anomaly detection via the `04-platform/observability/` stack.
6. **Customer-initiated admin actions** (e.g. "user clicks 'I want to talk to a human' → creates a `support_tickets` table"). v1 has no `support_tickets` table; support is via email. v2 adds the in-app ticketing system.
7. **Scoped `super_admin` actions.** In v1, `super_admin` has the same visibility as `admin`. v2 scopes the most-destructive actions (force handle change, force feature on partner's shop, manual ledger reversal) to `super_admin` only, with a half-step toward dual-control for those actions.
8. **GDPR vs 7-year-ledger reconciliation ADR.** The `admin-customer-detail.md` Open Questions §2 calls out the conflict between GDPR Article 17 (right to deletion) and the 7-year retention requirement for financial records (IRS 1099 / 1099-K). v1's policy is "the deletion request is a review workflow, not an immediate action; financial records survive even after a 'full deletion' is approved." The v1 policy is informal; v2 needs an ADR codifying the legal basis, the workflow, the redaction rules, and the appeals path. This is a structural ADR candidate; flag for human review at v2 kickoff.

## Consequences

### Positive

- **Ships in v1.** No migration for sub-roles, no migration for dual-control, no migration for `pending_role_changes`. The 10 new tables in ADR-0007 are the v1 schema scope; admin RBAC is not on that list.
- **Single pattern for RLS policies.** Every admin-gated table uses the same `exists (... role = 'admin')` predicate. Easy to grep, easy to review.
- **Audit log is comprehensive from day 1.** When v2 introduces sub-roles, we have a year of audit data to mine for "which actions does the support team actually do?"
- **MFA + rate limits + typed confirmation are the v1 safety net.** A compromised admin still has to bypass MFA. A careless admin still has to type `BAN` and a 20-char reason. The audit log catches both after the fact.
- **The ban/suspend state machine is explicit.** No "what does suspended mean?" ambiguity in the spec or the code.

### Negative

- **A compromised admin account = full access.** No second pair of eyes. This is the v1 risk we accept; the mitigation is MFA + audit + human review.
- **A single admin (the v1 launch scenario) is a single point of failure.** If the admin is unavailable, the moderation queue grows. v2 adds the second admin and dual-control.
- **The ban/suspend state machine is partially in the data model** (the `profiles.status` enum needs a new value, plus the suspended/banned columns on `profiles`). This is an additive migration that lands alongside the admin-people specs in round 2.
- **The "what the admin cannot do" list (no delete user, no edit ledger, no view plaintext tokens) is enforced at the server action layer, not the DB.** A forgotten check = a bug. The mitigation is the pre-merge security checklist in `06-quality/checklists/pre-merge.md` and the per-action Vitest test.
- **Audit log review is a human task.** A weekly review is fine for v1 volume (one or two admins, hundreds of actions/week). At 50K MAU and a 5-person admin team, we need automated anomaly detection (v2).

### Mitigations

- **Pre-merge checklist** (`06-quality/checklists/pre-merge.md`) has a "Security" section that requires: (a) every new admin server action to log to `admin_audit_log`, (b) every admin RLS policy to use the standard `exists (... role = 'admin')` predicate, (c) no plaintext in the URL or the response.
- **Vitest tests** for every admin server action: assert the audit log row was written, with the right shape.
- **Weekly human review** of the audit log, documented in `05-ops/runbooks/admin-audit-review.md`. The review is short (30 min) at v1 volume.
- **MFA enforcement** is a Supabase project-level config, not per-user. An admin cannot "opt out" of MFA. The config is in `04-platform/auth/supabase-config.md`.
- **The admin app is a separate route prefix** (`/admin/*`). The middleware at `00-foundations/auth/admin-middleware.ts` checks the role on every request, redirects non-admins to `/404` (we use 404 to avoid leaking the existence of the admin area). This is the same pattern as the existing `/partner/*` and `/affiliate/*` route guards.
- **The "data-model" consequence is documented.** The follow-up migration that adds the ban/suspend columns on `profiles` is part of the admin-people spec track in round 2. This ADR is the canonical source for the state machine.

## References

- The RLS multi-tenancy ADR (the predicate pattern this builds on): `01-specs/decisions/0004-rls-multi-tenancy.md`
- The append-only payout ledger ADR (the "admin cannot edit the ledger" rule): `01-specs/decisions/0005-append-only-payout-ledger.md`
- The companion "new tables" ADR (the v1 schema scope, including the polymorphic `admin_audit_log` and the `super_admin` role): `01-specs/decisions/0007-new-tables-for-v1.md`
- The data model (`profiles`, `partners`, `affiliates` status fields, the `admin_audit_log` polymorphic-actor columns): `01-specs/pages/_data-model.md`
- The spec files that codify admin actions:
  - `admin-review.md` (approve / reject submission; rate limits; SLA)
  - `admin-payouts.md` (manual batch trigger; typed confirmation; refund approval)
  - `admin-reports.md` (report resolution queue; `reports` table; the SLA on the queue)
  - `admin-settings.md` (`platform_settings` writer; secret-keys allowlist)
  - `admin-categories.md` (`categories_admin_all` RLS policy; product-count trigger)
  - `admin-customers.md` (risk score formula; `risk_signals`; `profiles.warnings_count`)
  - `admin-analytics.md` (planned; admin-only analytics queries)
  - `dmca.md` (takedown lifecycle; `dmca_takedowns`; `counter_notice_deadline` cron)
  - `admin-customer-detail.md` (the ban/suspend state machine; GDPR-vs-7-year-ledger escalation)
  - `admin-partner-detail.md` (partner suspend / ban; `partner_admin_notes`; KYC + tax column extensions)
  - `admin-affiliate-detail.md` (affiliate suspend / ban; `affiliate_admin_notes`; `affiliate_curated_products`; `handle_cool_off`; `super_admin` role for force-handle-change)
  - `admin-partner-detail.md`, `admin-affiliate-detail.md` (force feature on partner's shop; `affiliate_curated_products` partial unique)
  - `partner-courses-detail.md` (sales summary; `product_sales_daily` view; `reviews.flagged_*`; `payout_ledger.paused_product_takedown`)
  - `partner-courses-sales.md` (partner-side sales read; service-role masking; `product_sales_daily` view)
  - `partner-settings-api.md` (api_tokens; the polymorphic audit-log proposal; HMAC-pepper token hashing)
- The audit log table: `01-specs/pages/_data-model.md` (`admin_audit_log`)
- The pre-merge security checklist: `06-quality/checklists/pre-merge.md`
- The audit review runbook (to be written): `05-ops/runbooks/admin-audit-review.md`
- The Supabase MFA config (to be written): `04-platform/auth/supabase-config.md`
