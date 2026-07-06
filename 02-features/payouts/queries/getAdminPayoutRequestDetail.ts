// getAdminPayoutRequestDetail.ts — read the full payout_requests row
// + partner + ledger impact preview for the admin detail surface.

import 'server-only'
import { z } from 'zod'
import { getServiceSupabase } from '@foundations/data/supabase'
import { getSessionUser } from '@foundations/auth/guards'
import { requireRole } from '@foundations/auth/guards'
import { loggerFor } from '@foundations/log/pino'

const log = loggerFor({ component: 'payouts.getAdminPayoutRequestDetail' })

const IdSchema = z.object({ id: z.number().int().positive() })

export type AdminPayoutRequestDetail = {
  id: number
  partnerId: number
  partnerName: string | null
  partnerEmailMasked: string | null
  amountCents: number
  currency: string
  status: string
  payoutMethodKind: 'paypal'
  payoutMethodTargetMasked: string
  denialReason: string | null
  processedAt: string | null
  createdAt: string
  updatedAt: string
  ledger: Array<{ id: number; amountCents: number; kind: string; description: string | null; createdAt: string }>
  metadata: Record<string, unknown> | null
}

export async function getAdminPayoutRequestDetail(
  rawId: number,
): Promise<AdminPayoutRequestDetail | null> {
  const user = await getSessionUser()
  if (!user) return null
  try {
    await requireRole(['admin', 'super_admin'])
  } catch {
    return null
  }
  const parsed = IdSchema.safeParse({ id: rawId })
  if (!parsed.success) return null

  const service = getServiceSupabase()
  const { data: req, error: reqErr } = await service
    .from('payout_requests')
    .select('id, partner_id, amount_cents, currency, status, payout_method_kind, payout_method_target_masked, denial_reason, processed_at, created_at, updated_at, metadata')
    .eq('id', parsed.data.id)
    .maybeSingle()
  if (reqErr || !req) return null

  const partnerId = (req as { partner_id: number }).partner_id
  const [partnerRes, profileRes, ledgerRes] = await Promise.all([
    service.from('partners').select('id, public_slug, user_id, payout_method').eq('id', partnerId).maybeSingle(),
    service.rpc('get_admin_partner_detail' as never, { p_partner_id: partnerId } as never).then((r) => ({ data: r.data, error: r.error })),
    service.from('payout_ledger').select('id, amount_cents, kind, description, created_at').eq('partner_id', partnerId).in('status', ['pending_payout', 'paid']).order('created_at', { ascending: true }).limit(200),
  ])

  let partnerName: string | null = null
  let partnerEmailMasked: string | null = null
  if (partnerRes.data) {
    partnerName = (partnerRes.data as { public_slug: string | null }).public_slug ?? null
    // profile email not exposed; we show partnerSlug only (matches the queue pattern)
  }

  const ledger = (ledgerRes.data ?? []).map((r) => {
    const row = r as { id: number; amount_cents: number | null; kind: string; description: string | null; created_at: string }
    return {
      id: row.id,
      amountCents: row.amount_cents ?? 0,
      kind: row.kind,
      description: row.description,
      createdAt: row.created_at,
    }
  })

  return {
    id: (req as { id: number }).id,
    partnerId,
    partnerName,
    partnerEmailMasked,
    amountCents: (req as { amount_cents: number }).amount_cents,
    currency: (req as { currency: string }).currency,
    status: (req as { status: string }).status,
    payoutMethodKind: 'paypal',
    payoutMethodTargetMasked: (req as { payout_method_target_masked: string }).payout_method_target_masked,
    denialReason: (req as { denial_reason: string | null }).denial_reason,
    processedAt: (req as { processed_at: string | null }).processed_at,
    createdAt: (req as { created_at: string }).created_at,
    updatedAt: (req as { updated_at: string }).updated_at,
    ledger,
    metadata: ((req as { metadata: Record<string, unknown> | null }).metadata) ?? null,
  }
}
