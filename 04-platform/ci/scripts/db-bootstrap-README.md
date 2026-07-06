# db-bootstrap — Fresh-DB migration runner + RLS verifier

P3.6 Slice 1 ships two scripts that together implement the
`04-platform/migrations/README.md` §"Tested on a fresh DB" promise
in pure Node, without requiring `psql` or the Supabase CLI on PATH.

## What it does

`db-bootstrap.ts` runs every `04-platform/migrations/*.sql` file in
numeric order against a fresh Postgres database. Idempotent: every
migration is designed to be re-run safe, so re-running on a partially-
migrated database is a no-op for the already-applied files.

`db-bootstrap-verify.ts` introspects the Postgres catalog after a
bootstrap run and asserts that every table in the `public` schema has
Row Level Security enabled AND at least one policy in `pg_policies`.

Together they implement the migration-dry-run contract end-to-end:

1. **Bootstrap**: apply all migrations from scratch → DB is in the
   expected end-state.
2. **Verify**: introspect the catalog → catch any table that's missing
   RLS or has zero policies.

## How to run

### Local (against the local Supabase Postgres)

The default `DATABASE_URL` points at the local Supabase Postgres
(`postgresql://postgres:postgres@127.0.0.1:54322/postgres`). If
`supabase start` is running, no env var is needed:

```bash
pnpm db:bootstrap       # apply all migrations
pnpm db:verify          # verify RLS coverage on every public table
```

### Against a custom DB

```bash
DATABASE_URL=postgresql://user:pass@host:5432/dbname pnpm db:bootstrap
DATABASE_URL=postgresql://user:pass@host:5432/dbname pnpm db:verify
```

The password is redacted in logs (see `redactDatabaseUrl` in both
scripts) so it's safe to copy-paste in CI.

### Unit tests

```bash
pnpm test db-bootstrap           # 10 tests — listMigrations + redactDatabaseUrl
pnpm test db-bootstrap-verify    # 6 tests — formatVerifyReport shape
```

## CI integration

Add to `.github/workflows/ci.yml` (when that workflow lands; for now
this is the manual recipe):

```yaml
jobs:
  db-bootstrap:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:15-alpine
        env:
          POSTGRES_PASSWORD: postgres
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
    env:
      DATABASE_URL: postgresql://postgres:postgres@localhost:5432/postgres
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - run: pnpm install --frozen-lockfile
      - run: pnpm db:bootstrap
      - run: pnpm db:verify
```

This is the canonical "migrations run on a fresh DB" check that the
README §"Tested on a fresh DB" promises. The shell-script
`check-rls-coverage.sh` stays as a static check (parses SQL files); the
runtime check (`db-bootstrap-verify.ts`) catches the cases the static
check can't — e.g. a migration that fails to apply mid-file because
of a constraint violation.

## Slices

- **Slice 1 (this)**: bootstrap + RLS verify. End-to-end-runnable.
- **Slice 2 (future)**: minimal fixture seed (`db-seed.ts`) — 1 user,
  1 product, 1 partner, 1 category. Loaded via the same `pg.Pool`
  pattern, called after `db:bootstrap` in CI.
- **Slice 3 (future)**: API smoke (`db-smoke.ts`) — hits
  `/api/health`, `/api/search?q=test`, `/` against a Next.js dev
  server running with the just-seeded DB. Reports 200/4xx/5xx per
  endpoint. Wired to the same CI job as bootstrap + verify.

## Design decisions

- **`pg.Pool`, not raw `pg.Client`.** The pool handles reconnection
  on transient network failures (e.g. Supabase idle timeout) without
  the caller wiring retry logic.
- **No `BEGIN; / COMMIT;` wrapper around each file.** The migrations
  are designed to be autocommit-safe; wrapping would roll back partial
  failures and obscure the actual failure point. If a future migration
  introduces non-idempotent DDL, fix that migration — don't paper over
  it in the bootstrap script.
- **`SET statement_timeout = 60000`** per file. A DDL statement that
  takes > 60s on a fresh DB is almost certainly an infinite loop or
  deadlock — both warrant a hard timeout.
- **`max: 1`** connection per pool. Single-connection makes the
  migration history deterministic; running two migrations in parallel
  is asking for ordering surprises.
- **Excluded from `check:no-todo`**: this README and the migration
  directory's README are allowed to mention "TODO" (per the script's
  allow-list). The scripts themselves contain no banned placeholders.

## What does NOT live here

- **Schema migrations** — `04-platform/migrations/`. The bootstrap
  script reads from there, never writes.
- **Application code** — `02-features/`, `03-app/`.
- **Production deployment** — `04-platform/ci/workflows/deploy-*.yml`
  (future). Bootstrap is a local + CI primitive, not a deploy
  primitive.
- **Backup / restore** — those scripts (when added) belong in
  `05-ops/runbooks/` or `04-platform/ci/scripts/backup/`, not here.

## Why not just `supabase db reset`?

Supabase's `supabase db reset` is the canonical way to reset a local
Supabase Postgres to a known state. Two reasons we ship a parallel
script:

1. **`supabase` CLI is not in our runtime container.** Adding it is a
   ~150 MB Docker layer; `pg` is 30 KB of npm. CI runners don't need
   the full Supabase CLI to validate migrations.
2. **Portability.** `db-bootstrap.ts` runs against any Postgres URL,
   not just `supabase start`'s local instance. The same script
   verifies migrations on staging, in CI, and on a dev's laptop —
   without three separate mechanisms.

If `supabase db reset` is the more appropriate tool for your local
loop (e.g. you want to wipe auth users + storage too), use it. This
script is the cross-environment fallback.