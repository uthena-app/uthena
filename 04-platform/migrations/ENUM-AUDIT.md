# ENUM Audit — every Postgres ENUM + CHECK-constraint-as-enum

> **Read this once before adding any new enum value.** Every Postgres
> `CREATE TYPE ... AS ENUM` and every text column with a `CHECK (... IN
> (...))` constraint is mirrored in `00-foundations/data/enums.ts`. The
> two MUST stay in lockstep. The `04-platform/ci/scripts/check-enum-
> coverage.sh` script enforces this on every CI run.
>
> **When to update this file.** Add a new row when:
> 1. You create a new `CREATE TYPE ... AS ENUM` in a migration.
> 2. You `ALTER TYPE ... ADD VALUE` to an existing enum.
> 3. You add a new `CHECK (col IN (...))` to a text column.
> 4. You add a new value to an existing CHECK constraint.
>
> The check script will fail the build if any value is missing.

---

## Deprecation strategy (the policy)

**The rule: never drop an enum value.** Postgres does not support
`ALTER TYPE ... DROP VALUE` until Postgres 12, and even then it's a
non-reversible change that breaks any consumer (read replica, PostgREST
schema cache, ETL pipeline) that has the old value in flight.

**The escalation policy:**

1. **Stop using the value at the application layer.** Update every
   `WHERE col = '<value>'` query, every form, every dropdown, every
   server action to treat the value as "do not use." Filter in the
   query, not in the DB:

   ```sql
   -- DO NOT delete the value. DO NOT add a sentinel.
   -- Just stop USING it. Filter at read time so it never surfaces.
   select * from products
   where status = 'published'   -- never 'unpublished' on the storefront
     and kind in ('video_course', 'ebook', 'template_pack',
                  'audio_course', 'bundle', 'asset_pack')
     -- 'video_course_v2' is the deprecated value; we filter it out
     -- here even though the column still accepts it on write.
   ```

2. **Add a sentinel value ONLY if you need to distinguish "deprecated
   intentionally" from "deprecated accidentally."** The sentinel is a
   NEW value (e.g. `legacy_video_course`), not a rename of the old one.
   Keep the old value untouched in the column; only the application
   reads/writes the sentinel.

3. **Document the deprecation in `STUBS.md`** with the replacement
   plan + the target removal version (e.g. "deferred to v3, removing
   in Q4 2027 once PostgREST schema caches flush across all regions").

4. **NEVER drop the value.** Even after every consumer stops using it,
   the value stays in the type. This protects:
   - Read replicas that lag the primary.
   - PostgREST's schema cache (1-minute TTL by default; some pipelines
     cache longer).
   - ETL / analytics queries that read historical rows.
   - Downstream services that joined on the value's literal.

5. **For TEXT columns with CHECK constraints** (the enums-by-example):
   the rule is the same. Edit the CHECK constraint to add the new
   values, never to remove the old ones. A migration that removes a
   value from a CHECK constraint is rejected at review.

**Adding values is the only mutation allowed.** `ALTER TYPE ... ADD
VALUE` (with `IF NOT EXISTS` for idempotency) is forward-only. It
becomes effectively immutable after the transaction commits in
Postgres < 12 (no `DROP VALUE`); in Postgres ≥ 12 you can drop a value
but the policy is still "don't."

**How this matches AGENTS.md.** "No destructive migrations" is the
project-wide rule. The enum deprecation strategy is the typed
extension of that rule. Forward-only, additive, never destructive.

---

## Inventory — Postgres ENUM types (CREATE TYPE ... AS ENUM)

Every Postgres `CREATE TYPE X AS ENUM (...)` in
`04-platform/migrations/*.sql`. The "TS source" column is the
canonical TypeScript counterpart in `00-foundations/data/enums.ts`;
"Runtime array" is the `as const satisfies` array that the check
script reads.

