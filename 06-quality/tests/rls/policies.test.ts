// Unit tests for the policy-list fixture.
//
// These tests validate the SHAPE of the fixture, not the policies
// themselves. The policies are exercised by the live runner (the
// deferred slice). The unit tests catch:
//   - duplicate (table, operation, role) keys
//   - missing policies for a high-priority table
//   - malformed filter/note fields
//   - drift between the RlsRole union and the `as` values
//
// Run: `pnpm test rls-policies`.

import { describe, expect, it } from 'vitest'
import { ALL_RLS_POLICIES, tablesInFixture, fixtureCoverage, SELF_READ, APPEND_ONLY, PUBLIC_READ, ADMIN_ONLY } from './policies'
import { RLS_ROLES } from './roles'

describe('ALL_RLS_POLICIES', () => {
  it('is a non-empty array', () => {
    expect(ALL_RLS_POLICIES.length).toBeGreaterThan(0)
  })

  it('every entry has a well-formed RlsPolicyTest shape', () => {
    for (const test of ALL_RLS_POLICIES) {
      expect(test.table).toMatch(/^[a-z_][a-z0-9_]*$/)
      expect(['select', 'insert', 'update', 'delete']).toContain(test.operation)
      expect(RLS_ROLES).toContain(test.as)
      expect(['allow', 'deny']).toContain(test.expect)
      expect(typeof test.note).toBe('string')
      expect(test.note.length).toBeGreaterThan(0)
      if (test.filter !== undefined) {
        expect(typeof test.filter).toBe('string')
        expect(test.filter.length).toBeGreaterThan(0)
      }
    }
  })

  it('has no duplicate (table, operation, role, filter?) keys', () => {
    const seen = new Set<string>()
    const dupes: string[] = []
    for (const test of ALL_RLS_POLICIES) {
      const key = `${test.table}|${test.operation}|${test.as}|${test.filter ?? ''}`
      if (seen.has(key)) {
        dupes.push(key)
      }
      seen.add(key)
    }
    expect(dupes).toEqual([])
  })
})

describe('tablesInFixture', () => {
  it('returns the sorted set of tables covered by the fixture', () => {
    const tables = tablesInFixture()
    expect(tables.length).toBeGreaterThan(0)
    const sorted = [...tables].sort()
    expect(tables).toEqual(sorted)
  })

  it('covers every table in SELF_READ at least once', () => {
    const tables = new Set(tablesInFixture())
    for (const t of SELF_READ) {
      expect(tables.has(t)).toBe(true)
    }
  })

  it('covers every table in APPEND_ONLY at least once', () => {
    const tables = new Set(tablesInFixture())
    for (const t of APPEND_ONLY) {
      expect(tables.has(t)).toBe(true)
    }
  })

  it('covers every table in PUBLIC_READ at least once', () => {
    const tables = new Set(tablesInFixture())
    for (const t of PUBLIC_READ) {
      expect(tables.has(t)).toBe(true)
    }
  })

  it('covers every table in ADMIN_ONLY at least once', () => {
    const tables = new Set(tablesInFixture())
    for (const t of ADMIN_ONLY) {
      expect(tables.has(t)).toBe(true)
    }
  })
})

describe('fixtureCoverage', () => {
  it('every count is at least 1', () => {
    const coverage = fixtureCoverage()
    for (const key of Object.keys(coverage)) {
      expect(coverage[key]).toBeGreaterThanOrEqual(1)
    }
  })

  it('the total of all coverage counts equals the fixture size', () => {
    const coverage = fixtureCoverage()
    const total = Object.values(coverage).reduce((sum, n) => sum + n, 0)
    expect(total).toBe(ALL_RLS_POLICIES.length)
  })
})
