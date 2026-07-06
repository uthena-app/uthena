// filterVaultFiles.test.ts — unit tests for the pure P7.9 helper.
// Covers: empty input, no-filter passthrough, each filter dimension
// individually, combined filters, the date boundary, defensive
// handling of null created_at + invalid dates, and sinceDays
// edge cases ('all' / 0 / negative).

import { describe, expect, it } from 'vitest'
import type { VaultFile } from './queries/getUserAccessibleFiles'
import { filterVaultFiles } from './filterVaultFiles'

function file(overrides: Partial<VaultFile>): VaultFile {
  return {
    id: 1,
    product_id: 100,
    product_title: 'Default',
    product_slug: 'default',
    kind: 'document',
    original_filename: 'a.pdf',
    size_bytes: 1024,
    duration_seconds: null,
    hls_manifest_url: null,
    created_at: '2026-06-01T00:00:00Z',
    last_accessed_at: null,
    ...overrides,
  }
}

// Fixed `now` so date math is deterministic. The fixture files use
// timestamps relative to this moment:
//   - 1 day ago  → "2026-06-25T12:00:00Z"
//   - 60 days ago → "2026-04-27T12:00:00Z"
//   - 400 days ago → "2025-05-24T12:00:00Z"
const NOW = new Date('2026-06-26T12:00:00Z')
const ONE_DAY_AGO = '2026-06-25T12:00:00Z'
const SIXTY_DAYS_AGO = '2026-04-27T12:00:00Z'
const FOUR_HUNDRED_DAYS_AGO = '2025-05-24T12:00:00Z'

