// validateBulkRequest.test.ts — pure unit tests for the bulk-download
// validator. Covers every code path: invalid input, dedupe, count
// cap, missing rows, scan/encoding gates, access gate, and the size
// cap (including bigint math at the >2 GiB threshold).

import { describe, it, expect } from 'vitest'
import {
  validateBulkRequest,
  MAX_BULK_BYTES,
  MAX_BULK_FILES,
  formatBytes,
  type BulkFileRow,
  type AccessibleProductId,
} from './validateBulkRequest'

function makeRow(over: Partial<BulkFileRow> = {}): BulkFileRow {
  return {
    id: 1,
    product_id: 100,
    size_bytes: 1024,
    scan_status: 'clean',
    encoding_status: 'ready',
    ...over,
  }
}

function resolveAll(rows: BulkFileRow[]) {
  return async (ids: number[]) => rows.filter((r) => ids.includes(r.id))
}

const acc = (...ids: number[]): AccessibleProductId[] => ids.map((id) => ({ product_id: id }))

describe('validateBulkRequest — schema layer', () => {
  it('rejects empty selection with code=empty_selection', async () => {
    const result = await validateBulkRequest(
      { file_ids: [] },
      resolveAll([]),
      acc(100),
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('empty_selection')
  })

  it('rejects object without file_ids', async () => {
    const result = await validateBulkRequest({}, resolveAll([]), acc(100))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('invalid_input')
  })

  it('rejects non-positive ids', async () => {
    const result = await validateBulkRequest(
      { file_ids: [1, -5, 3] },
      resolveAll([]),
      acc(100),
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('invalid_input')
  })

  it('rejects zero id', async () => {
    const result = await validateBulkRequest(
      { file_ids: [0] },
      resolveAll([]),
      acc(100),
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('invalid_input')
  })

  it('rejects fractional ids', async () => {
    const result = await validateBulkRequest(
      { file_ids: [1.5] },
      resolveAll([]),
      acc(100),
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('invalid_input')
  })

  it('rejects over-cap selection (51 files) with code=too_many_files', async () => {
    const ids = Array.from({ length: 51 }, (_, i) => i + 1)
    const result = await validateBulkRequest({ file_ids: ids }, resolveAll([]), acc(100))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('too_many_files')
  })

  it('accepts exactly 50 files (the cap)', async () => {
    const ids = Array.from({ length: 50 }, (_, i) => i + 1)
    const rows = ids.map((id) => makeRow({ id, size_bytes: 1 }))
    const result = await validateBulkRequest(
      { file_ids: ids },
      resolveAll(rows),
      acc(100),
    )
    expect(result.ok).toBe(true)
  })

  it('coerces string ids from FormData', async () => {
    const rows = [makeRow({ id: 42, size_bytes: 100 })]
    const result = await validateBulkRequest(
      { file_ids: ['42'] },
      resolveAll(rows),
      acc(100),
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.file_ids).toEqual([42])
  })

  it('accepts a raw array input', async () => {
    const rows = [makeRow({ id: 7, size_bytes: 100 })]
    const result = await validateBulkRequest([7], resolveAll(rows), acc(100))
    expect(result.ok).toBe(true)
  })

  it('accepts a FormData input with repeated file_ids keys', async () => {
    const fd = new FormData()
    fd.append('file_ids', '5')
    fd.append('file_ids', '9')
    const rows = [makeRow({ id: 5, size_bytes: 1 }), makeRow({ id: 9, size_bytes: 1 })]
    const result = await validateBulkRequest(fd, resolveAll(rows), acc(100))
    expect(result.ok).toBe(true)
  })

  it('dedupes repeated ids and keeps deterministic ascending order', async () => {
    const rows = [makeRow({ id: 5 }), makeRow({ id: 9 })]
    const result = await validateBulkRequest(
      { file_ids: [9, 5, 9, 5, 9] },
      resolveAll(rows),
      acc(100),
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.file_ids).toEqual([5, 9])
    expect(result.rows.map((r) => r.id)).toEqual([5, 9])
  })
})

describe('validateBulkRequest — row resolution layer', () => {
  it('rejects when some requested ids are missing (code=not_found, offending_ids set)', async () => {
    const result = await validateBulkRequest(
      { file_ids: [1, 2, 3] },
      resolveAll([makeRow({ id: 1 })]),
      acc(100),
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('not_found')
    expect(result.offending_ids).toEqual([2, 3])
  })

  it('rejects when scan_status != clean (code=file_not_ready)', async () => {
    const result = await validateBulkRequest(
      { file_ids: [1] },
      resolveAll([makeRow({ id: 1, scan_status: 'pending' })]),
      acc(100),
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('file_not_ready')
    expect(result.offending_ids).toEqual([1])
  })

  it('rejects when encoding_status != ready', async () => {
    const result = await validateBulkRequest(
      { file_ids: [1] },
      resolveAll([makeRow({ id: 1, encoding_status: 'pending' })]),
      acc(100),
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('file_not_ready')
  })

  it('ignores extra rows from resolveRows that were not requested', async () => {
    const result = await validateBulkRequest(
      { file_ids: [1] },
      resolveAll([makeRow({ id: 1 }), makeRow({ id: 999 })]),
      acc(100),
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0]?.id).toBe(1)
  })
})

describe('validateBulkRequest — access layer', () => {
  it('rejects when user has no access to the row\'s product (code=forbidden)', async () => {
    const result = await validateBulkRequest(
      { file_ids: [1] },
      resolveAll([makeRow({ id: 1, product_id: 200 })]),
      acc(100), // user has access to product 100 only
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('forbidden')
    expect(result.offending_ids).toEqual([1])
  })

  it('accepts when user has access via subscription (set membership)', async () => {
    const result = await validateBulkRequest(
      { file_ids: [1, 2] },
      resolveAll([
        makeRow({ id: 1, product_id: 100 }),
        makeRow({ id: 2, product_id: 200 }),
      ]),
      acc(100, 200, 999),
    )
    expect(result.ok).toBe(true)
  })

  it('rejects only the offending ids when access is mixed', async () => {
    const result = await validateBulkRequest(
      { file_ids: [1, 2, 3] },
      resolveAll([
        makeRow({ id: 1, product_id: 100 }),
        makeRow({ id: 2, product_id: 999 }),
        makeRow({ id: 3, product_id: 100 }),
      ]),
      acc(100),
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('forbidden')
    expect(result.offending_ids).toEqual([2])
  })

  it('coerces string product_id in the accessible set', async () => {
    const result = await validateBulkRequest(
      { file_ids: [1] },
      resolveAll([makeRow({ id: 1, product_id: 100 })]),
      [{ product_id: '100' }],
    )
    expect(result.ok).toBe(true)
  })
})

describe('validateBulkRequest — size cap', () => {
  it('accepts when total size is exactly the cap', async () => {
    const rows = [makeRow({ id: 1, size_bytes: MAX_BULK_BYTES.toString() })]
    const result = await validateBulkRequest(
      { file_ids: [1] },
      resolveAll(rows),
      acc(100),
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.total_bytes).toBe(MAX_BULK_BYTES)
  })

  it('rejects when total exceeds the cap (code=too_large, message names the limit)', async () => {
    const rows = [
      makeRow({ id: 1, size_bytes: MAX_BULK_BYTES.toString() }),
      makeRow({ id: 2, size_bytes: '1' }),
    ]
    const result = await validateBulkRequest(
      { file_ids: [1, 2] },
      resolveAll(rows),
      acc(100),
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('too_large')
    expect(result.message).toMatch(/256\.0 MB/)
  })

  it('sums bigint-as-string size_bytes correctly across many files', async () => {
    const rows = Array.from({ length: 10 }, (_, i) =>
      makeRow({ id: i + 1, size_bytes: '300000000' }),
    ) // 300 MB × 10 = 3 GB
    const result = await validateBulkRequest(
      { file_ids: rows.map((r) => r.id) },
      resolveAll(rows),
      acc(100),
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('too_large')
  })

  it('clamps negative size_bytes to 0 (defensive)', async () => {
    const rows = [makeRow({ id: 1, size_bytes: -100 })]
    const result = await validateBulkRequest(
      { file_ids: [1] },
      resolveAll(rows),
      acc(100),
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.total_bytes).toBe(0n)
  })
})

describe('formatBytes', () => {
  it('formats <1 KiB as B', () => {
    expect(formatBytes(500n)).toBe('500 B')
  })
  it('formats KiB with one decimal', () => {
    expect(formatBytes(1536n)).toBe('1.5 KB')
  })
  it('formats MiB', () => {
    expect(formatBytes(5n * 1024n * 1024n)).toBe('5.0 MB')
  })
  it('formats GiB', () => {
    expect(formatBytes(2n * 1024n * 1024n * 1024n)).toBe('2.0 GB')
  })
  it('formats TiB', () => {
    expect(formatBytes(3n * 1024n * 1024n * 1024n * 1024n)).toBe('3.0 TB')
  })
  it('clamps negative input to 0 B', () => {
    expect(formatBytes(-1n)).toBe('0 B')
  })
})

describe('constants', () => {
  it('MAX_BULK_FILES is 50', () => {
    expect(MAX_BULK_FILES).toBe(50)
  })
  it('MAX_BULK_BYTES is 256 MiB', () => {
    expect(MAX_BULK_BYTES).toBe(256n * 1024n * 1024n)
  })
})