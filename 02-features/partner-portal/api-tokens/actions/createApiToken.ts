'use server'

// 02-features/partner-portal/api-tokens/actions/createApiToken.ts
//
// P12.19 — `createApiTokenAction` server action.
//
// The plaintext token is generated server-side, returned to the
// caller ONCE, and never persisted. Only the HMAC-SHA256 hash (with
// the env pepper) lands in `api_tokens.token_hash`. The display
// prefix `uth_pat_<first 8>***` lands in `token_prefix` so the UI
// can recognize "which token is this".
//
// 5 gating branches (mirrors the `requestPayoutAction` P6.6 pattern):
//   1. Auth: getUser → not signed in → { ok: false, error: ... }
//   2. Partner: profile.role !== 'partner' → { ok: false, error: ... }
//   3. Rate limit: create bucket over the cap → friendly retry
//   4. Active-token cap: > MAX_ACTIVE_TOKENS → "Revoke one first"
//   5. DB insert + audit
//
// On success the response is:
//   { ok: true, id, name, plaintext, scopes, expiresAt, tokenPrefix }
// `plaintext` is the ONLY field the UI must surface in the
// one-time-show modal; after the user clicks "I've saved it, hide",
// the modal closes and the plaintext is gone from client state.

import { revalidatePath } from 'next/cache'
import { getServerSupabase } from '@foundations/data/supabase'
import { getServiceSupabase } from '@foundations/data/supabase'
import { loggerFor } from '@foundations/log/pino'
import { writeSelfAuditLog } from '@features/account/profile/actions/writeSelfAuditLog'
import {
  API_TOKEN_PLAINTEXT_PREFIX,
  buildApiTokenDisplayPrefix,
  generateApiTokenPlaintext,
  hashApiToken,
} from '@foundations/security/api-token'
import {
  API_TOKEN_MAX_ACTIVE_TOKENS,
  API_TOKEN_SCOPE_LABELS,
} from '../constants'
import {
  CreateApiTokenInputSchema,
  type ApiTokenScope,
  type CreateApiTokenInput,
} from '../lib/schemas'
import { _resetApiTokensRateLimitForTests, createRateLimitVerdict } from './api-tokens.rate-limit'

const log = loggerFor({ component: 'partner.api_tokens.create' })

export type CreateApiTokenResult =
  | {
      ok: true
      id: number
      name: string
      /** Plaintext token — returned ONCE. NEVER persist this value.
       *  The UI surfaces it in the one-time-show modal then forgets it. */
      plaintext: string
      scopes: ApiTokenScope[]
      tokenPrefix: string
      expiresAt: string | null
      createdAt: string
    }
  | {
      ok: false
      error: string
      /** When true, the form should bounce to the one-time-show view
       *  anyway. False on every other failure. */
      code?:
        | 'not_signed_in'
        | 'not_partner'
        | 'rate_limited'
        | 'too_many_active_tokens'
        | 'invalid_input'
        | 'duplicate_prefix'
        | 'unknown'
    }

/**
 * Mint a new partner API token. Server-only.
 *
 * The plaintext is in the response payload — the action's caller is
 * responsible for NOT echoing it into any other surface. The audit
 * row metadata contains only `{ name, scopes, expirationDays }` —
 * never the hash, never the plaintext.
 */
