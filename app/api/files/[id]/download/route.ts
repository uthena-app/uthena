// /api/files/[id]/download — mint a 24h signed download URL and 302
// to it. This is the redirect-shaped endpoint for `<a download>`
// and direct browser flows. The /library page uses the
// mintDownloadUrlAction (returns JSON + shows in a textbox) so
// the user can copy/paste; this endpoint is the no-UI path.

import { NextResponse } from 'next/server'
import { getServerSupabase, getServiceSupabase } from '@foundations/data/supabase'
import { getSessionUser } from '@foundations/auth/guards'
import { signCdnUrl, isBunnyConfigured } from '@foundations/files/signed-url'
import { checkAndRecordSignedUrlMint } from '@foundations/files/rate-limit'
import { createHash } from 'node:crypto'
import { headers } from 'next/headers'
import { loggerFor } from '@foundations/log/pino'

export const dynamic = 'force-dynamic'

const log = loggerFor({ component: 'api.files.download' })

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (!isBunnyConfigured()) {
    return NextResponse.json(
      { error: 'storage is not configured' },
      { status: 503 },
    )
  }
  const rl = checkAndRecordSignedUrlMint(user.id)
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'rate limited', retry_after_s: rl.retryAfterSeconds },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } },
    )
  }

  const { id } = await ctx.params
  const fileId = Number(id)
  if (!Number.isInteger(fileId) || fileId <= 0) {
    return NextResponse.json({ error: 'invalid file id' }, { status: 400 })
  }

  const supabase = await getServerSupabase()
  const { data: file } = await supabase
    .from('product_files')
    .select('id, product_id, storage_path, original_filename, scan_status, encoding_status')
    .eq('id', fileId)
    .maybeSingle()
  if (!file) return NextResponse.json({ error: 'not found' }, { status: 404 })
  if (file.scan_status !== 'clean' || file.encoding_status !== 'ready') {
    return NextResponse.json({ error: 'file not ready' }, { status: 409 })
  }

  const { data: accessible } = await supabase.rpc('user_accessible_products', { p_user_id: user.id })
  const productIds = new Set<number>(((accessible ?? []) as { product_id: number }[]).map((p) => p.product_id))
  if (!productIds.has(file.product_id)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const { url, expiresAt } = signCdnUrl({
    storagePath: file.storage_path,
    kind: 'download',
  })

  const h = await headers()
  const ip = h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null
  const ipHash = ip ? createHash('sha256').update(ip + new Date().toISOString().slice(0, 10)).digest('hex') : null
  const service = getServiceSupabase()
  await service.from('file_downloads').insert({
    user_id: user.id,
    file_id: file.id,
    product_id: file.product_id,
    kind: 'download',
    url_expires_at: expiresAt.toISOString(),
    ip_hash: ipHash,
    ip_raw: ip,
    user_agent: h.get('user-agent') ?? null,
  })
  log.info(
    { user_id: user.id, file_id: file.id, product_id: file.product_id },
    'download url minted',
  )
  return NextResponse.redirect(url, { status: 302 })
}
