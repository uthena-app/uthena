// db-bootstrap.test.ts — Unit tests for `db-bootstrap.ts` (P3.6 Slice 1).
//
// What we test (no DB required)
// -----------------------------
// - `listMigrations` filters out non-SQL files, ignores `_` prefix,
//   returns numeric (lexicographic) order, and matches the real
//   `04-platform/migrations/` directory layout.
// - `redactDatabaseUrl` hides the password component of a Postgres
//   URL while preserving the rest of the structure.
//
// What we intentionally do NOT test
// ----------------------------------
// - The actual SQL execution path. That requires a live Postgres
//   and is exercised by `db:bootstrap` in CI / locally against the
//   real Supabase Postgres. Mocking `pg.Pool.query()` here would
//   only test that we call `query()` the right number of times —
//   it would NOT verify that the SQL parses cleanly against a real
//   server. Better to keep this file fast + pure and run the
//   integration check separately.
//
// Run: `pnpm test db-bootstrap`.

import { writeFileSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, afterAll } from 'vitest'

import { listMigrations, redactDatabaseUrl } from './db-bootstrap'

describe('listMigrations', () => {
  const tmpDirs: string[] = []

  afterAll(() => {
    for (const d of tmpDirs) rmSync(d, { recursive: true, force: true })
  })

  function makeTmp(label: string): string {
    const d = join(tmpdir(), `db-bootstrap-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(d, { recursive: true })
    tmpDirs.push(d)
    return d
  }

  it('returns an empty array when no .sql files exist', () => {
    const dir = makeTmp('empty')
    expect(listMigrations(dir)).toEqual([])
  })

  it('returns only .sql files, ignoring .md and .txt', () => {
    const dir = makeTmp('mixed')
    writeFileSync(join(dir, '0001_initial.sql'), '-- init')
    writeFileSync(join(dir, 'README.md'), '# docs')
    writeFileSync(join(dir, 'notes.txt'), 'notes')
    expect(listMigrations(dir)).toEqual(['0001_initial.sql'])
  })

  it('ignores files starting with _ (draft convention)', () => {
    const dir = makeTmp('draft')
    writeFileSync(join(dir, '_draft.sql'), '-- draft')
    writeFileSync(join(dir, '0001_initial.sql'), '-- init')
    expect(listMigrations(dir)).toEqual(['0001_initial.sql'])
  })

  it('returns migrations in lexicographic order', () => {
    const dir = makeTmp('order')
    writeFileSync(join(dir, '0027_late.sql'), '-- late')
    writeFileSync(join(dir, '0001_initial.sql'), '-- init')
    writeFileSync(join(dir, '0014_middle.sql'), '-- middle')
    expect(listMigrations(dir)).toEqual([
      '0001_initial.sql',
      '0014_middle.sql',
      '0027_late.sql',
    ])
  })

  it('matches the real 04-platform/migrations/ directory layout (smoke check)', () => {
    const realDir = join(process.cwd(), '04-platform', 'migrations')
    const result = listMigrations(realDir)
    // 27 migrations as of P3.6. Stay loose — 20+ is fine; 100+ is
    // fine; we just want to catch a regression where a non-SQL file
    // sneaks into the result set or the count suddenly drops.
    expect(result.length).toBeGreaterThan(20)
    expect(result.every((f) => /^\d{4}_.*\.sql$/.test(f))).toBe(true)
    const sorted = [...result].sort((a, b) => a.localeCompare(b))
    expect(result).toEqual(sorted)
    expect(result.some((f) => f.endsWith('.md'))).toBe(false)
  })
})

describe('redactDatabaseUrl', () => {
  it('hides the password component of a standard Postgres URL', () => {
    expect(redactDatabaseUrl('postgresql://user:secret@host:5432/db')).toBe(
      'postgresql://user:***@host:5432/db',
    )
  })

  it('leaves a URL without a password unchanged', () => {
    expect(redactDatabaseUrl('postgresql://user@host:5432/db')).toBe(
      'postgresql://user@host:5432/db',
    )
  })

  it('returns a placeholder for a URL that fails to parse', () => {
    expect(redactDatabaseUrl('not-a-url')).toBe('<unparseable-url>')
  })

  it('preserves query params (e.g. sslmode) when redacting', () => {
    const result = redactDatabaseUrl('postgresql://user:secret@host:5432/db?sslmode=require')
    expect(result).toContain('***')
    expect(result).toContain('sslmode=require')
    expect(result).not.toContain('secret')
  })
})