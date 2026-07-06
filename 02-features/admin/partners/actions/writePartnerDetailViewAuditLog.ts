// writePartnerDetailViewAuditLog.ts — every /admin/partners/[id] page
// load writes one audit row. The action key is
// `admin.partner_detail_viewed`. The `target_kind` is 'partners', the
// `target_id` is the partner's id (bigint as string), and the
// `metadata` carries the active tab.
//
// PII note: the metadata is intentionally minimal. We record the tab
// the admin opened (so the audit log reader knows which surface was
// read), but NOT the email hash, NOT the payout email mask, NOT any
// of the read fields. The page load itself is the audit-worthy event;
// the row exists so a future investigation can correlate
// "which admin looked at this partner on this date" without
// carrying the actual PII in the audit log.

import 'server-only'
import { getServiceSupabase } from '@foundations/data/supabase'
import { loggerFor } from '@foundations/log/pino'
import type { PartnerDetailTab } from '../queries/parsePartnerDetailTab'

const log = loggerFor({ component: 'admin.partners.detail.audit' })

export type WritePartnerDetailViewAuditLogInput = {
  adminId: string
  actorEmail: string
  partnerId: string
  tab: PartnerDetailTab
  ipAddress?: string | null
  userAgent?: string | null
}

export async function writePartnerDetailViewAuditLog(
  input: WritePartnerDetailViewAuditLogInput,
): Promise<number | null> {
  const supabase = getServiceSupabase()

  const metadata = {
    tab: input.tab,
    // The partner_id is the canonical target; metadata also carries it
    // for log readers that filter by target_id at the metadata level.
    partner_id: input.partnerId,
  }

  const { data, error } = await supabase
    .from('admin_audit_log')
    .insert({
      actor_id: input.adminId,
      actor_email: input.actorEmail,
      action: 'admin.partner_detail_viewed',
      target_kind: 'partners',
      target_id: input.partnerId,
      metadata: metadata as never,
      ip: input.ipAddress ?? null,
      user_agent: input.userAgent ?? null,
    })
    .select('id')
    .single()

  if (error || !data) {
    log.warn(
      { code: 'partner_detail_view_audit_write_failed' },
      'writePartnerDetailViewAuditLog: insert failed',
    )
    return null
  }
  return (data as unknown as { id: number }).id
}