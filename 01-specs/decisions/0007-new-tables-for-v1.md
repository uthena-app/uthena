# ADR-0007: New tables for v1 (round 2 of spec writing)

**Date:** 2026-06-12
**Status:** Accepted
**Deciders:** Human, platform agent
**Supersedes:** none
**Superseded by:** none

## Context

When the v1 data model was first drafted (see `01-specs/pages/_data-model.md` and the existing six ADRs), it covered the **core commerce, content, and engagement** flows: products, orders, library grants, progress, reviews, payouts, and the partner/affiliate scaffolding. The model was opinionated and complete for the marketplace's "buy a course, watch it, get a payout" spine.

Round 2 of spec writing covered the **user-facing account flows, the admin moderation tools, and the partner/affiliate onboarding wizards**. As we wrote those page specs, ten new tables surfaced as required for v1 — they were not "nice to have" or "v2 follow-ups"; they were structural to the flows the spec body required.

This ADR documents the decision to add all ten tables to the v1 schema, and the consequences for the migration plan, the RLS policy surface, the data-model doc, and the team workflows. We considered the alternative (defer some to v2) and rejected it: each table is load-bearing for a feature the v1 spec promises.

### Why now

The page specs being written in round 2 reference entities that don't exist in the v1 schema. For example:

- `cart.md` references a `cart_items` table (auth-only; anon lives in a cookie)
- `partner-onboarding.md` and `affiliate-onboarding.md` reference wizard-state tables (`partner_onboarding_drafts`, `affiliate_onboarding_drafts`)
- `affiliate-onboarding.md` also needs `handle_reservations` for race-safe handle uniqueness during the wizard
- `account-certificates.md` and `library.md` (reconciliation) both need a `certificates` table
- `account-settings.md` needs `notification_preferences`
- `admin-reports.md` needs `reports`
- `admin-settings.md` and `dmca.md` both need `platform_settings` (the same table serves both — public_read keys are how DMCA agent contact is exposed; admin-only keys are how `/admin/settings` exposes fee percentages, maintenance mode, etc.)
- `partner-settings-api.md` needs `api_tokens`
- `dmca.md` needs `dmca_takedowns`
- `admin-partner-detail.md`, `admin-affiliate-detail.md`, `admin-customer-detail.md` need `partner_admin_notes`, `affiliate_admin_notes`, `customer_admin_notes` (one per target; admin-only; edit-by-author for 24h)
- `admin-customers.md` (risk score) needs `risk_signals` and a denormalized `profiles.warnings_count`
- `affiliate-shop.md` and `admin-affiliate-detail.md` need `affiliate_curated_products` (the affiliate's mini-shop curation; partial unique on `(affiliate_id) where is_featured=true` for "at most one featured")
- `admin-affiliate-detail.md` (force-handle-change recovery) needs `handle_cool_off` (30-day block on the freed handle)

For each, the page spec's `Open Questions` section either proposed the schema in a SQL block or explicitly flagged "this table is not in `_data-model.md` yet." The data-model doc is the source of truth, so the tables need to land there before the page specs can move from "spec" to "implementation."

## Considered options

### Option A: Add all 10 to v1 (this ADR's decision)

- **Pros:** Every spec's "what this page does" is implementable as-written. The data model matches the product. No spec has to compromise to fit a smaller v1 schema.
- **Cons:** Schema is ~50% larger than the original v1 scope. More migrations to write, test, and ship. More RLS policies to maintain.

### Option B: Defer 4–6 tables to v2

- **Pros:** v1 ships with a tighter schema. Fewer migrations. Less test surface.
- **Cons:** **The affected features don't work in v1.** The cart, the onboarding wizards, certificates, notifications, the admin moderation tools, the partner API, and DMCA all become "v2 follow-up" features — which means the v1 launch has neither onboarding nor moderation, and the launch is a catalog with no way to buy or moderate it. Not a viable product.

### Option C: Hybrid — keep some in v1, defer others

- **Pros:** Pick the 4–5 tables that block launch-critical flows, defer the rest.
- **Cons:** The "non-launch-critical" tables are exactly the ones that make the platform operable in production: admin moderation (`reports`), admin config (`platform_settings`), API for power partners (`api_tokens`), DMCA compliance (`dmca_takedowns`). Without these, we'd have to ship under human-only moderation (one admin in a queue), no remote-config lever, no partner API, and an unaudited DMCA process. None of those are acceptable for a real-money, real-content platform. We'd be deferring the things that make the platform safe to run.

## Decision

**Add all 10 tables to the v1 schema.** The tables, with a one-line rationale each, are:

| # | Table | Rationale |
|---|---|---|
| 1 | `cart_items` | Persistent cart for authed users. The anon cart lives in a signed cookie (`cart_session`); on sign-in we merge into this table. Without it, the "Add to cart" → "checkout" flow has no persistence between page loads. |
| 2 | `partner_onboarding_drafts` | Wizard state for the partner application. Per-step `jsonb` payloads let each step validate independently. Without it, the partner onboarding flow has no place to put incremental state — every page reload loses the user's progress. |
| 3 | `affiliate_onboarding_drafts` | Same pattern, six steps (no tax/kyc for affiliates in v1). |
| 4 | `handle_reservations` | Race-safe handle uniqueness during the affiliate wizard. The 7-day TTL is enforced by a janitor cron. Without it, two affiliates could both pick the same handle in flight (race) and one would lose at submit time with a confusing error. |
| 5 | `certificates` | Issued on course completion. Two identifiers coexist on purpose: `id` (internal, bigint) for `/account/certificates` and the library page; `certificate_code` (8-char base-32) for the public `/verify/[code]` page. The 33-bit code space is plenty at our scale. |
| 6 | `notification_preferences` | Per-account email/notification settings. Locale/timezone stay on `profiles` (no schema change). The per-list opt-in toggles cover v1; a "master marketing opt-in" switch is a v2 follow-up. |
| 7 | `reports` | User-submitted content reports feed the admin moderation queue. Polymorphic `target_table` + `target_id` (Postgres doesn't enforce cross-table FK for this). Authed reporters only in v1; the column is nullable for v2 anon. Scope is `('product', 'review')` in v1; affiliate / partner reports come in v2 (the enum doesn't need a v2 migration). |
| 8 | `platform_settings` | Global config (fees, feature flags, maintenance mode, **and the DMCA agent contact**). Admin-only read + write by default; the `public_read` opt-in column is how `/dmca` renders the agent contact publicly. The same table serves `/admin/settings` and the public DMCA page — one table, one migration. |
| 9 | `api_tokens` | Partner API tokens. Plaintext is shown once at creation; only `hmac_sha256(pepper, plaintext)` is stored (HMAC-pepper approach per `partner-settings-api.md` Open Questions §"Token hashing approach" Option B). Column-level GRANT strips `token_hash` from non-service roles. |
| 10 | `dmca_takedowns` | DMCA notice log. `notice_body jsonb` holds the 6 required elements per 17 USC §512(c)(3). Admin-only RLS; partner visibility goes through a server action with explicit `product.partner_id` filtering, not via direct RLS on this table. The `counter_notice_deadline` column is the SQL-truth source for the 14-day window. |

**Plus 8 additional tables and 1 materialized view that surfaced in the second round of spec writing** (consolidated here as a single decision — the alternative would be to fragment the rationale across multiple ADRs, which is more confusing than one ADR that documents the full set):

| # | Table | Rationale |
|---|---|---|
| 11 | `partner_admin_notes` | Internal admin notes on a partner. Edit-by-author for 24h, then read-only; soft-delete via `deleted_at`. Reusing `admin_audit_log` is wrong because the audit log is append-only and notes are not. (Per `admin-partner-detail.md` Open Questions §3.) |
| 12 | `affiliate_admin_notes` | Same shape, `affiliate_id` instead of `partner_id`. (Per `admin-affiliate-detail.md` Open Questions §5.) |
| 13 | `customer_admin_notes` | Same shape, `customer_id` (= `auth.users.id`) instead of `partner_id`. (Per `admin-customer-detail.md` Open Questions §3.) |
| 14 | `risk_signals` | Source data for the customer risk score (0-100). The score is `min(40, refund_count*8) + min(40, dispute_count*20) + min(20, sum of signal_severity)`. v1 is a deterministic formula; ML-based scoring is v2. (Per `admin-customers.md` Open Questions §3.) |
| 15 | `affiliate_curated_products` | The affiliate's mini-shop curation. Per `affiliate-shop.md` and `admin-affiliate-detail.md` OQs, this is a separate table (not a jsonb on `affiliates`) because the partial unique index `(affiliate_id) where is_featured=true` enforces "at most one featured" at the DB level. |
| 16 | `handle_cool_off` | 30-day block on a handle after an admin force-handle-change. Distinct from `handle_reservations` (which is for in-flight wizards); this is the post-recovery security backstop. (Per `admin-affiliate-detail.md` Open Questions §6.) |
| 17 (view) | `product_sales_daily` (materialized view) | The partner-courses-sales tab reads from this view (per `partner-courses-sales.md` OQ §"Materialized view for sales summary"). Refreshed nightly + on order/refund write. Replaces per-page `count(*)` aggregates that wouldn't scale past 10K orders. |
| 18 (alter) | `affiliate_links` extensions | `active`, `last_clicked_at`, `disabled_at`, `deleted_at` columns (per `admin-affiliate-detail.md` OQ §3 and `affiliate-links.md` OQ §1). The four columns look redundant but aren't — each captures a different actor / state. |
| 19 (alter) | `profiles` extensions | `status` enum (active/suspended/banned) + suspended/banned timestamps + `warnings_count` (per `admin-customers.md` OQ §2 and ADR-0008). The ban/suspend state machine is the same across all user types. |
| 20 (alter) | `partners` extensions | `status` enum gains `'banned'`; KYC columns (`kyc_reviewed_at`, `kyc_reviewed_by`, `kyc_rejection_reason`, `gov_id_front_storage_path`, `gov_id_back_storage_path`); tax columns (`tax_country`, `tax_id_encrypted`, `tax_form_storage_path`) (per `admin-partner-detail.md` OQ §2 and `partner-settings.md` OQ). |
| 21 (alter) | `affiliates` extensions | `status` enum gains `'banned'`. KYC is v2 (no schema change in v1). |
| 22 (alter) | `reviews` extensions | `flagged_reason`, `flagged_by_user_id`, `flagged_at` columns (per `partner-courses-detail.md` OQ). The partner's "flag for admin review" action writes here. |
| 23 (alter) | `payout_ledger` extensions | `ledger_status` enum gains `'paused_product_takedown'` (per `partner-courses-detail.md` OQ §"Payout pause on unpublish"). Auto-clawback after 30d is v2. |
| 24 (alter) | `admin_audit_log` extensions | Polymorphic actor: nullable `admin_id` + new nullable `partner_id` + new `system_source` text column (per ADR-0008). One table serves admin-initiated, partner-initiated, and system-initiated audit writes. |

**Net v1 schema scope: 16 new tables + 1 materialized view + 7 additive `ALTER TABLE` migrations.**

### Migration ordering

The migrations land in this order. Some tables reference others; the order avoids forward-references. (The exact file numbers will be assigned by the platform agent at PR time; this is the conceptual order.)

1. **`profiles` extensions** — adds `status`, suspend/ban columns, `warnings_count`; extends the `role` check to include `'super_admin'`. The `super_admin` role is platform-owner-only in v1 (no scoped sub-roles); see ADR-0008.
2. **`partners` extensions** — `status` enum gains `'banned'`; KYC + tax columns. No other table depends on these.
3. **`affiliates` extensions** — `status` enum gains `'banned'`.
4. **`reviews` extensions** — `flagged_*` columns.
5. **`affiliate_links` extensions** — `active`, `last_clicked_at`, `disabled_at`, `deleted_at`.
6. **`payout_ledger` extensions** — `ledger_status` enum gains `'paused_product_takedown'`.
7. **`admin_audit_log` extensions** — polymorphic actor columns + check constraint.
8. **`product_sales_daily` (materialized view)** — depends on `orders`, `order_items`, `refunds`, `products`.
9. **`notification_preferences`** — depends on `auth.users`. Standalone.
10. **`cart_items`** — depends on `auth.users`, `products`, `product_pricing` (via the `license_tier` enum).
11. **`partner_onboarding_drafts`** — depends on `auth.users`. Standalone. Includes the `partner_onboarding_step` enum.
12. **`affiliate_onboarding_drafts`** — depends on `auth.users`. Standalone. Includes the `affiliate_onboarding_step` enum.
13. **`handle_reservations`** — depends on `affiliate_onboarding_drafts` (FK on `draft_id`).
14. **`handle_cool_off`** — depends on `affiliates` and `auth.users`. Standalone otherwise.
15. **`certificates`** — depends on `auth.users`, `products`, `partners` (denormalized `partner_id`). Includes the `certificate_status` enum.
16. **`reports`** — depends on `auth.users` (the reporter). No FK to target tables (polymorphic). Includes the `report_kind`, `report_reason`, `report_status` enums.
17. **`platform_settings`** — no FK. Standalone.
18. **`api_tokens`** — depends on `partners`. Includes `api_token_scope`, `api_token_status` enums + the column-level `REVOKE` on `token_hash`.
19. **`dmca_takedowns`** — depends on `products` (`on delete restrict`, never cascade). Includes the `dmca_takedown_status` enum.
20. **`partner_admin_notes`** — depends on `partners`, `auth.users`. Standalone otherwise.
21. **`affiliate_admin_notes`** — depends on `affiliates`, `auth.users`. Standalone otherwise.
22. **`customer_admin_notes`** — depends on `auth.users`. Standalone.
23. **`risk_signals`** — depends on `auth.users`. Includes the `risk_signal_type` enum. Standalone otherwise.
24. **`affiliate_curated_products`** — depends on `affiliates`, `products`. Standalone otherwise. The partial unique on `(affiliate_id) where is_featured=true` is part of the same migration.
25. **Additive RLS policies** (no table changes) — `categories_admin_all`, `reviews_partner_read_own_product`, `affiliate_commissions_admin_all`, the explicit RLS for `product_modules` / `product_lessons` / `product_pricing` / `product_assets` (was "inherits from product" — now explicit). One or more migration files; could be one big one or split per-table.

The numbers above assume the prior migrations are `0001_initial.sql` through `0008_*.sql`. The actual numbers will be assigned by the platform agent at PR time (per the rules in `04-platform/migrations/README.md`: never reuse, never edit, applied-in-order).

### What we deliberately did NOT add (deferred to v2)

- **No `marketing_opt_in` master switch** on `notification_preferences` (the spec `account-settings.md` proposed it as a GDPR-friendly "unsubscribe from all marketing" kill-switch). The per-list opt-ins cover v1; a single master switch is a v2 follow-up. See `01-specs/pages/_data-model.md` "What we deliberately DON'T do" for the entry.
- **No anonymous reports** in v1 — `reports.reporter_user_id` is nullable for forward-compat, but v1 enforces authed reporters in the server action. Anon + CAPTCHA is v2.
- **No affiliate or partner reports** in v1 — `reports.kind` is `('product', 'review')`. Reports against affiliates and partners are v2 (the `target_table` is open to extension).
- **No KYC data** in `partner_onboarding_drafts.kyc` in v1 — the column exists, the wizard skips the step. Gov ID is collected at first payout over the threshold in v2.
- **No cart `quantity`** in `cart_items` — one row per `(user, product, tier)`. The PLR reseller who wants 5 copies is a v2 follow-up.
- **No sub-admin / moderator role** in v1 — see ADR-0008 (the only role extension in v1 is `super_admin` for the platform owner, which is a distinct role, not a scoped sub-role).
- **No dual-control (two-person rule)** on admin actions in v1 — see ADR-0008.
- **No auto-clawback of `paused_product_takedown` ledger entries.** The 30-day timeout that flips `paused` → `clawback` is v2.
- **No unified `admin_notes` table.** v1 has three per-target tables (`partner_admin_notes`, `affiliate_admin_notes`, `customer_admin_notes`) with identical schemas. Consolidation is a v2 housekeeping task.
- **No ML-based risk scoring.** v1 uses a deterministic formula over `risk_signals`. ML is v2.
- **No KYC on affiliates in v1.** `affiliates.kyc_status` column doesn't exist; KYC collection for affiliates is v2 (triggered by the first payout over the reporting threshold).

## Consequences

### Positive

- **Every spec in round 2 is implementable as written.** No "we'll fake this in the UI for v1" patches, no "v2 will add a real X." The schemas match the spec bodies.
- **One place to look for the schema.** `_data-model.md` is the single source of truth; the page specs link to it; the migrations land against it. No "drafted in the spec, finalized in code" drift.
- **Future migrations are smaller.** v2's "add sub-admin role" or "add cart quantity" is a small additive change against an existing table, not a from-scratch design.
- **Tests are colocated with the schema.** Every new table's RLS policies get tests in `06-quality/tests/integration/rls.test.ts` as part of the migration PR.
- **Cross-spec consistency.** The same `platform_settings` table serves `/admin/settings` and the public DMCA page. The same `admin_audit_log` serves admin, partner, and system actors. The same `profiles.status` enum serves customers, partners, and affiliates. **One table per concept, no duplication.**

### Negative

- **Schema is ~2× larger** than the original v1 scope. From ~17 tables to ~33 tables + 1 materialized view. The RLS test matrix grows by ~50 policies.
- **Migration sequence is longer.** 24+ new migrations (16 new tables + 1 view + 7 additive `ALTER TABLE`s), each with its own PR, its own CI run, its own deploy. The "strictly sequential migrations" rule in `04-platform/migrations/README.md` means we can't parallelize the work.
- **Janitor jobs needed.** `handle_reservations` (7-day TTL), `handle_cool_off` (30-day TTL), `partner_onboarding_drafts` + `affiliate_onboarding_drafts` (90-day post-submit retention), `dmca_takedowns` 14-day counter-notice window, `affiliate_links.deleted_at` 7-day trash, `api_tokens` expiry — six new scheduled jobs in the platform.
- **Some tables are forward-compat-only.** `reports.reporter_user_id` is nullable (for v2 anon). `partner_onboarding_drafts.kyc` column exists (for v2 KYC). `payout_ledger.status='paused_product_takedown'` exists (for v2 auto-clawback). `product_sales_daily` is a materialized view (it could have been a table; the view is the cleaner choice because it's derived).
- **The data model doc grew from 814 lines to ~1800 lines.** Still scannable with the table index, still organized by section. If it grows past ~2500 lines in v2, we split into `_data-model-core.md` and `_data-model-extras.md` (deferred decision).

### Mitigations

- **One PR per migration** (per the rule in `04-platform/migrations/README.md`). The 24+ migrations ship in 24+ PRs, not 1 mega-PR. Each is reviewed by the platform agent + a second reviewer.
- **RLS test matrix is automated.** Every new policy gets a row in `06-quality/tests/integration/rls.test.ts`. CI catches missing policies before merge.
- **Janitor jobs are templated.** `04-platform/ci/scripts/cron/` has the pattern (a single Node script that runs on Coolify's scheduler). Six new jobs is overhead, not a new system.
- **The "When you add a table" checklist** in `_data-model.md` now includes writing an ADR for non-trivial additions. This ADR is the first fruit of that rule.
- **Additive `ALTER TABLE` migrations preserve history.** The original `profiles`, `partners`, etc. SQL blocks are unchanged; the extensions are documented under "Schema extensions for v1" with the migration code in a separate `ALTER` block. Reviewers can diff just the extensions.

## References

- The extended data model: `01-specs/pages/_data-model.md` (now ~1800 lines)
- The migration rules: `04-platform/migrations/README.md`
- The existing RLS multi-tenancy ADR: `01-specs/decisions/0004-rls-multi-tenancy.md`
- The admin RBAC ADR (companion): `01-specs/decisions/0008-admin-area-rbac.md`
- The spec files that proposed these tables:
  - `cart.md` (cart_items)
  - `partner-onboarding.md` (partner_onboarding_drafts)
  - `affiliate-onboarding.md` (affiliate_onboarding_drafts, handle_reservations)
  - `account-certificates.md` + `library.md` (certificates)
  - `account-settings.md` (notification_preferences)
  - `admin-reports.md` (reports)
  - `admin-settings.md` (platform_settings)
  - `dmca.md` (dmca_takedowns, public_read opt-in)
  - `partner-settings-api.md` (api_tokens)
  - `admin-partner-detail.md` (partner_admin_notes, partners KYC/tax extensions)
  - `admin-affiliate-detail.md` (affiliate_admin_notes, affiliate_curated_products, handle_cool_off, affiliate_links extensions, super_admin role)
  - `admin-customer-detail.md` (customer_admin_notes, profiles.status ban/suspend state machine, GDPR-vs-7-year-ledger candidate ADR)
  - `admin-customers.md` (risk_signals, profiles.warnings_count)
  - `affiliate-shop.md` (affiliate_curated_products)
  - `affiliate-links.md` (affiliate_links.disabled_at + deleted_at)
  - `partner-courses-detail.md` (product_sales_daily view, reviews.flagged_*, payout_ledger.paused_product_takedown)
  - `partner-courses-sales.md` (product_sales_daily view)
  - `partner-settings.md` (partners.tax_country, tax_id_encrypted, tax_form_storage_path)
  - `admin-categories.md` (categories_admin_all RLS policy)
