'use server'

import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'
import { getServerSupabase } from '@foundations/data/supabase'
import { UpdateProfileInput } from '@foundations/data/schemas'
import { loggerFor } from '@foundations/log/pino'
import { writeSelfAuditLog } from './writeSelfAuditLog'

const log = loggerFor({ component: 'account.profile.update' })

export type UpdateProfileResult =
  | { ok: true; profile: { display_name: string; bio: string | null; locale: string; timezone: string; avatar_url: string | null } }
  | { ok: false; error: string; fieldErrors?: Record<string, string> }

/** Update the current user's profile. The user_id is ALWAYS derived
 *  from the session — never trusted from the client. The RLS policy
 *  `profiles_self_update` is the second line of defense. */
export async function updateProfileAction(input: unknown): Promise<UpdateProfileResult> {
  const supabase = await getServerSupabase()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Not signed in' }

  const parsed = UpdateProfileInput.safeParse(input)
  if (!parsed.success) {
    return {
      ok: false,
      error: 'Please fix the errors below.',
      fieldErrors: Object.fromEntries(
        parsed.error.issues.map((i) => [i.path[0]?.toString() ?? '_', i.message]),
      ),
    }
  }
  const next = {
    display_name: parsed.data.display_name,
    bio: parsed.data.bio === '' ? null : parsed.data.bio,
    locale: parsed.data.locale,
    timezone: parsed.data.timezone,
    avatar_url: parsed.data.avatar_url ?? null,
  }

  // Read the current row to compute the diff for the audit log. The
  // email / role / user_id are NEVER in the metadata — only the
  // editable fields, and only the ones that actually changed.
  const { data: before } = await supabase
    .from('profiles')
    .select('display_name, bio, locale, timezone, avatar_url')
    .eq('user_id', user.id)
    .maybeSingle()

  const { error: updateError } = await supabase
    .from('profiles')
    .update(next)
    .eq('user_id', user.id)

  if (updateError) {
    log.warn({ code: 'profile_update_failed', msg: updateError.message }, 'profile update failed')
    return { ok: false, error: 'Could not save your changes. Please try again.' }
  }

  // Build the { before, after } diff — only include keys that changed.
  const diff: { before: Record<string, unknown>; after: Record<string, unknown> } = {
    before: {},
    after: {},
  }
  for (const k of Object.keys(next) as (keyof typeof next)[]) {
    const prev = (before as Record<string, unknown> | null)?.[k] ?? null
    if (prev !== next[k]) {
      diff.before[k] = prev
      diff.after[k] = next[k]
    }
  }
  if (Object.keys(diff.after).length > 0) {
    const hdrs = await headers()
    await writeSelfAuditLog({
      userId: user.id,
      userEmail: user.email ?? '',
      action: 'profile_self_update',
      targetKind: 'profiles',
      targetId: user.id,
      metadata: diff,
      ipAddress: hdrs.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
      userAgent: hdrs.get('user-agent') ?? null,
    })
  }

  revalidatePath('/account/profile')
  return { ok: true, profile: next }
}
