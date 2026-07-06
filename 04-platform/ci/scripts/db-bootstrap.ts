#!/usr/bin/env node
/* eslint-disable no-console */
// db-bootstrap.ts — Fresh-DB migration runner (P3.6 Slice 1).
//
// Connects to a Postgres database (default: the local Supabase Postgres
// at 127.0.0.1:54322), reads every `04-platform/migrations/*.sql` file
// in numeric order, and applies each one to the database. Stops on the
// first failure with a non-zero exit code.
//
// Why this script exists
// ---------------------
// The README at `04-platform/migrations/README.md` §"Tested on a fresh
// DB" already promises a script that runs all migrations from scratch.
// Until now, that promise was filled by `supabase db reset` + per-file
// `psql` invocations — both of which require the Supabase CLI + `psql`
// on PATH. This script removes those requirements and replaces the
// mechanism with a single Node process using the `pg` driver.
//
// Why a Node script (not a shell script)
// --------------------------------------
// 1. No psql / supabase CLI in our runtime container. Adding them is a
//    +200 MB Docker layer; `pg` is 30 KB of npm.
// 2. We need precise error attribution (which statement in which file
//    failed?). `pg` returns the SQL error with the failed statement
//    number; bash + heredoc loses that context.
// 3. Future P3.6 Slice 2 (seed minimal fixture data) and Slice 3
//    (API smoke test) reuse this script's connection pool. Bash can't
//    do that cleanly across three scripts.
//
// How to run
// ----------
//   DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres \
//     pnpm db:bootstrap
//
// Or with the local-Supabase default (no env var needed):
//   pnpm db:bootstrap
//
// The script is safe to re-run on a database that already has all
// migrations applied: every migration is designed to be idempotent
// (`create table if not exists`, `do $$ ... exception when
// duplicate_object then null; end $$;`, etc.). Re-runs are a no-op.
//
// Idempotency caveats are documented in `04-platform/migrations/README.md`
// §2 ("Idempotent where possible"). If a future migration introduces a
// non-idempotent DDL, that migration is wrong — fix it, don't paper
// over it here.

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import pg from 'pg'

const DEFAULT_LOCAL_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'

type BootstrapOptions = {
  /** Override the migrations directory (default: `04-platform/migrations`). */
  migrationsDir?: string
  /** Override the database URL (default: $DATABASE_URL or local Supabase). */
  databaseUrl?: string
  /** Skip the pre-flight connectivity check (useful for unit tests). */
  skipConnectivityCheck?: boolean
}

type MigrationResult = {
  file: string
  ok: boolean
  durationMs: number
  error?: string
}

type BootstrapReport = {
  startedAt: string
  finishedAt: string
  databaseUrl: string
  totalMigrations: number
  applied: number
  failed: number
  results: MigrationResult[]
}

const REPO_ROOT = process.cwd()
const DEFAULT_MIGRATIONS_DIR = join(REPO_ROOT, '04-platform', 'migrations')

/**
 * List migration files in numeric (lexicographic) order.
 *
 * Sorts with a simple `localeCompare` on the file name. All of our
 * migrations follow the `NNNN_*.sql` convention (zero-padded 4-digit
 * prefix), so lexicographic order is identical to numeric order. If a
 * future migration drops the zero padding (`100_*`), this sort still
 * works because the prefix is sorted as a string — `0027_*` < `100_*`
 * in `localeCompare` order. So the contract holds for the foreseeable
 * future.
 *
 * Excludes:
 *   - `README.md` (not a migration)
 *   - Files starting with `_` (the README convention marks them as
 *     "not a migration" — used for design notes / unfinished drafts)
 */
export function listMigrations(migrationsDir: string): string[] {
  const entries = readdirSync(migrationsDir, { withFileTypes: true })
  return entries
    .filter((e) => e.isFile() && e.name.endsWith('.sql') && !e.name.startsWith('_'))
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b))
}

/**
 * Apply a single migration file. Returns `{ ok, durationMs, error? }`.
 *
 * We send the file's full text as one `pool.query()` call. The `pg`
 * driver's simple-query protocol handles multi-statement SQL (the
 * Postgres server parses each `;`-terminated statement in sequence).
 *
 * We do NOT wrap in a transaction. The migrations are designed to be
 * autocommit-safe (every DDL is idempotent or guarded by a DO block).
 * If a migration partially fails, the caller wants to know exactly
 * which statement broke — wrapping in a transaction would roll back
 * the prior statements and obscure the failure point.
 *
 * Why a 60s statement timeout
 * ---------------------------
 * A single DDL statement that takes > 60s on a fresh DB is almost
 * certainly an infinite loop or a deadlock — both warrant a hard
 * timeout. Postgres's `statement_timeout` (in ms) aborts the
 * statement server-side and returns the canonical `canceling statement
 * due to statement timeout` error. Without it, a bad migration could
 * hang the CI job indefinitely.
 */
