# RLS Test Framework

Verifies that every Row Level Security policy in
`04-platform/migrations/*.sql` actually behaves as designed.

## Why this exists

`pnpm check:rls` (the static check in `04-platform/ci/scripts/`)
verifies that **every table has an `enable row level security` +
at least one `create policy`** statement. That's the floor. The
RLS test framework is the ceiling — it verifies that the policies
behave as designed (anon can't read PII, customer can read own
data but not another customer's, admin can read all, etc.).

The static check is "RLS exists." The framework is "RLS is
correct."

## How to use

### Dry-run (default, no DB required)

```sh
pnpm test:rls
```

This runs the framework in dry-run mode. Every test is reported
as **SKIPPED** (no Supabase calls issued). The output is the
coverage matrix — which tables are covered, how many tests per
table, what policies are exercised. Use this in CI without a
staging DB; a green run means the fixture is well-formed and
the runner is wired correctly.

### Live (requires a seeded staging DB)

```sh
SUPABASE_URL_FOR_RLS_TESTS=https://<staging>.supabase.co \
SUPABASE_ANON_KEY_FOR_RLS_TESTS=<anon-key> \
SUPABASE_SERVICE_ROLE_KEY_FOR_RLS_TESTS=<service-role-key> \
RLS_SEED_USER_PASSWORD=<password> \
pnpm test:rls:live
```

This runs the framework in live mode. Every test issues a real
Supabase query and asserts the outcome matches the fixture's
`expect`. A failure means a policy is broken or missing — fix the
SQL migration, then re-run.

### Filtering to a subset

```sh
pnpm test:rls --table products --table orders
```

Use `--table` to focus on a single table (or several). Useful
when triaging a specific policy failure.

### JSON output for CI

```sh
pnpm test:rls --json > rls-report.json
```

## Architecture

```
06-quality/tests/rls/
├── types.ts          — RlsRole, RlsPolicyTest, RlsTestResult, etc.
├── roles.ts          — RLS_ROLES const + isAuthenticatedRole + RLS_SEED_USERS
├── policies.ts       — the policy-list fixture (ALL_RLS_POLICIES)
├── sign-in-as.ts     — signInAs(role) → Supabase client
├── run.ts            — runRlsTests({ executor, tests, mode })
├── cli.ts            — the `pnpm test:rls` entry point
├── index.ts          — barrel
├── README.md         — this file
└── *.test.ts         — unit tests for the framework itself
```

The framework is **three pieces**:

1. **The fixture** (`policies.ts`) — a list of (table, operation,
   role, expected outcome) tuples that mirror the `create policy`
   statements in the migrations.
2. **The runner** (`run.ts`) — a pure function that iterates a
   list of tests, calls an injected `executor`, and aggregates the
   results. Knows nothing about Supabase.
3. **The executor** — the seam between the runner and a real (or
   mocked) Supabase client. The dry-run executor returns
   `outcome: 'skipped'` for every test. The live executor issues
   real queries.

## Modes

| Mode    | DB?  | Use                                    |
| ------- | ---- | -------------------------------------- |
| `dry-run` | No   | Default. Fixture validation + coverage matrix. CI-friendly. |
| `live`    | Yes  | Staging DB. Real policy verification. |
| `mocked`  | No   | Unit tests of the framework itself.    |

## What the live runner does (deferred slice — STUB-045)

The full live runner is the deferred slice. The current CLI ships
a **structural** live executor that issues a representative read
query (`.from(table).select('*').limit(1)`) and infers the
RLS outcome from the row count. This catches the most common
class of RLS bugs (anon can read PII, customer can read another
user's data, admin can't read all).

The full per-operation shape (insert/update/delete with the
right payload, filter selection against seed data, append-only
table enforcement) lands in a follow-up tick that needs:

1. A seeded staging DB with the test users (see "Seeding" below).
2. The `RLS_SEED_USER_PASSWORD` env var wired in CI.
3. The live executor extended to issue insert/update/delete
   operations + select with the right filters.

This is the work tracked in **STUB-045**.

## Seeding the staging DB (one-time setup)

The live runner needs seven pre-baked users in the staging
project. The emails are documented in `roles.ts` (the
`RLS_SEED_USERS` const). The setup is a 5-minute Supabase Studio
operation:

1. **Create the users** in `Authentication → Users` (one per
   role). Use the emails from `RLS_SEED_USERS`. Set the same
   password for all seven (the `RLS_SEED_USER_PASSWORD` env var).
2. **Create the profile rows** — SQL snippet:
   ```sql
   insert into profiles (user_id, display_name, role) values
     ('<customer-uuid>', 'RLS Test Customer', 'customer'),
     ('<partner-own-uuid>', 'RLS Test Partner (own)', 'partner'),
     ('<partner-other-uuid>', 'RLS Test Partner (other)', 'partner'),
     ('<affiliate-uuid>', 'RLS Test Affiliate', 'affiliate'),
     ('<admin-uuid>', 'RLS Test Admin', 'admin'),
     ('<super-admin-uuid>', 'RLS Test Super Admin', 'super_admin');
   ```
3. **Create the partner rows** for the two partner identities —
   SQL snippet:
   ```sql
   insert into partners (user_id, status, public_slug) values
     ('<partner-own-uuid>', 'approved', 'rls-test-partner-own'),
     ('<partner-other-uuid>', 'approved', 'rls-test-partner-other');
   ```
4. **Create the seed product** owned by `partner-own-uuid` (so
   the "partner reads own product" / "partner_other reads own
   product" / "anon reads published product" cases have a row to
   test against). Optional for the current read-only executor; the
   full deferred slice will need this.

After setup, the live runner can sign in as each role and
exercise the policies.

## What's tested

The current fixture covers **the security-critical invariants**
on the major tables. Specifically:

- **Anon reads** — almost always deny; tables with public_read
  policies test allow.
- **Customer self-reads** — allow; tests the "self can read own
  row" guarantee.
- **Customer writes** — deny; tests "customers don't write to
  platform tables."
- **Admin all** — allow; tests "admin can do anything."
- **Append-only** — UPDATE/DELETE deny for every role including
  admin and super_admin.
- **Service-role negative control** — every (table, operation)
  the service role performs must be allowed through RLS.

The fixture is **not exhaustive** — it covers the invariants that
matter for security, not every (role × operation) combination.
Adding more tests is a one-line edit to `policies.ts`.

## When to add a new test

When a new table is added to a migration, the static check
(`pnpm check:rls`) will fail until the table has RLS + a policy.
Once the policy exists, add at least these four test rows to
`policies.ts`:

```ts
{ table: 'new_table', operation: 'select', as: 'anon', expect: 'deny', note: '...' },
{ table: 'new_table', operation: 'select', as: 'authenticated_customer', expect: 'allow', filter: '{ user_id: "<self>" }', note: '...' },
{ table: 'new_table', operation: 'insert', as: 'authenticated_customer', expect: 'deny', note: '...' },
{ table: 'new_table', operation: 'select', as: 'authenticated_admin', expect: 'allow', note: '...' },
```

Adjust the `expect` values to match the actual policy. The unit
test (`policies.test.ts`) will catch duplicate keys + missing
fields.

## Cross-references

- **AGENTS.md §2** — "RLS on every table. No table goes to
  production without a Row Level Security policy."
- **`04-platform/migrations/README.md`** — the migration order +
  authoring conventions.
- **`04-platform/ci/scripts/check-rls-coverage.sh`** — the static
  check (companion to this framework).
- **STUB-045** — the deferred slice (full live-DB executor +
  seed data + per-operation shape).
