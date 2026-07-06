'use server'

// 02-features/partner-portal/api-tokens/actions/revokeApiToken.ts
//
// P12.19 — `revokeApiTokenAction` server action.
//
// Sets `revoked_at = now()` on a single token owned by the current
// partner. The token can NEVER be unrevoked (per the data-model spec
// line 1050 "Revocation is irreversible in v1") — the partner must
// create a new token to replace it.
//
// 4 gating branches:
//   1. Auth: getUser → not signed in → { ok: false }
//   2. Partner: profile.role check
//   3. Zod validation: tokenId + typed "REVOKE" confirmation
//   4. Ownership verify + UPDATE (RLS already enforces the row is
//      this user's; we additionally read-before-write to surface
//      friendly errors when the row is missing or already revoked)
//
// On success the audit row is written with the revoked timestamp;
// the token's status will flip to `revoked` on the next list read.

import { revalidatePath } from 'next/cache'
import { getServerSupabase } from '@foundations/data/supabase'
import { loggerFor } from '@foundations/log/pino'
import { writeSelfAuditLog } from '@features/account/profile/actions/writeSelfAuditLog'
import {
  RevokeApiTokenInputSchema,
  type RevokeApiTokenInput,
} from '../lib/schemas'

const log = loggerFor({ component: 'partner.api_tokens.revoke' })

export type RevokeApiTokenResult =
  | { ok: true; id: number; revokedAt: string }
  | {
      ok: false
      error: string
      code?: 'not_signed_in' | 'not_partner' | 'invalid_input' | 'not_found' | 'already_revoked'
    }

export async function revokeApiTokenAction(
  input: unknown,
): Promise<RevokeApiTokenResult> {
  const supabase = await getServerSupabase()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return { ok: false, error: 'Not signed in.', code: 'not_signed_in' }
  }

  // Profile check.
  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('user_id', user.id)
    .maybeSingle()
  const role = (profile?.role as string | undefined) ?? 'customer'
  if (role !== 'partner' && role !== 'admin' && role !== 'super_admin') {
    return { ok: false, error: 'Only partners can revoke API tokens.', code: 'not_partner' }
  }

  // Zod validate (typed REVOKE confirmation is enforced at parse time).
  const parsed = RevokeApiTokenInputSchema.safeParse(input)
  if (!parsed.success) {
    return {
      ok: false,
      error: 'Please type REVOKE to confirm.',
      code: 'invalid_input',
    }
  }
  const data: RevokeApiTokenInput = parsed.data

  // Ownership verify. RLS already enforces `user_id = auth.uid()`;
  // the read is a friendly-error surface (so we can return a clear
  // "already revoked" or "not found" instead of letting the UPDATE
  // silently affect zero rows).
  const { data: existing, error: readError } = await supabase
    .from('api_tokens')
    .select('id, name, revoked_at')
    .eq('id', data.tokenId)
    .eq('user_id', user.id)
    .maybeSingle()

  if (readError) {
    log.warn(
      { code: 'api_tokens_revoke_read_failed', msg: readError.message },
      'revokeApiTokenAction: pre-revoke read failed',
    )
    return { ok: false, error: 'Could not load token. Please try again.' }
  }
  if (!existing) {
    return { ok: false, error: 'Token not found.', code: 'not_found' }
  }
  if (existing.revoked_at) {
    return {
      ok: false,
      error: 'Token is already revoked.',
      code: 'already_revoked',
    }
  }

  // UPDATE — set revoked_at = now(). RLS ensures the WHERE matches
  // only this user's rows. The UPDATE is idempotent at the DB layer
  // (re-running with revoked_at already set is a no-op for the
  // partner — they see "already revoked" via the pre-check).
  const { data: updated, error: updateError } = await supabase
    .from('api_tokens')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', data.tokenId)
    .eq('user_id', user.id)
    .select('id, revoked_at')
    .maybeSingle()

  if (updateError || !updated) {
    log.warn(
      { code: 'api_tokens_revoke_failed', msg: updateError?.message },
      'revokeApiTokenAction: update failed',
    )
    return { ok: false, error: 'Could not revoke token. Please try again.' }
  }

  // Audit row — best-effort.
  try {
    await writeSelfAuditLog({
      userId: user.id,
      userEmail: user.email ?? '',
      action: 'api_token_revoked',
      targetKind: 'api_tokens',
      targetId: String(data.tokenId),
      metadata: {
        name: (existing as { name: string }).name,
        revoked_at: (updated as { revoked_at: string }).revoked_at,
      },
    })
  } catch (auditErr) {
    log.warn(
      { code: 'api_tokens_revoke_audit_failed', msg: (auditErr as Error).message },
      'revokeApiTokenAction: audit write failed (revoke saved; audit dropped)',
    )
  }

  revalidatePath('/partner/settings/api')
  return {
    ok: true,
    id: (updated as { id: number }).id,
    revokedAt: (updated as { revoked_at: string }).revoked_at,
  }
}