// Unit tests for the CLI.
//
// We test `main(argv)` directly — the function returns a process
// exit code, prints to stdout/stderr, and the tests capture the
// output by spying on `process.stdout.write` / `process.stderr.write`.
//
// The CLI's "live" mode is NOT tested here — that path needs a
// real Supabase (the deferred slice). The unit tests cover:
//   - `--help` (exit 0, help text on stdout)
//   - unknown arguments (exit 2, error on stderr)
//   - `--table` / `--concurrency` validation
//   - default dry-run mode (every test is SKIPPED, exit 0)
//   - `--json` output is valid JSON
//   - `--table` filter restricts the suite
//
// Run: `pnpm test rls-cli`.

import { describe, expect, it, afterEach } from 'vitest'
import { main } from './cli'

/** Spy on a writable stream and capture every write. Returns the
 *  restore function. The spy replaces `write` on the stream
 *  directly so the CLI's `process.stdout.write(...)` calls land
 *  in the captured array. */
function spyStream(stream: NodeJS.WritableStream): {
  writes: string[]
  restore: () => void
} {
  const writes: string[] = []
  const original = (stream as { write: (...args: unknown[]) => unknown }).write.bind(stream)
  const spy = (chunk: string | Uint8Array): boolean => {
    writes.push(typeof chunk === 'string' ? chunk : chunk.toString())
    return true
  }
  ;(stream as { write: (...args: unknown[]) => unknown }).write = spy as never
  return {
    writes,
    restore: () => {
      ;(stream as { write: (...args: unknown[]) => unknown }).write = original as never
    },
  }
}

describe('CLI', () => {
  const spies: Array<() => void> = []
  afterEach(() => {
    while (spies.length > 0) {
      const restore = spies.pop()
      if (restore) restore()
    }
  })

  it('prints help and exits 0 on --help', async () => {
    const stdout = spyStream(process.stdout)
    spies.push(stdout.restore)
    const code = await main(['--help'])
    expect(code).toBe(0)
    const output = stdout.writes.join('')
    expect(output).toContain('pnpm test:rls')
    expect(output).toContain('--live')
    expect(output).toContain('--json')
  })

  it('rejects unknown arguments with a non-zero exit', async () => {
    const stderr = spyStream(process.stderr)
    spies.push(stderr.restore)
    const code = await main(['--bogus'])
    expect(code).toBe(2)
    expect(stderr.writes.join('')).toContain('unknown argument: --bogus')
  })

  it('rejects --table with no value', async () => {
    const stderr = spyStream(process.stderr)
    spies.push(stderr.restore)
    const code = await main(['--table'])
    expect(code).toBe(2)
    expect(stderr.writes.join('')).toContain('--table requires a value')
  })

  it('rejects --concurrency out of range', async () => {
    const stderr = spyStream(process.stderr)
    spies.push(stderr.restore)
    const code = await main(['--concurrency', '99'])
    expect(code).toBe(2)
    expect(stderr.writes.join('')).toContain('must be 1..8')
  })

  it('runs the dry-run default and prints the coverage matrix', async () => {
    const stdout = spyStream(process.stdout)
    spies.push(stdout.restore)
    const code = await main([])
    expect(code).toBe(0)
    const output = stdout.writes.join('')
    expect(output).toContain('RLS test report')
    expect(output).toContain('Per-table coverage matrix')
    expect(output).toContain('SKIP')
    expect(output).not.toContain('FAIL')
  })

  it('emits JSON on stdout with --json', async () => {
    const stdout = spyStream(process.stdout)
    spies.push(stdout.restore)
    const code = await main(['--json', '--table', 'products'])
    expect(code).toBe(0)
    const output = stdout.writes.join('')
    const parsed = JSON.parse(output) as { mode: string; results: unknown[] }
    expect(parsed.mode).toBe('dry-run')
    expect(Array.isArray(parsed.results)).toBe(true)
    expect(parsed.results.length).toBeGreaterThan(0)
  })

  it('respects --table filter', async () => {
    const stdout = spyStream(process.stdout)
    spies.push(stdout.restore)
    const code = await main(['--table', 'products', '--table', 'orders', '--json'])
    expect(code).toBe(0)
    const output = stdout.writes.join('')
    const parsed = JSON.parse(output) as { results: { test: { table: string } }[] }
    const tables = new Set(parsed.results.map((r) => r.test.table))
    expect(tables.has('products')).toBe(true)
    expect(tables.has('orders')).toBe(true)
    expect(tables.size).toBeLessThanOrEqual(2)
  })
})
