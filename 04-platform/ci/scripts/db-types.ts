#!/usr/bin/env node
/* eslint-disable no-console */
// db-types.ts — TypeScript types generator wrapper (P3.7 Slice 1).
//
// Wraps `supabase gen types typescript --db-url <DATABASE_URL>` and
// writes the output to `00-foundations/data/types.generated.ts`.
// Env-gated: returns a clear "skipped" exit code if there's no DB to
// talk to (the local Supabase CLI may not be running), so CI can run
// the wrapper as a no-op outside the bootstrap workflow.
//
// Why this script exists
// ---------------------
// The README at `04-platform/migrations/README.md` §"Tested on a fresh
// DB" promises that types are regenerated against the live schema on
// every CI run. Until now, `pnpm db:types` was a one-liner that called
// the Supabase CLI directly. That worked locally (when the CLI was on
// PATH and a DB was running) but had three problems for CI:
//
//   1. No redaction of the database URL. A `postgres://...?password=...`
//      URL would leak the password to CI logs.
//   2. No atomic write. A partial write (interrupted mid-stream) would
//      leave `types.generated.ts` in a broken state, breaking the
//      typecheck on the next PR.
//   3. No "skip gracefully" behavior. If the CLI wasn't installed or
//      the DB wasn't reachable, `pnpm db:types` exited with a confusing
//      "command not found" or "connection refused" — making the
//      wrapper hard to wire into a multi-step CI job.
//
// This wrapper fixes all three.
//
// How to run
// ----------
//   DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres \
//     pnpm db:types
//
// Or with the local-Supabase default (no env var needed):
//   pnpm db:types
//
// If the Supabase CLI is missing or the DB is unreachable, the wrapper
// prints a clear "skipped" line and exits 0. This is the right
// behavior for dev machines that haven't started `supabase start`.
// CI must invoke the wrapper AFTER `pnpm db:bootstrap` so the DB is
// guaranteed to be reachable — see `.github/workflows/db-types.yml`.
//
// Why a Node script (not a shell script)
// --------------------------------------
// Mirrors the same rationale as `db-bootstrap.ts`: precise error
// attribution, future reuse of the connection pool + URL-redaction
// helper, and cross-platform behavior without `bash`/`sed`/`awk`
// dependencies.

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { performance } from 'node:perf_hooks'

import { redactDatabaseUrl } from './db-bootstrap'

const DEFAULT_LOCAL_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'

type GenerateOptions = {
  /** Override the database URL (default: $DATABASE_URL or local Supabase). */
  databaseUrl?: string
  /** Override the output file path (default: 00-foundations/data/types.generated.ts). */
  outputPath?: string
  /**
   * When true, skip the call entirely if the CLI is missing or the DB
   * URL doesn't look reachable (no `preflight` probe). Used by CI's
   * "soft" jobs that want to gate on explicit bootstrap success.
   * Default: false (always attempt, report failure).
   */
  skipIfUnavailable?: boolean
}

type GenerateResult = {
  /** True if the file was generated and committed to disk. */
  ok: boolean
  /** True if the call was skipped (CLI missing or DB unreachable). */
  skipped: boolean
  /** Reason for the skip / failure (human-readable). */
  reason?: string
  /** Path to the generated file (only set when ok=true). */
  outputPath?: string
  /** Number of bytes written (only set when ok=true). */
  bytes?: number
  /** Wall-clock duration in ms (only set when attempted, not skipped). */
  durationMs?: number
}

const REPO_ROOT = process.cwd()
const DEFAULT_OUTPUT_PATH = join(REPO_ROOT, '00-foundations', 'data', 'types.generated.ts')

/**
 * Locate the `supabase` CLI binary. The Supabase CLI is a Node package
 * installed via `pnpm`, so `pnpm exec supabase` is the portable
 * invocation (works whether or not `supabase` is on the user's PATH).
 *
 * Returns null if the CLI isn't installed (e.g. a fresh `pnpm install`
 * before the devDeps are pulled). The wrapper treats this as a
 * "skipped, not failed" condition.
 */