| Postgres type | Values | Migration | TS source | Runtime array |
|---|---|---|---|---|
| `user_role` | `customer`, `partner`, `affiliate`, `admin`, `super_admin` | 0001 | `UserRole` | `USER_ROLES` ✓ |
| `user_status` | `active`, `suspended`, `banned` | 0001 | `UserStatus` | `USER_STATUSES` ✓ |
| `partner_status` | `pending`, `approved`, `suspended` | 0001 | `PartnerStatus` | `PARTNER_STATUSES` ✓ |
| `product_kind` | `video_course`, `ebook`, `template_pack`, `audio_course`, `bundle`, `asset_pack` | 0001 | `ProductKind` | `PRODUCT_KINDS` ✓ |
| `product_status` | `draft`, `in_review`, `published`, `unpublished`, `archived` | 0001 | `ProductStatus` | `PRODUCT_STATUSES` ✓ |
| `file_kind` | `video`, `slides`, `transcript`, `graphics`, `audio`, `document`, `archive`, `other` | 0001 | `FileKind` | `FILE_KINDS` ✓ |
| `scan_status` | `pending`, `clean`, `infected`, `failed` | 0001 | `ScanStatus` | `SCAN_STATUSES` ✓ |
| `encoding_status` | `pending`, `processing`, `ready`, `failed` | 0001 | `EncodingStatus` | `ENCODING_STATUSES` ✓ |
| `license_type` | `plr`, `mrr`, `rr`, `personal` | 0001 | `LicenseTier` | `LICENSE_TIERS` ✓ |
| `order_status` | `pending`, `awaiting_payment`, `paid`, `fulfilled`, `refunded`, `partially_refunded`, `failed`, `canceled`, `fraudulent` | 0001 | `OrderStatus` | `ORDER_STATUSES` ✓ |
| `refund_status` | `pending`, `succeeded`, `failed`, `canceled`, `approved` (+0059) | 0001, 0059 | `RefundStatus` | `REFUND_STATUSES` ✓ |
| `cart_status` | `active`, `converted`, `abandoned`, `expired` | 0001 | `CartStatus` | `CART_STATUSES` ✓ |
| `payout_ledger_kind` | `order_sale`, `subscription`, `refund`, `adjustment`, `payout`, `clawback` | 0001 | `PayoutLedgerKind` | `PAYOUT_LEDGER_KINDS` ✓ |
| `payout_ledger_status` | `accruing`, `pending_payout`, `paid`, `void`, `locked` (+0005), `available` (+0005) | 0001, 0005 | `PayoutLedgerStatus` | `PAYOUT_LEDGER_STATUSES` ✓ |
| `subscription_status` | `incomplete`, `incomplete_expired`, `trialing`, `active`, `past_due`, `canceled`, `unpaid`, `paused` | 0002 | `SubscriptionStatus` | `SUBSCRIPTION_STATUSES` ✓ |

**Total: 15 Postgres ENUM types.** All mirrored in `enums.ts` with a
runtime array (the check script reads the array).

### ALTER TYPE ADD VALUE history

Forward-only adds (the only mutation allowed by the policy):

| Date | Migration | Type | New values |
|---|---|---|---|
| (initial) | 0005_payout_ledger_lock_columns | `payout_ledger_status` | `locked`, `available` (added by the PH08 release-locked-balances cron + the locked_until / available_at columns) |

That's it — one `ALTER TYPE ADD VALUE` in the project's history. The
check script asserts the 6th and 7th values are present in
`PAYOUT_LEDGER_STATUSES`.

---

## Inventory — text columns with CHECK constraints (enums-by-example)

Every `CHECK (col IN (...))` constraint on a text column in
`04-platform/migrations/*.sql`. The check script reads the
constraint's value list from the migration file and asserts the
matching TS enum in `enums.ts` has every value + the runtime array.