async function applyMigration(
  pool: pg.Pool,
  migrationsDir: string,
  file: string,
): Promise<MigrationResult> {
  const path = join(migrationsDir, file)
  const sql = readFileSync(path, 'utf8')
  const startedAt = performance.now()
  try {
    await pool.query(`SET statement_timeout = 60000`)
    await pool.query(sql)
    return { file, ok: true, durationMs: Math.round(performance.now() - startedAt) }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return {
      file,
      ok: false,
      durationMs: Math.round(performance.now() - startedAt),
      error: message,
    }
  }
}

/**
 * The main entry point. Returns a structured report so the caller (or
 * a future test) can inspect what happened. Exits non-zero on any
 * failure.
 */
export async function bootstrapDatabase(opts: BootstrapOptions = {}): Promise<BootstrapReport> {
  const migrationsDir = opts.migrationsDir ?? DEFAULT_MIGRATIONS_DIR
  const databaseUrl = opts.databaseUrl ?? process.env.DATABASE_URL ?? DEFAULT_LOCAL_URL

  const startedAt = new Date().toISOString()
  const files = listMigrations(migrationsDir)

  if (files.length === 0) {
    throw new Error(`No migration files found in ${migrationsDir}`)
  }

  console.log(`[db:bootstrap] database=${redactDatabaseUrl(databaseUrl)}`)
  console.log(`[db:bootstrap] migrations_dir=${migrationsDir}`)
  console.log(`[db:bootstrap] migration_count=${files.length}`)

  const pool = new pg.Pool({
    connectionString: databaseUrl,
    max: 1, // Single-connection: keep the migration history deterministic.
    connectionTimeoutMillis: 10000,
  })

  try {
    if (!opts.skipConnectivityCheck) {
      // Pre-flight: confirm the database is reachable before we touch
      // any DDL. A typo in DATABASE_URL or a stopped local Postgres
      // produces a clear "could not connect" error instead of a
      // confusing "relation does not exist" later.
      const ping = await pool.query('SELECT 1 AS ok')
      if (!ping.rows[0] || ping.rows[0].ok !== 1) {
        throw new Error('Database connectivity check failed (SELECT 1 returned no row)')
      }
      console.log('[db:bootstrap] connectivity_ok=true')
    }

    const results: MigrationResult[] = []
    for (const file of files) {
      process.stdout.write(`[db:bootstrap] applying ${file} ... `)
      const result = await applyMigration(pool, migrationsDir, file)
      if (result.ok) {
        console.log(`ok (${result.durationMs}ms)`)
      } else {
        console.log(`FAILED (${result.durationMs}ms)`)
        console.error(`[db:bootstrap] ${file} -> ${result.error ?? 'unknown error'}`)
      }
      results.push(result)
      if (!result.ok) break
    }

    const applied = results.filter((r) => r.ok).length
    const failed = results.length - applied
    const finishedAt = new Date().toISOString()
    return { startedAt, finishedAt, databaseUrl, totalMigrations: files.length, applied, failed, results }
  } finally {
    await pool.end()
  }
}

/**
 * Redact the password from a Postgres URL before logging. Postgres URLs
 * look like `postgresql://user:password@host:port/db`. Logging the raw
 * URL would leak the password to stdout — and `check-pii-logs.sh` is
 * not the right layer to fix this; we redact at the source.
 */
export function redactDatabaseUrl(url: string): string {
  try {
    const parsed = new URL(url)
    if (parsed.password) parsed.password = '***'
    return parsed.toString()
  } catch {
    return '<unparseable-url>'
  }
}

// CLI entry point — only runs when invoked directly (`tsx db-bootstrap.ts`),
// not when imported by a test. Vitest sets `import.meta.vitest` for in-test
// imports; for the `tsx` CLI runner, the canonical check is
// `process.argv[1] === fileURLToPath(import.meta.url)`.
function isDirectInvocation(): boolean {
  if (!process.argv[1]) return false
  return process.argv[1].endsWith('db-bootstrap.ts') || process.argv[1].endsWith('db-bootstrap')
}

if (isDirectInvocation()) {
  bootstrapDatabase()
    .then((report) => {
      console.log('')
      console.log(
        `[db:bootstrap] done applied=${report.applied} failed=${report.failed} total=${report.totalMigrations}`,
      )
      if (report.failed > 0) {
        process.exit(1)
      }
    })
    .catch((err) => {
      console.error('[db:bootstrap] aborted:', err instanceof Error ? err.message : err)
      process.exit(2)
    })
}