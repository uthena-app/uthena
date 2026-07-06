import 'server-only'
import { cache } from 'react'
import { getServerSupabase } from '@foundations/data/supabase'
import type { EmailDigestFreq } from '@foundations/data/schemas'

export type MySettings = {
  email_digest_freq: EmailDigestFreq
  transactional_opt_in: true // locked-on by spec; always true (no v1 toggle)
  marketing_opt_in: boolean
  newsletter_opt_in: boolean
  partner_updates_opt_in: boolean
  affiliate_updates_opt_in: boolean
  locale: string
  timezone: string
  email: string
}

/** Defaults applied when the user has no row yet. Match the SQL
 *  defaults in `04-platform/migrations/0033_notification_preferences_v2.sql`. */
const DEFAULTS = {
  email_digest_freq: 'weekly' as EmailDigestFreq,
  transactional_opt_in: true as const,
  marketing_opt_in: false,
  newsletter_opt_in: false,
  partner_updates_opt_in: false,
  affiliate_updates_opt_in: false,
} as const

const VALID_FREQ: ReadonlySet<EmailDigestFreq> = new Set([
  'off',
  'daily',
  'weekly',
  'monthly',
])

/** Read the current user's settings (notification_preferences + profile).
 *
 *  Server-only. RLS allows self-read on both tables. If the
 *  notification_preferences row doesn't exist (new user), returns
 *  the schema defaults — the row is created on the first toggle by
 *  `updateNotificationPrefsAction` (single upsert, no prior read).
 *
 *  Wrapped in `cache()` so the page + the form (when they re-fetch
 *  via revalidatePath) share a single round-trip per request.
 */
export const getMySettings = cache(async (): Promise<MySettings | null> => {
  const supabase = await getServerSupabase()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null

  const [prefsRes, profileRes] = await Promise.all([
    supabase
      .from('notification_preferences')
      .select(
        'email_digest_freq, transactional_opt_in, marketing_opt_in, newsletter_opt_in, partner_updates_opt_in, affiliate_updates_opt_in',
      )
      .eq('user_id', user.id)
      .maybeSingle(),
    supabase
      .from('profiles')
      .select('locale, timezone')
      .eq('user_id', user.id)
      .maybeSingle(),
  ])

  if (profileRes.error || !profileRes.data) return null

  const p = prefsRes.data
  // Defensive coercion — the column type is text+CHECK, but a future
  // migration or a manual DB edit could surface an unexpected value.
  const freq: EmailDigestFreq =
    typeof p?.email_digest_freq === 'string' && VALID_FREQ.has(p.email_digest_freq as EmailDigestFreq)
      ? (p.email_digest_freq as EmailDigestFreq)
      : DEFAULTS.email_digest_freq

  return {
    email_digest_freq: freq,
    transactional_opt_in: true, // locked; never user-editable
    marketing_opt_in: p?.marketing_opt_in ?? DEFAULTS.marketing_opt_in,
    newsletter_opt_in: p?.newsletter_opt_in ?? DEFAULTS.newsletter_opt_in,
    partner_updates_opt_in: p?.partner_updates_opt_in ?? DEFAULTS.partner_updates_opt_in,
    affiliate_updates_opt_in: p?.affiliate_updates_opt_in ?? DEFAULTS.affiliate_updates_opt_in,
    locale: profileRes.data.locale || 'en',
    timezone: profileRes.data.timezone || 'UTC',
    email: user.email ?? '',
  }
})