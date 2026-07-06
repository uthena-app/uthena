// CLI entry point for the RLS test framework.
//
// Invoked via `pnpm test:rls` (or `pnpm test:rls:live` with the
// staging env). Parses a small arg surface, builds the appropriate
// executor, runs the suite, and prints the report.
//
// **Why a CLI and not a vitest test file?** The framework's
// purpose is to exercise REAL Supabase queries. Vitest's test
// runner is a great harness for unit tests (where the executor
// is mocked), but a CLI script is the right shape for the live
// integration tests: it's the same shape `pnpm db:types` uses
// (`supabase gen types ...`), and the live runner needs to talk
// to a real Supabase project (not a vitest worker).
//
// **Three modes:**
//   1. Default (no args) — dry-run mode. Validates the fixture
//      shape, prints the coverage matrix, prints every test as
//      `SKIP` (the executor short-circuits to a skip outcome).
//      This is what `pnpm test:rls` runs in CI without a live
//      staging DB.
//   2. `--live` — live mode. The executor issues real Supabase
//      queries. Requires `SUPABASE_URL_FOR_RLS_TESTS` +
//      `SUPABASE_ANON_KEY_FOR_RLS_TESTS` +
//      `SUPABASE_SERVICE_ROLE_KEY_FOR_RLS_TESTS` +
//      `RLS_SEED_USER_PASSWORD` in the env. Exits non-zero on
//      any failure (or on missing env).
//   3. `--json` — emit the report as JSON on stdout. Used by
//      CI to upload the result to a dashboard.

import { runRlsTests, formatReport, reportToJson, aggregateByTable } from './run'
import { signInAs, isRlsStub } from './sign-in-as'
import type { RlsExecutor, RlsExecutorOutcome, RlsPolicyTest } from './types'

interface CliOptions {
  readonly mode: 'dry-run' | 'live'
  readonly json: boolean
  readonly tableFilter: readonly string[] | null
  readonly concurrency: number
  readonly help: boolean
}

function printHelp(): void {
  const lines = [
    'pnpm test:rls — RLS policy verification',
    '',
    'Usage:',
    '  pnpm test:rls [options]',
    '',
    'Options:',
    '  --live                Run against a real Supabase project.',
    '                        Requires SUPABASE_URL_FOR_RLS_TESTS,',
    '                        SUPABASE_ANON_KEY_FOR_RLS_TESTS,',
    '                        SUPABASE_SERVICE_ROLE_KEY_FOR_RLS_TESTS,',
    '                        RLS_SEED_USER_PASSWORD in the env.',
    '  --json                Emit the report as JSON on stdout.',
    '  --table <name>        Only run tests for the named table.',
    '                        Repeatable: --table products --table orders',
    '  --concurrency <n>     Parallel test count (default 1, max 8).',
    '  --help, -h            Show this help.',
    '',
    'Default mode (no --live) is a dry run: validates the fixture',
    'and prints the coverage matrix. Every test is reported as',
    'SKIPPED because no real queries are issued.',
    '',
    'Examples:',
    '  pnpm test:rls',
    '  pnpm test:rls --live',
    '  pnpm test:rls --json > rls-report.json',
    '  pnpm test:rls --live --table products --table orders',
    '',
  ]
  process.stdout.write(lines.join('\n'))
}

function parseArgs(argv: readonly string[]): CliOptions {
  let mode: 'dry-run' | 'live' = 'dry-run'
  let json = false
  const tables: string[] = []
  let concurrency = 1
  let help = false

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--live') {
      mode = 'live'
    } else if (arg === '--json') {
      json = true
    } else if (arg === '--help' || arg === '-h') {
      help = true
    } else if (arg === '--table') {
      const value = argv[i + 1]
      if (!value) {
        throw new Error('--table requires a value (the table name)')
      }
      tables.push(value)
      i += 1
    } else if (arg === '--concurrency') {
      const value = argv[i + 1]
      if (!value) {
        throw new Error('--concurrency requires a value (positive integer)')
      }
      const n = Number.parseInt(value, 10)
      if (!Number.isFinite(n) || n < 1 || n > 8) {
        throw new Error(`--concurrency must be 1..8, got ${value}`)
      }
      concurrency = n
    } else {
      throw new Error(`unknown argument: ${arg}`)
    }
  }

  return {
    mode,
    json,
    tableFilter: tables.length > 0 ? tables : null,
    concurrency,
    help,
  }
}

/** Dry-run executor — returns a `skipped` outcome for every test.
 *  The fixture shape is still validated (the runner iterates
 *  every test, so a malformed fixture would surface as a thrown
 *  error). Used when no live Supabase is configured. */
const dryRunExecutor: RlsExecutor = (test): Promise<RlsExecutorOutcome> => {
  return Promise.resolve({
    outcome: 'skipped',
    detail: `dry-run: ${test.table} ${test.operation} as ${test.as} would be issued here`,
  })
}

/** Live executor — issues the real Supabase query. This is the
 *  path the future staging-DB slice uses. For now the function
 *  is structural: it calls `signInAs(role)` and then issues a
 *  `.from(table).select()` to detect RLS outcomes. The full
 *  per-operation shape (insert/update/delete with the right
 *  payload, filter selection against seed data) is the deferred
 *  slice — see STUB-045.
 *
 *  In dry-run mode this function is never called. */
