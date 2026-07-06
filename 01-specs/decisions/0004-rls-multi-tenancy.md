# ADR-0004: RLS for all multi-tenant data

**Date:** 2026-06-12
**Status:** Accepted
**Deciders:** Human, platform agent

## Context

Uthena is a multi-tenant system. We have:
- **Customers** (people who buy products)
- **Partners** (people who upload products and earn 60% of sales)
- **Affiliates** (people who promote products and earn 20% of sales)
- **Admins** (internal staff who review products, manage payouts, handle support)

All of these users share a single Postgres database. Each user type has access to a different slice of the data:
- A customer can see their own orders, library, account
- A partner can see their own products, earnings, payouts
- An affiliate can see their own referrals, earnings, payouts
- An admin can see (almost) everything, with full audit logging

The data isolation requirement is non-negotiable. A bug that lets a customer see another customer's library, or a partner see another partner's earnings, is a security incident. The question is: how do we enforce isolation?

## Considered options

### Option A: Application-layer authorization only

The app checks "does this user have permission to see this row?" in every server action. The DB trusts whatever the app sends.

- **Pros:** Simple to start. No DB-level enforcement.
- **Cons:** A single forgotten check = data leak. A single SQL injection = data leak. The blast radius of any auth bug is the entire database. We are one missed check away from a breach.

### Option B: Row-Level Security (RLS) in Postgres

Postgres has a feature called Row-Level Security (RLS). You define policies on each table ("a user can SELECT this row only if `auth.uid() = user_id`"), and Postgres enforces them at query time. The app's role (typically `authenticated`) has SELECT/INSERT/UPDATE/DELETE on the table, but the policies determine WHICH rows are visible/writable.

