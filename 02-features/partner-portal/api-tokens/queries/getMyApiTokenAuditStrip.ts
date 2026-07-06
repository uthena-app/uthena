// 02-features/partner-portal/api-tokens/queries/getMyApiTokenAuditStrip.ts
//
// P12.19 — Page-level audit strip ("Last token action: 3 minutes ago
// (api_token_revoked)"). RSC, fast (1 query), fail-soft to `null`
// when there's no recent row or on error.
//
// The full audit-log modal ("View last 50 audit rows" per the spec
// line 42) is deferred to STUB-101. The strip is enough for the page
// to satisfy the spec's "audit logged" + "Last token action" lines.

import 'server-only'
import { getServerSupabase } from '@foundations/data/supabase'
import { loggerFor } from '@foundations/log/pino'
import { API_TOKEN_AUDIT_STRIP_LIMIT } from '../constants'

const log = loggerFor({ component: 'partner.api_tokens.audit_strip' })

export type ApiTokenAuditEntry = {
  id: number
  action: 'api_token_created' | 'api_token_revoked'
  /** ISO timestamp of the audit row. */
  at: string
  /** The token id (audit row's target_id). */
  tokenId: string | null
}

/**
 * Read the current user's most-recent api-tokens audit rows. Returns
 * at most `API_TOKEN_AUDIT_STRIP_LIMIT` entries (1 by default) — the
 * page renders just the most-recent line.
 *
 * Returns an empty array on any error. Never throws.
 *
 * PII-safe select: never selects `actor_email` / `actor_id` /
 * `metadata` (the metadata is metadata, not PII, but the strip only
 * needs `action` + `at` + `target_id` so we keep the payload tight).
 */
export async function getMyApiTokenAuditStrip(): Promise<ApiTokenAuditEntry[]> {
  const supabase = await getServerSupabase()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return []

  const { data, error } = await supabase
    .from('admin_audit_log')
    .select('id, action, created_at, target_id')
    .eq('actor_id', user.id)
    .eq('target_kind', 'api_tokens')
    .in('action', ['api_token_created', 'api_token_revoked'])
    .order('created_at', { ascending: false })
    .limit(API_TOKEN_AUDIT_STRIP_LIMIT)

  if (error) {
    log.warn(
      { code: 'api_tokens_audit_strip_failed', msg: error.message },
      'getMyApiTokenAuditStrip: query failed (returning empty)',
    )
    return []
  }

  const out: ApiTokenAuditEntry[] = []
  for (const row of data ?? []) {
    const action = (row as { action?: string }).action
    if (action !== 'api_token_created' && action !== 'api_token_revoked') continue
    out.push({
      id: (row as { id: number }).id,
      action,
      at: (row as { created_at: string }).created_at,
      tokenId: ((row as { target_id?: string | null }).target_id ?? null) as string | null,
    })
  }
  return out
}