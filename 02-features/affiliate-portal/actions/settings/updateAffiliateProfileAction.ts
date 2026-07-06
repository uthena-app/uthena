'use server'

// updateAffiliateProfileAction — P13.11 Slice 1.
//
// Server action for the /affiliate/settings Profile section.
//
// **Input contract:** `UpdateAffiliateProfileInput` from
// @foundations/data/schemas. Strict subset of the customer-side
// `UpdateProfileInput` (display_name + bio only). The display_name
// cap is 60 chars (not 80) per the affiliate surface's stricter
// UX cap. Locale + timezone + avatar_url are NOT in scope for the
// affiliate surface in v1 (per spec: avatar is on /account/profile,
// locale + timezone are on the future Locale & region section).
//
// **Auth + RLS:**
//   - `requireAffiliate()` gates on role + redirects non-affiliates
//   - The `profiles_self_update` RLS policy is the second line of
//     defense; the user_id is ALWAYS derived from the session
//
// **Audit:** writes one `affiliate_settings_self_update` row to
// `admin_audit_log` with a { before, after } diff of just the
// fields that actually changed (display_name + bio). Email,
// user_id, role are NEVER in the metadata (the user_id is the
// actor_id; the table's audit trail surfaces it via the actor
// column, not in the change payload).
//
// **Rate limit:** the spec doesn't define a per-action rate limit
// for profile edits (the customer-side `updateProfileAction` is
// also unrate-limited). The surface is debounced inline (300ms
// in the UI), which is the platform's primary defense against
// edit-spam. A future tick can add a per-user N/min limit if
// support requests it.

import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'
import { requireAffiliate } from '@foundations/auth/guards'
import { getServerSupabase } from '@foundations/data/supabase'
import { UpdateAffiliateProfileInput } from '@foundations/data/schemas'
import { loggerFor } from '@foundations/log/pino'
import { writeSelfAuditLog } from '@features/account/profile/actions/writeSelfAuditLog'

const log = loggerFor({ component: 'affiliate.settings.profile' })

export type UpdateAffiliateProfileResult =
  | {
      ok: true
      profile: { displayName: string; bio: string | null }
    }
  | {
      ok: false
      error: string
      fieldErrors?: Record<string, string>
    }

export async function updateAffiliateProfileAction(
  input: unknown,
): Promise<UpdateAffiliateProfileResult> {
  // Auth gate — `requireAffiliate` accepts affiliate + admin +
  // super_admin (matches the AffiliateShell's role list).
  let user: { id: string; email: string }
  try {
    const authed = await requireAffiliate()
    user = { id: authed.id, email: authed.email }
  } catch {
    return { ok: false, error: 'Please sign in.' }
  }

  // Zod validation — strict subset, `display_name` 2-60 + `bio` ≤ 280.
  const parsed = UpdateAffiliateProfileInput.safeParse(input)
  if (!parsed.success) {
    return {
      ok: false,
      error: 'Please fix the errors below.',
      fieldErrors: Object.fromEntries(
        parsed.error.issues.map((i) => [i.path[0]?.toString() ?? '_', i.message]),
      ),
    }
  }

  // Normalize: empty bio → null (matches the customer-side action).
  const next = {
    display_name: parsed.data.display_name,
    bio: parsed.data.bio && parsed.data.bio.length > 0 ? parsed.data.bio : null,
  }

  const supabase = await getServerSupabase()

  // Read the current row to compute the diff for the audit log.
  // We only need the editable fields.
  const { data: before } = await supabase
    .from('profiles')
    .select('display_name, bio')
    .eq('id', user.id)
    .maybeSingle()

  const { error: updateError } = await supabase
    .from('profiles')
    .update(next)
    .eq('id', user.id)

  if (updateError) {
    log.warn(
      { code: 'profile_update_failed', msg: updateError.message },
      'affiliate profile update failed',
    )
    return { ok: false, error: 'Could not save your changes. Please try again.' }
  }

  // Build the { before, after } diff — only include keys that
  // changed. Avoids audit-log noise on no-op saves (e.g. the
  // user re-saves the same bio).
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
      userEmail: user.email,
      action: 'affiliate_settings_self_update',
      targetKind: 'profiles',
      targetId: user.id,
      metadata: diff,
      ipAddress: hdrs.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
      userAgent: hdrs.get('user-agent') ?? null,
    })
  }

  // Revalidate so /affiliate/settings + /[handle] both re-render
  // with the new display_name / bio on the next request. The
  // /[handle] page is ISR-cached with revalidate=300 per the
  // minishop spec, so this revalidate only affects the settings
  // page in the immediate moment — the public surface catches up
  // on its next ISR tick.
  revalidatePath('/affiliate/settings')
  revalidatePath('/[handle]', 'page')

  return {
    ok: true,
    profile: { displayName: next.display_name, bio: next.bio },
  }
}