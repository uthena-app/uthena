// writeOrderDetailViewAuditLog.ts — best-effort audit writer for the
// /admin/orders/[id] page. Mirrors the customer-detail + partner-detail
// pattern: every page load writes one row to `admin_audit_log` with
// `action = 'admin.order_detail_viewed'`, the target_id is the order id,
// and the metadata carries the active tab.
//
// PII note: metadata is intentionally minimal — just the active tab.
// The masked-by-default view is NOT a reveal event; the destruct-
// ive-action audit rows (issue_manual_refund / mark_fraudulent /
// resend_receipt / admin_note / copy_payment_intent_id) ship in
// Slice 2 as their own AuditAction values.

import 'server-only'
import { getServiceSupabase } from '@foundations/data/supabase'
import { loggerFor } from '@foundations/log/pino'
import type { OrderDetailTab } from '../queries/parseOrderDetailTab'

const log = loggerFor({ component: 'admin.order-detail.audit' })

export type WriteOrderDetailViewAuditLogInput = {
  adminId: string
  actorEmail: string | null
  orderId: string
  tab: OrderDetailTab
  ipAddress?: string | null
  userAgent?: string | null
}

export async function writeOrderDetailViewAuditLog(
  input: WriteOrderDetailViewAuditLogInput,
): Promise<number | null> {
  try {
    const supabase = getServiceSupabase()
    const { data, error } = await supabase
      .from('admin_audit_log')
      .insert({
        actor_id: input.adminId,
        actor_email: input.actorEmail,
        action: 'admin.order_detail_viewed',
        target_kind: 'orders',
        target_id: input.orderId,
        metadata: {
          tab: input.tab,
        } as never,
        ip: input.ipAddress ?? null,
        user_agent: input.userAgent ?? null,
      })
      .select('id')
      .single()

    if (error || !data) {
      log.warn(
        { code: 'order_detail_view_audit_write_failed' },
        'writeOrderDetailViewAuditLog: insert failed',
      )
      return null
    }
    return (data as unknown as { id: number }).id
  } catch (err) {
    log.warn(
      { code: 'order_detail_view_audit_write_threw', err: String(err) },
      'writeOrderDetailViewAuditLog: threw',
    )
    return null
  }
}
