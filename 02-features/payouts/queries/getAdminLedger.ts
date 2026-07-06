// getAdminLedger.ts — admin's full ledger view. Service-role because
// the admin sees all partners' rows (RLS for partner_read_own would
// block the cross-partner read). RLS on payout_ledger also includes
// `payout_ledger_admin_read` for the admin RLS-aware client, so the
// admin can also use their RLS client. v1: service-role for clarity.

import 'server-only'
import { getServiceSupabase } from '@foundations/data/supabase'
import { getSessionUser } from '@foundations/auth/guards'
import { loggerFor } from '@foundations/log/pino'

const log = loggerFor({ component: 'payouts.getAdminLedger' })

export type AdminLedgerEntry = {
  id: number
  partner_id: number
  partner_name: string | null
  created_at: string
  kind: 'order_sale' | 'subscription' | 'refund' | 'adjustment' | 'payout' | 'clawback'
  status: 'accruing' | 'pending_payout' | 'locked' | 'available' | 'paid' | 'void'
  amount_cents: number
  currency: string
  description: string | null
  order_id: number | null
  available_at: string | null
  paid_at: string | null
}

export type AdminLedgerResult = {
  entries: AdminLedgerEntry[]
  totals: {
    available_cents: number
    locked_cents: number
    paid_this_month_cents: number
    pending_payout_cents: number
    available_by_partner: Array<{ partner_id: number; partner_name: string | null; available_cents: number }>
  }
}

export async function getAdminLedger(opts: { limit?: number } = {}): Promise<AdminLedgerResult> {
  const user = await getSessionUser()
  if (!user) {
    return { entries: [], totals: emptyTotals() }
  }
  const service = getServiceSupabase()
  // Read the entries + a partner_id -> display_name map. One
  // roundtrip for entries, one for the partner name map. We don't
  // embed the join in PostgREST because the partner `public_slug` is
  // sometimes null; an explicit map is simpler.
  const { data: entries, error } = await service
    .from('payout_ledger')
    .select('id, partner_id, created_at, kind, status, amount_cents, currency, description, order_id, available_at, paid_at')
    .order('created_at', { ascending: false })
    .limit(opts.limit ?? 100)
  if (error) {
    log.warn({ code: 'admin_ledger_failed', msg: error.message }, 'admin ledger read failed')
    return { entries: [], totals: emptyTotals() }
  }

  const { data: partners } = await service.from('partners').select('id, public_slug, user_id')
  const partnerName = new Map<number, string | null>()
  if (partners) {
    for (const p of partners) {
      partnerName.set(p.id, p.public_slug ?? `Partner #${p.id}`)
    }
  }
  const annotated: AdminLedgerEntry[] = (entries ?? []).map((e) => ({
    ...e,
    partner_name: partnerName.get(e.partner_id) ?? null,
  }))

  // Totals. Three round-trips for the three statuses + one aggregate
  // for "available by partner" (group by partner_id).
  const monthStart = new Date()
  monthStart.setUTCDate(1)
  monthStart.setUTCHours(0, 0, 0, 0)
  const monthStartIso = monthStart.toISOString()
  const [availableRes, lockedRes, paidThisMonthRes, pendingRes, availableByPartnerRes] = await Promise.all([
    service.from('payout_ledger').select('amount_cents').eq('status', 'available'),
    service.from('payout_ledger').select('amount_cents').eq('status', 'locked'),
    service.from('payout_ledger').select('amount_cents').eq('status', 'paid').gte('paid_at', monthStartIso),
    service.from('payout_ledger').select('amount_cents').eq('status', 'pending_payout'),
    service.from('payout_ledger').select('partner_id, amount_cents').eq('status', 'available'),
  ])
  const sum = (rows: { amount_cents: number | null }[] | null) =>
    (rows ?? []).reduce((s, r) => s + (r.amount_cents ?? 0), 0)

  // Aggregate "available by partner" in JS (PostgREST doesn't have
  // group-by in a single roundtrip; the data is small at 500
  // partners max so a JS fold is fine).
  const byPartner = new Map<number, number>()
  for (const r of availableByPartnerRes.data ?? []) {
    byPartner.set(r.partner_id, (byPartner.get(r.partner_id) ?? 0) + (r.amount_cents ?? 0))
  }
  const available_by_partner = [...byPartner.entries()].map(([partner_id, amount_cents]) => ({
    partner_id,
    partner_name: partnerName.get(partner_id) ?? null,
    available_cents: amount_cents,
  }))
  // Sort by available_cents desc, take top 20.
  available_by_partner.sort((a, b) => b.available_cents - a.available_cents)
  available_by_partner.splice(20)

  return {
    entries: annotated,
    totals: {
      available_cents: sum(availableRes.data),
      locked_cents: sum(lockedRes.data),
      paid_this_month_cents: sum(paidThisMonthRes.data),
      pending_payout_cents: sum(pendingRes.data),
      available_by_partner,
    },
  }
}

function emptyTotals(): AdminLedgerResult['totals'] {
  return {
    available_cents: 0,
    locked_cents: 0,
    paid_this_month_cents: 0,
    pending_payout_cents: 0,
    available_by_partner: [],
  }
}
