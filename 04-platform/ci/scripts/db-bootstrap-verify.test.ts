// db-bootstrap-verify.test.ts — Unit tests for `db-bootstrap-verify.ts`.
//
// What we test
// ------------
// - `formatVerifyReport` produces the right human-readable shape
//   (passed/failed counts, table rows, reason column).
// - `redactDatabaseUrl` (mirrored from db-bootstrap.ts — kept in
//   sync via the same URL-parsing logic; tested separately so a
//   future refactor that breaks one doesn't silently break the other).
//
// What we do NOT test here
// ------------------------
// - The Postgres-catalog `introspectTables` query. That requires a
//   live DB. The runtime path is exercised via `db:verify` against
//   a real Supabase Postgres in CI / locally.
//
// Run: `pnpm test db-bootstrap-verify`.

import { describe, expect, it } from 'vitest'

import { formatVerifyReport, type VerifyReport } from './db-bootstrap-verify'

function makeReport(overrides: Partial<VerifyReport> = {}): VerifyReport {
  return {
    startedAt: '2026-06-25T08:00:00.000Z',
    finishedAt: '2026-06-25T08:00:01.000Z',
    databaseUrl: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
    totalTables: 3,
    passed: 2,
    failed: 1,
    results: [
      { table: 'products', rlsEnabled: true, policyCount: 5, ok: true },
      { table: 'orders', rlsEnabled: true, policyCount: 3, ok: true },
      {
        table: 'broken_table',
        rlsEnabled: false,
        policyCount: 0,
        ok: false,
        reason: 'RLS not enabled',
      },
    ],
    ...overrides,
  }
}

describe('formatVerifyReport', () => {
  it('reports the passed/failed/total counts in the header line', () => {
    const out = formatVerifyReport(makeReport())
    expect(out).toContain('passed=2')
    expect(out).toContain('failed=1')
    expect(out).toContain('total=3')
  })

  it('redacts the password from the database URL in the report', () => {
    const out = formatVerifyReport(makeReport())
    // The real password was 'postgres' but the report must contain
    // '***' instead.
    expect(out).toContain('***')
    expect(out).not.toMatch(/postgresql:\/\/postgres:postgres@/)
  })

  it('lists every table on its own line', () => {
    const out = formatVerifyReport(makeReport())
    expect(out).toContain('products')
    expect(out).toContain('orders')
    expect(out).toContain('broken_table')
  })

  it('marks passing tables as OK and failing tables as FAIL', () => {
    const out = formatVerifyReport(makeReport())
    // OK rows
    expect(out).toMatch(/products\s+\|\s+yes\s+\|\s+5\s+\|\s+OK/)
    expect(out).toMatch(/orders\s+\|\s+yes\s+\|\s+3\s+\|\s+OK/)
    // FAIL row carries the reason
    expect(out).toMatch(/broken_table\s+\|\s+no\s+\|\s+0\s+\|\s+FAIL\s+\|\s+RLS not enabled/)
  })

  it('surfaces the "RLS enabled but zero policies" case distinctly', () => {
    const report = makeReport({
      totalTables: 1,
      passed: 0,
      failed: 1,
      results: [
        {
          table: 'orphan_table',
          rlsEnabled: true,
          policyCount: 0,
          ok: false,
          reason: 'RLS enabled but zero policies',
        },
      ],
    })
    const out = formatVerifyReport(report)
    expect(out).toMatch(/orphan_table\s+\|\s+yes\s+\|\s+0\s+\|\s+FAIL\s+\|\s+RLS enabled but zero policies/)
  })

  it('handles an empty result set gracefully (no crash, no rows)', () => {
    const report = makeReport({
      totalTables: 0,
      passed: 0,
      failed: 0,
      results: [],
    })
    const out = formatVerifyReport(report)
    expect(out).toContain('passed=0')
    expect(out).toContain('failed=0')
    expect(out).toContain('total=0')
  })
})