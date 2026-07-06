// getCategoryHistory.ts — last N admin_audit_log entries whose
// target_kind = 'category'. Reads the actor's email straight from
// the row (admin_audit_log stores actor_email as a snapshot, so
// we don't need to join to profiles for this view).
//
// IMPORTANT: The live schema in `04-platform/migrations/0001_initial.sql`
// uses target_kind (was target_table) and created_at (was at).
// Earlier this query targeted the old names and returned 0 rows
// after the column rename.

import 'server-only'
import { getServerSupabase } from '@foundations/data/supabase'
import { requireRole } from '@foundations/auth/guards'
import { loggerFor } from '@foundations/log/pino'
import type { CategoryAuditEntry } from '../types'

const log = loggerFor({ component: 'admin.categories.getCategoryHistory' })

export async function getCategoryHistory(limit = 20): Promise<CategoryAuditEntry[]> {
  await requireRole(['admin', 'super_admin'])
  const supabase = await getServerSupabase()

  const { data, error } = await supabase
    .from('admin_audit_log')
    .select('id, action, target_id, metadata, created_at, actor_id, actor_email')
    .eq('target_kind', 'category')
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error || !data) {
    log.warn(
      { code: 'cat_history_failed', msg: error?.message },
      'getCategoryHistory: admin_audit_log query failed',
    )
    return []
  }

  type RawRow = {
    id: number
    action: string
    target_id: string | null
    metadata: unknown
    created_at: string
    actor_id: string
    actor_email: string
  }

  return (data as unknown as RawRow[]).map((row) => {
    // `metadata` is the jsonb blob that contains our {before, after}
    // shape (encoded by writeAuditLog). The panel reads the action
    // verb; the before/after blob is reserved for the future detail
    // view, not the collapsed list.
    const meta = (row.metadata ?? {}) as { before?: unknown; after?: unknown }
    return {
      id: row.id,
      action: row.action,
      target_id: row.target_id,
      before: meta.before ?? null,
      after: meta.after ?? null,
      created_at: row.created_at,
      actor_id: row.actor_id,
      actor_email: row.actor_email,
    } satisfies CategoryAuditEntry
  })
}
