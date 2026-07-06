# 04-platform/migrations/

Database migrations. The single most sensitive folder in the repo. Every schema change in the app lands here. Every change has a number. Every change is append-only.

## The rules

### 1. Numbered and append-only

`0001_initial.sql`, `0002_add_payout_ledger.sql`, `0003_add_affiliates_table.sql`, ...

- **Never edit a migration that's been applied to any environment.** If you need to change a migration, add a new one.
- **Never reuse a number.** If your PR is number 0042 and someone else's PR is also 0042, one of you renames.
- **Migrations run in numeric order.** The CI pipeline asserts this. Out-of-order migrations are a CI failure.

### 2. Idempotent where possible

```sql
-- Good
CREATE TABLE IF NOT EXISTS partners (...);
CREATE INDEX IF NOT EXISTS idx_partners_user_id ON partners(user_id);

-- Bad (without IF NOT EXISTS) — will fail on re-run
CREATE TABLE partners (...);
```

DDL that can't be idempotent (e.g. `ALTER TABLE ADD COLUMN`) is wrapped in a transaction with explicit checks.

### 3. RLS in the same migration

**Every new table gets RLS in the same migration.** No exceptions. No "we'll add RLS in a follow-up." A table without RLS is a security hole, and migrations are deployed to staging and prod independently.

```sql
-- Always paired with the CREATE TABLE
CREATE TABLE partners (...);
ALTER TABLE partners ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Partners can read their own profile"
  ON partners FOR SELECT
  USING (auth.uid() = user_id);
-- ...
```

### 4. Rollback plan in the PR

Every migration PR includes a rollback plan in the description:

```markdown
## Rollback plan

If this migration fails in prod, the follow-up migration `0043_rollback_partners.sql` will be applied.
The rollback drops the new policies, the new columns, and the new table (in that order).
```

Or, for migrations that can't be rolled back trivially (e.g. dropping a column with data):

```markdown
## Rollback plan

This migration is not safely reversible. The new column `partners.tax_id` is added with a default of NULL.
Removing the column would require a separate migration. We accept that risk because the column is not yet read by application code.
```

### 5. Tested on a fresh DB

The CI pipeline runs **all migrations from scratch** on every PR. A migration that fails on a fresh DB blocks the PR.

```bash
# Local + CI equivalent (P3.6 Slice 1)
pnpm db:bootstrap    # applies every 04-platform/migrations/*.sql in numeric order
pnpm db:verify       # introspects pg_class + pg_policies; asserts every public table has RLS + ≥1 policy
pnpm db:types        # regenerates 00-foundations/data/types.generated.ts from the live schema (P3.7 Slice 1)
pnpm db:types:check  # detects drift between the committed types and a fresh generation (P3.7 Slice 1)
pnpm check:enum-coverage  # bi-directional DB ↔ TS enum coverage (P3.8)
```

The `check:enum-coverage` script (P3.8) parses every `CREATE TYPE ... AS
ENUM` and every text column with a `CHECK (... IN (...))` constraint
from the migrations, then asserts each value is mirrored in
`00-foundations/data/enums.ts` (and vice versa). The full audit
inventory + deprecation policy lives at
[`ENUM-AUDIT.md`](./ENUM-AUDIT.md) — read it before adding a new enum
value.

The bootstrap scripts live at `04-platform/ci/scripts/db-bootstrap{,-verify}.ts` and ship with `pg` as a devDependency — they don't need `psql` or the Supabase CLI on PATH. The types-regeneration scripts (`db-types.ts` + `check-types-fresh.ts`) use the Supabase CLI via `pnpm exec` — that one IS a devDependency. Default `DATABASE_URL` is `postgresql://postgres:postgres@127.0.0.1:54322/postgres` (local Supabase Postgres); override via env var for staging / CI.

The bootstrap script is safe to re-run on a database that already has all migrations applied: every migration is designed to be idempotent (`create table if not exists`, `do $$ ... exception when duplicate_object then null; end $$;`, etc.). See `db-bootstrap-README.md` for full design rationale + CI integration snippets. See `db-types-README.md` for the types-regeneration contract + how CI invokes it via `.github/workflows/db-types.yml`.

For users with the Supabase CLI installed, `supabase db reset` is still the canonical way to wipe auth users + storage too — use whichever fits the loop. The bootstrap script is the cross-environment fallback that works on any Postgres URL.

The test verifies: no errors, all tables exist, all RLS policies are in place, types are in sync.