| Table | Column | Values | Migration(s) | TS source | Runtime array |
|---|---|---|---|---|---|
| `partners` | `tax_form_status` | `none`, `pending`, `submitted`, `approved` | 0001 | `PartnerTaxFormStatus` | `PARTNER_TAX_FORM_STATUSES` ✓ |
| `partners` | `kyc_status` | `none`, `pending`, `approved`, `rejected` | 0001 | `PartnerKycStatus` | `PARTNER_KYC_STATUSES` ✓ |
| `affiliates` | `status` | `pending`, `approved`, `suspended` | 0001 | `AffiliateStatus` | `AFFILIATE_STATUSES` ✓ |
| `library_grants` | `source` | `purchase`, `subscription`, `admin_grant`, `free_promo` | 0001 | `LibraryGrantSource` | `LIBRARY_GRANT_SOURCES` ✓ |
| `file_downloads` | `kind` | `download`, `stream` | 0001 | `FileDownloadKind` | `FILE_DOWNLOAD_KINDS` ✓ |
| `webhooks` | `source` | `stripe`, `paypal`, `bunny`, `ses`, `clerk`, `supabase` | 0001 | `WebhookSource` | `WEBHOOK_SOURCES` ✓ |
| `webhooks` | `result` | `processed`, `skipped`, `failed` | 0001 | `WebhookResult` | `WEBHOOK_RESULTS` ✓ |
| `risk_signals` | `severity` | `info`, `warn`, `block` | 0001 | `RiskSignalSeverity` | `RISK_SIGNAL_SEVERITIES` ✓ |
| `content_moderation` | `target_kind` | `product`, `review`, `user`, `comment` | 0001 | `ModerationTargetKind` | `MODERATION_TARGET_KINDS` ✓ |
| `content_moderation` | `status` | `open`, `reviewing`, `actioned`, `dismissed` | 0001 | `ModerationStatus` | `MODERATION_STATUSES` ✓ |
| `reports` | `reason` | `copyright`, `spam`, `fraud`, `harassment`, `illegal`, `other` | 0001 | `ModerationReason` | `MODERATION_REASONS` ✓ |
| `dmca` | `target_kind` | `product`, `product_file`, `review` | 0001 | `DmcaTargetKind` | `DMCA_TARGET_KINDS` ✓ |
| `dmca` | `status` | `received`, `acknowledged`, `product_removed`, `counter_notice_filed`, `restored`, `rejected`, `court_action` | 0001 | `DmcaStatus` | `DMCA_STATUSES` ✓ |
| `reviews` | `status` | `pending`, `published`, `hidden`, `flagged` | 0001 | `ReviewStatus` | `REVIEW_STATUSES` ✓ |
| `product_images` | `kind` | `gallery`, `preview_video_thumb` | 0012 | `ProductImageKind` | `PRODUCT_IMAGE_KINDS` ✓ |
| `collections` | `status` | `draft`, `published`, `archived` | 0015 | `CollectionStatus` | `COLLECTION_STATUSES` ✓ |
| `auth_failed_attempts` | `kind` | `signin`, `signup`, `reset_password`, `update_password`, `email_verification`, `oauth_signin`, `oauth_callback` | 0017 (+ 0018, 0019, 0020, 0022) | `AuthFailureKind` | `AUTH_FAILURE_KINDS` ✓ |
| `auth_failed_attempts` | `reason` | `invalid_credentials`, `rate_limited`, `email_not_verified`, `unknown_user`, `malformed_input`, `server_error`, `success` | 0017 (+ 0022) | `AuthFailureReason` | `AUTH_FAILURE_REASONS` ✓ |
| `partner_uploads` | `failure_kind` | `network`, `aborted`, `rejected`, `oversized`, `unscanned`, `other` | 0041 | `FailureKind` | `FAILURE_KINDS` ✓ |

**Total: 19 text columns with CHECK constraints.** All mirrored in
`enums.ts` with a runtime array.

### Multi-migration extensions

These CHECK constraints were extended across multiple migrations. The
check script reads the **current** value list (the union of every
migration that touched it) and asserts `enums.ts` matches:

- `auth_failed_attempts.kind` — 0017 baseline (`signin`, `signup`,
  `reset_password`) + 0018 (`update_password`) + 0019
  (`email_verification`) + 0020 (`oauth_signin`) + 0022
  (`oauth_callback`). The check script de-dups across migrations
  before comparing.
- `auth_failed_attempts.reason` — 0017 baseline (6 values) + 0022
  (`success`). Same de-dup pattern.

---

## What is NOT covered (and why)

