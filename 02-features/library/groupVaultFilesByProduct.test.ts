// groupVaultFilesByProduct.test.ts — unit tests for the pure helper.
// Covers empty list, single product, multi-product sort order,
// per-product file ordering preserved, and product_title fallback.

import { describe, expect, it } from 'vitest'
import type { VaultFile } from './queries/getUserAccessibleFiles'
import { groupVaultFilesByProduct } from './groupVaultFilesByProduct'

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
    // P7.9 — the helper itself doesn't read this field; we default
    // it to null so the group-helper test stays decoupled from the
    // query hydration path. Coverage for the hydration lives in
    // getUserAccessibleFiles.test.ts.
    created_at: null,
    // P7.3 — the helper doesn't read this field; we default it to
    // null so the helper test stays decoupled from the hydration
    // path. Coverage for the hydration lives in
    // getUserAccessibleFiles.test.ts.
    last_accessed_at: null,
    ...overrides,
  }
}

describe('groupVaultFilesByProduct', () => {
  it('returns an empty array for an empty input', () => {
    expect(groupVaultFilesByProduct([])).toEqual([])
  })

  it('wraps a single file into a single group', () => {
    const f = file({ id: 7, product_id: 42, product_title: 'Solo', product_slug: 'solo' })
    const result = groupVaultFilesByProduct([f])
    expect(result).toHaveLength(1)
    expect(result[0]!).toEqual({
      product_id: 42,
      product_title: 'Solo',
      product_slug: 'solo',
      files: [f],
    })
  })

  it('groups multiple files under one product when product_id matches', () => {
    const a = file({ id: 1, product_id: 42, product_title: 'Course A', original_filename: 'a.pdf' })
    const b = file({ id: 2, product_id: 42, product_title: 'Course A', original_filename: 'b.pdf' })
    const c = file({ id: 3, product_id: 42, product_title: 'Course A', original_filename: 'c.pdf' })
    const result = groupVaultFilesByProduct([a, b, c])
    expect(result).toHaveLength(1)
    expect(result[0]!.files).toEqual([a, b, c])
  })

  it('sorts groups by product_title ascending (case-insensitive)', () => {
    const a = file({ id: 1, product_id: 1, product_title: 'banana' })
    const b = file({ id: 2, product_id: 2, product_title: 'Apple' })
    const c = file({ id: 3, product_id: 3, product_title: 'cherry' })
    const result = groupVaultFilesByProduct([a, b, c])
    expect(result.map((g) => g.product_title)).toEqual(['Apple', 'banana', 'cherry'])
  })

  it('keeps per-product file order from the source list (no internal re-sort)', () => {
    // The source query sorts by created_at desc, so file 3 (newest) comes
    // first, then 2, then 1. groupVaultFilesByProduct must preserve that.
    const f1 = file({ id: 1, product_id: 99, original_filename: 'old.pdf' })
    const f2 = file({ id: 2, product_id: 99, original_filename: 'mid.pdf' })
    const f3 = file({ id: 3, product_id: 99, original_filename: 'new.pdf' })
    const result = groupVaultFilesByProduct([f1, f2, f3])
    expect(result[0]!.files.map((f) => f.original_filename)).toEqual(['old.pdf', 'mid.pdf', 'new.pdf'])
  })

  it('separates interleaved files into distinct product groups', () => {
    const a1 = file({ id: 1, product_id: 10, product_title: 'A', original_filename: 'a1.pdf' })
    const b1 = file({ id: 2, product_id: 20, product_title: 'B', original_filename: 'b1.pdf' })
    const a2 = file({ id: 3, product_id: 10, product_title: 'A', original_filename: 'a2.pdf' })
    const b2 = file({ id: 4, product_id: 20, product_title: 'B', original_filename: 'b2.pdf' })
    const result = groupVaultFilesByProduct([a1, b1, a2, b2])
    expect(result.map((g) => g.product_title)).toEqual(['A', 'B'])
    expect(result[0]!.files.map((f) => f.original_filename)).toEqual(['a1.pdf', 'a2.pdf'])
    expect(result[1]!.files.map((f) => f.original_filename)).toEqual(['b1.pdf', 'b2.pdf'])
  })

  it('passes product_title + product_slug from the FIRST file sighting of the product', () => {
    // If somehow a later file for the same product_id has different title/slug,
    // the group keeps the first sighting (defensive — the query normally joins
    // the product so this shouldn't happen in practice).
    const first = file({ id: 1, product_id: 50, product_title: 'First Title', product_slug: 'first-slug' })
    const second = file({ id: 2, product_id: 50, product_title: 'Different Title', product_slug: 'different-slug' })
    const result = groupVaultFilesByProduct([first, second])
    expect(result[0]!.product_title).toBe('First Title')
    expect(result[0]!.product_slug).toBe('first-slug')
    // Both files still end up in the group.
    expect(result[0]!.files).toEqual([first, second])
  })

  it('does not mutate the input array', () => {
    const input = [
      file({ id: 1, product_id: 2, product_title: 'B' }),
      file({ id: 2, product_id: 1, product_title: 'A' }),
    ]
    const snapshot = [...input]
    groupVaultFilesByProduct(input)
    expect(input).toEqual(snapshot)
  })
})