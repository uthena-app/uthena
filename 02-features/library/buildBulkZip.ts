// buildBulkZip.ts — pure helper that builds an in-memory ZIP archive
// from a list of `{name, data: Uint8Array}` entries.
//
// Uses fflate (small, fast, pure-JS, no native deps). The async
// `zip()` function returns the complete archive as a single
// `Uint8Array` — the route handler hands that to `Response`.
//
// v1 design choice: in-memory, not streaming. Reasoning:
//   - fflate has no streaming ZIP API (its classes are for DEFLATE /
//     GZIP, not ZIP central directory).
//   - The "real" streaming zip libs (archiver, yazl) aren't in this
//     project's dependency tree and pulling one in just for this is
//     overkill for v1.
//   - The size cap (256 MiB; see MAX_BULK_BYTES in validateBulkRequest)
//     keeps peak RAM bounded — comfortable for a single Next.js
//     instance.
//
// Collision handling: when two files have the same `name`, the second
// wins. ZIP archives allow duplicate entries, but most extractors
// pick the last one. We pre-dedupe by name in the caller (validateBulkRequest
// already enforces distinct ids, so duplicate names can only come from
// distinct products that happen to share a filename like "transcript.pdf";
// in that case we keep the first to match the order the user selected).

import { zip, type AsyncZippable } from 'fflate'

export type BulkZipEntry = {
  /** Path inside the archive (forward-slash only; ZIP spec). */
  name: string
  /** File contents. */
  data: Uint8Array
}

export type BuildBulkZipResult = {
  ok: true
  /** The complete ZIP archive as a single Uint8Array. */
  archive: Uint8Array
  /** Number of entries actually included (after dedupe). */
  entryCount: number
  /** Sum of the entry sizes (uncompressed). */
  totalBytes: number
}

export type BuildBulkZipErr = {
  ok: false
  code: 'empty' | 'duplicate_name' | 'invalid_name' | 'too_large' | 'zip_failed'
  message: string
  /** For `duplicate_name` — the offending names (in selection order). */
  offending_names?: string[]
  /** For `too_large` — the offending byte count. */
  totalBytes?: number
}

export type BuildBulkZipOutcome = BuildBulkZipResult | BuildBulkZipErr

/** Same 256 MiB cap as the validator. The builder enforces it
 *  independently so callers can use the helper standalone without
 *  first routing through validateBulkRequest. */
export const BUILD_ZIP_MAX_BYTES = 256n * 1024n * 1024n

/** Maximum entries we accept in a single archive. Mirrors
 *  validateBulkRequest's MAX_BULK_FILES for symmetry. */
export const BUILD_ZIP_MAX_ENTRIES = 50

/** Async-friendly wrapper around fflate's `zip()`. Returns a Promise. */
function zipAsync(entries: AsyncZippable): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    zip(entries, (err, data) => {
      if (err) {
        reject(typeof err === 'string' ? new Error(err) : err)
        return
      }
      resolve(data)
    })
  })
}

/** Validate one entry's name. ZIP spec requires forward-slash paths
 *  and forbids absolute paths + ".." segments. Empty / whitespace-only
 *  names are also rejected. Pure. */
function isValidEntryName(name: string): boolean {
  if (typeof name !== 'string') return false
  const trimmed = name.trim()
  if (trimmed.length === 0) return false
  if (trimmed.length > 255) return false
  if (trimmed.startsWith('/')) return false
  // Forbid Windows-style separators + drive letters + path traversal.
  if (trimmed.includes('\\')) return false
  if (/^[a-zA-Z]:/.test(trimmed)) return false
  const segments = trimmed.split('/')
  for (const seg of segments) {
    if (seg === '' || seg === '.' || seg === '..') return false
  }
  return true
}

/**
 * Build a ZIP archive from the given entries. Pure — no I/O. The
 * route handler provides the fetched file data (as Uint8Array).
 *
 * Order of checks:
 *   1. At least one entry.
 *   2. No more than BUILD_ZIP_MAX_ENTRIES.
 *   3. Every entry has a valid name (no traversal, no separators).
 *   4. No two entries share a name (we pick the first).
 *   5. Sum of `data.byteLength` ≤ BUILD_ZIP_MAX_BYTES.
 *   6. Build the zip via fflate (async, single chunk).
 *
 * On success: `{ ok: true, archive, entryCount, totalBytes }`.
 * On failure: `{ ok: false, code, message, ... }`.
 */