- **Pros:** The DB enforces isolation. A forgotten app check is caught by the DB. SQL injection is contained (the attacker still can't see other rows). Defense in depth — even if the app has a bug, the data is still safe.
- **Cons:** More upfront work. RLS policies must be tested. Some patterns are awkward (e.g. aggregations across users for admin reports). Performance requires indexes that match the policy expressions.

### Option C: Schema-per-tenant

Each user (or organization) gets their own Postgres schema. The app connects with a per-tenant role.

- **Pros:** Strongest isolation. Can do per-tenant backups easily.
- **Cons:** Heavy operational overhead. Doesn't fit our model (we have a few user types, not thousands of tenants). Migrations are harder (apply to every schema).

## Decision

**Row-Level Security (RLS) on every table that contains tenant data.**

The full schema is in `01-specs/pages/_data-model.md`. Every table that has a `user_id` column (or equivalent) has RLS enabled and at least one policy.

The pattern:

```sql
-- Example: profiles table
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read their own profile"
  ON profiles FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can update their own profile"
  ON profiles FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Admin policy
CREATE POLICY "Admins can read all profiles"
  ON profiles FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.user_id = auth.uid() AND p.role = 'admin'
    )
  );
```

The `auth.uid()` function is provided by Supabase and returns the current session's user ID. The DB knows who's making the query, and the policy is evaluated automatically.

## The role model

We have these Postgres roles:

- **anon** — for unauthenticated requests (e.g. the public catalog). Can only read public tables (e.g. `products` where `status = 'published'`).
- **authenticated** — for logged-in users. Can read/write their own rows, per the policies.
- **service_role** — for server-side admin work. Bypasses RLS. Used in webhook handlers, cron jobs, and admin actions. **Never sent to the client.**
- **partner** — a logical role (not a Postgres role) for partner-specific access. Implemented as a column in `profiles` (`role = 'partner'`).
- **affiliate** — same.
- **admin** — same. Admins have policies that allow them to read/write any row.

In v1, the `service_role` is used in the few places where the app needs to bypass RLS (e.g. an admin manually viewing a user's library). In v2, we may add more granular roles.

## The "every table gets RLS" rule

The rule, stated in `AGENTS.md` and enforced in CI:

> **Every table in production has RLS enabled. No exceptions, no "we'll add it later."**

A new table without RLS is a CI failure. The check runs in `04-platform/ci/scripts/check-rls-coverage.sh`:

```bash
#!/bin/bash
# Verify every table has RLS enabled
TABLES=$(psql -t -c "SELECT tablename FROM pg_tables WHERE schemaname = 'public'")
for TABLE in $TABLES; do
  RLS=$(psql -t -c "SELECT relrowsecurity FROM pg_class WHERE relname = '$TABLE'")
  if [ "$RLS" != "t" ]; then
    echo "FAIL: Table $TABLE does not have RLS enabled"
    exit 1
  fi
done
echo "OK: All tables have RLS enabled"
```

This is the safety net. A new migration that creates a table without RLS blocks the PR.

## Testing RLS

Every policy is tested in `06-quality/tests/integration/rls.test.ts`. The test pattern:

1. Create a test user (user A) and another test user (user B)
2. Create a row for user A
3. As user A, verify the row is visible
4. As user B, verify the row is NOT visible
5. As user B, try to update the row → should fail
6. As user B, try to delete the row → should fail

If any of these checks fail, the policy is broken and the migration is blocked.

## The "admin can see everything" pattern

Admins have policies that allow them to read all rows. The pattern:

```sql
CREATE POLICY "Admins can read all profiles"
  ON profiles FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.user_id = auth.uid() AND p.role = 'admin'
    )
  );
```

This is a recursive RLS policy — the `profiles` table is queried to check if the current user is an admin. Postgres handles this fine; the `EXISTS` is evaluated with the current user's policies, so user A can see their own row in `profiles` (which is what makes the EXISTS work).

The admin read is **logged** in `admin_audit_log` (a trigger on the `profiles` table fires whenever a row is read by an admin). The log includes: who, what, when. This is a PII access audit trail.

## The "service_role bypasses RLS" pattern

Some operations need to bypass RLS. The pattern:

```ts
// In a server action that needs to do admin work
import { createServiceRoleClient } from '00-foundations/data/service-role';

const supabase = createServiceRoleClient();  // bypasses RLS
const { data } = await supabase.from('orders').select('*');  // sees all orders
```

The `service_role` key is in Doppler / Vault, never in the client. It's used in:
- Webhook handlers (e.g. `04-platform/webhooks/stripe.ts` needs to read the user's order regardless of session state)
- Cron jobs (e.g. `04-platform/ci/scripts/cron/daily-payout-batch.ts` needs to read all approved ledger entries)
- Admin actions that need to bypass RLS (e.g. "reset this user's password")

Every use of `service_role` is documented with a comment explaining why RLS is being bypassed. Code review rejects unjustified uses.

## Consequences

### Positive

- **Defense in depth.** A forgotten app check is caught by the DB. SQL injection is contained.
- **Single source of truth for access control.** The policies are in the schema, not scattered through 200 server actions.
- **Easy to audit.** "Who can read the orders table?" → look at the policies.
- **GDPR-friendly.** We can prove to a regulator that user data is isolated.

### Negative

- **More upfront work.** Every table needs a policy (or an explicit "public" marker).
- **Awkward patterns.** Some queries (e.g. aggregations for admin dashboards) need creative policy design. We may need to use `service_role` for some reports.
- **Performance requires care.** Policies that call functions on every row (e.g. `auth.uid()`) need indexes. We use `EXPLAIN` on every new query.
- **Recursive policies** (the admin-check pattern) are subtle. We test them carefully.

### Mitigations

- **Templates** in `00-foundations/auth/policies/` for the common patterns (user-owned, partner-owned, admin-readable, etc.).
- **RLS test suite** in `06-quality/tests/integration/rls.test.ts` that runs on every migration.
- **CI check** (`check-rls-coverage.sh`) that fails if any table is missing RLS.
- **Code review** by the platform agent on every RLS policy change.

## References

- The full schema with policies: `01-specs/pages/_data-model.md`
- The RLS coverage check: `04-platform/ci/scripts/check-rls-coverage.sh`
- The Supabase RLS docs: https://supabase.com/docs/guides/auth/row-level-security
- The pre-merge checklist: `06-quality/checklists/pre-merge.md` (Security section)
