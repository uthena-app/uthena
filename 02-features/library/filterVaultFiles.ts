// filterVaultFiles.ts — pure helper that narrows a flat VaultFile[] down
// to the rows that match the three URL-driven filter dimensions on the
// /library file vault (P7.9):
//
//   - productId  : keep only files for one product (number)
//   - kind       : keep only one file format (FileKind — video, slides, ...)
//   - sinceDays  : keep only files uploaded in the last N days
//
// The helper is pure (no DB, no I/O). The /library page composes it with
// the existing groupVaultFilesByProduct so the filtered rows still render
// in the grouped shape (one h3 per product, count badge, file rows).
//
// Why a pure helper instead of doing the filtering inside
// getUserAccessibleFiles?
//   - The query is the canonical read; filtering by searchParams is a
//     UI concern. Lifting the filter out keeps the query reusable from
//     other surfaces (e.g. the partner's "my files" panel in v2) that
//     may not want the same URL-driven behavior.
//   - Pure helpers are trivial to test. The URL-parsing lives in the
//     page; this helper takes parsed values and decides membership.
//
// Edge cases worth pinning:
//   - All three filters are independent and combine with AND.
//   - A missing / null filter value means "don't apply this dimension".
//   - sinceDays='all' or null means "no date constraint".
//   - sinceDays=0 or negative means "no files match" (defensive — the
//     page's parser rejects 0/negative values upstream and passes null
//     instead, but the helper should still be safe if called directly).
//   - Files whose created_at is null are excluded by a date filter but
//     kept when no date filter is set (defensive — the column is NOT
//     NULL in the schema; this only fires if a row somehow leaks through
//     the mapper with no timestamp).
//   - productId=0 / negative are treated as "no product filter" rather
//     than as a valid id. The page's parser coerces invalid strings to
//     null; this is the second gate.

import type { VaultFile } from './queries/getUserAccessibleFiles'

export type VaultFilterOptions = {
  /** Filter to one product. null/undefined = no product filter. */
  productId?: number | null | undefined
  /** Filter to one file format. null/undefined = no kind filter. */
  kind?: VaultFile['kind'] | null | undefined
  /**
   * Filter by upload recency.
   * - number > 0: keep rows whose created_at >= now - N days
   * - 'all' | null | undefined: no date filter
   * - 0 or negative: no rows match (defensive guard for invalid input)
   */
  sinceDays?: number | 'all' | null | undefined
}

export function filterVaultFiles(
  files: VaultFile[],
  opts: VaultFilterOptions = {},
  now: Date = new Date(),
): VaultFile[] {
  const productId = opts.productId ?? null
  const kind = opts.kind ?? null
  const sinceDays = opts.sinceDays ?? null

  // Pre-compute the date cutoff once so the loop below doesn't allocate.
  // `null` means no date filter — the loop's branch becomes a no-op.
  let cutoff: number | null = null
  if (typeof sinceDays === 'number' && sinceDays > 0) {
    cutoff = now.getTime() - sinceDays * 24 * 60 * 60 * 1000
  } else if (typeof sinceDays === 'number') {
    // Zero or negative: caller asked for "the last 0 days" — no rows
    // can possibly match. The defensive shape (returning []) is what
    // the caller would have to build themselves anyway.
    return []
  }

  return files.filter((f) => {
    if (productId != null && f.product_id !== productId) return false
    if (kind != null && f.kind !== kind) return false
    if (cutoff != null) {
      // Exclude rows without a created_at when a date filter is active.
      // The schema is NOT NULL but the defensive mapper leaves null on
      // a malformed row, and we'd rather show "0 results" than "all
      // results including the bogus ones".
      if (f.created_at == null) return false
      const ts = Date.parse(f.created_at)
      if (Number.isNaN(ts)) return false
      if (ts < cutoff) return false
    }
    return true
  })
}