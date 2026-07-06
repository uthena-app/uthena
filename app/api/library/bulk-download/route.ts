// /api/library/bulk-download — bulk-download handler (P7.4).
//
// POST { file_ids: number[] (one or more, repeated key) }
// Response: application/zip stream of the selected files, grouped by
// product in the archive (one folder per product, original filenames
// inside).
//
// Auth: same as /api/files/[id]/download — must have an active session.
// Access: every file must belong to a product the user has access to
// (purchase grant OR active subscription). Enforced via the
// user_accessible_products RPC, same single round-trip pattern as the
// single-file surface.
// Rate limit: shared 60/hour bucket (checkAndRecordSignedUrlMint).
// Counts as N hits (one per file in the request) so a 10-file bulk
// request consumes 10 of the 60/hour quota — matches the single-file
// surface's per-URL cost.
// Audit: one file_downloads row per file (kind='download'), same
// shape as the single-file surface, so the user's download history
// (P7.7) reflects every bulk-downloaded file.
//
// Architecture choice (Slice 1, P7.4):
//   - In-memory ZIP via fflate. fflate's `zip()` is the only zip API
//     it offers; streaming-zip libs (archiver / yazl) aren't in this
//     project's deps and pulling one in just for v1 is overkill.
//   - The 256 MiB MAX_BULK_BYTES cap (validateBulkRequest) keeps the
//     in-memory working set bounded.
//   - Files are fetched in parallel (5 concurrent) to balance
//     bandwidth vs memory pressure.
//   - The archive is built in one shot after all files are in memory;
//     the Route Handler returns the Uint8Array as the response body.

import { NextResponse } from 'next/server'
import { createHash } from 'node:crypto'
import { headers } from 'next/headers'
import { getServerSupabase, getServiceSupabase } from '@foundations/data/supabase'
import { getSessionUser } from '@foundations/auth/guards'
import { signCdnUrl, isBunnyConfigured } from '@foundations/files/signed-url'
import { checkAndRecordSignedUrlMint } from '@foundations/files/rate-limit'
import { loggerFor } from '@foundations/log/pino'
import {
  validateBulkRequest,
  type BulkFileRow,
  type EnrichedBulkFileRow,
  type AccessibleProductId,
} from '@features/library/validateBulkRequest'
import { buildBulkZip, bulkEntryName } from '@features/library/buildBulkZip'

export const dynamic = 'force-dynamic'

const log = loggerFor({ component: 'api.library.bulkDownload' })

/** Max files fetched in parallel from Bunny CDN. Keeps the working
 *  set from spiking and stays polite to the CDN. */
const FETCH_CONCURRENCY = 5

/** ISO timestamp suffix for the archive filename. One second is fine
 *  resolution; the cron / abuse-detection pipeline uses the audit
 *  rows for finer timestamps. */
function archiveFilename(): string {
  const now = new Date()
  // YYYYMMDD-HHMMSS UTC.
  const pad = (n: number) => String(n).padStart(2, '0')
  const s =
    `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}` +
    `-${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}`
  return `uthena-bulk-${s}.zip`
}

