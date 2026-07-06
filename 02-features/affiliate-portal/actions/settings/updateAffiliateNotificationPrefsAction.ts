'use server'

// updateAffiliateNotificationPrefsAction — P13.11 Slice 1.
//
// Server action for the /affiliate/settings Notifications section.
//
// **Input contract:** `UpdateAffiliateNotificationPrefsInput` from
// @foundations/data/schemas. The 4 affiliate-specific toggles,
// all optional so a single-toggle patch is supported (the UI
// debounces each toggle independently).
//
// **Auth + RLS:**
//   - `requireAffiliate()` gates on role + redirects non-affiliates
//   - The `notification_prefs_self_write` RLS policy is the
//     second line of defense; the user_id is ALWAYS derived from
//     the session
//
// **Audit:** writes one `affiliate_settings_self_update` row to
// `admin_audit_log` with a { before, after } diff of just the
// toggles that actually changed. The diff shape mirrors the
// customer's `updateNotificationPrefsAction` so admins can answer
// "what did this affiliate actually agree to?" with one query.
//
// **First-write behavior:** if the user has no notification_preferences
// row yet (defaults only), the action UPDATEs (which is a no-op on
// zero rows). To handle this, we use an UPSERT: insert with the
// schema defaults if the row is missing, then patch the requested
// fields. Supabase's `upsert` with `onConflict: 'user_id'` handles
// the race-safety (a concurrent patch from another tab will merge
// correctly per last-write-wins on the explicit columns).

import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'
import { requireAffiliate } from '@foundations/auth/guards'
import { getServerSupabase } from '@foundations/data/supabase'
import { UpdateAffiliateNotificationPrefsInput } from '@foundations/data/schemas'
import { loggerFor } from '@foundations/log/pino'
import { writeSelfAuditLog } from '@features/account/profile/actions/writeSelfAuditLog'

const log = loggerFor({ component: 'affiliate.settings.prefs' })

/** Column → camelCase mapping for the response shape. The DB columns
 *  are snake_case (matching the migration); the response shape is
 *  camelCase (matching the existing `AffiliateSettingsPrefs` type).
 *  Both shapes are listed here so the read → patch → diff → response
 *  pipeline stays in sync with one source of truth. The action ONLY
 *  accepts the 4 affiliate-specific toggles via Zod — the legacy
 *  v2 columns (marketing_opt_in, etc.) are NOT in scope here. */
const COLUMN_TO_CAMEL: ReadonlyArray<{
  /** DB column name (snake_case, matches the migration). */
  col: 'affiliate_updates_opt_in' | 'commission_notifications_opt_in' | 'payout_notifications_opt_in' | 'monthly_digest_opt_in'
  /** Response field name (camelCase, matches `AffiliateSettingsPrefs`). */
  field: 'affiliateUpdatesOptIn' | 'commissionNotificationsOptIn' | 'payoutNotificationsOptIn' | 'monthlyDigestOptIn'
}> = [
  { col: 'affiliate_updates_opt_in', field: 'affiliateUpdatesOptIn' },
  { col: 'commission_notifications_opt_in', field: 'commissionNotificationsOptIn' },
  { col: 'payout_notifications_opt_in', field: 'payoutNotificationsOptIn' },
  { col: 'monthly_digest_opt_in', field: 'monthlyDigestOptIn' },
]

export type UpdateAffiliateNotificationPrefsResult =
  | { ok: true; prefs: Record<'affiliateUpdatesOptIn' | 'commissionNotificationsOptIn' | 'payoutNotificationsOptIn' | 'monthlyDigestOptIn', boolean> }
  | { ok: false; error: string; fieldErrors?: Record<string, string> }

