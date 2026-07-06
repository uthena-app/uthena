// getMyAffiliateSettings.ts — P13.11 affiliate settings aggregator.
//
// Reads the three slices the /affiliate/settings page needs in one
// round-trip:
//
//   1. The profile row (display_name + bio + locale + timezone)
//      — RLS: profiles_self_read
//   2. The notification_preferences row (the 4 affiliate-specific
//      toggles + the 6 inherited v2 columns) — left-join; defaults
//      are filled in client-side if no row exists yet, matching the
//      pattern used by /account/profile's `getMySettings` so the
//      two surfaces behave identically on first read
//   3. The affiliates row (status — used to render the suspended
//      / pending banners on the page) — RLS: affiliates_self_read
//
// **Auth contract:** caller must be a logged-in affiliate (role
// check happens in the page route via `requireRole(['affiliate'])`).
// The helper itself only requires `getUser()` to return a user.
//
// **Fail-soft contract:** each read is independent and never throws.
// If a read fails, the corresponding slice returns defaults and a
// PII-safe warn is logged (the user_id is HASHED before the log call,
// so the raw UUID NEVER crosses the log boundary).
//
// **Why one query, not three?** Same pattern as
// `getAffiliateDashboard`: the page is the only consumer today, and
// colocating the reads here means future P13.11 Slices (Sessions,
// Connected accounts, Locale & region, Audit strip) can reuse the
// aggregator without re-implementing the auth + ownership + fail-
// soft logic. Each slice is independently nullable so a single read
// failure doesn't blank the whole page.

import 'server-only'
import { getServerSupabase } from '@foundations/data/supabase'
import { loggerFor } from '@foundations/log/pino'

const SETTINGS_LOG = loggerFor({ component: 'affiliate.settings' })

/** Profile slice (display_name + bio + locale + timezone). RLS:
 *  profiles_self_read. */
export type AffiliateSettingsProfile = {
  displayName: string
  bio: string | null
  locale: string
  timezone: string
}

/** Notification preferences slice — the 4 affiliate-specific toggles
 *  (P13.11) + the 4 legacy transactional booleans (kept for parity
 *  with the customer settings page; the affiliate surface doesn't
 *  expose them but the row data is here so the page can compute
 *  the audit strip timestamp without a second query). RLS:
 *  notification_prefs_self_read. */
export type AffiliateSettingsPrefs = {
  /** The 4 affiliate-specific toggles (spec §Notifications). */
  affiliateUpdatesOptIn: boolean
  commissionNotificationsOptIn: boolean
  payoutNotificationsOptIn: boolean
  monthlyDigestOptIn: boolean
  /** The v2 inherited columns from migration 0033 (the customer
   *  surface exposes them; the affiliate surface doesn't render
   *  them in v1 but we read them so a future settings slice can
   *  reuse the query without a schema change). */
  emailDigestFreq: 'off' | 'daily' | 'weekly' | 'monthly'
  marketingOptIn: boolean
  newsletterOptIn: boolean
  transactionalOptIn: boolean
  /** Set when the row exists; lets the page render "never edited"
   *  vs. "edited N days ago" on the audit strip. */
  hasRow: boolean
}

/** Affiliates slice — used for the suspended / pending banner on
 *  the page. RLS: affiliates_self_read. */
export type AffiliateSettingsStatus = {
  status: 'pending' | 'approved' | 'suspended'
  /** True when the row exists. False when the user has no
   *  affiliates row (the page redirects to /affiliate/onboarding
   *  in that case — see the route-level guard). */
  hasRow: boolean
}

/** Aggregator result. Always returned (never null) — even an
 *  unauthenticated caller gets a fully-defaulted shape so the
 *  page can render an empty state without branching on null.
 *  Authenticated callers get the real data or defaults if a read
 *  fails. */
export type AffiliateSettings = {
  userId: string
  profile: AffiliateSettingsProfile
  prefs: AffiliateSettingsPrefs
  status: AffiliateSettingsStatus
}

