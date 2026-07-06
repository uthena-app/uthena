// writePlatformSettingsAuditLog.ts — small helper used by the
// platform-settings admin actions. Inserts one row into admin_audit_log.
//
// Mirrors the column mapping from `02-features/admin/categories/actions/writeAuditLog.ts`:
//   actor_id      uuid not null
//   actor_email   text not null
//   action        text not null
//   target_kind   text           (we use 'platform_settings' as the
//                                  logical singular noun)
//   target_id     text           (we store the key name)
//   metadata      jsonb          (we encode { before, after } inside)
//   ip            text
//   user_agent    text
//   created_at    timestamptz

import 'server-only'
import { getServiceSupabase } from '@foundations/data/supabase'
import { loggerFor } from '@foundations/log/pino'

const log = loggerFor({ component: 'admin.platform_settings.audit' })

export type PlatformSettingsAuditLogInput = {
  /** The authenticated admin's user_id (UUID). */
  adminId: string
  /** The authenticated admin's email — required by the real schema. */
  actorEmail: string
  /** Action verb (e.g. 'admin.settings_update'). */
  action: 'admin.settings_update'
  /** The platform_settings.key that was mutated. */
  key: string
  /** Pre-mutation value (the row's `value` jsonb). */
  before: unknown
  /** Post-mutation value (the row's `value` jsonb). */
  after: unknown
  /** Optional client IP — recorded if available. */
  ipAddress?: string | null
  /** Optional user-agent — recorded if available. */
  userAgent?: string | null
}

export async function writePlatformSettingsAuditLog(
  input: PlatformSettingsAuditLogInput,
): Promise<number | null> {
  const supabase = getServiceSupabase()
  const metadata: Record<string, unknown> = {
    before: input.before,
    after: input.after,
  }
  const { data, error } = await supabase
    .from('admin_audit_log')
    .insert({
      actor_id: input.adminId,
      actor_email: input.actorEmail,
      action: input.action,
      target_kind: 'platform_settings',
      target_id: input.key,
      metadata: metadata as never,
      ip: input.ipAddress ?? null,
      user_agent: input.userAgent ?? null,
    })
    .select('id')
    .single()

  if (error || !data) {
    log.warn(
      { code: 'platform_settings_audit_write_failed', msg: error?.message },
      'writePlatformSettingsAuditLog: insert failed',
    )
    return null
  }
  return (data as unknown as { id: number }).id
}