export async function POST(request: Request) {
  const user = await getSessionUser()
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  if (!isBunnyConfigured()) {
    return NextResponse.json(
      { error: 'storage is not configured' },
      { status: 503 },
    )
  }

  // 1. Read + validate the raw form input via the pure helper. We
  //    capture the validated file_ids here so we can charge the rate
  //    limit AFTER validation succeeds (a malformed request shouldn't
  //    eat quota) but BEFORE the network fetches (a 60 MB download
  //    that gets rate-limited mid-stream is a bad experience).
  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return NextResponse.json({ error: 'invalid_form' }, { status: 400 })
  }

  // 2. Pull accessible-product set so the validator can check access
  //    without an extra round trip per row.
  const supabase = await getServerSupabase()
  const accessiblePromise = supabase.rpc('user_accessible_products', { p_user_id: user.id })

  // 3. Validate the form input + shape (counts + caps), then resolve
  //    rows from the DB. The validator does the heavy lifting. The
  //    SELECT pulls everything the route handler needs downstream
  //    (storage_path for the CDN fetch + product join for the in-
  //    archive path) — the validator ignores fields it doesn't read.
  const validateOutcome = await validateBulkRequest(
    formData,
    async (ids) => {
      const { data } = await supabase
        .from('product_files')
        .select('id, product_id, storage_path, original_filename, size_bytes, scan_status, encoding_status, product:products ( title )')
        .in('id', ids)
      return (data ?? []) as BulkFileRow[]
    },
    // Defer the awaited RPC until the validator needs the access
    // set — but since the validator iterates `accessible` synchronously,
    // we need to await here.
    await (async () => {
      const { data } = await accessiblePromise
      return (data ?? []) as AccessibleProductId[]
    })(),
  )

  if (!validateOutcome.ok) {
    const status = statusForCode(validateOutcome.code)
    return NextResponse.json(
      {
        error: validateOutcome.code,
        message: validateOutcome.message,
        offending_ids: validateOutcome.offending_ids,
      },
      { status },
    )
  }

  // 4. Charge the rate limit. Counts as N hits — matches the cost
  //    surface a user would pay by minting each URL individually.
  //    We do this AFTER validation (malformed requests don't eat
  //    quota) but BEFORE the fetches (a rate-limited request that
  //    has already started downloading 200 MB is much worse than
  //    one that fails fast).
  for (let i = 0; i < validateOutcome.file_ids.length; i++) {
    const rl = checkAndRecordSignedUrlMint(user.id)
    if (!rl.allowed) {
      log.warn(
        {
          code: 'rate_limited',
          retry_after_s: rl.retryAfterSeconds,
          file_count: validateOutcome.file_ids.length,
        },
        'bulk download rate limited mid-charge',
      )
      return NextResponse.json(
        {
          error: 'rate_limited',
          message: `Too many requests. Try again in ${rl.retryAfterSeconds} seconds.`,
          retry_after_s: rl.retryAfterSeconds,
        },
        {
          status: 429,
          headers: { 'Retry-After': String(rl.retryAfterSeconds) },
        },
      )
    }
  }

  // 5. Fetch each file from the signed CDN URL. Parallel with a small
  //    concurrency cap. The signed URL is a Bunny CDN URL — the
  //    server-side fetch counts against Bunny's bandwidth, not ours.
  //    We mint each URL on the fly (not stored anywhere) with the
  //    'download' kind (NOT IP-bound per spec).
  //
  // Flatten the product join from the resolver's row shape into
  // the enriched row the route handler needs (product_title +
  // original_filename for the archive path). Defensive mapping: the
  // join may be an array (PostgREST), an object, or null (deleted
  // product — the FK is `on delete cascade` but the type system
  // can't prove that).
  const rows: EnrichedBulkFileRow[] = validateOutcome.rows.map((row) => {
    const r = row as BulkFileRow & {
      storage_path?: unknown
      original_filename?: unknown
      product?: unknown
    }
    const rawProduct = r.product
    let productTitle = 'Untitled'
    if (Array.isArray(rawProduct) && rawProduct[0]) {
      productTitle =
        (rawProduct[0] as { title?: string }).title?.trim() || 'Untitled'
    } else if (rawProduct && typeof rawProduct === 'object') {
      productTitle =
        (rawProduct as { title?: string }).title?.trim() || 'Untitled'
    }
    return {
      id: row.id,
      product_id: row.product_id,
      size_bytes: row.size_bytes,
      scan_status: row.scan_status,
      encoding_status: row.encoding_status,
      storage_path: typeof r.storage_path === 'string' ? r.storage_path : '',
      original_filename:
        typeof r.original_filename === 'string' ? r.original_filename : `file-${row.id}`,
      product_title: productTitle,
    }
  })

  const entries = await fetchAllFiles(rows)

  if (entries.some((e) => e.error)) {
    const firstError = entries.find((e) => e.error)
    log.warn(
      {
        code: 'fetch_failed',
        msg: firstError?.error,
        file_id: firstError?.row.id,
      },
      'bulk download fetch failed',
    )
    return NextResponse.json(
      { error: 'fetch_failed', message: firstError?.error ?? 'unknown' },
      { status: 502 },
    )
  }

  // 6. Build the in-memory ZIP archive.
  const zipResult = await buildBulkZip(
    entries.map((e) => ({
      name: bulkEntryName(e.row.product_title, e.row.original_filename),
      data: e.data!,
    })),
  )
  if (!zipResult.ok) {
    log.warn({ code: zipResult.code, msg: zipResult.message }, 'bulk zip build failed')
    return NextResponse.json(
      { error: zipResult.code, message: zipResult.message },
      { status: 500 },
    )
  }

  // 7. Audit. One row per file. Uses the service-role client because
  //    file_downloads has no INSERT policy for the auth.uid() role
  //    (append-only is enforced by the absence of UPDATE/DELETE
  //    policies, not by an INSERT policy — the service-role inserts
  //    bypass RLS). Fail-soft: a failed insert shouldn't block the
  //    user's download (same contract as mintDownloadUrlAction).
  const h = await headers()
  const ip = h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null
  const ua = h.get('user-agent') ?? null
  const ipHash = ip
    ? createHash('sha256').update(ip + new Date().toISOString().slice(0, 10)).digest('hex')
    : null
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
  const service = getServiceSupabase()
  const auditRows = rows.map((row) => ({
    user_id: user.id,
    file_id: row.id,
    product_id: row.product_id,
    kind: 'download',
    url_expires_at: expiresAt,
    ip_hash: ipHash,
    ip_raw: ip,
    user_agent: ua,
  }))
  const { error: auditErr } = await service.from('file_downloads').insert(auditRows)
  if (auditErr) {
    log.warn(
      { code: 'audit_insert_failed', msg: auditErr.message, file_count: auditRows.length },
      'bulk audit insert failed (continuing)',
    )
  }

  log.info(
    {
      user_id: user.id,
      file_count: rows.length,
      total_bytes: Number(validateOutcome.total_bytes),
      archive_bytes: zipResult.archive.byteLength,
    },
    'bulk download served',
  )

  // 8. Stream the archive back. `Response` accepts a Uint8Array
  //    directly; Next.js will set Content-Length correctly.
  return new Response(zipResult.archive as unknown as BodyInit, {
    status: 200,
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${archiveFilename()}"`,
      'Content-Length': String(zipResult.archive.byteLength),
      'Cache-Control': 'no-store',
    },
  })
}

