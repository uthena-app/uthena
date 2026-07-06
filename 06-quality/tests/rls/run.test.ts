// Unit tests for the `runRlsTests` runner.
//
// Pure tests — the runner's executor is injected, so the tests
// can fake any RLS outcome (allow, deny, error, skipped) without
// touching the network.
//
// What the tests cover:
//   - the runner iterates every test in the fixture
//   - it compares the executor's outcome to the fixture's expect
//   - the report's passed/failed/skipped counts add up
//   - errors in the executor are reported as failures (not
//     swallowed)
//   - the formatReport + reportToJson + aggregateByTable helpers
//     produce the right shapes
//   - concurrency=2 issues the tests in two parallel chunks
//     (verified via a counter that tracks the in-flight count)
//
// Run: `pnpm test rls-run`.

import { describe, expect, it, vi } from 'vitest'
import { runRlsTests, formatReport, reportToJson, aggregateByTable } from './run'
import type {
  RlsExecutor,
  RlsExecutorOutcome,
  RlsPolicyTest,
  RlsTestReport,
} from './types'

const T = (
  table: string,
  op: RlsPolicyTest['operation'],
  as: RlsPolicyTest['as'],
  expect: RlsPolicyTest['expect'],
): RlsPolicyTest => ({
  table,
  operation: op,
  as,
  expect,
  note: `unit test fixture row: ${table}/${op}/${as}`,
})

describe('runRlsTests', () => {
  it('counts a passing test as passed', async () => {
    const executor: RlsExecutor = (test) =>
      Promise.resolve({ outcome: test.expect, detail: 'ok' })
    const report = await runRlsTests({
      executor,
      tests: [T('products', 'select', 'anon', 'allow')],
      mode: 'mocked',
    })
    expect(report.passed).toBe(1)
    expect(report.failed).toBe(0)
    expect(report.skipped).toBe(0)
    expect(report.results[0]?.passed).toBe(true)
  })

  it('counts a deny-outcome on an expect-allow test as a failure', async () => {
    const executor: RlsExecutor = () =>
      Promise.resolve({ outcome: 'deny', detail: 'rows=0' })
    const report = await runRlsTests({
      executor,
      tests: [T('products', 'select', 'anon', 'allow')],
      mode: 'mocked',
    })
    expect(report.passed).toBe(0)
    expect(report.failed).toBe(1)
    expect(report.results[0]?.passed).toBe(false)
    expect(report.results[0]?.detail).toContain('expected=allow')
    expect(report.results[0]?.detail).toContain('actual=deny')
  })

  it('counts a skip outcome as a non-failure (skipped, not failed)', async () => {
    const executor: RlsExecutor = () =>
      Promise.resolve({ outcome: 'skipped', detail: 'no DB' })
    const report = await runRlsTests({
      executor,
      tests: [T('orders', 'select', 'anon', 'deny')],
      mode: 'dry-run',
    })
    expect(report.passed).toBe(0)
    expect(report.failed).toBe(0)
    expect(report.skipped).toBe(1)
    expect(report.results[0]?.passed).toBe(false)
    expect(report.results[0]?.detail).toContain('skipped:')
  })

  it('counts an error outcome as a failure (not a skip)', async () => {
    const executor: RlsExecutor = () =>
      Promise.resolve({ outcome: 'error', detail: 'network down' })
    const report = await runRlsTests({
      executor,
      tests: [T('orders', 'select', 'anon', 'deny')],
      mode: 'live',
    })
    expect(report.passed).toBe(0)
    expect(report.failed).toBe(1)
    expect(report.skipped).toBe(0)
    expect(report.results[0]?.detail).toContain('network down')
  })

  it('captures a thrown error from the executor as an error outcome', async () => {
    const executor: RlsExecutor = () => {
      throw new Error('boom')
    }
    const report = await runRlsTests({
      executor,
      tests: [T('products', 'select', 'anon', 'deny')],
      mode: 'mocked',
    })
    expect(report.failed).toBe(1)
    expect(report.results[0]?.detail).toContain('executor threw')
    expect(report.results[0]?.detail).toContain('boom')
  })

  it('aggregates passed + failed + skipped correctly across many tests', async () => {
    const executor: RlsExecutor = (test) => {
      if (test.table === 'skip_me') {
        return Promise.resolve({ outcome: 'skipped', detail: 'dry-run' })
      }
      return Promise.resolve({ outcome: test.expect, detail: 'ok' })
    }
    const tests: RlsPolicyTest[] = [
      T('a', 'select', 'anon', 'allow'),
      T('b', 'select', 'anon', 'deny'),
      T('c', 'select', 'anon', 'allow'),
      T('skip_me', 'select', 'anon', 'deny'),
    ]
    const report = await runRlsTests({ executor, tests, mode: 'mocked' })
    expect(report.passed).toBe(3)
    expect(report.skipped).toBe(1)
    expect(report.failed).toBe(0)
  })

  it('records mode, startedAt, finishedAt on the report', async () => {
    const executor: RlsExecutor = (test) =>
      Promise.resolve({ outcome: test.expect, detail: 'ok' })
    const before = Date.now()
    const report = await runRlsTests({
      executor,
      tests: [T('products', 'select', 'anon', 'allow')],
      mode: 'mocked',
    })
    const after = Date.now()
    expect(report.mode).toBe('mocked')
    expect(new Date(report.startedAt).getTime()).toBeGreaterThanOrEqual(before - 5)
    expect(new Date(report.finishedAt).getTime()).toBeLessThanOrEqual(after + 5)
  })

  it('respects concurrency > 1 (parallel chunks)', async () => {
    let inFlight = 0
    let maxInFlight = 0
    const executor: RlsExecutor = async (test) => {
      inFlight += 1
      maxInFlight = Math.max(maxInFlight, inFlight)
      // Simulate a 20ms query so the parallel chunks overlap.
      await new Promise((resolve) => setTimeout(resolve, 20))
      inFlight -= 1
      return { outcome: test.expect, detail: 'ok' }
    }
    const tests: RlsPolicyTest[] = Array.from({ length: 8 }, (_, i) =>
      T(`t${i}`, 'select', 'anon', 'allow'),
    )
    await runRlsTests({ executor, tests, mode: 'mocked', concurrency: 4 })
    // With concurrency=4 and 8 tests, two chunks of 4 run in
    // parallel — the peak in-flight should be 4, not 1.
    expect(maxInFlight).toBe(4)
  })
})

