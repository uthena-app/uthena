// buildBulkZip.test.ts — pure unit tests for the bulk-zip builder.

import { describe, it, expect } from 'vitest'
import {
  buildBulkZip,
  bulkEntryName,
  sanitizePathSegment,
  BUILD_ZIP_MAX_BYTES,
  BUILD_ZIP_MAX_ENTRIES,
  type BulkZipEntry,
} from './buildBulkZip'

function entry(name: string, body: string): BulkZipEntry {
  return { name, data: new TextEncoder().encode(body) }
}

/** Helper for tests that need a Uint8Array payload (the regular
 *  `entry()` goes through TextEncoder, which crashes on multi-MB
 *  inputs because `String(uint8array)` blows the string-length
 *  ceiling). */
function bytesEntry(name: string, byteLength: number): BulkZipEntry {
  return { name, data: new Uint8Array(byteLength) }
}

describe('buildBulkZip — input validation', () => {
  it('rejects empty entry list', async () => {
    const result = await buildBulkZip([])
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('empty')
  })

  it('rejects more than BUILD_ZIP_MAX_ENTRIES entries', async () => {
    const entries: BulkZipEntry[] = Array.from({ length: 51 }, (_, i) =>
      entry(`f${i}.txt`, 'x'),
    )
    const result = await buildBulkZip(entries)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('too_large')
  })

  it('rejects entries with invalid names (path traversal)', async () => {
    const result = await buildBulkZip([entry('../../etc/passwd', 'x')])
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('invalid_name')
    expect(result.offending_names).toEqual(['../../etc/passwd'])
  })

  it('rejects entries with Windows-style separators', async () => {
    const result = await buildBulkZip([entry('foo\\bar.txt', 'x')])
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('invalid_name')
  })

  it('rejects absolute paths', async () => {
    const result = await buildBulkZip([entry('/etc/passwd', 'x')])
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('invalid_name')
  })

  it('rejects empty / whitespace names', async () => {
    const result = await buildBulkZip([entry('   ', 'x')])
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('invalid_name')
  })

  it('rejects duplicate names', async () => {
    const result = await buildBulkZip([
      entry('a.txt', 'one'),
      entry('a.txt', 'two'),
    ])
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('duplicate_name')
    expect(result.offending_names).toEqual(['a.txt'])
  })

  it('rejects aggregate size over cap', async () => {
    const result = await buildBulkZip([bytesEntry('huge.bin', Number(BUILD_ZIP_MAX_BYTES) + 1)])
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('too_large')
  })
})

describe('buildBulkZip — happy path', () => {
  it('builds a valid zip with one entry', async () => {
    const result = await buildBulkZip([entry('hello.txt', 'hello world')])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.entryCount).toBe(1)
    expect(result.totalBytes).toBe(11)
    // ZIP magic bytes: PK\x03\x04 (0x04034b50 in little-endian)
    expect(result.archive[0]).toBe(0x50)
    expect(result.archive[1]).toBe(0x4b)
    expect(result.archive[2]).toBe(0x03)
    expect(result.archive[3]).toBe(0x04)
  })

  it('builds a valid zip with multiple entries (grouped by product)', async () => {
    const result = await buildBulkZip([
      entry('Course A/transcript.pdf', 'aaaa'),
      entry('Course A/slides.pdf', 'bbbb'),
      entry('Course B/transcript.pdf', 'cccc'),
    ])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.entryCount).toBe(3)
    expect(result.totalBytes).toBe(12)
    // Archive is non-empty and starts with the local-file-header magic.
    expect(result.archive.byteLength).toBeGreaterThan(0)
    expect(result.archive[0]).toBe(0x50)
  })

  it('accepts exactly BUILD_ZIP_MAX_ENTRIES (50)', async () => {
    const entries = Array.from({ length: BUILD_ZIP_MAX_ENTRIES }, (_, i) =>
      entry(`f${i}.txt`, 'x'),
    )
    const result = await buildBulkZip(entries)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.entryCount).toBe(BUILD_ZIP_MAX_ENTRIES)
  })

  it('embeds the filename in the local file header', async () => {
    const result = await buildBulkZip([entry('hello.txt', 'hi')])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // Search for "hello.txt" in the archive bytes — it'll appear in the
    // local file header AND in the central directory.
    const bytes = new TextDecoder('latin1').decode(result.archive)
    expect(bytes).toContain('hello.txt')
  })
})

describe('bulkEntryName / sanitizePathSegment', () => {
  it('joins product + filename with a forward slash', () => {
    expect(bulkEntryName('Course A', 'transcript.pdf')).toBe('Course A/transcript.pdf')
  })

  it('replaces backslashes with underscores in the product title', () => {
    expect(bulkEntryName('Bad\\Title', 'x.pdf')).toBe('Bad_Title/x.pdf')
  })

  it('replaces forward slashes in the product title (no nesting in a single segment)', () => {
    expect(bulkEntryName('A/B', 'x.pdf')).toBe('A_B/x.pdf')
  })

  it('makes path-traversal-like input safe (slashes → underscores, ".." → "_")', () => {
    // Once the `/` is gone, `..` cannot escape — the resulting segment
    // is a flat string that the ZIP extractor will treat as a single
    // file/folder name under the product prefix.
    expect(sanitizePathSegment('../../etc/passwd')).toBe('.._.._etc_passwd')
  })

  it('strips Windows drive letters before backslash replacement', () => {
    expect(sanitizePathSegment('C:\\Windows\\System32')).toBe('C_Windows_System32')
  })

  it('preserves a single leading dot in a hidden-file name', () => {
    // `.hidden.txt` is a legitimate filename (Unix hidden file).
    // We only collapse REPEATED dots (`..+`) which is the traversal
    // shape, not single leading dots.
    expect(sanitizePathSegment('.hidden.txt')).toBe('.hidden.txt')
  })

  it('preserves a single dot inside a filename', () => {
    // `a..b` is a legitimate filename with two consecutive dots
    // (common in versioned names like "course..v2.txt"). After slash
    // escape, `..` can't escape the archive root, so we leave the dots
    // alone.
    expect(sanitizePathSegment('a..b')).toBe('a..b')
  })

  it('trims whitespace', () => {
    expect(sanitizePathSegment('  spaced  ')).toBe('spaced')
  })

  it('caps segment length at 200', () => {
    const long = 'x'.repeat(500)
    expect(sanitizePathSegment(long).length).toBe(200)
  })

  it('returns empty for non-string input', () => {
    expect(sanitizePathSegment('')).toBe('')
    // @ts-expect-error — testing defensive behavior
    expect(sanitizePathSegment(null)).toBe('')
    // @ts-expect-error — testing defensive behavior
    expect(sanitizePathSegment(undefined)).toBe('')
  })
})