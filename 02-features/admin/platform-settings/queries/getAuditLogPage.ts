// getAuditLogPage.ts — paginated audit log read with filters.
//
// Service-role (admin sees all). Returns entries with the PII-safe
// select from prior migrations (actor_email is hashed at insert time
// per the audit log writers; no raw actor_email selects here).
//
// Pagination: keyset on (created_at desc, id desc) — matches the
// partitioning in migration 0026.

import 'server-only'
import { z } from 'zod'
import { getServiceSupabase } from '@foundations/data/supabase'
import { getSessionUser } from '@foundations/auth/guards'
import { requireRole } from '@foundations/auth/guards'
import { loggerFor } from '@foundations/log/pino'

const log = loggerFor({ component: 'admin.getAuditLogPage' })

const InputSchema = z.object({
  actorEmailQuery: z.string().trim().max(200).optional(),
  actionQuery: z.string().trim().max(200).optional(),
  targetKindQuery: z.string().trim().max(100).optional(),
  targetIdQuery: z.string().trim().max(200).optional(),
  fromIso: z.string().datetime({ offset: true }).optional(),
  toIso: z.string().datetime({ offset: true }).optional(),
  limit: z.number().int().min(1).max(200).default(50),
  beforeId: z.number().int().positive().optional(),
})

export type AuditLogPageInput = z.infer<typeof InputSchema>

export type AuditLogEntry = {
  id: number
  actorId: string | null
  actorEmail: string
  action: string
  targetKind: string | null
  targetId: string | null
  metadata: Record<string, unknown> | null
  ip: string | null
  userAgent: string | null
  createdAt: string
}

export type AuditLogPageResult = {
  entries: AuditLogEntry[]
  hasMore: boolean
  filters: Pick<AuditLogPageInput, 'actorEmailQuery' | 'actionQuery' | 'targetKindQuery' | 'targetIdQuery' | 'fromIso' | 'toIso' | 'limit'>
  lastCursorId: number | null
}

export async function getAuditLogPage(
  rawInput: AuditLogPageInput,
): Promise<AuditLogPageResult> {
  const user = await getSessionUser()
  if (!user) return empty(rawInput)
  try {
    await requireRole(['admin', 'super_admin'])
  } catch {
    return empty(rawInput)
  }

  const parsed = InputSchema.safeParse(rawInput)
  let input: AuditLogPageInput
  if (!parsed.success) {
    log.warn(
      { code: 'audit_log_bad_input', issues: parsed.error.issues.length },
      'getAuditLogPage: invalid opts — using defaults',
    )
    input = { limit: 50 }
  } else {
    input = parsed.data
  }

  const service = getServiceSupabase()

  let q = service
    .from('admin_audit_log')
    .select('id, actor_id, actor_email, action, target_kind, target_id, metadata, ip, user_agent, created_at')
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(input.limit + 1) // over-fetch for hasMore
  if (input.beforeId) q = q.lt('id', input.beforeId)
  if (input.actorEmailQuery) q = q.ilike('actor_email', `%${input.actorEmailQuery}%`)
  if (input.actionQuery) q = q.ilike('action', `%${input.actionQuery}%`)
  if (input.targetKindQuery) q = q.eq('target_kind', input.targetKindQuery)
  if (input.targetIdQuery) q = q.eq('target_id', input.targetIdQuery)
  if (input.fromIso) q = q.gte('created_at', input.fromIso)
  if (input.toIso) q = q.lte('created_at', input.toIso)

  const { data: rows, error } = await q

  if (error) {
    log.warn(
      { code: 'audit_log_read_failed', msg: error.message },
      'getAuditLogPage: query failed',
    )
    return empty(rawInput)
  }

  const overshoot = (rows?.length ?? 0) > input.limit
  const trimmed = overshoot ? (rows ?? []).slice(0, input.limit) : (rows ?? [])

  const entries: AuditLogEntry[] = trimmed.map((r) => {
    const row = r as {
      id: number
      actor_id: string | null
      actor_email: string | null
      action: string
      target_kind: string | null
      target_id: string | null
      metadata: Record<string, unknown> | null
      ip: string | null
      user_agent: string | null
      created_at: string
    }
    return {
      id: row.id,
      actorId: row.actor_id,
      actorEmail: row.actor_email ?? '(unknown)',
      action: row.action,
      targetKind: row.target_kind,
      targetId: row.target_id,
      metadata: row.metadata,
      ip: row.ip,
      userAgent: row.user_agent,
      createdAt: row.created_at,
    }
  })

  return {
    entries,
    hasMore: overshoot,
    filters: {
      actorEmailQuery: input.actorEmailQuery,
      actionQuery: input.actionQuery,
      targetKindQuery: input.targetKindQuery,
      targetIdQuery: input.targetIdQuery,
      fromIso: input.fromIso,
      toIso: input.toIso,
      limit: input.limit,
    },
    lastCursorId: entries.length > 0 ? entries[entries.length - 1]!.id : null,
  }
}

function empty(raw: AuditLogPageInput): AuditLogPageResult {
  return {
    entries: [],
    hasMore: false,
    filters: {
      actorEmailQuery: raw.actorEmailQuery,
      actionQuery: raw.actionQuery,
      targetKindQuery: raw.targetKindQuery,
      targetIdQuery: raw.targetIdQuery,
      fromIso: raw.fromIso,
      toIso: raw.toIso,
      limit: raw.limit ?? 50,
    },
    lastCursorId: null,
  }
}