function findSupabaseCli(): 'pnpm' | 'bare' | null {
  // Prefer `pnpm exec` — works in any workspace where `supabase` is a
  // devDep (which it is in this repo; see package.json devDependencies).
  // Fall back to bare `supabase` if the user has it on PATH (useful
  // when running the script outside pnpm, e.g. via `tsx db-types.ts`).
  try {
    const check = spawnSync('pnpm', ['exec', '--', 'supabase', '--version'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 10000,
    })
    if (check.status === 0) return 'pnpm'
  } catch {
    // pnpm missing — fall through
  }
  try {
    const check = spawnSync('supabase', ['--version'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 10000,
    })
    if (check.status === 0) return 'bare'
  } catch {
    // bare missing too
  }
  return null
}

/**
 * Run `supabase gen types typescript --db-url <URL>` and capture stdout.
 *
 * Returns the raw TypeScript source on success, or an error message on
 * failure. Never throws — callers translate the result into a
 * structured `GenerateResult`.
 */
function runSupabaseGenTypes(
  cli: 'pnpm' | 'bare',
  databaseUrl: string,
): { ok: true; typescript: string } | { ok: false; error: string } {
  const args =
    cli === 'pnpm'
      ? ['exec', '--', 'supabase', 'gen', 'types', 'typescript', '--db-url', databaseUrl]
      : ['gen', 'types', 'typescript', '--db-url', databaseUrl]

  const result = spawnSync(cli === 'pnpm' ? 'pnpm' : 'supabase', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 60000, // 60s — matches the statement timeout in db-bootstrap
  })

  if (result.error) {
    return { ok: false, error: result.error.message }
  }
  if (result.status !== 0) {
    const stderr = (result.stderr ?? '').trim()
    return { ok: false, error: stderr || `supabase exited with status ${result.status}` }
  }
  const stdout = result.stdout ?? ''
  if (stdout.trim().length === 0) {
    return { ok: false, error: 'supabase gen types returned empty output (is the DB reachable?)' }
  }
  return { ok: true, typescript: stdout }
}

/**
 * Write the generated types to disk atomically. We write to a temp
 * file in the same directory, then `rename()` it over the destination
 * — `rename()` is atomic on POSIX filesystems within the same
 * directory, so a reader (e.g. the next typecheck run) never sees a
 * partial file.
 */
function atomicWrite(outputPath: string, contents: string): number {
  const dir = dirname(outputPath)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  const tmpPath = `${outputPath}.${process.pid}.${Date.now()}.tmp`
  writeFileSync(tmpPath, contents, 'utf8')
  renameSync(tmpPath, outputPath)
  return Buffer.byteLength(contents, 'utf8')
}

/**
 * The main entry point. Generates types, writes atomically, returns a
 * structured report.
 *
 * Behavior matrix:
 * - CLI missing + skipIfUnavailable → { ok: false, skipped: true, reason }
 * - CLI missing + !skipIfUnavailable → { ok: false, skipped: false, reason }
 * - CLI present, DB unreachable → { ok: false, skipped: false, reason }
 * - CLI present, DB reachable → { ok: true, skipped: false, ... }
 *
 * The caller (CI or a developer) decides what to do with a non-ok
 * result. We never throw — the goal is to give the caller a clean
 * structured outcome.
 */
