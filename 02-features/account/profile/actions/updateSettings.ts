'use server'

import { revalidatePath } from 'next/cache'
import { getServerSupabase } from '@foundations/data/supabase'
import { UpdatePrefsInput, UpdateLocaleTzInput } from '@foundations/data/schemas'
import { loggerFor } from '@foundations/log/pino'
import { writeSelfAuditLog } from './writeSelfAuditLog'

const log = loggerFor({ component: 'account.settings.updatePrefs' })

/** Shape returned by updateNotificationPrefsAction on success.
 *  Mirrors the fields that may have changed (subset of the upserted
 *  payload) so the client can refresh its local state without a full
 *  re-read of `getMySettings`. */
export type UpdatePrefsResult =
  | {
      ok: true
      prefs: {
        email_digest_freq?: 'off' | 'daily' | 'weekly' | 'monthly' | undefined
        marketing_opt_in?: boolean | undefined
        newsletter_opt_in?: boolean | undefined
        partner_updates_opt_in?: boolean | undefined
        affiliate_updates_opt_in?: boolean | undefined
      }
    }
  | { ok: false; error: string; fieldErrors?: Record<string, string> }

/** Apply a partial patch to the user's notification_preferences row.
 *
 *  Idempotent: upserts with `onConflict: 'user_id'` so the first
 *  call creates the row and subsequent calls update it. Only the
 *  fields supplied in `input` are written — omitted fields keep
 *  their existing values. Before/after JSON is recorded to the
 *  admin_audit_log when at least one field actually changes.
 *
 *  `transactional_opt_in` is NOT user-editable — the schema doesn't
 *  expose it and the action does not look for it. A locked-on badge
 *  in the UI communicates the invariant to the user.
 */
export async function updateNotificationPrefsAction(input: unknown): Promise<UpdatePrefsResult> {
  const supabase = await getServerSupabase()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Not signed in' }

  const parsed = UpdatePrefsInput.safeParse(input)
  if (!parsed.success) {
    return {
      ok: false,
      error: 'Invalid preferences.',
      fieldErrors: Object.fromEntries(
        parsed.error.issues.map((i) => [i.path[0]?.toString() ?? '_', i.message]),
      ),
    }
  }

  const patch = parsed.data

  // Read the current values for the fields we're patching so the
  // audit log captures a meaningful before/after diff. Only the
  // patched fields are read — a full row read is wasted bandwidth.
  const before: Record<string, unknown> = {}
  if (Object.keys(patch).length > 0) {
    const { data: current } = await supabase
      .from('notification_preferences')
      .select(
        'email_digest_freq, marketing_opt_in, newsletter_opt_in, partner_updates_opt_in, affiliate_updates_opt_in',
      )
      .eq('user_id', user.id)
      .maybeSingle()
    for (const k of Object.keys(patch)) {
      before[k] = (current as Record<string, unknown> | null)?.[k] ?? null
    }
  }

  const upsertPayload = { user_id: user.id, ...patch }

  const { error: upsertErr } = await supabase
    .from('notification_preferences')
    .upsert(upsertPayload, { onConflict: 'user_id' })

  if (upsertErr) {
    log.warn(
      { code: 'prefs_upsert_failed', msg: upsertErr.message },
      'notification prefs upsert failed',
    )
    return { ok: false, error: 'Could not save your preferences. Please try again.' }
  }

  // Build a focused before/after diff — only the fields that actually
  // changed get recorded. This keeps the audit row compact + accurate.
  const diff: { before: Record<string, unknown>; after: Record<string, unknown> } = {
    before: {},
    after: {},
  }
  for (const [k, v] of Object.entries(patch)) {
    if (before[k] !== v) {
      diff.before[k] = before[k]
      diff.after[k] = v
    }
  }
  if (Object.keys(diff.after).length > 0) {
    await writeSelfAuditLog({
      userId: user.id,
      userEmail: user.email ?? '',
      action: 'settings_self_update',
      targetKind: 'profiles',
      targetId: user.id,
      metadata: { ...diff, target_table: 'notification_preferences' },
    })
  }

  revalidatePath('/account/settings')
  return { ok: true, prefs: patch }
}

export type UpdateLocaleTzResult =
  | { ok: true; locale: string; timezone: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string> }

export async function updateLocaleAndTimezoneAction(input: unknown): Promise<UpdateLocaleTzResult> {
  const supabase = await getServerSupabase()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Not signed in' }

  const parsed = UpdateLocaleTzInput.safeParse(input)
  if (!parsed.success) {
    return {
      ok: false,
      error: 'Invalid locale/timezone.',
      fieldErrors: Object.fromEntries(
        parsed.error.issues.map((i) => [i.path[0]?.toString() ?? '_', i.message]),
      ),
    }
  }

  const { data: before } = await supabase
    .from('profiles')
    .select('locale, timezone')
    .eq('user_id', user.id)
    .maybeSingle()

  const { error: updateErr } = await supabase
    .from('profiles')
    .update({ locale: parsed.data.locale, timezone: parsed.data.timezone })
    .eq('user_id', user.id)
    .select('locale, timezone')
    .single()

  if (updateErr) {
    log.warn({ code: 'locale_tz_failed', msg: updateErr.message }, 'locale/timezone update failed')
    return { ok: false, error: 'Could not save. Please try again.' }
  }

  const diff: { before: Record<string, unknown>; after: Record<string, unknown> } = {
    before: {},
    after: {},
  }
  for (const k of Object.keys(parsed.data) as (keyof typeof parsed.data)[]) {
    const prev = (before as Record<string, unknown> | null)?.[k] ?? null
    if (prev !== parsed.data[k]) {
      diff.before[k] = prev
      diff.after[k] = parsed.data[k]
    }
  }
  if (Object.keys(diff.after).length > 0) {
    await writeSelfAuditLog({
      userId: user.id,
      userEmail: user.email ?? '',
      action: 'settings_self_update',
      targetKind: 'profiles',
      targetId: user.id,
      metadata: { ...diff, target_table: 'profiles' },
    })
  }

  revalidatePath('/account/settings')
  return { ok: true, locale: parsed.data.locale, timezone: parsed.data.timezone }
}