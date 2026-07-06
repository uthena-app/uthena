// The `runRlsTests` runner — iterates a fixture, calls the
// executor, aggregates the results into a report.
//
// **Pure function.** The runner does NOT know about Supabase, the
// network, or the file system. The caller injects an `executor`
// that translates a `RlsPolicyTest` into a `RlsExecutorOutcome`.
// This is what makes the framework testable without a live DB.
//
// **Concurrency.** The runner supports bounded concurrency via
// `opts.concurrency` (default 1 = sequential). Live runs may
// bump this to 4-8 to keep wall time reasonable; the Supabase
// client per role is reused across the suite, so a higher
// concurrency doesn't multiply the sign-in cost — it just lets
// multiple `await` chains progress in parallel.

import type {
  RlsExecutor,
  RlsExecutorOutcome,
  RlsPolicyTest,
  RlsRunOptions,
  RlsTestReport,
  RlsTestResult,
} from './types'

/** Internal: run a single test through the executor and shape the
 *  result. The runner calls this in a `Promise.all` map. */
async function runSingle(
  test: RlsPolicyTest,
  executor: RlsExecutor,
): Promise<RlsTestResult> {
  const startedAt = performance.now()
  let outcome: RlsExecutorOutcome
  try {
    outcome = await executor(test)
  } catch (err) {
    const detail = err instanceof Error ? err.message : 'unknown error'
    outcome = { outcome: 'error', detail: `executor threw: ${detail}` }
  }
  const durationMs = Math.round(performance.now() - startedAt)

  if (outcome.outcome === 'error') {
    // The executor hit a non-RLS error (network, migration not
    // applied, etc.). Count as a failure (not a policy violation —
    // the report's `detail` field makes the distinction clear) so
    // a regression in the test infrastructure doesn't masquerade
    // as a green test suite.
    return { test, passed: false, detail: outcome.detail, durationMs }
  }
  if (outcome.outcome === 'skipped') {
    return { test, passed: false, detail: `skipped: ${outcome.detail}`, durationMs }
  }

  // The executor returned an `allow` or `deny`. Compare to the
  // fixture's `expect`.
  const expected = test.expect
  const actual = outcome.outcome
  const passed = expected === actual
  const detail = passed
    ? `ok (actual=${actual})`
    : `expected=${expected}, actual=${actual} — ${outcome.detail}`
  return { test, passed, detail, durationMs }
}

/** Internal: split an array into chunks of `size`. */
function chunk<T>(arr: readonly T[], size: number): readonly (readonly T[])[] {
  if (size <= 0) return [arr]
  const result: T[][] = []
  for (let i = 0; i < arr.length; i += size) {
    result.push(arr.slice(i, i + size))
  }
  return result
}

/** Run the RLS test suite.
 *
 *  - `opts.executor` — the function that translates a
 *    `RlsPolicyTest` into a `RlsExecutorOutcome`. Real Supabase
 *    for live mode; throw-skips for dry-run.
 *  - `opts.tests` — defaults to `ALL_RLS_POLICIES` from
 *    `policies.ts`. Live runs may pass a subset.
 *  - `opts.mode` — written into the report so a future reader
 *    knows whether the results came from a live DB or mocks.
 *  - `opts.concurrency` — soft cap on parallel tests. Default 1.
 */
export async function runRlsTests(opts: RlsRunOptions): Promise<RlsTestReport> {
  const startedAt = new Date().toISOString()
  const tests = opts.tests ?? (await import('./policies')).ALL_RLS_POLICIES
  const concurrency = Math.max(1, opts.concurrency ?? 1)

  // Sequentially or in chunks — chunked execution is bounded by
  // `concurrency` and uses Promise.all within each chunk.
  const chunks = chunk(tests, concurrency)
  const results: RlsTestResult[] = []
  for (const group of chunks) {
    const groupResults = await Promise.all(group.map((t) => runSingle(t, opts.executor)))
    results.push(...groupResults)
  }

  const finishedAt = new Date().toISOString()
  const passed = results.filter((r) => r.passed).length
  // Skipped = test was marked passed=false with a `skipped:` prefix
  // in the detail. (We use a prefix rather than a separate field
  // so the test array shape stays uniform.) Skipped tests are NOT
  // counted as failures — they're a separate bucket.
  const skipped = results.filter(
    (r) => !r.passed && r.detail.startsWith('skipped:'),
  ).length
  const failed = results.length - passed - skipped

  return {
    mode: opts.mode,
    startedAt,
    finishedAt,
    passed,
    failed,
    skipped,
    results,
  }
}

/** Render a report as a human-readable table. Used by the CLI's
 *  default output mode.
 *
 *  The format is intentionally tight (one line per test) so the
 *  report fits in a terminal without scrolling. CI integrations
 *  can parse the JSON form (use `reportToJson`) instead. */
export function formatReport(report: RlsTestReport): string {
  const lines: string[] = []
  lines.push(
    `RLS test report — mode=${report.mode}  passed=${report.passed}  failed=${report.failed}  skipped=${report.skipped}`,
  )
  lines.push(`Started:  ${report.startedAt}`)
  lines.push(`Finished: ${report.finishedAt}`)
  lines.push('')
  lines.push(
    'table                                | op     | role                          | expect | actual  | result  | detail',
  )
  lines.push('-'.repeat(160))
  for (const r of report.results) {
    const table = r.test.table.padEnd(36)
    const op = r.test.operation.padEnd(6)
    const role = r.test.as.padEnd(30)
    const expected = r.test.expect.padEnd(6)
    const actual = r.passed ? r.test.expect : (r.detail.includes('actual=') ? extractActual(r.detail) : 'error').padEnd(7)
    const result = r.passed
      ? 'OK     '
      : r.detail.startsWith('skipped:')
        ? 'SKIP   '
        : 'FAIL   '
    const detail = r.detail
    lines.push(`${table} | ${op} | ${role} | ${expected} | ${actual} | ${result} | ${detail}`)
  }
  return lines.join('\n')
}

/** Extract the `actual=...` value from a failed-result detail
 *  string. Used by `formatReport` to render the actual column
 *  compactly. */
function extractActual(detail: string): string {
  const m = detail.match(/actual=(\w+)/)
  return m?.[1] ?? '?'
}

/** Serialize a report as JSON. The shape mirrors `RlsTestReport`
 *  exactly; no `Date` objects, no `Map` instances. */
export function reportToJson(report: RlsTestReport): string {
  return JSON.stringify(report, null, 2)
}

/** Aggregate the report by table — used by the dry-run report to
 *  print the per-table coverage matrix. */
export function aggregateByTable(
  report: RlsTestReport,
): Readonly<Record<string, { passed: number; failed: number; skipped: number }>> {
  const out: Record<string, { passed: number; failed: number; skipped: number }> = {}
  for (const r of report.results) {
    const bucket = (out[r.test.table] ??= { passed: 0, failed: 0, skipped: 0 })
    if (r.passed) bucket.passed += 1
    else if (r.detail.startsWith('skipped:')) bucket.skipped += 1
    else bucket.failed += 1
  }
  return out
}
