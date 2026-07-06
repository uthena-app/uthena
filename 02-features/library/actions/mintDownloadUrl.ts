// mintDownloadUrl.ts — server action invoked from the "Generate link"
// button on the /library page. Verifies the user has access to the
// file's product, mints a 24h signed URL, and writes a file_downloads
// row (append-only audit log).
//
// Auth + access model:
//   - The file's product must be in user_accessible_products(user_id).
//     This single check covers both the purchase-grant case and the
//     active-subscription case.
//   - Rate-limited via the shared 00-foundations/files/rate-limit helper
//     (60/hour per user, in-process for v1; STUB-013 documents the
//     Phase 18 P18.8 Supabase migration).

'use server'

import { headers } from 'next/headers'
import { createHash } from 'node:crypto'
import { getServerSupabase, getServiceSupabase } from '@foundations/data/supabase'
import { MintDownloadInput } from '@foundations/data/schemas'
import { getSessionUser } from '@foundations/auth/guards'
import { signCdnUrl, isBunnyConfigured } from '@foundations/files/signed-url'
import { checkAndRecordSignedUrlMint } from '@foundations/files/rate-limit'
import { getEnv } from '@foundations/env'
import { loggerFor } from '@foundations/log/pino'

const log = loggerFor({ component: 'library.mintDownloadUrl' })

export type MintResult =
  | { ok: true; url: string; expires_at: string; file_name: string; size_bytes: number }
  | { ok: false; error: string; code?: 'not_authed' | 'no_access' | 'bunny_unconfigured' | 'rate_limited' | 'unknown' }

export async function mintDownloadUrlAction(
  raw: FormData | Record<string, unknown>,
): Promise<MintResult> {
  const obj = raw instanceof FormData ? Object.fromEntries(raw.entries()) : raw
  const parsed = MintDownloadInput.safeParse({ file_id: obj.file_id })
  if (!parsed.success) return { ok: false, error: 'Invalid file id.' }

  const user = await getSessionUser()
  if (!user) return { ok: false, error: 'Sign in to generate download links.', code: 'not_authed' }

  const rl = checkAndRecordSignedUrlMint(user.id)
  if (!rl.allowed) {
    log.warn(
      { code: 'rate_limited', user_id: user.id, retry_after_s: rl.retryAfterSeconds },
      'mint download rate limited',
    )
    return {
      ok: false,
      error: `Too many requests. Try again in ${rl.retryAfterSeconds} seconds.`,
      code: 'rate_limited',
    }
  }
  if (!isBunnyConfigured()) {
    return {
      ok: false,
      error: 'File storage is not configured. Add BUNNY_SIGNING_KEY + BUNNY_STORAGE_PUBLIC_HOSTNAME.',
      code: 'bunny_unconfigured',
    }
  }

  const supabase = await getServerSupabase()

  // Load the file. The product_files table is readable by anyone
  // for published products (per RLS); we still need the product_id
  // to verify access.
  const { data: file, error: fileErr } = await supabase
    .from('product_files')
    .select('id, product_id, original_filename, storage_path, size_bytes, scan_status, encoding_status')
    .eq('id', parsed.data.file_id)
    .maybeSingle()
  if (fileErr || !file) {
    return { ok: false, error: 'File not found.' }
  }
  // Refuse to serve a file whose scan or encoding is not ready. v1
  // is strict — we never serve 'pending' or 'infected' files.
  if (file.scan_status !== 'clean' || file.encoding_status !== 'ready') {
    return { ok: false, error: 'This file is not available for download yet.' }
  }

  // Access check. user_accessible_products covers both purchase
  // and subscription access in a single roundtrip.
  const { data: accessible, error: accessErr } = await supabase.rpc(
    'user_accessible_products',
    { p_user_id: user.id },
  )
  if (accessErr) {
    log.warn({ code: 'access_check_failed', msg: accessErr.message, file_id: file.id }, 'access check failed')
    return { ok: false, error: 'Could not verify access. Try again.' }
  }
  const productIds = new Set<number>(((accessible ?? []) as { product_id: number }[]).map((p) => p.product_id))
  if (!productIds.has(file.product_id)) {
    log.warn({ code: 'no_access', user_id: user.id, file_id: file.id, product_id: file.product_id }, 'access denied')
    return { ok: false, error: 'You do not have access to this file.', code: 'no_access' }
  }

  // Mint the signed URL (download kind, 24h TTL, no IP binding per spec).
  const { url, expiresAt } = signCdnUrl({
    storagePath: file.storage_path,
    kind: 'download',
  })

  // Write the audit row. Use the service role so the append-only
  // invariant holds (no UPDATE/DELETE policies on file_downloads).
  // Hash the IP (per spec) for downloads.
  const ipRaw = (await headers()).get('x-forwarded-for')?.split(',')[0]?.trim() ?? null
  const ipHash = ipRaw ? createHash('sha256').update(ipRaw + new Date().toISOString().slice(0, 10)).digest('hex') : null
  const env = getEnv()
  const service = getServiceSupabase()
  const { error: auditErr } = await service.from('file_downloads').insert({
    user_id: user.id,
    file_id: file.id,
    product_id: file.product_id,
    kind: 'download',
    url_expires_at: expiresAt.toISOString(),
    ip_hash: ipHash,
    ip_raw: ipRaw, // PH19 cron nulls this after 90 days
    user_agent: (await headers()).get('user-agent') ?? null,
  })
  if (auditErr) {
    // Don't fail the user — log + continue. The audit row is
    // important for abuse detection but the user should still get
    // their file.
    log.warn(
      { code: 'audit_insert_failed', msg: auditErr.message, file_id: file.id },
      'file_downloads audit insert failed (continuing)',
    )
  }

  log.info(
    { user_id: user.id, file_id: file.id, product_id: file.product_id, expires_at: expiresAt.toISOString() },
    'download url minted',
  )
  return {
    ok: true,
    url,
    expires_at: expiresAt.toISOString(),
    file_name: file.original_filename,
    size_bytes: file.size_bytes,
  }
}
