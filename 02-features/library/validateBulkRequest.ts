// validateBulkRequest.ts — pure validator for P7.4 bulk-download requests.
//
// Source-of-truth for the validation rules the route handler enforces.
// Pure (no DB / no I/O / no `Date.now()`) so it can be unit-tested
// without fixtures and reused by both the route handler and any
// future caller (e.g. a CLI bulk-export tool).
//
// Validation layers, in order:
//   1. Zod schema parse (1-50 distinct positive integer ids).
//   2. Row-level: every requested id must resolve to a product_files row
//      that is `scan_status = 'clean'` AND `encoding_status = 'ready'`.
//      The route handler does the actual SELECT; this helper takes the
//      resolved rows and returns a typed outcome so the test suite can
//      exercise the failure branches without a DB.
//   3. Row-level: every resolved row must belong to a product the user
//      has access to (purchase grant OR active subscription). Same
//      shape as the route handler: takes a Set<product_id>.
//   4. Aggregate cap: the sum of `size_bytes` across the kept rows
//      must not exceed `MAX_BULK_BYTES`. This protects the server
//      from streaming huge zips through our origin.
//
// Failure shape: every failure carries a `code` discriminator + a
// human-readable `message`. The route handler maps `code` to an HTTP
// status + response body; the message is what the user sees.

import { BulkDownloadInput } from '@foundations/data/schemas'

/** Hard ceiling on the number of files in one bulk request. Matches
 *  the Zod max; the helper still applies the cap defensively in case
 *  the schema is loosened in the future. */
export const MAX_BULK_FILES = 50

/** Hard ceiling on the aggregate uncompressed size of one bulk
 *  request. 256 MiB. Picked to keep the in-memory zip pipeline
 *  bounded on a single Next.js instance — the v1 build reads every
 *  file into memory as a `Uint8Array` before handing the zip object
 *  to `fflate.zip()`, so the peak working set is roughly the sum of
 *  uncompressed sizes. 256 MiB is comfortably below the default Node
 *  heap ceiling (1.5-2 GB on Coolify) while still covering the
 *  "non-video vault" use case (slide decks + transcripts + graphics
 *  for a typical PLR course). Video file source uploads are
 *  typically larger than this and should be downloaded individually.
 *  Larger bulk requests are rejected; the user must split them. */
export const MAX_BULK_BYTES = 256n * 1024n * 1024n

/** Minimal shape of a product_files row the validator needs. The
 *  route handler pulls a superset (storage_path + product title for
 *  building the archive path); the validator only reads the four
 *  required columns to keep the contract narrow + easy to mock.
 *
 *  Extra fields on the row are ignored by the validator — callers
 *  may pass a richer row type and the validator's narrowing logic
 *  just doesn't touch them. */
export type BulkFileRow = {
  id: number
  product_id: number
  size_bytes: number | string | bigint
  scan_status: 'clean' | 'pending' | 'infected' | string
  encoding_status: 'ready' | 'pending' | string
}

/** Enriched row shape the route handler uses downstream. Extends
 *  BulkFileRow with the columns the validator doesn't need but the
 *  archive builder does. */
export type EnrichedBulkFileRow = BulkFileRow & {
  storage_path: string
  original_filename: string
  product_title: string
}

/** Minimal column the validator reads from the access check. */
export type AccessibleProductId = { product_id: number | string | bigint }

/** Coerce bigint / string / number size_bytes to a bigint for safe
 *  arithmetic. PostgREST serializes bigint columns as JSON strings
 *  on the wire, so the input may be either shape. */
function toBigintBytes(v: BulkFileRow['size_bytes']): bigint {
  if (typeof v === 'bigint') return v < 0n ? 0n : v
  if (typeof v === 'number') return BigInt(Math.max(0, Math.trunc(v)))
  if (typeof v === 'string') {
    const n = BigInt(v)
    return n < 0n ? 0n : n
  }
  return 0n
}

function toProductId(v: AccessibleProductId['product_id']): number {
  if (typeof v === 'number') return v
  if (typeof v === 'string') return Number.parseInt(v, 10)
  if (typeof v === 'bigint') return Number(v)
  return NaN
}

export type ValidateBulkRequestOk = {
  ok: true
  /** File ids in stable order (numeric ascending). */
  file_ids: number[]
  /** Resolved rows matching the file_ids, in the same order. */
  rows: BulkFileRow[]
  /** Total uncompressed size in bytes (bigint). */
  total_bytes: bigint
}

export type ValidateBulkRequestErr = {
  ok: false
  code:
    | 'invalid_input'
    | 'empty_selection'
    | 'too_many_files'
    | 'not_found'
    | 'forbidden'
    | 'file_not_ready'
    | 'too_large'
  message: string
  /** For `not_found` / `forbidden` / `file_not_ready`: the offending
   *  file_ids so the route handler can echo a precise error. */
  offending_ids?: number[]
}

export type ValidateBulkRequestResult = ValidateBulkRequestOk | ValidateBulkRequestErr

/**
 * Validate a bulk-download request. Pure — takes the raw form input
 * + the DB-resolved rows + the user's accessible-product set. Returns
 * either the kept rows (in deterministic order) or a typed failure.
 *
 * @param raw          The raw input — either a FormData, a plain object
 *                     with `file_ids`, or an array of ids.
 * @param resolveRows  A function that takes the deduped id list and
 *                     returns the matching `product_files` rows. The
 *                     caller does the DB query; this helper just
 *                     inspects the result. Returning rows whose `id`
 *                     wasn't requested is allowed (defensive — extra
 *                     rows are dropped by the helper).
 * @param accessible   The user's accessible product ids (purchase +
 *                     subscription). Injected as a Set<number>.
 */
