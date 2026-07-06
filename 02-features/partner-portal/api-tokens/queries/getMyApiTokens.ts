// 02-features/partner-portal/api-tokens/queries/getMyApiTokens.ts
//
// RSC query: list the current partner's API tokens for the
// `/partner/settings/api` page.
//
// P12.19 — The list shows metadata ONLY. The plaintext was already
// returned to the client once at create time; subsequent GETs NEVER
// include `token_hash` (the column is excluded from the select so
// the hash never crosses the wire to the partner's session).
//
// Sort order: active first (so the most-useful rows are at the top),
// then by `created_at desc` so the most-recent rows are next. The
// order is stable per `01-specs/pages/partner-settings-api.md`
// §"Data this page shows" + the requirement that the UI surface
// the "actionable" tokens first.
//
// Failure mode: any error returns an empty array (the page renders
// the "No tokens yet" empty state). We do NOT surface a destructive
// error toast — the partner can refresh.

import 'server-only'
import { getServerSupabase } from '@foundations/data/supabase'
import { loggerFor } from '@foundations/log/pino'
import { ApiTokenEntitySchema, type ApiTokenEntity } from '../lib/schemas'

const log = loggerFor({ component: 'partner.api_tokens.list' })

/** PII-safe select. NEVER includes `token_hash` — the hash is the
 *  lookup key for the future `/api/v1/partner/*` middleware, not for
 *  the partner-facing page. */
const API_TOKENS_COLS =
  'id, name, scopes, token_prefix, created_at, expires_at, revoked_at, last_used_at'

/**
 * Read the current user's api_tokens rows, defensively mapped to the
 * `ApiTokenEntity` display shape (with the derived `status` field).
 *
 * Returns an empty array on any error — the page renders the empty
 * state. The function does not throw.
 */
export async function getMyApiTokens(): Promise<ApiTokenEntity[]> {
  const supabase = await getServerSupabase()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return []

  const { data, error } = await supabase
    .from('api_tokens')
    .select(API_TOKENS_COLS)
    .eq('user_id', user.id)
    // Stable order: active first by created_at desc, then
    // revoked/expired by created_at desc. The `revoked_at is null`
    // half + the `desc` halves are the only sorts the page needs.
    .order('revoked_at', { ascending: true, nullsFirst: true })
    .order('expires_at', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(50)

  if (error) {
    log.warn(
      { code: 'api_tokens_list_failed', msg: error.message },
      'getMyApiTokens: query failed (returning empty list)',
    )
    return []
  }

  const now = Date.now()
  const out: ApiTokenEntity[] = []
  for (const row of data ?? []) {
    const mapped = mapRow(row, now)
    if (mapped) out.push(mapped)
  }
  return out
}

/** Map one raw row → display entity. Returns null for malformed rows
 *  (defensive — the page renders the rest of the list, the bad row
 *  is skipped + logged). */
function mapRow(row: unknown, nowMs: number): ApiTokenEntity | null {
  if (row == null || typeof row !== 'object') return null
  const r = row as Record<string, unknown>
  const id = typeof r.id === 'number' ? r.id : Number(r.id)
  if (!Number.isFinite(id) || id <= 0) return null
  const name = typeof r.name === 'string' ? r.name : null
  if (name === null) return null
  const scopes = Array.isArray(r.scopes)
    ? (r.scopes.filter((s): s is 'read_sales' | 'read_payouts' | 'read_products' =>
        s === 'read_sales' || s === 'read_payouts' || s === 'read_products',
      ))
    : []
  const tokenPrefix = typeof r.token_prefix === 'string' ? r.token_prefix : null
  if (tokenPrefix === null) return null
  const createdAt = typeof r.created_at === 'string' ? r.created_at : null
  if (createdAt === null) return null

  const expiresAt = typeof r.expires_at === 'string' ? r.expires_at : null
  const revokedAt = typeof r.revoked_at === 'string' ? r.revoked_at : null
  const lastUsedAt = typeof r.last_used_at === 'string' ? r.last_used_at : null

  // Status derivation. Mirrors the spec line 79 ("Expired tokens are
  // filtered to the 'Expired' tab automatically") + the create
  // action's "Max 10 active tokens" check.
  let status: ApiTokenEntity['status']
  if (revokedAt !== null) {
    status = 'revoked'
  } else if (expiresAt !== null) {
    const expiresMs = Date.parse(expiresAt)
    if (Number.isFinite(expiresMs) && expiresMs <= nowMs) {
      status = 'expired'
    } else {
      status = 'active'
    }
  } else {
    status = 'active'
  }

  const candidate = {
    id,
    name,
    scopes,
    tokenPrefix,
    createdAt,
    expiresAt,
    revokedAt,
    lastUsedAt,
    status,
  }
  const parsed = ApiTokenEntitySchema.safeParse(candidate)
  if (!parsed.success) {
    log.warn(
      { code: 'api_tokens_row_mapping_failed', id },
      'getMyApiTokens: row mapped but failed schema parse (skipping)',
    )
    return null
  }
  return parsed.data
}