// writeAuditLog — small helper used by every category mutation
// action. Inserts one row into admin_audit_log.
//
// IMPORTANT: The live schema in `04-platform/migrations/0001_initial.sql`
// (the source of truth) uses these columns:
//   actor_id      uuid not null  (was admin_id in the old spec doc)
//   actor_email   text not null  (required)
//   action        text not null
//   target_kind   text           (was target_table; we use 'category')
//   target_id     text
//   metadata      jsonb          (we encode { before, after } inside)
//   ip            text           (was ip_address inet)
//   user_agent    text
//   created_at    timestamptz
//
// Earlier (pre-fix) this helper inserted into admin_id / target_table /
// before / after / ip_address — those columns don't exist in the real
// table, so the inserts failed silently with PGRST204. This file is
// the single source of truth for the column mapping; callers pass the
// same logical input shape (adminId, actorEmail, action, targetKind,
// targetId, before, after) and we translate.

import 'server-only'
import { getServiceSupabase } from '@foundations/data/supabase'
import { loggerFor } from '@foundations/log/pino'

const log = loggerFor({ component: 'admin.categories.audit' })

export type AuditLogInput = {
  /** The authenticated admin's user_id (UUID). */
  adminId: string
  /** The authenticated admin's email — required by the real schema. */
  actorEmail: string
  /** Action verb (e.g. 'admin.category_create'). */
  action: string
  /** Logical target table name (e.g. 'categories'). We translate to
   *  the singular `target_kind` value the table expects. */
  targetTable: 'categories'
  /** The affected row's id (stringified when written). */
  targetId: string | number
  /** The row's pre-mutation state, or null for create. */
  before: unknown
  /** The row's post-mutation state, or null for delete. */
  after: unknown
  /** Optional client IP — recorded if available. */
  ipAddress?: string | null
  /** Optional user-agent — recorded if available. */
  userAgent?: string | null
}

/** Map a logical table name to the singular `target_kind` value the
 *  audit log stores. Categories use 'category' (singular noun). */
function targetKindFor(table: 'categories'): 'category' {
  return 'category'
}

export async function writeAuditLog(input: AuditLogInput): Promise<number | null> {
  const supabase = getServiceSupabase()
  // Encode { before, after } inside the `metadata` jsonb column. We
  // always set BOTH keys, with null when one side doesn't apply.
  // Empty object fallback satisfies the `not null default '{}'::jsonb`
  // shape so a missing before/after still produces a valid row.
  const metadata: Record<string, unknown> = {}
  if ('before' in input) metadata.before = input.before
  if ('after' in input) metadata.after = input.after

  const { data, error } = await supabase
    .from('admin_audit_log')
    .insert({
      actor_id: input.adminId,
      actor_email: input.actorEmail,
      action: input.action,
      target_kind: targetKindFor(input.targetTable),
      target_id: String(input.targetId),
      metadata: metadata as never,
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