export async function validateBulkRequest(
  raw: FormData | Record<string, unknown> | Array<number | string>,
  resolveRows: (fileIds: number[]) => Promise<BulkFileRow[]>,
  accessible: Iterable<AccessibleProductId>,
): Promise<ValidateBulkRequestResult> {
  // 1. Normalize the raw input into the shape Zod expects.
  let inputObj: Record<string, unknown>
  if (raw instanceof FormData) {
    const all = raw.getAll('file_ids')
    inputObj = { file_ids: all.map((v) => (typeof v === 'string' ? v : v.name)) }
  } else if (Array.isArray(raw)) {
    inputObj = { file_ids: raw }
  } else {
    inputObj = raw
  }

  const parsed = BulkDownloadInput.safeParse(inputObj)
  if (!parsed.success) {
    const flat = parsed.error.flatten()
    // Walk all issues so we can distinguish the array-level caps
    // (`too_big` / `too_small` on the file_ids array itself) from
    // element-level failures (a single id that isn't a positive
    // integer, or that isn't coercible to a number).
    let code: 'invalid_input' | 'empty_selection' | 'too_many_files' = 'invalid_input'
    for (const issue of parsed.error.issues) {
      // `path: ['file_ids']` means the array itself. `path: ['file_ids', N]`
      // means the Nth element.
      if (issue.path.length === 1 && issue.path[0] === 'file_ids') {
        if (issue.code === 'too_big') {
          code = 'too_many_files'
        } else if (issue.code === 'too_small') {
          code = 'empty_selection'
        }
      }
    }
    const message =
      flat.fieldErrors.file_ids?.[0] ?? parsed.error.issues[0]?.message ?? 'Invalid request.'
    return { ok: false, code, message }
  }

  // Zod already deduped + sorted-not-required (we sort below for
  // determinism). Dedupe is via Set; ordering is numeric ascending.
  const requested = Array.from(new Set(parsed.data.file_ids)).sort((a, b) => a - b)
  if (requested.length > MAX_BULK_FILES) {
    return {
      ok: false,
      code: 'too_many_files',
      message: `Select no more than ${MAX_BULK_FILES} files at once.`,
    }
  }
  if (requested.length === 0) {
    return {
      ok: false,
      code: 'empty_selection',
      message: 'Select at least one file to download.',
    }
  }

  // 2. Resolve rows + classify missing / not-ready.
  const resolved = await resolveRows(requested)
  const byId = new Map<number, BulkFileRow>()
  for (const row of resolved) {
    if (Number.isFinite(row.id)) byId.set(row.id, row)
  }

  const missing: number[] = []
  const notReady: number[] = []
  for (const id of requested) {
    const row = byId.get(id)
    if (!row) {
      missing.push(id)
      continue
    }
    if (row.scan_status !== 'clean' || row.encoding_status !== 'ready') {
      notReady.push(id)
    }
  }
  if (missing.length > 0) {
    return {
      ok: false,
      code: 'not_found',
      message: `Some files could not be found (${missing.length}).`,
      offending_ids: missing,
    }
  }
  if (notReady.length > 0) {
    return {
      ok: false,
      code: 'file_not_ready',
      message: `Some files are not ready for download yet (${notReady.length}).`,
      offending_ids: notReady,
    }
  }

  // 3. Access check. Membership of the user's accessible-products set.
  const accessibleIds = new Set<number>()
  for (const p of accessible) {
    const n = toProductId(p.product_id)
    if (Number.isFinite(n)) accessibleIds.add(n)
  }
  const forbidden: number[] = []
  for (const id of requested) {
    const row = byId.get(id)
    if (!row) continue
    if (!accessibleIds.has(row.product_id)) forbidden.push(id)
  }
  if (forbidden.length > 0) {
    return {
      ok: false,
      code: 'forbidden',
      message: `You don't have access to ${forbidden.length} selected file${forbidden.length === 1 ? '' : 's'}.`,
      offending_ids: forbidden,
    }
  }

  // 4. Aggregate size cap. bigint arithmetic to avoid the 2 GiB
  //    number ceiling; the input rows may have PostgREST-string sizes.
  const keptRows = requested
    .map((id) => byId.get(id))
    .filter((r): r is BulkFileRow => Boolean(r))
  let total = 0n
  for (const row of keptRows) {
    total += toBigintBytes(row.size_bytes)
  }
  if (total > MAX_BULK_BYTES) {
    return {
      ok: false,
      code: 'too_large',
      message: `Total size ${formatBytes(total)} exceeds the ${formatBytes(MAX_BULK_BYTES)} bulk-download limit. Narrow your selection.`,
    }
  }

  return {
    ok: true,
    file_ids: requested,
    rows: keptRows,
    total_bytes: total,
  }
}

/**
 * Format a bigint byte count as a human-readable string (binary
 * units, one decimal). Used by the validator's `too_large` message.
 * Pure — exported so the route handler + tests can share.
 */
export function formatBytes(bytes: bigint): string {
  const n = bytes < 0n ? 0n : bytes
  const KB = 1024n
  const MB = KB * 1024n
  const GB = MB * 1024n
  const TB = GB * 1024n
  if (n >= TB) return `${formatDecimal(n, TB)} TB`
  if (n >= GB) return `${formatDecimal(n, GB)} GB`
  if (n >= MB) return `${formatDecimal(n, MB)} MB`
  if (n >= KB) return `${formatDecimal(n, KB)} KB`
  return `${n} B`
}

/** Divide two bigints and render with one decimal place. Pure. */
function formatDecimal(n: bigint, unit: bigint): string {
  const whole = n / unit
  const tenths = (n * 10n) / unit - whole * 10n
  return `${whole.toString()}.${tenths.toString()}`
}