export async function createApiTokenAction(
  input: unknown,
): Promise<CreateApiTokenResult> {
  const supabase = await getServerSupabase()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return { ok: false, error: 'Not signed in.', code: 'not_signed_in' }
  }

  // Profile check: partner / admin / super_admin. Same set as
  // `requirePartner()` — the action is the partner-portal surface.
  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('user_id', user.id)
    .maybeSingle()
  const role = (profile?.role as string | undefined) ?? 'customer'
  if (role !== 'partner' && role !== 'admin' && role !== 'super_admin') {
    return { ok: false, error: 'Only partners can create API tokens.', code: 'not_partner' }
  }

  // Zod validate.
  const parsed = CreateApiTokenInputSchema.safeParse(input)
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? 'Invalid input.',
      code: 'invalid_input',
    }
  }
  const data: CreateApiTokenInput = parsed.data

  // Rate limit (per user per hour).
  const rl = createRateLimitVerdict(user.id)
  if (!rl.allowed) {
    const minutes = Math.max(1, Math.ceil(rl.retryAfterSeconds / 60))
    return {
      ok: false,
      error: `Too many token creates. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`,
      code: 'rate_limited',
    }
  }

  // Active-token cap. Count rows where `revoked_at IS NULL` AND
  // (`expires_at IS NULL` OR `expires_at > now()`).
  const { count: activeCount, error: countError } = await supabase
    .from('api_tokens')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .is('revoked_at', null)
    .or('expires_at.is.null,expires_at.gt.now()')

  if (countError) {
    log.warn(
      { code: 'api_tokens_count_failed', msg: countError.message },
      'createApiTokenAction: active-token count failed',
    )
    return { ok: false, error: 'Could not check existing tokens. Please try again.' }
  }
  // Treat a `null` count (no error but no count returned) the same
  // way — refuse to proceed. The expected happy path is `count = 0..N`
  // (always a number when `head:true, count:exact`).
  if (activeCount === null || activeCount === undefined) {
    log.warn(
      { code: 'api_tokens_count_null' },
      'createApiTokenAction: active-token count returned null (refusing to proceed)',
    )
    return { ok: false, error: 'Could not check existing tokens. Please try again.' }
  }
  if (activeCount >= API_TOKEN_MAX_ACTIVE_TOKENS) {
    return {
      ok: false,
      error: `Maximum ${API_TOKEN_MAX_ACTIVE_TOKENS} active tokens. Revoke one first.`,
      code: 'too_many_active_tokens',
    }
  }

  // Generate plaintext + hash + display prefix.
  const plaintext = generateApiTokenPlaintext()
  const tokenHash = hashApiToken(plaintext)
  const tokenPrefix = buildApiTokenDisplayPrefix(plaintext) ?? `${API_TOKEN_PLAINTEXT_PREFIX}????????***`
  const expiresAtIso =
    data.expirationDays === null
      ? null
      : new Date(Date.now() + data.expirationDays * 86_400_000).toISOString()

  // Insert via the user-scoped client. RLS enforces `user_id =
  // auth.uid()` so even a buggy payload can't insert for someone
  // else. The token_hash is unique-indexed — a (vanishingly rare)
  // collision surfaces as a 23505 PG error code.
  const { data: row, error: insertError } = await supabase
    .from('api_tokens')
    .insert({
      user_id: user.id,
      name: data.name,
      token_hash: tokenHash,
      token_prefix: tokenPrefix,
      scopes: data.scopes,
      expires_at: expiresAtIso,
    })
    .select('id, created_at')
    .single()

  if (insertError || !row) {
    const code = (insertError as { code?: string } | null)?.code
    if (code === '23505') {
      log.warn(
        { code: 'api_tokens_hash_collision' },
        'createApiTokenAction: hash collision (extraordinarily rare — 256-bit entropy)',
      )
      return {
        ok: false,
        error: 'Token collision. Please try again.',
        code: 'duplicate_prefix',
      }
    }
    log.warn(
      { code: 'api_tokens_insert_failed', msg: insertError?.message },
      'createApiTokenAction: insert failed',
    )
    return { ok: false, error: 'Could not create token. Please try again.' }
  }

  // Audit row. NEVER include `token_hash` or the plaintext in the
  // metadata — only the human-visible shape.
  try {
    await writeSelfAuditLog({
      userId: user.id,
      userEmail: user.email ?? '',
      action: 'api_token_created',
      targetKind: 'api_tokens',
      targetId: String((row as { id: number }).id),
      metadata: {
        name: data.name,
        scopes: data.scopes,
        scope_labels: data.scopes.map((s) => API_TOKEN_SCOPE_LABELS[s]),
        expiration_days: data.expirationDays,
      },
    })
  } catch (auditErr) {
    // Best-effort audit — never abort the create.
    log.warn(
      { code: 'api_tokens_audit_failed', msg: (auditErr as Error).message },
      'createApiTokenAction: audit write failed (token saved; audit dropped)',
    )
  }

  revalidatePath('/partner/settings/api')
  return {
    ok: true,
    id: (row as { id: number }).id,
    name: data.name,
    plaintext,
    scopes: data.scopes,
    tokenPrefix,
    expiresAt: expiresAtIso,
    createdAt: (row as { created_at: string }).created_at,
  }
}

/** Test-only re-export. The reset helper is a no-op in production
 *  paths; exporting it lets the test file clean state between cases
 *  without poking at the underlying Map directly. */
export { _resetApiTokensRateLimitForTests }