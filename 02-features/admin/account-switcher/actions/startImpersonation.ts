// startImpersonation — server action that mints a Supabase magic link
// for the target user and returns it to the client. The client's
// responsibility is to open the link in a NEW tab via window.open
// (so the admin's primary tab stays admin).
//
// Flow:
//   1. Zod-validate { targetUserId: uuid, reason: 20..500 chars }
//   2. requireRole(['super_admin']) — refuses non-super_admins
//   3. In-memory per-admin rate limit (1 per 30s)
//   4. Refuse self-impersonation (admin == target)
//   5. Refuse banned target (defense — even if UI filter is bypassed)
//   6. Refuse super_admin target (privilege separation)
//   7. Call supabase.auth.admin.generateLink({ type: 'magiclink', ... })
//      with redirectTo: '/auth/callback?next=...&impersonation=<id>'
//   8. Insert one impersonation_sessions row (admin, target, link, reason,
//      IP, UA, 5-min expiry)
//   9. Insert one admin_audit_log row (action='admin.account_switch_initiated')
//  10. Return { ok: true, actionLink, impersonationSessionId, expiresAt }
//
// Failure cases return a discriminated `StartImpersonationResult` so
// the client form can render an inline error without losing the search
// state.

'use server'

import { headers } from 'next/headers'
import { getSessionUser } from '@foundations/auth/guards'
import { getServiceSupabase } from '@foundations/data/supabase'
import { ImpersonationInput } from '@foundations/data/schemas'
import { loggerFor } from '@foundations/log/pino'
import { writeAuditLog } from './writeAuditLog'

const log = loggerFor({ component: 'admin.account-switcher.start' })

const RATE_LIMIT_WINDOW_MS = 30_000
const LINK_TTL_SECONDS = 300 // 5 minutes

export type StartImpersonationResult =
  | {
      ok: true
      actionLink: string
      impersonationSessionId: string
      expiresAt: string
    }
  | {
      ok: false
      error: string
      code:
        | 'not_authorized'
        | 'rate_limited'
        | 'invalid_input'
        | 'self_impersonation'
        | 'invalid_target'
        | 'supabase_error'
        | 'unknown'
    }

/** In-memory rate limit. Per-adminId → last start timestamp.
 *  Acceptable for v1 (the cost of forgetting one row is "user retries
 *  in 30s"). A future tick can move this to the auth_failed_attempts
 *  table for durability (same shape as the P1.2 rate limit). */
const lastStartAt = new Map<string, number>()

function rateLimited(adminId: string): { limited: true; retryAfterMs: number } | { limited: false } {
  const last = lastStartAt.get(adminId)
  if (!last) return { limited: false }
  const elapsed = Date.now() - last
  if (elapsed >= RATE_LIMIT_WINDOW_MS) return { limited: false }
  return { limited: true, retryAfterMs: RATE_LIMIT_WINDOW_MS - elapsed }
}