- **`admin_audit_log.action`** — a free-form `text not null` column
  with NO CHECK constraint. The values are documented in `enums.ts`
  as `AuditAction` (24 values) for grep-ability, but the DB does not
  enforce them. Future migrations MAY add a CHECK constraint; until
  then, the check script ignores this column.

- **`products.bullets`, `products.curriculum`, `products.long_description`,
  `collections.description`, `bundle_items.note`** — JSONB columns.
  JSONB has its own shape-validation story (P0.13 / P0.14 / P0.15 /
  0015 / 0016 migrations added per-column CHECK constraints for the
  JSON shape, but those are structural — `jsonb_typeof = 'array'`,
  `bool_and(jsonb_array_elements(...))` — not value enums).

- **The `categories` `slug` + `name` lookup table** — values are data
  rows (17 categories seeded in 0001), not enum values. Adding a new
  category is an INSERT, not a migration.

- **PII scrubbing constants** (e.g. `auth_failed_attempts.email_hash`
  vs `email_raw` column names) — column existence, not enum values.

---

## How the check script reads this

`04-platform/ci/scripts/check-enum-coverage.sh` does this:

1. **Parse migrations.** For every `04-platform/migrations/*.sql`, extract:
   - Every `CREATE TYPE X AS ENUM (...)` → `{ type: X, values: [...] }`
   - Every `ALTER TYPE X ADD VALUE '...'` → append to the type's values
   - Every `CHECK (col IN ('a', 'b', ...))` on a text column → `{ table, col, values: [...] }`
   - For CHECK constraints that span multiple migrations, the script
     unions the values before comparison (so the 0017 baseline + the
     0020 extension all count).

2. **Parse enums.ts.** For every `export const X` matching
   `<NAME>_STATUSES|_KINDS|_SOURCES|_RESULTS|_SEVERITIES|_LEVELS|_ROLES|_TIERS|_REASONS|_TARGET_KINDS|_STATUS|_KINDS|_SOURCES|_RESULTS|_SEVERITIES|_STATUSES|_TARGET_KINDS` (the
   `<NAME>` + `_STATUSES` style), extract the array literal.

3. **Compare.** For every migration-extracted value, assert the
   corresponding TS enum + runtime array contains it. For every TS
   enum value, assert some migration has it. (Bi-directional check —
   both directions must pass.)

4. **Report.** One `[ok]` or `[x]` line per (column, value). Fail the
   build if any line is `[x]`.

The script is bash + awk + grep; no Node runtime. Runs in < 200 ms
against the 27-migration corpus.

---

## When this audit was last run

The audit is part of the `check:enum-coverage` script and runs on
every CI invocation. The check is fast and idempotent — it's safe to
run on every PR. If the check fails, the build fails.

Audit freeze: **P3.8**. Future enum changes (new `ALTER TYPE ADD VALUE`
or new `CHECK` constraints) must update both the migration and this
document. The check script will refuse to merge a PR that adds an enum
value without mirroring it in `enums.ts`.

---

## Reusable lessons (saved to MEMORY.md)

- **`ALTER TYPE ... DROP VALUE` is forbidden by policy** even though
  Postgres ≥ 12 supports it. The cost of a dropped value (read
  replicas, schema caches, ETL lag) is never worth the small gain.
- **CHECK-constraint-as-enum is the right shape for low-cardinality
  text columns** when the value set is closed and small. JSONB is the
  wrong shape for enums; it loses the DB-level constraint + the
  index-on-categorical-data optimization.
- **`as const satisfies readonly T[]`** is the canonical pattern for
  the TS enum + runtime array (TypeScript 4.9+). The `satisfies`
  clause enforces the type without widening the value's literal types.
- **Bi-directional check (every DB value in TS + every TS value in DB)**
  catches both "added a migration but forgot enums.ts" and "added to
  enums.ts but never had it in the DB." One-sided checks miss half
  the drift.
- **Defer deprecation in the application layer, never in the DB
  schema.** Stop USING the value in queries, forms, and server
  actions. Keep the value in the DB. The DB is the contract; the
  application is the policy.