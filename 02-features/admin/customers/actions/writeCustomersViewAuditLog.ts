// writeCustomersViewAuditLog.ts — every /admin/customers page load
// writes one audit row with action='admin.customers_list_viewed',
// target_table='profiles', and the active filter bag in `before`
// JSON. Bulk actions (email / suspend / CSV) and per-row PII clicks
// ship in Slice 2 (STUB-114 — the audit actions for those will be
// added alongside the actions themselves).
//
// PII note: the audit row's `before` JSON contains the filter values
// (role, status, signup range, spend range, risk range, search query)
// but NOT the customer rows themselves. The search query (`q`) is
// stored as-is because the admin typed it — admins see their own
// queries in the audit log so support can reconstruct "what was the
// admin looking for?". The customer rows that match the filter are
// not duplicated into the audit log — the page load itself is the
// audit-worthy event (every row rendered is admin-readable PII).

import 'server-only'
import { getServiceSupabase } from '@foundations/data/supabase'
import { loggerFor } from '@foundations/log/pino'
import type { ParsedCustomerFilters } from '../types'

const log = loggerFor({ component: 'admin.customers.audit' })

export type WriteCustomersViewAuditLogInput = {
  adminId: string
  actorEmail: string
  filters: ParsedCustomerFilters
  /** The sort key + page + result count. */
  sort: string
  page: number
  resultCount: number
  ipAddress?: string | null
  userAgent?: string | null
}

export async function writeCustomersViewAuditLog(
  input: WriteCustomersViewAuditLogInput,
): Promise<number | null> {
  const supabase = getServiceSupabase()

  // Filter bag is the canonical "what did the admin ask for" payload.
  // The shape matches the URL params so an audit-log reader can
  // reconstruct the page URL.
  const before: Record<string, unknown> = {}
  if (input.filters.role) before.role = input.filters.role
  if (input.filters.status) before.status = input.filters.status
  if (input.filters.signupFrom) before.signupFrom = input.filters.signupFrom
  if (input.filters.signupTo) before.signupTo = input.filters.signupTo
  if (input.filters.spendMinCents !== null) {
    before.spendMinCents = input.filters.spendMinCents
  }
  if (input.filters.spendMaxCents !== null) {
    before.spendMaxCents = input.filters.spendMaxCents
  }
  if (input.filters.riskMin !== null) before.riskMin = input.filters.riskMin
  if (input.filters.riskMax !== null) before.riskMax = input.filters.riskMax
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
      action: 'admin.customers_list_viewed',
      target_kind: 'profiles',
      target_id: null,
      metadata: metadata as never,
      ip: input.ipAddress ?? null,
      user_agent: input.userAgent ?? null,
    })
    .select('id')
    .single()

  if (error || !data) {
    log.warn(
      { code: 'customers_view_audit_write_failed', msg: error?.message },
      'writeCustomersViewAuditLog: insert failed',
    )
    return null
  }
  return (data as unknown as { id: number }).id
}