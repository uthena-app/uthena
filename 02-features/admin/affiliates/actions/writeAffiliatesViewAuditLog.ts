// writeAffiliatesViewAuditLog.ts — best-effort audit-log writer for
// the /admin/affiliates list page. Mirrors the partner pattern
// (writePartnersViewAuditLog): every page load writes one row to
// `admin_audit_log` with the active filter bag + sort + page + result
// count. Failure is caught — the page must not block on the audit row.
//
// Per AGENTS.md rule 2: "Admin reads of PII are audit-logged." This
// view surfaces emails (admin-visible), so the read itself is the
// audit-worthy event.

import 'server-only'
import { getServiceSupabase } from '@foundations/data/supabase'
import { loggerFor } from '@foundations/log/pino'
import type { ParsedAffiliateFilters } from '../types'

const log = loggerFor({ component: 'admin.affiliates.writeAffiliatesViewAuditLog' })

export type WriteAffiliatesViewAuditLogInput = {
  adminId: string
  actorEmail: string | null
  filters: ParsedAffiliateFilters
  sort: string
  page: number
  resultCount: number
  ipAddress: string | null
  userAgent: string | null
}

/**
 * Insert one `admin_audit_log` row capturing the admin's view of the
 * affiliates list. Failure is logged + swallowed — the audit row is
 * a defense-in-depth signal, not a gate.
 */
export async function writeAffiliatesViewAuditLog(
  input: WriteAffiliatesViewAuditLogInput,
): Promise<void> {
  try {
    const supabase = getServiceSupabase()
    const { error } = await supabase.from('admin_audit_log').insert({
      actor_id: input.adminId,
      actor_email: input.actorEmail,
      action: 'admin.affiliates_list_viewed',
      target_kind: 'affiliates',
      target_id: null,
      // Filter bag + sort + page in metadata (JSON). The admin_audit_log
      // .metadata column is jsonb.
      metadata: {
        filters: {
          status: input.filters.status,
          joinedFrom: input.filters.joinedFrom,
          joinedTo: input.filters.joinedTo,
          q: input.filters.q,
        },
        sort: input.sort,
        page: input.page,
        resultCount: input.resultCount,
        ip: input.ipAddress,
        userAgent: input.userAgent,
      },
    } as never)

    if (error) {
      log.warn(
        { code: 'admin_affiliates_audit_log_failed', msg: error.message },
        'writeAffiliatesViewAuditLog: insert failed',
      )
    }
  } catch (err) {
    log.warn(
      { code: 'admin_affiliates_audit_log_threw', err: String(err) },
      'writeAffiliatesViewAuditLog: threw',
    )
  }
}