export async function updateAffiliateNotificationPrefsAction(
  input: unknown,
): Promise<UpdateAffiliateNotificationPrefsResult> {
  // Auth gate.
  let user: { id: string; email: string }
  try {
    const authed = await requireAffiliate()
    user = { id: authed.id, email: authed.email }
  } catch {
    return { ok: false, error: 'Please sign in.' }
  }

  // Zod validation — strict (rejects unknown keys).
  const parsed = UpdateAffiliateNotificationPrefsInput.safeParse(input)
  if (!parsed.success) {
    return {
      ok: false,
      error: 'Please fix the errors below.',
      fieldErrors: Object.fromEntries(
        parsed.error.issues.map((i) => [i.path[0]?.toString() ?? '_', i.message]),
      ),
    }
  }

  const supabase = await getServerSupabase()

  // Read the current toggles to compute the diff for the audit log.
  // Only fetch the 4 affiliate-specific columns.
  const { data: before, error: readErr } = await supabase
    .from('notification_preferences')
    .select('affiliate_updates_opt_in, commission_notifications_opt_in, payout_notifications_opt_in, monthly_digest_opt_in')
    .eq('user_id', user.id)
    .maybeSingle()

  if (readErr) {
    log.warn(
      { code: 'prefs_read_failed', msg: readErr.message },
      'notification_preferences read failed before patch',
    )
    // Fail-soft: proceed without a diff (the audit row will be
    // an "after-only" record). The patch itself may still succeed.
  }

  // UPSERT: if no row exists, insert with all schema defaults
  // (matching migration 0033 + 0051 defaults), then patch the
  // requested fields. `onConflict: 'user_id'` ensures the
  // existing-row case is an UPDATE.
  const patch: Record<string, boolean> = {}
  for (const { col, field } of COLUMN_TO_CAMEL) {
    // The input is snake_case to match the Zod schema (which is
    // the contract for the client form). The response is
    // camelCase to match the `AffiliateSettingsPrefs` type.
    const value = parsed.data[col]
    if (value !== undefined) {
      patch[col] = value
    }
  }
  // If the request patched zero fields after Zod (e.g. someone
  // passed an empty object somehow — Zod's `.refine` already
  // rejects this), bail with a friendly error.
  if (Object.keys(patch).length === 0) {
    return { ok: false, error: 'No preferences to update.' }
  }

  const { error: upsertErr } = await supabase
    .from('notification_preferences')
    .upsert(
      {
        user_id: user.id,
        // Schema defaults — match the migration defaults so a
        // first-write row matches what the read path would have
        // returned. Any column not in `patch` keeps its default.
        ...patch,
      },
      { onConflict: 'user_id' },
    )

  if (upsertErr) {
    log.warn(
      { code: 'prefs_update_failed', msg: upsertErr.message },
      'notification_preferences upsert failed',
    )
    return {
      ok: false,
      error: 'Could not save your preferences. Please try again.',
    }
  }

  // Build the { before, after } diff — only include keys that
  // changed. Avoids audit-log noise on no-op saves.
  const diff: { before: Record<string, unknown>; after: Record<string, unknown> } = {
    before: {},
    after: {},
  }
  const prevRow = (before as Record<string, unknown> | null) ?? null
  for (const { col, field } of COLUMN_TO_CAMEL) {
    const next = parsed.data[col]
    if (next === undefined) continue
    const prev = (prevRow?.[col] as boolean | undefined) ?? null
    if (prev !== next) {
      diff.before[field] = prev
      diff.after[field] = next
    }
  }
  if (Object.keys(diff.after).length > 0) {
    const hdrs = await headers()
    await writeSelfAuditLog({
      userId: user.id,
      userEmail: user.email,
      action: 'affiliate_settings_self_update',
      targetKind: 'notification_preferences',
      targetId: user.id,
      metadata: diff,
      ipAddress: hdrs.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
      userAgent: hdrs.get('user-agent') ?? null,
    })
  }

  revalidatePath('/affiliate/settings')

  // Build the typed response. Defaults match the spec (line 71):
  //   affiliateUpdates = false (from patch or default)
  //   commissionNotifications = true (from patch or default)
  //   payoutNotifications = true (from patch or default)
  //   monthlyDigest = true (from patch or default)
  const responsePrefs = {
    affiliateUpdatesOptIn:
      parsed.data.affiliate_updates_opt_in ??
      ((prevRow?.affiliate_updates_opt_in as boolean | undefined) ?? false),
    commissionNotificationsOptIn:
      parsed.data.commission_notifications_opt_in ??
      ((prevRow?.commission_notifications_opt_in as boolean | undefined) ?? true),
    payoutNotificationsOptIn:
      parsed.data.payout_notifications_opt_in ??
      ((prevRow?.payout_notifications_opt_in as boolean | undefined) ?? true),
    monthlyDigestOptIn:
      parsed.data.monthly_digest_opt_in ??
      ((prevRow?.monthly_digest_opt_in as boolean | undefined) ?? true),
  }
  return { ok: true, prefs: responsePrefs }
}