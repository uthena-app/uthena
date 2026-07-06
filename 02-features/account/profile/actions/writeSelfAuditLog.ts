import 'server-only'
import { getServiceSupabase } from '@foundations/data/supabase'
import { loggerFor } from '@foundations/log/pino'

const log = loggerFor({ component: 'account.profile.audit' })

/** Audit log shape used by the account/profile feature. The same
 *  `admin_audit_log` table is the source of truth — the spec
 *  reuses the table for self-service actions so the admin can
 *  answer "what did the user actually do?" in one query.
 *
 *  We translate our logical shape (action, targetKind, metadata)
 *  to the table's real columns (action, target_kind, metadata
 *  jsonb, actor_id, actor_email). Email masking is done by the
 *  pino redact list — never log the raw email here. */
export type SelfAuditInput = {
  /** The session user's UUID. */
  userId: string
  /** The session user's email. Required by the table's NOT NULL. */
  userEmail: string
  /** Action verb (e.g. 'profile_self_update'). */
  action: string
  /** Logical target kind. The DB column is free text (no CHECK
   *  constraint) — we type the values we use today; adding a new
   *  kind is a one-line type extension + a SPEC update. */
  targetKind:
    | 'profiles'
    | 'auth.sessions'
    | 'orders'
    | 'refunds'
    | 'partners'
    | 'products'
    | 'payout_method'
    | 'avatars'
    | 'refund_proofs'
    | 'consent_log'
    | 'partner_onboarding_drafts'
    | 'partner_upload_drafts'
    | 'partner_uploads'
    | 'api_tokens'
    | 'affiliate_onboarding_drafts'
    | 'notification_preferences'
  /** The affected row's id. For 'profiles' the id is the user's
   *  `user_id` (uuid); for 'auth.sessions' the id is the
   *  `auth.sessions.id` (uuid); for 'partners' the id is the
   *  `partners.id` (bigint — pass as string per the table's
   *  stringified-id convention). */
  targetId: string
  /** jsonb metadata. NEVER include the password or the raw email. */
  metadata: Record<string, unknown>
  /** Optional IP — recorded if the caller can read it. */
  ipAddress?: string | null
  /** Optional user-agent — recorded if the caller can read it. */
  userAgent?: string | null
}

export async function writeSelfAuditLog(input: SelfAuditInput): Promise<number | null> {
  const supabase = getServiceSupabase()
  const { data, error } = await supabase
    .from('admin_audit_log')
    .insert({
      actor_id: input.userId,
      actor_email: input.userEmail,
      action: input.action,
      target_kind: input.targetKind,
      target_id: input.targetId,
      metadata: input.metadata as never,
      ip: input.ipAddress ?? null,
      user_agent: input.userAgent ?? null,
    })
    .select('id')
    .single()

  if (error || !data) {
    log.warn(
      { code: 'audit_write_failed', action: input.action, msg: error?.message },
      'writeSelfAuditLog: insert failed',
    )
    return null
  }
  return (data as unknown as { id: number }).id
}