## The structure of a migration

```sql
-- 0042_add_partner_tax_id.sql
-- Description: Add tax_id field to partners table (encrypted)
-- Author: agent-name
-- Date: 2026-06-15
-- Spec: 01-specs/pages/instructor-payouts.md (Tax form collection)
-- Rollback: 0043_rollback_partner_tax_id.sql

BEGIN;

-- 1. New column (nullable for backward compat)
ALTER TABLE partners
  ADD COLUMN tax_id_encrypted bytea,
  ADD COLUMN tax_id_key_id text;

-- 2. RLS — no policy change needed; existing policies apply to all columns
-- (The column is encrypted at the app layer; the DB never sees plaintext.)

-- 3. Index (if needed for query performance)
CREATE INDEX idx_partners_tax_id_key_id
  ON partners(tax_id_key_id)
  WHERE tax_id_key_id IS NOT NULL;

COMMIT;
```

## Testing migrations

Three layers:

1. **Syntax** — `psql --check` runs the migration and rolls back. Catches syntax errors.
2. **Fresh DB** — run all migrations from scratch on a clean DB. Catches ordering issues.
3. **RLS verification** — query the table as different roles (anon, authenticated, service_role). Verify the policies do what they say.

The third layer is the most important. A migration that adds a table without RLS, or with a broken RLS policy, can leak data in production. CI must catch this.

## What does NOT go in a migration

- Application code (server actions, React components) — goes in `02-features/`
- Configuration (Supabase settings, env vars) — goes in `04-platform/ci/` or `04-platform/storage/`
- Data backfills — split out into a separate "data migration" tracked in `_data-migrations.md`

Data backfills are tricky because they can be slow and can fail mid-run. They're tracked separately and run as one-off scripts (e.g. `04-platform/ci/scripts/backfill_partner_emails.ts`), not as part of the migration sequence.

## Migrations and PRs

- One PR per migration. Always.
- Migration PRs are reviewed by the platform agent AND a second reviewer (because the stakes are high)
- Migration PRs are deployed to staging first, verified, then deployed to prod
- Migration PRs are NOT batched. If you have 3 unrelated schema changes, that's 3 PRs.
- Migration PRs are NOT combined with feature PRs. The feature PR waits for the migration to be live.

## When you need a migration

1. Schema changes (table, column, index, RLS policy) → migration
2. New enum values → migration (`ALTER TYPE ... ADD VALUE`) — also update
   `00-foundations/data/enums.ts` and `04-platform/migrations/ENUM-AUDIT.md`.
   The `check:enum-coverage` script will fail if the TS side lags.
3. New CHECK constraint on a text column → migration — also add the TS
   counterpart to `enums.ts` + the mapping entry in
   `04-platform/ci/scripts/check-enum-coverage.sh`.
4. Default value changes → migration (be careful, can lock the table)
5. Materialized view changes → migration

## Deprecating an enum value

**Never drop.** See [`ENUM-AUDIT.md` § "Deprecation strategy"](./ENUM-AUDIT.md#deprecation-strategy-the-policy)
for the full policy. The short version: stop using the value at the
application layer (filter in queries, not in the DB), keep the value
in the DB type, document the deprecation in `STUBS.md`. Forward-only
via `ALTER TYPE ... ADD VALUE` — no `DROP VALUE`, ever.

## When you DON'T need a migration

- Adding data to a configuration table (use a one-off script)
- Changing application code (no DB impact)
- Renaming a column in code (DB column stays the same; this is a refactor)
- Adding an index concurrently (use `CREATE INDEX CONCURRENTLY` in a one-off script, not a migration)

## Append-only is the law

If a migration is merged, you cannot edit it. Period. Even if you spot a typo in a comment. The migration in git is the migration that ran in prod. The history must be immutable.

This is the hardest rule to follow when the mistake is small. Don't fix it with a force-push. Add a follow-up migration.

```sql
-- 0042_add_partner_tax_id.sql
-- Description: Add tax_id field to partners table
-- ...
COMMENT ON COLUMN partners.tax_id_encrypted IS 'Encrypted tax ID. See 0042_add_partner_tax_id.sql';

-- 0043_fix_typo_in_comment.sql
-- Description: Fix typo in 0042 comment
COMMENT ON COLUMN partners.tax_id_encrypted IS 'Encrypted tax ID (AES-256-GCM via libsodium).';
```

That's how you fix a typo in a migration. With a new migration.
