// writeAuditLog — admin audit log writer for the account-switcher
// feature. Mirrors the column-mapping pattern established by
// `02-features/admin/categories/actions/writeAuditLog.ts`.
//
// Always writes via the service-role client (no INSERT policy exists
// on admin_audit_log for non-service-role callers). Fails soft —
// returns `null` and logs a warning if the insert fails; the caller
// still completes the user-facing action.

import 'server-only'
import { getServiceSupabase } from '@foundations/data/supabase'
import { loggerFor } from '@foundations/log/pino'

const log = loggerFor({ component: 'admin.account-switcher.audit' })

export type AccountSwitcherAuditInput = {
  /** Authenticated admin's user_id (UUID). */
  adminId: string
  /** Authenticated admin's email — required by admin_audit_log.actor_email. */
  actorEmail: string
  /** Action verb (e.g. 'admin.account_switch_initiated'). */
  action: string
  /** Affected user's id (UUID-as-string). */
  targetUserId: string
  /** Free-form metadata. Stored verbatim in the `metadata` jsonb column. */
  metadata: Record<string, unknown>
  /** Optional client IP (from x-forwarded-for). */
  ipAddress?: string | null
  /** Optional truncated user-agent (caller truncates). */
  userAgent?: string | null
}

export async function writeAuditLog(input: AccountSwitcherAuditInput): Promise<number | null> {
  const supabase = getServiceSupabase()
  const { data, error } = await supabase
    .from('admin_audit_log')
    .insert({
      actor_id: input.adminId,
      actor_email: input.actorEmail,
      action: input.action,
      target_kind: 'profile',
      target_id: input.targetUserId,
      metadata: input.metadata as never,
      ip: input.ipAddress ?? null,
      user_agent: input.userAgent ?? null,
    })
    .select('id')
    .single()

  if (error || !data) {
    log.warn(
      { code: 'audit_write_failed', action: input.action, msg: error?.message },
      'writeAuditLog: insert failed',
    )
    return null
  }
  return (data as unknown as { id: number }).id
}