/** Coerce a PostgREST bigint/text/string into a trimmed string.
 *  Used for `display_name` etc. */
function coerceString(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

/** Coerce a string-or-null into a trimmed string or null. Used
 *  for `bio` which is nullable in the DB. */
function coerceNullableString(v: unknown): string | null {
  if (v == null) return null
  return typeof v === 'string' ? v : null
}

/** Coerce a boolean-like value (PostgREST may serialize booleans
 *  as `true` / `false` / `null` / `'t'` / `'f'` depending on the
 *  driver; some drivers serialize as `0` / `1`). All the new opt-in
 *  columns are `NOT NULL` so a null here means the row didn't exist
 *  or the column wasn't included in the select. */
function coerceBool(v: unknown, fallback: boolean): boolean {
  if (v === true || v === 'true' || v === 't' || v === 1) return true
  if (v === false || v === 'false' || v === 'f' || v === 0) return false
  return fallback
}

/** Map the 4 raw `email_digest_freq` enum values from the DB onto
 *  the typed union. Falls back to `'weekly'` (the column default)
 *  for any unrecognized value (forward-compat: a future migration
 *  adding a new enum value won't crash the page). */
function coerceEmailDigestFreq(v: unknown): 'off' | 'daily' | 'weekly' | 'monthly' {
  if (v === 'off' || v === 'daily' || v === 'weekly' || v === 'monthly') return v
  return 'weekly'
}

/** Narrow the raw profiles row to the minimal shape the page needs. */
function narrowProfileRow(raw: Record<string, unknown> | null): AffiliateSettingsProfile {
  return {
    displayName: coerceString(raw?.display_name),
    bio: coerceNullableString(raw?.bio),
    locale: coerceString(raw?.locale) || 'en-US',
    timezone: coerceString(raw?.timezone) || 'UTC',
  }
}

/** Defaults for a user who has never been on the notification
 *  preferences surface before. Matches the schema defaults in
 *  migration 0033 + 0051 (with the spec's affiliate-specific
 *  overrides applied):
 *   - affiliate_updates_opt_in        = false (spec line 71)
 *   - commission_notifications_opt_in = true  (spec line 71)
 *   - payout_notifications_opt_in     = true  (spec line 71)
 *   - monthly_digest_opt_in           = true  (spec line 71)
 *   - email_digest_freq               = 'weekly' (migration 0033 default)
 *   - marketing_opt_in                = false (migration 0033 default)
 *   - newsletter_opt_in               = false (migration 0033 default)
 *   - transactional_opt_in            = true  (migration 0033 default)
 */
const DEFAULT_PREFS: AffiliateSettingsPrefs = {
  affiliateUpdatesOptIn: false,
  commissionNotificationsOptIn: true,
  payoutNotificationsOptIn: true,
  monthlyDigestOptIn: true,
  emailDigestFreq: 'weekly',
  marketingOptIn: false,
  newsletterOptIn: false,
  transactionalOptIn: true,
  hasRow: false,
}

/** Narrow the raw notification_preferences row to the typed shape. */
function narrowPrefsRow(raw: Record<string, unknown> | null): AffiliateSettingsPrefs {
  if (!raw) return DEFAULT_PREFS
  return {
    affiliateUpdatesOptIn: coerceBool(raw.affiliate_updates_opt_in, DEFAULT_PREFS.affiliateUpdatesOptIn),
    commissionNotificationsOptIn: coerceBool(
      raw.commission_notifications_opt_in,
      DEFAULT_PREFS.commissionNotificationsOptIn,
    ),
    payoutNotificationsOptIn: coerceBool(
      raw.payout_notifications_opt_in,
      DEFAULT_PREFS.payoutNotificationsOptIn,
    ),
    monthlyDigestOptIn: coerceBool(
      raw.monthly_digest_opt_in,
      DEFAULT_PREFS.monthlyDigestOptIn,
    ),
    emailDigestFreq: coerceEmailDigestFreq(raw.email_digest_freq),
    marketingOptIn: coerceBool(raw.marketing_opt_in, DEFAULT_PREFS.marketingOptIn),
    newsletterOptIn: coerceBool(raw.newsletter_opt_in, DEFAULT_PREFS.newsletterOptIn),
    transactionalOptIn: coerceBool(raw.transactional_opt_in, DEFAULT_PREFS.transactionalOptIn),
    hasRow: true,
  }
}

/** Narrow the raw affiliates row to the status slice. */
function narrowStatusRow(
  raw: Record<string, unknown> | null,
): AffiliateSettingsStatus {
  if (!raw) {
    return { status: 'pending', hasRow: false }
  }
  const statusRaw = typeof raw.status === 'string' ? raw.status : 'pending'
  const status: AffiliateSettingsStatus['status'] =
    statusRaw === 'approved' || statusRaw === 'suspended' ? statusRaw : 'pending'
  return { status, hasRow: true }
}

/** Hash the user_id into an 8-char FNV-1a hex. Same scheme as the
 *  other affiliate-portal queries so log entries correlate. */
function hashUserId(userId: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < userId.length; i++) {
    hash ^= userId.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

/**
 * Read the full P13.11 settings aggregator in a single
 * Promise.all round-trip.
 *
 * **Returns:** always a fully-shaped `AffiliateSettings`. When the
 *  user is not logged in, all three slices return defaults and the
 *  `userId` is empty. When a read fails for an authenticated caller,
 *  that slice returns defaults + a PII-safe warn is logged. The
 *  page route is the auth gate; this helper trusts the caller.
 */
export async function getMyAffiliateSettings(): Promise<AffiliateSettings> {
  const supabase = await getServerSupabase()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return {
      userId: '',
      profile: { displayName: '', bio: null, locale: 'en-US', timezone: 'UTC' },
      prefs: DEFAULT_PREFS,
      status: { status: 'pending', hasRow: false },
    }
  }

  // Round 1 (sequential, cheap): nothing — all three reads are
  // keyed by the same auth user id so we can parallelize.
  //
  // Round 2 (parallel): profile + notification_preferences +
  // affiliates. The notification_preferences left-join is implicit
  // (Supabase auto-maps `.maybeSingle()` to a null result on zero
  // rows; we narrow that to the default shape).
  const [profileResult, prefsResult, statusResult] = await Promise.all([
    supabase
      .from('profiles')
      .select('display_name, bio, locale, timezone')
      .eq('id', user.id)
      .maybeSingle(),
    supabase
      .from('notification_preferences')
      .select(
        'affiliate_updates_opt_in, commission_notifications_opt_in, payout_notifications_opt_in, monthly_digest_opt_in, email_digest_freq, marketing_opt_in, newsletter_opt_in, transactional_opt_in',
      )
      .eq('user_id', user.id)
      .maybeSingle(),
    supabase
      .from('affiliates')
      .select('status')
      .eq('user_id', user.id)
      .maybeSingle(),
  ])

  if (profileResult.error) {
    SETTINGS_LOG.warn(
      { user_id_hash: hashUserId(user.id), code: profileResult.error.code ?? null },
      'profiles row read failed',
    )
  }
  if (prefsResult.error) {
    SETTINGS_LOG.warn(
      { user_id_hash: hashUserId(user.id), code: prefsResult.error.code ?? null },
      'notification_preferences row read failed',
    )
  }
  if (statusResult.error) {
    SETTINGS_LOG.warn(
      { user_id_hash: hashUserId(user.id), code: statusResult.error.code ?? null },
      'affiliates row read failed',
    )
  }

  return {
    userId: user.id,
    profile: narrowProfileRow(profileResult.data as Record<string, unknown> | null),
    prefs: narrowPrefsRow(prefsResult.data as Record<string, unknown> | null),
    status: narrowStatusRow(statusResult.data as Record<string, unknown> | null),
  }
}