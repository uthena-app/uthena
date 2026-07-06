// types — shape of the profile data the page renders. Derived from
// 04-platform/migrations/0001_initial.sql (the source of truth for
// the column types) plus the auth.users fields the server query
// surfaces (email, email_verified).
//
// If the schema changes, update the matching profile columns here
// AND the SELECT in queries/getMyProfile.ts.

export const SUPPORTED_LOCALES = [
  { value: 'en', label: 'English' },
  { value: 'es', label: 'Español' },
  { value: 'fr', label: 'Français' },
  { value: 'de', label: 'Deutsch' },
  { value: 'pt', label: 'Português' },
  { value: 'it', label: 'Italiano' },
  { value: 'nl', label: 'Nederlands' },
  { value: 'ja', label: '日本語' },
  { value: 'zh', label: '中文' },
  { value: 'ko', label: '한국어' },
] as const
export type Locale = (typeof SUPPORTED_LOCALES)[number]['value']

/** The editable subset of `profiles` the user can change on this page. */
export type ProfileEditable = {
  display_name: string
  bio: string | null
  locale: string
  timezone: string
  avatar_url: string | null
}

/** The full profile row + auth.users email + verified state. */
export type ProfileWithEmail = {
  user_id: string
  display_name: string
  avatar_url: string | null
  bio: string | null
  locale: string
  timezone: string
  role: string
  created_at: string
  updated_at: string
  email: string
  email_verified: boolean
}
