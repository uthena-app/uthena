// writeAnalyticsViewAuditLog.ts — every /admin/analytics page load
// writes one audit row with action='admin.analytics_viewed',
// target_kind='analytics_daily', and the active date-range + segment
// in metadata.
//
// PII note: the filter bag carries date-range + segment kind + IDs +
// the analytics_daily row count. It NEVER carries customer emails,
// names, IPs, or any per-row data. The page load itself is the
// audit-worthy event (admin is reading the platform's aggregate
// numbers — admin-internal PII-adjacent per spec §Security line 88).
//
// Best-effort writer: failure here must NOT block the page render.
// The caller `.catch(() => null)`s the result and continues.

import 'server-only'
import { getServiceSupabase } from '@foundations/data/supabase'
import { loggerFor } from '@foundations/log/pino'
import type { AnalyticsRange } from '../types'

const log = loggerFor({ component: 'admin.analytics.audit' })

export type WriteAnalyticsViewAuditLogInput = {
  adminId: string
  actorEmail: string
  range: AnalyticsRange
  /** The 'all' / 'category' / 'partner' / 'affiliate' segment selected. */
  segment: 'all' | 'category' | 'partner' | 'affiliate'
  /** Optional dimension ID when segment != 'all'. */
  dimensionId?: string | number | null
  /** Number of analytics_daily rows the page consumed. */
  rowCount: number
  ipAddress?: string | null
  userAgent?: string | null
}

export async function writeAnalyticsViewAuditLog(
  input: WriteAnalyticsViewAuditLogInput,
): Promise<number | null> {
  const supabase = getServiceSupabase()

  // The filter bag — what did the admin look at? Date range + segment
  // + dimension_id. No row-level data.
  const before: Record<string, unknown> = {
    rangeKind: input.range.kind,
    from: input.range.fromIso,
    to: input.range.toIso,
    days: input.range.days,
    segment: input.segment,
  }
  if (input.segment !== 'all' && input.dimensionId !== null && input.dimensionId !== undefined) {
    before.dimensionId = String(input.dimensionId)
  }

  const metadata: Record<string, unknown> = {
    before,
    rowCount: input.rowCount,
  }

  const { data, error } = await supabase
    .from('admin_audit_log')
    .insert({
      actor_id: input.adminId,
      actor_email: input.actorEmail,
      action: 'admin.analytics_viewed',
      target_kind: 'analytics_daily',
      target_id: null,
      metadata: metadata as never,
      ip: input.ipAddress ?? null,
      user_agent: input.userAgent ?? null,
    })
    .select('id')
    .single()

  if (error || !data) {
    log.warn(
      { code: 'admin_analytics_audit_failed', msg: error?.message ?? 'unknown' },
      'writeAnalyticsViewAuditLog: insert failed',
    )
    return null
  }

  return (data as unknown as { id: number }).id ?? null
}