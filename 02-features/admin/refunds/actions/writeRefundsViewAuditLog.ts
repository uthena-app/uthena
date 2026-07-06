// writeRefundsViewAuditLog.ts — best-effort audit-log writer for the
// /admin/refunds list + detail page. Mirrors the orders / partners /
// affiliates patterns: every page load writes one row to
// `admin_audit_log` capturing the active filter bag + the detail-panel
// id (when present). Failure is caught — the page must not block on
// the audit row.
//
// Per AGENTS.md rule 2: "Admin reads of PII are audit-logged." This
// view surfaces customer emails + refund reason text + reversal
// amounts (admin-visible), so the read itself is the audit-worthy
// event.
//
// Action values (per spec line 72):
//   - 'admin.refunds_queue_viewed' — every list page load
//   - 'admin.refund_detail_viewed' — every detail-panel open
//     (target_id = refund id)

import 'server-only'
import { getServiceSupabase } from '@foundations/data/supabase'
import { loggerFor } from '@foundations/log/pino'
import type { ParsedRefundFilters } from '../types'

const log = loggerFor({ component: 'admin.refunds.writeRefundsViewAuditLog' })

export type WriteRefundsViewAuditLogInput = {
  adminId: string
  actorEmail: string | null
  /** When null, this is a queue page view (no detail-panel id). */
  detailRefundId: number | null
  filters: ParsedRefundFilters
  page: number
  resultCount: number
  ipAddress: string | null
  userAgent: string | null
}

/**
 * Insert one `admin_audit_log` row capturing the admin's view of the
 * refunds queue OR the detail panel for one refund. Failure is logged
 * + swallowed — the audit row is a defense-in-depth signal, not a
 * gate.
 */
export async function writeRefundsViewAuditLog(
  input: WriteRefundsViewAuditLogInput,
): Promise<void> {
  try {
    const supabase = getServiceSupabase()
    const isDetail = input.detailRefundId !== null
    const { error } = await supabase.from('admin_audit_log').insert({
      actor_id: input.adminId,
      actor_email: input.actorEmail,
      action: isDetail ? 'admin.refund_detail_viewed' : 'admin.refunds_queue_viewed',
      target_kind: 'refunds',
      target_id: isDetail ? String(input.detailRefundId) : null,
      // Filter bag + page + result count in metadata (JSON).
      // The admin_audit_log .metadata column is jsonb. NOTE:
      // customerEmail is included as-is here — it's already an
      // admin-only ILIKE search, and the admin_audit_log row itself
      // is admin-only-readable (separate RLS, per P3.5 / migration
      // 0026 partitioning). If a stricter PII policy is desired in
      // future, swap to a sha-256-prefix hash here.
      metadata: {
        filters: input.filters,
        page: input.page,
        resultCount: input.resultCount,
        ...(isDetail ? { refundId: input.detailRefundId } : {}),
      },
      ip_address: input.ipAddress,
      user_agent: input.userAgent,
    })
    if (error) {
      log.warn(
        { code: 'admin_refunds_audit_failed', msg: error.message },
        'writeRefundsViewAuditLog: insert failed',
      )
    }
  } catch (err) {
    log.warn(
      {
        code: 'admin_refunds_audit_threw',
        msg: err instanceof Error ? err.message : 'unknown',
      },
      'writeRefundsViewAuditLog: unexpected error',
    )
  }
}