export async function buildBulkZip(entries: BulkZipEntry[]): Promise<BuildBulkZipOutcome> {
  if (!Array.isArray(entries) || entries.length === 0) {
    return { ok: false, code: 'empty', message: 'No entries to archive.' }
  }
  if (entries.length > BUILD_ZIP_MAX_ENTRIES) {
    return {
      ok: false,
      code: 'too_large',
      message: `Too many entries (${entries.length}); max is ${BUILD_ZIP_MAX_ENTRIES}.`,
      totalBytes: entries.length,
    }
  }

  // 3+4 — name validation + dedupe-by-first-wins.
  const seen = new Set<string>()
  const kept: BulkZipEntry[] = []
  const badNames: string[] = []
  const dupNames: string[] = []
  for (const e of entries) {
    if (!isValidEntryName(e.name)) {
      badNames.push(e.name)
      continue
    }
    if (seen.has(e.name)) {
      dupNames.push(e.name)
      continue
    }
    seen.add(e.name)
    kept.push(e)
  }
  if (badNames.length > 0) {
    return {
      ok: false,
      code: 'invalid_name',
      message: `Some entry names are invalid (${badNames.length}).`,
      offending_names: badNames,
    }
  }
  if (dupNames.length > 0) {
    return {
      ok: false,
      code: 'duplicate_name',
      message: `Some entry names are duplicated (${dupNames.length}).`,
      offending_names: dupNames,
    }
  }

  // 5 — size cap.
  let total = 0n
  for (const e of kept) {
    total += BigInt(e.data.byteLength)
  }
  if (total > BUILD_ZIP_MAX_BYTES) {
    return {
      ok: false,
      code: 'too_large',
      message: `Total uncompressed size exceeds the archive limit.`,
      totalBytes: Number(total > BigInt(Number.MAX_SAFE_INTEGER) ? Number.MAX_SAFE_INTEGER : total),
    }
  }

  // 6 — build.
  const zippable: AsyncZippable = {}
  for (const e of kept) {
    zippable[e.name] = e.data
  }
  try {
    const archive = await zipAsync(zippable)
    return {
      ok: true,
      archive,
      entryCount: kept.length,
      totalBytes: Number(total),
    }
  } catch (err) {
    return {
      ok: false,
      code: 'zip_failed',
      message: err instanceof Error ? err.message : 'Unknown zip build failure.',
    }
  }
}

/**
 * Resolve a unique in-archive name for `(productTitle, originalFilename)`.
 * The bulk zip groups by product so a user downloading transcripts from
 * two products gets:
 *   Product A/transcript.pdf
 *   Product B/transcript.pdf
 * instead of one overwriting the other. Pure — no I/O.
 */
export function bulkEntryName(productTitle: string, originalFilename: string): string {
  const safeProduct = sanitizePathSegment(productTitle)
  const safeFile = sanitizePathSegment(originalFilename)
  return `${safeProduct}/${safeFile}`
}

/** Strip path separators + traversal + drive letters from a single
 *  path segment so it can be safely concatenated into a ZIP path.
 *  Pure — exported for unit tests.
 *
 *  Rules (in order):
 *   1. Drop colons (Windows drive-letter separator).
 *   2. Backslashes → underscores.
 *   3. Forward slashes → underscores. Forward slashes are the ZIP
 *      path separator; we never want them inside a single segment
 *      because that would create unexpected folder nesting in the
 *      archive (and let `../` become a traversal vector — once the
 *      `/` is gone, `..` can't escape).
 *   4. Trim whitespace.
 *   5. Cap length at 200 chars (defensive — each ZIP path segment is
 *      allowed up to 255 UTF-8 bytes; we keep room for the product
 *      prefix + slash).
 */
export function sanitizePathSegment(s: string): string {
  if (typeof s !== 'string') return ''
  let r = s
  // 1. Drop colons.
  r = r.replace(/:/g, '')
  // 2. Backslashes → underscores.
  r = r.replace(/\\/g, '_')
  // 3. Forward slashes → underscores (no nesting, no traversal).
  r = r.replace(/\//g, '_')
  // 4. Trim whitespace.
  r = r.trim()
  // 5. Cap length.
  return r.slice(0, 200)
}