export async function generateTypes(opts: GenerateOptions = {}): Promise<GenerateResult> {
  const databaseUrl = opts.databaseUrl ?? process.env.DATABASE_URL ?? DEFAULT_LOCAL_URL
  const outputPath = opts.outputPath ?? DEFAULT_OUTPUT_PATH
  const skipIfUnavailable = opts.skipIfUnavailable ?? false

  const cli = findSupabaseCli()
  if (!cli) {
    const reason =
      'supabase CLI not found — install devDependencies (`pnpm install`) or add it to PATH'
    console.log(`[db:types] skipped: ${reason}`)
    return { ok: false, skipped: skipIfUnavailable, reason }
  }

  console.log(`[db:types] database=${redactDatabaseUrl(databaseUrl)}`)
  console.log(`[db:types] output=${outputPath}`)
  console.log(`[db:types] cli=${cli === 'pnpm' ? 'pnpm exec supabase' : 'supabase'}`)

  const startedAt = performance.now()
  const run = runSupabaseGenTypes(cli, databaseUrl)
  const durationMs = Math.round(performance.now() - startedAt)

  if (!run.ok) {
    // One common case: the DB is reachable but the `supabase` CLI can't
    // introspect it because the local stack isn't started. We surface
    // the CLI's own error message verbatim — it usually says
    // "connection refused" or "could not find project", which is more
    // actionable than our wrapper's "unknown error".
    console.error(`[db:types] FAILED (${durationMs}ms): ${run.error}`)
    return { ok: false, skipped: false, reason: run.error, durationMs }
  }

  // Add a generated-by header so future maintainers (and the CI drift
  // check) can tell the file at a glance. The header is intentionally
  // minimal — the supabase CLI emits its own header, so ours is one
  // line, separated by a blank line, and clearly marked as a wrapper
  // annotation.
  const annotated = `// AUTO-GENERATED by pnpm db:types (P3.7) — do not hand-edit.\n// Regenerate with: pnpm db:types\n// Last regenerated against: ${databaseUrl.replace(/\/\/[^@]+@/, '//***@')}\n\n${run.typescript}`

  const bytes = atomicWrite(outputPath, annotated)
  console.log(`[db:types] ok (${durationMs}ms, ${bytes} bytes)`)
  return { ok: true, skipped: false, outputPath, bytes, durationMs }
}

/**
 * Read the current generated types file (if it exists) and return its
 * content. Used by `check-types-fresh.ts` to compare against a fresh
 * generation.
 */
export function readGeneratedTypes(outputPath: string = DEFAULT_OUTPUT_PATH): string | null {
  if (!existsSync(outputPath)) return null
  return readFileSync(outputPath, 'utf8')
}

// CLI entry point — only runs when invoked directly.
function isDirectInvocation(): boolean {
  if (!process.argv[1]) return false
  return process.argv[1].endsWith('db-types.ts') || process.argv[1].endsWith('db-types')
}

/**
 * Parse CLI flags into GenerateOptions. The db-types.yml drift check
 * invokes `pnpm tsx db-types.ts --outputPath=/tmp/types.generated.ts`
 * so the committed file stays untouched during comparison — before this
 * parser existed the flag was silently ignored and the wrapper always
 * wrote to the default committed path. Accepts both `--outputPath=x`
 * and `--outputPath x` forms; unknown flags are ignored.
 */
export function parseCliArgs(argv: readonly string[]): GenerateOptions {
  const opts: GenerateOptions = {}
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === undefined) continue
    if (arg.startsWith('--outputPath=')) {
      const value = arg.slice('--outputPath='.length)
      if (value) opts.outputPath = value
    } else if (arg === '--outputPath') {
      const next = argv[i + 1]
      if (next && !next.startsWith('--')) {
        opts.outputPath = next
        i++
      }
    }
  }
  return opts
}

if (isDirectInvocation()) {
  generateTypes(parseCliArgs(process.argv.slice(2)))
    .then((result) => {
      if (!result.ok && !result.skipped) {
        console.error(`[db:types] aborted: ${result.reason ?? 'unknown error'}`)
        process.exit(1)
      }
      // ok or skipped — exit 0 in both cases.
    })
    .catch((err) => {
      console.error('[db:types] unexpected error:', err instanceof Error ? err.message : err)
      process.exit(2)
    })
}