export async function startImpersonationAction(
  rawTargetUserId: string,
  rawReason: string,
): Promise<StartImpersonationResult> {
  // 1. Validate input shape via the shared ImpersonationInput schema.
  //    The action signature accepts camelCase positional args; the
  //    shared schema uses snake_case (matches the DB column name).
  const parsed = ImpersonationInput.safeParse({
    target_user_id: rawTargetUserId,
    reason: rawReason,
  })
  if (!parsed.success) {
    return {
      ok: false,
      code: 'invalid_input',
      error: parsed.error.issues[0]?.message ?? 'Invalid input.',
    }
  }
  const targetUserId = parsed.data.target_user_id
  const reason = parsed.data.reason

  // 2. Auth gate.
  const admin = await getSessionUser()
  if (!admin || admin.role !== 'super_admin') {
    return { ok: false, code: 'not_authorized', error: 'You are not authorized to impersonate users.' }
  }

  // 3. Self-impersonation guard (runtime fast path; the data-model check
  //    is the second line of defense).
  if (targetUserId === admin.id) {
    return { ok: false, code: 'self_impersonation', error: "You can't impersonate yourself." }
  }

  // 4. Rate limit.
  const rl = rateLimited(admin.id)
  if (rl.limited) {
    const retryAfterSeconds = Math.ceil(rl.retryAfterMs / 1000)
    return {
      ok: false,
      code: 'rate_limited',
      error: `Please wait ${retryAfterSeconds}s before starting another impersonation.`,
    }
  }

  // 5. Fetch the target user (admin API — we need email + role + status).
  const serviceSupabase = getServiceSupabase()
  const { data: targetAuth, error: targetError } = await serviceSupabase.auth.admin.getUserById(
    targetUserId,
  )
  if (targetError || !targetAuth?.user?.email) {
    log.warn(
      { code: 'target_lookup_failed', targetUserId, msg: targetError?.message },
      'startImpersonation: target lookup failed',
    )
    return {
      ok: false,
      code: 'invalid_target',
      error: 'That user could not be found.',
    }
  }
  // Narrowed: the early return above guarantees both `targetAuth.user`
  // and its `email` field are present. TypeScript's narrowing doesn't
  // flow through the optional-chain + truthy check, so we assert.
  const targetEmail: string = targetAuth.user.email

  // 6. Look up the target's profile (role + status). The auth.users table
  //    doesn't carry role/status — that's on profiles.
  const { data: targetProfile, error: profileError } = await serviceSupabase
    .from('profiles')
    .select('role, status')
    .eq('user_id', targetUserId)
    .single()
  if (profileError || !targetProfile) {
    log.warn(
      { code: 'target_profile_failed', targetUserId, msg: profileError?.message },
      'startImpersonation: target profile lookup failed',
    )
    return {
      ok: false,
      code: 'invalid_target',
      error: "That user's profile could not be loaded.",
    }
  }

  // 7. Banned + super_admin guards.
  if (targetProfile.status === 'banned') {
    return {
      ok: false,
      code: 'invalid_target',
      error: "You can't impersonate a banned account.",
    }
  }
  if (targetProfile.role === 'super_admin') {
    return {
      ok: false,
      code: 'invalid_target',
      error: "You can't impersonate another super_admin.",
    }
  }

  // 8. Headers for audit log context.
  const hdrs = await headers()
  const ip = hdrs.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null
  const userAgent = hdrs.get('user-agent')?.slice(0, 256) ?? null

  // 9. Insert the impersonation_sessions row FIRST so we have a stable
  //    id to embed in the magic link's redirectTo. The id is a uuid —
  //    doesn't leak any user data through the URL.
  //    The action_link column is updated below once generateLink
  //    returns. To avoid a second round-trip, we use INSERT ... RETURNING
  //    + then UPDATE. Two queries is fine for a low-frequency action.
  const { data: inserted, error: insertError } = await serviceSupabase
    .from('impersonation_sessions')
    .insert({
      admin_id: admin.id,
      target_user_id: targetUserId,
      action_link: 'placeholder', // updated after generateLink
      expires_at: new Date(Date.now() + LINK_TTL_SECONDS * 1000).toISOString(),
      reason,
      ip,
      user_agent: userAgent,
    })
    .select('id, expires_at')
    .single()
  if (insertError || !inserted) {
    log.error(
      { code: 'impersonation_insert_failed', msg: insertError?.message },
      'startImpersonation: insert failed',
    )
    return {
      ok: false,
      code: 'supabase_error',
      error: 'Could not start the impersonation. Please try again.',
    }
  }
  const impersonationSessionId = (inserted as { id: string }).id
  const expiresAt = (inserted as { expires_at: string }).expires_at

  // 10. Mint the magic link. redirectTo embeds the impersonation id so
  //     Slice 2 can correlate the consumed row from the callback.
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
  const redirectTo = `${baseUrl}/auth/callback?next=${encodeURIComponent(
    '/admin/account-switcher/active',
    )}&impersonation=${encodeURIComponent(impersonationSessionId)}`

  const { data: linkData, error: linkError } = await serviceSupabase.auth.admin.generateLink({
    type: 'magiclink',
    email: targetEmail,
    options: { redirectTo },
  })

  if (linkError || !linkData?.properties?.action_link) {
    log.error(
      { code: 'generate_link_failed', msg: linkError?.message },
      'startImpersonation: generateLink failed',
    )
    // Clean up the placeholder row so we don't leave a dangling audit
    // entry. Service-role bypasses RLS.
    await serviceSupabase.from('impersonation_sessions').delete().eq('id', impersonationSessionId)
    return {
      ok: false,
      code: 'supabase_error',
      error: 'Could not generate the impersonation link. Please try again.',
    }
  }
  const actionLink = linkData.properties.action_link

  // 11. Patch the placeholder action_link with the real one.
  const { error: updateError } = await serviceSupabase
    .from('impersonation_sessions')
    .update({ action_link: actionLink })
    .eq('id', impersonationSessionId)
  if (updateError) {
    log.warn(
      { code: 'impersonation_update_failed', msg: updateError.message },
      'startImpersonation: action_link update failed (non-fatal — link still works)',
    )
  }

  // 12. Audit log.
  await writeAuditLog({
    adminId: admin.id,
    actorEmail: admin.email,
    action: 'admin.account_switch_initiated',
    targetUserId,
    metadata: {
      target_email: targetEmail,
      target_role: targetProfile.role,
      target_status: targetProfile.status,
      impersonation_session_id: impersonationSessionId,
      expires_at: expiresAt,
      reason,
    },
    ipAddress: ip,
    userAgent,
  })

  // 13. Update the in-memory rate limit AFTER the action succeeded.
  lastStartAt.set(admin.id, Date.now())

  return {
    ok: true,
    actionLink,
    impersonationSessionId,
    expiresAt,
  }
}
