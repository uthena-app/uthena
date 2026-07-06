// writeOrdersViewAuditLog.ts — best-effort audit-log writer for the
// /admin/orders list page. Mirrors the affiliate / partner patterns:
// every page load writes one row to `admin_audit_log` with the active
// filter bag + page + result count. Failure is caught — the page must
// not block on the audit row.
//
// Per AGENTS.md rule 2: "Admin reads of PII are audit-logged." This view
// surfaces customer emails + totals (admin-visible), so the read itself
// is the audit-worthy event.

import 'server-only'
import { getServiceSupabase } from '@foundations/data/supabase'
import { loggerFor } from '@foundations/log/pino'
import type { ParsedOrderFilters } from '../types'

const log = loggerFor({ component: 'admin.orders.writeOrdersViewAuditLog' })

export type WriteOrdersViewAuditLogInput = {
  adminId: string
  actorEmail: string | null
  filters: ParsedOrderFilters
  page: number
  resultCount: number
  ipAddress: string | null
  userAgent: string | null
}

/**
 * Insert one `admin_audit_log` row capturing the admin's view of the
 * orders list. Failure is logged + swallowed — the audit row is a
 * defense-in-depth signal, not a gate.
 */
export async function writeOrdersViewAuditLog(
  input: WriteOrdersViewAuditLogInput,
): Promise<void> {
  try {
    const supabase = getServiceSupabase()
    const { error } = await supabase.from('admin_audit_log').insert({
      actor_id: input.adminId,
      actor_email: input.actorEmail,
      action: 'admin.orders_list_viewed',
      target_kind: 'orders',
      target_id: null,
      // Filter bag + page in metadata (JSON). The admin_audit_log
      // .metadata column is jsonb. NOTE: customerEmail is included
      // as-is here — it's already an admin-only ILIKE search, and the
      // admin_audit_log row itself is admin-only-readable (separate
      // RLS, per P3.5 / migration 0026 partitioning). If a stricter
      // PII policy is desired in future, swap to a sha-256-prefix
      // hash here.
      metadata: {
        filters: {
          status: input.filters.status,
          from: input.filters.from,
          to: input.filters.to,
          customerEmail: input.filters.customerEmail,
          affiliateId: input.filters.affiliateId,
          productId: input.filters.productId,
          partnerId: input.filters.partnerId,
        },
        page: input.page,
        resultCount: input.resultCount,
        ip: input.ipAddress,
        userAgent: input.userAgent,
      },
    } as never)

    if (error) {
      log.warn(
        { code: 'admin_orders_audit_log_failed', msg: error.message },
        'writeOrdersViewAuditLog: insert failed',
      )
    }
  } catch (err) {
    log.warn(
      { code: 'admin_orders_audit_log_threw', err: String(err) },
      'writeOrdersViewAuditLog: threw',
    )
  }
}
