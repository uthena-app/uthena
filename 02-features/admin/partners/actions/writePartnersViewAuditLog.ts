// writePartnersViewAuditLog.ts — every /admin/partners page load
// writes one audit row with action='admin.partners_list_viewed',
// target_kind='partners', and the active filter bag in `before`
// JSON.
//
// PII note: the audit row's `before` JSON contains the filter values
// (status, kyc_status, tax_form_status, applied range, search query)
// but NOT the partner rows themselves. The search query (`q`) is
// stored as-is because the admin typed it — admins see their own
// queries in the audit log so support can reconstruct "what was the
// admin looking for?". The partner rows that match the filter are
// not duplicated into the audit log — the page load itself is the
// audit-worthy event (every row rendered is admin-readable PII).

import 'server-only'
import { getServiceSupabase } from '@foundations/data/supabase'
import { loggerFor } from '@foundations/log/pino'
import type { ParsedPartnerFilters } from '../types'

const log = loggerFor({ component: 'admin.partners.audit' })

export type WritePartnersViewAuditLogInput = {
  adminId: string
  actorEmail: string
  filters: ParsedPartnerFilters
  /** The sort key + page + result count. */
  sort: string
  page: number
  resultCount: number
  ipAddress?: string | null
  userAgent?: string | null
}

export async function writePartnersViewAuditLog(
  input: WritePartnersViewAuditLogInput,
): Promise<number | null> {
  const supabase = getServiceSupabase()

  // Filter bag is the canonical "what did the admin ask for" payload.
  // The shape matches the URL params so an audit-log reader can
  // reconstruct the page URL.
  const before: Record<string, unknown> = {}
  if (input.filters.status) before.status = input.filters.status
  if (input.filters.kycStatus) before.kycStatus = input.filters.kycStatus
  if (input.filters.taxFormStatus) before.taxFormStatus = input.filters.taxFormStatus
  if (input.filters.appliedFrom) before.appliedFrom = input.filters.appliedFrom
  if (input.filters.appliedTo) before.appliedTo = input.filters.appliedTo
  if (input.filters.q) before.q = input.filters.q

  const metadata: Record<string, unknown> = {
    before,
    sort: input.sort,
    page: input.page,
    resultCount: input.resultCount,
  }

  const { data, error } = await supabase
    .from('admin_audit_log')
    .insert({
      actor_id: input.adminId,
      actor_email: input.actorEmail,
      action: 'admin.partners_list_viewed',
      target_kind: 'partners',
      target_id: null,
      metadata: metadata as never,
      ip: input.ipAddress ?? null,
      user_agent: input.userAgent ?? null,
    })
    .select('id')
    .single()

  if (error || !data) {
    log.warn(
      { code: 'partners_view_audit_write_failed', msg: error?.message },
      'writePartnersViewAuditLog: insert failed',
    )
    return null
  }
  return (data as unknown as { id: number }).id
}