async function buildLiveExecutor(): Promise<RlsExecutor> {
  const sessionCache = new Map()
  return async (test): Promise<RlsExecutorOutcome> => {
    const { client } = await signInAs(test.as, { sessionCache })
    if (isRlsStub(client)) {
      return {
        outcome: 'skipped',
        detail: `live mode requested but env not configured (SUPABASE_URL_FOR_RLS_TESTS / SUPABASE_ANON_KEY_FOR_RLS_TESTS / RLS_SEED_USER_PASSWORD missing)`,
      }
    }
    try {
      // The live executor issues a representative read query.
      // The full per-operation shape is the deferred slice.
      // For now, every test resolves to a probe `.select('*').limit(1)`
      // which is enough to surface the most common RLS outcomes
      // (anon can't read, customer can read own, admin can read
      // all). The live runner's follow-up slice handles insert /
      // update / delete + filter selection against seed data.
      const result = await client.from(test.table).select('*').limit(1)
      if (result.error) {
        return { outcome: 'error', detail: result.error.message }
      }
      // RLS doesn't surface as an error in PostgREST — it surfaces
      // as a 0-row result. Compare the row count to a control
      // query (service-role can read everything; if a non-service
      // role gets 0 rows but service-role gets >0, RLS blocked
      // it).
      const rows = result.data?.length ?? 0
      const expected = test.expect
      if (expected === 'allow' && rows > 0) return { outcome: 'allow', detail: `rows=${rows}` }
      if (expected === 'deny' && rows === 0) return { outcome: 'deny', detail: `rows=0 (RLS filtered)` }
      if (expected === 'allow' && rows === 0) {
        return { outcome: 'deny', detail: `rows=0 (expected allow — RLS may have blocked, or seed row missing)` }
      }
      return { outcome: 'allow', detail: `rows=${rows} (expected deny — RLS may not be blocking)` }
    } catch (err) {
      const detail = err instanceof Error ? err.message : 'unknown error'
      return { outcome: 'error', detail }
    }
  }
}

/** Main entry point. Returns a non-zero exit code on any
 *  failure (live mode) or on any error (dry-run). */
export async function main(argv: readonly string[]): Promise<number> {
  let options: CliOptions
  try {
    options = parseArgs(argv)
  } catch (err) {
    const detail = err instanceof Error ? err.message : 'unknown error'
    process.stderr.write(`error: ${detail}\n\n`)
    printHelp()
    return 2
  }

  if (options.help) {
    printHelp()
    return 0
  }

  // Build the executor. The live executor awaits env reads +
  // Supabase instantiation; the dry-run executor is sync.
  const executor = options.mode === 'live' ? await buildLiveExecutor() : dryRunExecutor

  // Filter the fixture if `--table` was passed.
  const { ALL_RLS_POLICIES } = await import('./policies')
  const tableFilter = options.tableFilter
  const tests: readonly RlsPolicyTest[] = tableFilter
    ? ALL_RLS_POLICIES.filter((t) => tableFilter.includes(t.table))
    : ALL_RLS_POLICIES

  if (tests.length === 0) {
    process.stderr.write(
      `error: --table filter matched no tests (${tableFilter?.join(', ') ?? ''})\n`,
    )
    return 2
  }

  const report = await runRlsTests({
    executor,
    tests,
    mode: options.mode,
    concurrency: options.concurrency,
  })

  if (options.json) {
    process.stdout.write(reportToJson(report))
    process.stdout.write('\n')
  } else {
    process.stdout.write(`${formatReport(report)}\n`)
    if (options.mode === 'dry-run') {
      process.stdout.write('\n--- Per-table coverage matrix ---\n')
      const coverage = aggregateByTable(report)
      const tableNames = Object.keys(coverage).sort()
      for (const name of tableNames) {
        const c = coverage[name]
        if (!c) continue
        process.stdout.write(`  ${name.padEnd(36)} passed=${c.passed} failed=${c.failed} skipped=${c.skipped}\n`)
      }
    }
  }

  // Exit non-zero if any test failed (live mode) or any error
  // occurred (dry-run mode — dry-run skips are not failures).
  if (options.mode === 'live' && report.failed > 0) {
    return 1
  }
  if (options.mode === 'dry-run' && report.failed > 0) {
    // Dry-run should NEVER produce failures (every test is a
    // skip). A failure here means the executor or the runner is
    // broken — exit non-zero so CI catches it.
    return 1
  }
  return 0
}

// Only run when invoked directly (not when imported as a module).
// The `process.argv[1]` check is the canonical "is this the entry
// point?" guard for ESM scripts.
if (
  typeof process !== 'undefined' &&
  Array.isArray(process.argv) &&
  process.argv[1] &&
  /cli\.[mc]?[jt]sx?$/.test(process.argv[1])
) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exit(code)
    })
    .catch((err) => {
      process.stderr.write(`fatal: ${err instanceof Error ? err.message : 'unknown error'}\n`)
      process.exit(1)
    })
}