describe('filterVaultFiles', () => {
  it('returns an empty array for an empty input', () => {
    expect(filterVaultFiles([])).toEqual([])
    expect(filterVaultFiles([], { productId: 10 })).toEqual([])
  })

  it('returns the input as-is when no filters are set', () => {
    const input = [
      file({ id: 1 }),
      file({ id: 2, product_id: 200 }),
      file({ id: 3, kind: 'video' }),
    ]
    const result = filterVaultFiles(input, {}, NOW)
    expect(result).toEqual(input)
  })

  it('does not mutate the input array', () => {
    const input = [file({ id: 1 }), file({ id: 2, product_id: 200 })]
    const snapshot = [...input]
    filterVaultFiles(input, { productId: 100 }, NOW)
    expect(input).toEqual(snapshot)
  })

  it('filters by productId — keeps only matching product', () => {
    const input = [
      file({ id: 1, product_id: 100 }),
      file({ id: 2, product_id: 200 }),
      file({ id: 3, product_id: 100 }),
    ]
    const result = filterVaultFiles(input, { productId: 100 }, NOW)
    expect(result.map((f) => f.id)).toEqual([1, 3])
  })

  it('treats null productId as "no product filter"', () => {
    const input = [
      file({ id: 1, product_id: 100 }),
      file({ id: 2, product_id: 200 }),
    ]
    const result = filterVaultFiles(input, { productId: null }, NOW)
    expect(result).toEqual(input)
  })

  it('treats undefined productId as "no product filter"', () => {
    const input = [file({ id: 1, product_id: 100 }), file({ id: 2, product_id: 200 })]
    const result = filterVaultFiles(input, { productId: undefined }, NOW)
    expect(result).toEqual(input)
  })

  it('filters by kind — keeps only matching format', () => {
    const input = [
      file({ id: 1, kind: 'transcript' }),
      file({ id: 2, kind: 'video' }),
      file({ id: 3, kind: 'transcript' }),
    ]
    const result = filterVaultFiles(input, { kind: 'transcript' }, NOW)
    expect(result.map((f) => f.id)).toEqual([1, 3])
  })

  it('keeps all kinds when kind is null / undefined', () => {
    const input = [
      file({ id: 1, kind: 'transcript' }),
      file({ id: 2, kind: 'video' }),
    ]
    expect(filterVaultFiles(input, { kind: null }, NOW).length).toBe(2)
    expect(filterVaultFiles(input, { kind: undefined }, NOW).length).toBe(2)
  })

  it('filters by sinceDays — only files within the window', () => {
    const input = [
      file({ id: 1, created_at: ONE_DAY_AGO }),
      file({ id: 2, created_at: SIXTY_DAYS_AGO }),
      file({ id: 3, created_at: FOUR_HUNDRED_DAYS_AGO }),
    ]
    const result = filterVaultFiles(input, { sinceDays: 30 }, NOW)
    // 30-day window from NOW (Jun 26, 2026) covers everything newer than
    // May 27, 2026. So only the 1-day-ago file matches; the 60-day-ago
    // file is just outside the window.
    expect(result.map((f) => f.id)).toEqual([1])
  })

  it('the date boundary is inclusive (>=)', () => {
    // A file created exactly at the cutoff (NOW - 30 days) is INCLUDED.
    const exactlyThirtyDaysAgo = new Date(NOW.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString()
    const input = [file({ id: 1, created_at: exactlyThirtyDaysAgo })]
    expect(filterVaultFiles(input, { sinceDays: 30 }, NOW)).toHaveLength(1)
  })

  it('treats sinceDays="all" as "no date filter"', () => {
    const input = [
      file({ id: 1, created_at: ONE_DAY_AGO }),
      file({ id: 2, created_at: FOUR_HUNDRED_DAYS_AGO }),
    ]
    const result = filterVaultFiles(input, { sinceDays: 'all' }, NOW)
    expect(result).toEqual(input)
  })

  it('treats sinceDays=null / undefined as "no date filter"', () => {
    const input = [
      file({ id: 1, created_at: ONE_DAY_AGO }),
      file({ id: 2, created_at: FOUR_HUNDRED_DAYS_AGO }),
    ]
    expect(filterVaultFiles(input, { sinceDays: null }, NOW)).toEqual(input)
    expect(filterVaultFiles(input, { sinceDays: undefined }, NOW)).toEqual(input)
  })

  it('sinceDays=0 returns empty (defensive — invalid input)', () => {
    const input = [file({ id: 1, created_at: NOW.toISOString() })]
    expect(filterVaultFiles(input, { sinceDays: 0 }, NOW)).toEqual([])
  })

  it('sinceDays negative returns empty (defensive — invalid input)', () => {
    const input = [file({ id: 1, created_at: NOW.toISOString() })]
    expect(filterVaultFiles(input, { sinceDays: -1 }, NOW)).toEqual([])
  })

  it('excludes rows with null created_at when a date filter is active', () => {
    const input = [
      file({ id: 1, created_at: ONE_DAY_AGO }),
      file({ id: 2, created_at: null }),
    ]
    const result = filterVaultFiles(input, { sinceDays: 30 }, NOW)
    expect(result.map((f) => f.id)).toEqual([1])
  })

  it('keeps rows with null created_at when no date filter is active', () => {
    const input = [
      file({ id: 1, created_at: ONE_DAY_AGO }),
      file({ id: 2, created_at: null }),
    ]
    const result = filterVaultFiles(input, {}, NOW)
    expect(result.map((f) => f.id)).toEqual([1, 2])
  })

  it('excludes rows with unparseable created_at when a date filter is active', () => {
    const input = [file({ id: 1, created_at: 'not-a-date' })]
    expect(filterVaultFiles(input, { sinceDays: 30 }, NOW)).toEqual([])
  })

  it('combines product + kind filters with AND', () => {
    const input = [
      file({ id: 1, product_id: 100, kind: 'video' }),
      file({ id: 2, product_id: 100, kind: 'slides' }),
      file({ id: 3, product_id: 200, kind: 'video' }),
      file({ id: 4, product_id: 200, kind: 'slides' }),
    ]
    const result = filterVaultFiles(input, { productId: 100, kind: 'video' }, NOW)
    expect(result.map((f) => f.id)).toEqual([1])
  })

  it('combines all three filters (product + kind + date) with AND', () => {
    const input = [
      file({ id: 1, product_id: 100, kind: 'video', created_at: ONE_DAY_AGO }),
      file({ id: 2, product_id: 100, kind: 'video', created_at: SIXTY_DAYS_AGO }),
      file({ id: 3, product_id: 100, kind: 'slides', created_at: ONE_DAY_AGO }),
      file({ id: 4, product_id: 200, kind: 'video', created_at: ONE_DAY_AGO }),
    ]
    const result = filterVaultFiles(
      input,
      { productId: 100, kind: 'video', sinceDays: 30 },
      NOW,
    )
    expect(result.map((f) => f.id)).toEqual([1])
  })

  it('handles the empty default (no opts arg)', () => {
    const input = [file({ id: 1 }), file({ id: 2, product_id: 200 })]
    expect(filterVaultFiles(input)).toEqual(input)
  })
})