describe('formatReport', () => {
  it('includes the summary line + every test row', async () => {
    const executor: RlsExecutor = (test) =>
      Promise.resolve({ outcome: test.expect, detail: 'ok' })
    const report = await runRlsTests({
      executor,
      tests: [
        T('products', 'select', 'anon', 'allow'),
        T('orders', 'select', 'anon', 'deny'),
      ],
      mode: 'mocked',
    })
    const text = formatReport(report)
    expect(text).toContain('RLS test report')
    expect(text).toContain('mode=mocked')
    expect(text).toContain('passed=2')
    expect(text).toContain('products')
    expect(text).toContain('orders')
  })

  it('marks failures clearly', async () => {
    const executor: RlsExecutor = () =>
      Promise.resolve({ outcome: 'deny', detail: 'rows=0' })
    const report = await runRlsTests({
      executor,
      tests: [T('products', 'select', 'anon', 'allow')],
      mode: 'mocked',
    })
    const text = formatReport(report)
    expect(text).toContain('FAIL')
  })
})

describe('reportToJson', () => {
  it('round-trips through JSON.parse', async () => {
    const executor: RlsExecutor = (test) =>
      Promise.resolve({ outcome: test.expect, detail: 'ok' })
    const report = await runRlsTests({
      executor,
      tests: [T('products', 'select', 'anon', 'allow')],
      mode: 'mocked',
    })
    const parsed = JSON.parse(reportToJson(report)) as RlsTestReport
    expect(parsed.passed).toBe(report.passed)
    expect(parsed.results).toHaveLength(report.results.length)
  })
})

describe('aggregateByTable', () => {
  it('groups results by table and counts passed/failed/skipped', async () => {
    const executor: RlsExecutor = (test) => {
      if (test.table === 'skip_me') {
        return Promise.resolve({ outcome: 'skipped', detail: 'dry-run' })
      }
      if (test.table === 'fail_me') {
        return Promise.resolve({ outcome: 'deny', detail: 'rows=0' })
      }
      return Promise.resolve({ outcome: test.expect, detail: 'ok' })
    }
    const report = await runRlsTests({
      executor,
      tests: [
        T('products', 'select', 'anon', 'allow'),
        T('orders', 'select', 'anon', 'deny'),
        T('skip_me', 'select', 'anon', 'deny'),
        T('fail_me', 'select', 'anon', 'allow'),
      ],
      mode: 'mocked',
    })
    const agg = aggregateByTable(report)
    expect(agg.products).toEqual({ passed: 1, failed: 0, skipped: 0 })
    expect(agg.orders).toEqual({ passed: 1, failed: 0, skipped: 0 })
    expect(agg['skip_me']).toEqual({ passed: 0, failed: 0, skipped: 1 })
    expect(agg['fail_me']).toEqual({ passed: 0, failed: 1, skipped: 0 })
  })
})
