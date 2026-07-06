#!/usr/bin/env node
/* eslint-disable no-console */
// check-types-fresh.ts — Drift detector for the generated types file (P3.7 Slice 1).
//
// Compares the on-disk `00-foundations/data/types.generated.ts` against
// a fresh generation from the live database. Exits 0 if they match
// (types are up-to-date), 1 if they differ (someone added a migration
// without regenerating types), 2 if the generation itself failed.
//
// Why this script exists
// ---------------------
// The P3.7 contract is "no hand-written DB types in the codebase."
// That contract has two halves:
//   1. The CI workflow regenerates types on every push to main.
//   2. Pull requests fail if the regenerated types differ from what's
//      committed.
//
// Without (2), (1) is useless — a contributor could land a migration
// without regenerating types, and CI on main would silently drift.
// This script IS the (2) half. It belongs in CI's PR job, not the
// push-to-main job (which auto-commits the regenerated types).
//
// How to run
// ----------
//   DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres \
//     pnpm db:types:check
//
// Exit codes (CI-consistent):
//   0 — types are up-to-date (or the generation was skipped because
//       no DB was reachable — the caller is expected to run this AFTER
//       `pnpm db:bootstrap`, so this case should not happen in CI).
//   1 — types are stale; the committed file differs from a fresh
//       generation. Run `pnpm db:types` locally and commit the result.
//   2 — generation itself failed (CLI missing, DB unreachable, etc.).
//       Fix the environment before re-running.
//   3 — no generated file exists yet. First-time setup: run
//       `pnpm db:types` once to create the file, then commit it.

import { generateTypes } from './db-types'
import { readGeneratedTypes } from './db-types'

const DEFAULT_OUTPUT_PATH = '00-foundations/data/types.generated.ts'

export type FreshnessResult =
  | { status: 'fresh'; bytes: number }
  | { status: 'stale'; committedBytes: number; generatedBytes: number; diff: string }
  | { status: 'missing'; reason: string }
  | { status: 'generation-failed'; reason: string }

export async function checkTypesFresh(
  outputPath: string = DEFAULT_OUTPUT_PATH,
): Promise<FreshnessResult> {
  const committed = readGeneratedTypes(outputPath)

  // Generate to a temp path so we don't mutate the on-disk file. We
  // don't compare in memory directly because we want to mirror the
  // production write path (same annotation header, same atomic write).
  const tempPath = `${outputPath}.fresh-check.${process.pid}.${Date.now()}.tmp`
  const generated = await generateTypes({ outputPath: tempPath })

  if (!generated.ok) {
    return { status: 'generation-failed', reason: generated.reason ?? 'unknown error' }
  }

  // After generation, the temp file should exist. Read it back.
  // We do not use readGeneratedTypes here because that helper returns
  // the default repo-root path — we need the explicit temp path.
  const fresh = await readFileSafe(tempPath)
  if (fresh === null) {
    return { status: 'generation-failed', reason: 'generated file disappeared before read-back' }
  }

  // Compare against the committed file.
  if (committed === null) {
    // No committed file — first-run case.
    return {
      status: 'missing',
      reason: `no committed types.generated.ts at ${outputPath}; run \`pnpm db:types\` and commit the result`,
    }
  }

  if (committed === fresh) {
    return { status: 'fresh', bytes: committed.length }
  }

  // Drift — build a human-readable diff hint. We don't run a real
  // diff(1) because the script must work without a shell dependency;
  // the line-count difference + a truncated preview is enough to
  // point the contributor in the right direction.
  const committedLines = committed.split('\n').length
  const freshLines = fresh.split('\n').length
  return {
    status: 'stale',
    committedBytes: committed.length,
    generatedBytes: fresh.length,
    diff: `${committedLines} committed lines vs ${freshLines} fresh lines`,
  }
}

/**
 * Minimal fs wrapper that returns null instead of throwing on ENOENT.
 * Inline here so this file doesn't grow a third fs-import line; the
 * contract is identical to `readGeneratedTypes` except for the path.
 */
async function readFileSafe(path: string): Promise<string | null> {
  const { readFileSync } = await import('node:fs')
  try {
    return readFileSync(path, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }
}

// CLI entry point — only runs when invoked directly.
function isDirectInvocation(): boolean {
  if (!process.argv[1]) return false
  return (
    process.argv[1].endsWith('check-types-fresh.ts') || process.argv[1].endsWith('check-types-fresh')
  )
}

if (isDirectInvocation()) {
  checkTypesFresh()
    .then((result) => {
      switch (result.status) {
        case 'fresh':
          console.log(`[check-types-fresh] fresh (${result.bytes} bytes)`)
          process.exit(0)
          break
        case 'stale':
          console.error('[check-types-fresh] STALE')
          console.error(`[check-types-fresh] committed=${result.committedBytes} generated=${result.generatedBytes}`)
          console.error(`[check-types-fresh] diff hint: ${result.diff}`)
          console.error('[check-types-fresh] run `pnpm db:types` and commit the result')
          process.exit(1)
          break
        case 'missing':
          console.error(`[check-types-fresh] MISSING: ${result.reason}`)
          process.exit(3)
          break
        case 'generation-failed':
          console.error(`[check-types-fresh] generation failed: ${result.reason}`)
          process.exit(2)
          break
      }
    })
    .catch((err) => {
      console.error(
        '[check-types-fresh] unexpected error:',
        err instanceof Error ? err.message : err,
      )
      process.exit(2)
    })
}
