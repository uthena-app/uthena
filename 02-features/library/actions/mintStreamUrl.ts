// mintStreamUrl.ts — server action for the HLS stream. Same shape as
// mintDownloadUrl but: shorter TTL (4h), IP-bound (per spec), and
// kind='stream' in the audit log. The signed URL is for the HLS
// manifest (the .m3u8), not the .ts segments; the manifest points to
// the segments which Bunny serves via the same token.
//
// Rate-limited via the same shared 60/hour helper as downloads (added
// in P2.4 — the spec calls out rate limiting on every signed-URL
// surface, not just downloads).
//
// P7.8 Slice 1: also enforces MAX_CONCURRENT_STREAMS — a user with
// N unexpired stream URLs outstanding can't mint another one until
// the oldest expires. The check uses
// `02-features/library/queries/countActiveStreams` (RLS-gated to the
// user's own rows) and the pure decision helper
// `@foundations/files/concurrent-streams`. The limit is a courtesy,
// not a security boundary — see `countActiveStreams.ts` for the
// fail-soft contract.

'use server'

import { headers } from 'next/headers'
import { createHash } from 'node:crypto'
import { getServerSupabase, getServiceSupabase } from '@foundations/data/supabase'
import { MintDownloadInput } from '@foundations/data/schemas'
import { getSessionUser } from '@foundations/auth/guards'
import { signCdnUrl, isBunnyConfigured } from '@foundations/files/signed-url'
import { checkAndRecordSignedUrlMint } from '@foundations/files/rate-limit'
import {
  MAX_CONCURRENT_STREAMS,
  evaluateConcurrentStreamLimit,
} from '@foundations/files/concurrent-streams'
import { countActiveStreams } from '../queries/countActiveStreams'
import { loggerFor } from '@foundations/log/pino'

const log = loggerFor({ component: 'library.mintStreamUrl' })

export type StreamMintResult =
  | { ok: true; url: string; expires_at: string }
  | {
      ok: false
      error: string
      code?:
        | 'not_authed'
        | 'no_access'
        | 'bunny_unconfigured'
        | 'rate_limited'
        | 'too_many_concurrent_streams'
        | 'unknown'
    }

export async function mintStreamUrlAction(
  raw: FormData | Record<string, unknown>,
): Promise<StreamMintResult> {
  const obj = raw instanceof FormData ? Object.fromEntries(raw.entries()) : raw
  // The HLS stream is keyed by file_id (the .m3u8 lives at the file's
  // storage path; Bunny signs the URL). `MintStreamInput` will be a
  // future split once Phase 15 wires lesson_id; for now the shape is
  // identical to the download action so we reuse the same schema.
  const parsed = MintDownloadInput.safeParse({ file_id: obj.file_id })
  if (!parsed.success) return { ok: false, error: 'Invalid file id.' }

  const user = await getSessionUser()
  if (!user) return { ok: false, error: 'Sign in to stream.', code: 'not_authed' }

  // P7.8 Slice 1: concurrent-stream limit. Bounds how many unexpired
  // stream URLs a single user can hold at once (one per player, plus
  // a small multi-device headroom). Runs BEFORE the mint-volume
  // rate limit so a power user can't rapidly cycle URLs past the
  // ceiling — the count is a real-time property of `file_downloads`.
  const active = await countActiveStreams()
  const verdict = evaluateConcurrentStreamLimit(active, MAX_CONCURRENT_STREAMS)
  if (!verdict.allowed) {
    log.warn(
      {
        code: 'too_many_concurrent_streams',
        user_id: user.id,
        active_streams: verdict.current,
        limit: verdict.limit,
      },
      'mint stream denied: concurrent stream limit reached',
    )
    return {
      ok: false,
      error: `You have ${verdict.current} active streams. Close one before starting another (limit ${verdict.limit}).`,
      code: 'too_many_concurrent_streams',
    }
  }

  const rl = checkAndRecordSignedUrlMint(user.id)
  if (!rl.allowed) {
    log.warn(
      { code: 'rate_limited', user_id: user.id, retry_after_s: rl.retryAfterSeconds },
      'mint stream rate limited',
    )
    return {
      ok: false,
      error: `Too many requests. Try again in ${rl.retryAfterSeconds} seconds.`,
      code: 'rate_limited',
    }
  }

  if (!isBunnyConfigured()) {
    return { ok: false, error: 'Streaming is not configured.', code: 'bunny_unconfigured' }
  }

  const supabase = await getServerSupabase()
  const { data: file } = await supabase
    .from('product_files')
    .select('id, product_id, storage_path, scan_status, encoding_status, hls_manifest_url')
    .eq('id', parsed.data.file_id)
    .maybeSingle()
  if (!file) return { ok: false, error: 'File not found.' }
  if (file.scan_status !== 'clean' || file.encoding_status !== 'ready') {
    return { ok: false, error: 'Stream not ready.' }
  }

  // Access check.
  const { data: accessible } = await supabase.rpc('user_accessible_products', { p_user_id: user.id })
  const productIds = new Set<number>(((accessible ?? []) as { product_id: number }[]).map((p) => p.product_id))
  if (!productIds.has(file.product_id)) {
    return { ok: false, error: 'You do not have access to this stream.', code: 'no_access' }
  }

  // Mint the signed URL. HLS streams are IP-bound per spec.
  // We use the HLS manifest path if Bunny has a dedicated one,
  // otherwise the storage path. The Bunny token format takes the
  // same path either way.
  const h = await headers()
  const ip = h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? ''
  const manifestPath = file.hls_manifest_url
    ? file.hls_manifest_url.replace(/^https?:\/\/[^/]+\//, '')
    : file.storage_path.replace(/\.[^.]+$/, '') + '/playlist.m3u8'
  const { url, expiresAt } = signCdnUrl({
    storagePath: manifestPath,
    kind: 'stream',
    ip: ip || undefined,
  })

  // Audit (raw IP, not hashed — streams per spec).
  const ipHash = ip ? createHash('sha256').update(ip + new Date().toISOString().slice(0, 10)).digest('hex') : null
  const service = getServiceSupabase()
  await service.from('file_downloads').insert({
    user_id: user.id,
    file_id: file.id,
    product_id: file.product_id,
    kind: 'stream',
    url_expires_at: expiresAt.toISOString(),
    ip_hash: ipHash,
    ip_raw: ip || null,
    user_agent: h.get('user-agent') ?? null,
  })

  log.info(
    { user_id: user.id, file_id: file.id, product_id: file.product_id, expires_at: expiresAt.toISOString() },
    'stream url minted',
  )
  return { ok: true, url, expires_at: expiresAt.toISOString() }
}
