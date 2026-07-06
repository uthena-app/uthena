#!/usr/bin/env node
/* eslint-disable no-console */
// db-bootstrap-verify.ts — RLS coverage verifier (P3.6 Slice 1).
//
// Connects to a database that has had `db-bootstrap.ts` run against
// it, queries the Postgres catalog, and asserts that every table in
// the `public` schema has:
//   1. Row Level Security enabled (`relrowsecurity = true`)
//   2. At least one policy in `pg_policies`
//
// This is the **runtime** counterpart to `check-rls-coverage.sh`.
// The shell check parses SQL files and looks for the right strings;
// this script introspects the live Postgres catalog and catches
// policy gaps that the static check misses (e.g. policies that exist
// in the file but were silently dropped because a transaction rolled
// back, or migrations that ran out of order and left a table in a
// half-RLS state).
//
// What "no RLS" looks like at runtime
// -----------------------------------
// Postgres tracks RLS in `pg_class.relrowsecurity`. A table created
// with `enable row level security` has that flag set; without it, the
// flag is false and the table is readable by anyone with the
// `SELECT` privilege (which `anon` and `authenticated` always have
// via the default grants).
//
// What "no policy" looks like at runtime
// --------------------------------------
// `pg_policies` is the catalog view Supabase's docs reference. Every
// `create policy` adds a row. RLS enabled + zero policies = "no rows
// are visible to non-owners" — a useful safety net, but almost
// certainly a bug (the table was supposed to be readable to some
// role, but the policy was never added).
//
// Why both checks (not just one)
// ------------------------------
// - RLS off + 0 policies: leak (anyone with the table's SELECT grant
//   sees everything).
// - RLS on + 0 policies: silent zero-row reads (the table appears
//   empty to anon/authenticated, which is also wrong).
// - RLS on + ≥1 policy: the intended state.
//
// Output shape
// ------------
// A structured report (`VerifyReport`) that the caller can JSON-
// serialize for CI consumption. The CLI format mirrors
// `formatReport` from `06-quality/tests/rls/run.ts` — one line per
// table, then a summary line.

import pg from 'pg'

const DEFAULT_LOCAL_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'

export type VerifyOptions = {
  databaseUrl?: string
  /** Restrict the check to a subset of tables (for testing). */
  tableNames?: readonly string[]
}

export type TableStatus = {
  table: string
  rlsEnabled: boolean
  policyCount: number
  /** True if the table passes both checks. */
  ok: boolean
  /** Only populated when `ok` is false. */
  reason?: string
}

export type VerifyReport = {
  startedAt: string
  finishedAt: string
  databaseUrl: string
  totalTables: number
  passed: number
  failed: number
  results: TableStatus[]
}

const REPO_ROOT = process.cwd()

/**
 * Query Postgres for the RLS status of every table in `public`. Returns
 * a `TableStatus` per table — including tables that exist but have
 * RLS disabled or zero policies (so the report surfaces every gap).
 *
 * The query joins `pg_class` (where `relrowsecurity` lives) to
 * `pg_namespace` (where the schema name lives) and a `left join` to
 * `pg_policies` (where the per-table policy list lives). The left
 * join is critical: a table with zero policies must still appear in
 * the result set with `policyCount = 0`, not be filtered out by the
 * join itself.
 */
async function introspectTables(pool: pg.Pool, tableFilter?: readonly string[]): Promise<TableStatus[]> {
  const filterClause = tableFilter && tableFilter.length > 0
    ? `AND c.relname = ANY ($1::text[])`
    : ''
  const params: unknown[] = tableFilter && tableFilter.length > 0 ? [tableFilter] : []
  const sql = `
    SELECT
      c.relname AS table_name,
      c.relrowsecurity AS rls_enabled,
      COALESCE(p.policy_count, 0)::int AS policy_count
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    LEFT JOIN (
      SELECT tablename, COUNT(*) AS policy_count
      FROM pg_policies
      WHERE schemaname = 'public'
      GROUP BY tablename
    ) p ON p.tablename = c.relname
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p')  -- ordinary tables + partitioned tables
      ${filterClause}
    ORDER BY c.relname
  `
  const { rows } = await pool.query<{ table_name: string; rls_enabled: boolean; policy_count: number }>(sql, params)
  return rows.map((r): TableStatus => {
    const ok = r.rls_enabled && r.policy_count > 0
    if (ok) {
      return { table: r.table_name, rlsEnabled: r.rls_enabled, policyCount: r.policy_count, ok }
    }
    const reason = !r.rls_enabled
      ? 'RLS not enabled'
      : 'RLS enabled but zero policies'
    return { table: r.table_name, rlsEnabled: r.rls_enabled, policyCount: r.policy_count, ok, reason }
  })
}

export async function verifyRlsCoverage(opts: VerifyOptions = {}): Promise<VerifyReport> {
  const databaseUrl = opts.databaseUrl ?? process.env.DATABASE_URL ?? DEFAULT_LOCAL_URL
  const startedAt = new Date().toISOString()

  const pool = new pg.Pool({
    connectionString: databaseUrl,
    max: 1,
    connectionTimeoutMillis: 10000,
  })

  try {
    // Connectivity check — fail loudly on a stopped DB.
    await pool.query('SELECT 1')

    const results = await introspectTables(pool, opts.tableNames)
    const passed = results.filter((r) => r.ok).length
    const failed = results.length - passed
    const finishedAt = new Date().toISOString()
    return { startedAt, finishedAt, databaseUrl, totalTables: results.length, passed, failed, results }
  } finally {
    await pool.end()
  }
}

/** Render a report as a human-readable table (CLI default). */
export function formatVerifyReport(report: VerifyReport): string {
  const lines: string[] = []
  lines.push(
    `RLS verify — passed=${report.passed} failed=${report.failed} total=${report.totalTables}`,
  )
  lines.push(`Database: ${redactDatabaseUrl(report.databaseUrl)}`)
  lines.push('')
  lines.push('table                              | rls    | policies | result | reason')
  lines.push('-'.repeat(96))
  for (const r of report.results) {
    const table = r.table.padEnd(34)
    const rls = (r.rlsEnabled ? 'yes' : 'no').padEnd(6)
    const pol = String(r.policyCount).padEnd(8)
    const result = (r.ok ? 'OK' : 'FAIL').padEnd(6)
    lines.push(`${table} | ${rls} | ${pol} | ${result} | ${r.reason ?? ''}`)
  }
  return lines.join('\n')
}

function redactDatabaseUrl(url: string): string {
  try {
    const parsed = new URL(url)
    if (parsed.password) parsed.password = '***'
    return parsed.toString()
  } catch {
    return '<unparseable-url>'
  }
}

function isDirectInvocation(): boolean {
  if (!process.argv[1]) return false
  return (
    process.argv[1].endsWith('db-bootstrap-verify.ts') ||
    process.argv[1].endsWith('db-bootstrap-verify')
  )
}

if (isDirectInvocation()) {
  verifyRlsCoverage()
    .then((report) => {
      console.log(formatVerifyReport(report))
      console.log('')
      console.log(`[db:verify] done passed=${report.passed} failed=${report.failed}`)
      if (report.failed > 0) {
        process.exit(1)
      }
    })
    .catch((err) => {
      console.error('[db:verify] aborted:', err instanceof Error ? err.message : err)
      process.exit(2)
    })
}

// Re-export REPO_ROOT so test code can locate fixtures relative to the
// script's location rather than the current working directory.
export { REPO_ROOT }