/** Map validator failure codes to HTTP status codes. Pure. */
function statusForCode(
  code:
    | 'invalid_input'
    | 'empty_selection'
    | 'too_many_files'
    | 'not_found'
    | 'forbidden'
    | 'file_not_ready'
    | 'too_large',
): number {
  switch (code) {
    case 'invalid_input':
    case 'empty_selection':
    case 'too_many_files':
      return 400
    case 'not_found':
      return 404
    case 'forbidden':
      return 403
    case 'file_not_ready':
      return 409
    case 'too_large':
      return 413
  }
}

type FetchedEntry =
  | { row: EnrichedBulkFileRow; data: Uint8Array; error?: undefined }
  | { row: EnrichedBulkFileRow; data?: undefined; error: string }

/**
 * Fetch every file's bytes from the Bunny CDN in parallel (capped).
 * Returns one entry per requested file in the same order as `rows`.
 * Each entry has either a `data: Uint8Array` or an `error: string`.
 */
async function fetchAllFiles(rows: EnrichedBulkFileRow[]): Promise<FetchedEntry[]> {
  const results: FetchedEntry[] = new Array(rows.length)
  let cursor = 0

  async function worker() {
    while (cursor < rows.length) {
      const idx = cursor++
      const row = rows[idx]!
      try {
        const data = await fetchOne(row)
        results[idx] = { row, data }
      } catch (err) {
        results[idx] = {
          row,
          error: err instanceof Error ? err.message : 'unknown',
        }
      }
    }
  }

  const workers = Array.from(
    { length: Math.min(FETCH_CONCURRENCY, rows.length) },
    () => worker(),
  )
  await Promise.all(workers)
  return results
}

/** Fetch a single file's bytes from the Bunny CDN. Mints a download-
 *  kind signed URL (NOT IP-bound) on the fly and reads the full body
 *  into a Uint8Array. Throws on non-2xx or read errors. */
async function fetchOne(row: EnrichedBulkFileRow): Promise<Uint8Array> {
  const { url } = signCdnUrl({
    storagePath: row.storage_path,
    kind: 'download',
  })
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`cdn ${res.status} for file ${row.id}`)
  }
  const buf = await res.arrayBuffer()
  return new Uint8Array(buf)
}