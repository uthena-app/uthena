// writeCustomerDetailViewAuditLog.ts — every /admin/customers/[id] page
// load writes one audit row. The action key is
// `admin.customer_detail_viewed`. The `target_kind` is 'profiles', the
// `target_id` is the customer's user_id (uuid as string), and the
// `metadata` carries the active tab + a flag for whether the masked
// fields are being viewed.
//
// PII note: the metadata is intentionally minimal. We record the tab
// the admin opened (so the audit log reader knows which surface was
// read), but NOT the email hash, NOT the IP mask, NOT any of the
// read fields. The page load itself is the audit-worthy event; the
// row exists so a future investigation can correlate
// "which admin looked at this customer on this date" without
// carrying the actual PII in the audit log.

import 'server-only'
import { getServiceSupabase } from '@foundations/data/supabase'
import { loggerFor } from '@foundations/log/pino'
import type { CustomerDetailTab } from '../queries/parseCustomerDetailTab'

const log = loggerFor({ component: 'admin.customers.detail.audit' })

export type WriteCustomerDetailViewAuditLogInput = {
  adminId: string
  actorEmail: string
  customerUserId: string
  tab: CustomerDetailTab
  ipAddress?: string | null
  userAgent?: string | null
}

export async function writeCustomerDetailViewAuditLog(
  input: WriteCustomerDetailViewAuditLogInput,
): Promise<number | null> {
  const supabase = getServiceSupabase()

  const metadata = {
    tab: input.tab,
    // The user_id is the canonical target; metadata also carries it
    // for log readers that filter by target_id at the metadata level.
    customer_user_id: input.customerUserId,
  }

  const { data, error } = await supabase
    .from('admin_audit_log')
    .insert({
      actor_id: input.adminId,
      actor_email: input.actorEmail,
      action: 'admin.customer_detail_viewed',
      target_kind: 'profiles',
      target_id: input.customerUserId,
      metadata: metadata as never,
      ip: input.ipAddress ?? null,
      user_agent: input.userAgent ?? null,
    })
    .select('id')
    .single()

  if (error || !data) {
    log.warn(
      { code: 'customer_detail_view_audit_write_failed' },
      'writeCustomerDetailViewAuditLog: insert failed',
    )
    return null
  }
  return (data as unknown as { id: number }).id
}