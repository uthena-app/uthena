// searchUsersForImpersonation — find a user by email or display_name
// for the admin account-switcher. Excludes:
//   - super_admin users (privilege separation — a super_admin should never
//     impersonate another super_admin)
//   - banned users (they can't log in via the magic link exchange)
//
// Uses the service-role client because the search needs to read
// auth.users.email (the only place the email lives). The profiles table
// itself is public-readable via RLS, but profiles.display_name is the
// only profile data we have — the email lives in auth.users.
//
// SECURITY: this query runs only after `requireRole(['super_admin'])` on
// the page. The service-role client is the only way to read
// `auth.users.email` from the application; the query itself does not
// gate further (the page's auth gate is the only gate).
//
// Cache-deduped per-request via React's `cache()` so the page renders
// with at most one query call.

import 'server-only'
import { cache } from 'react'
import { z } from 'zod'
import { getServiceSupabase } from '@foundations/data/supabase'

const QuerySchema = z
  .string()
  .trim()
  .min(1, 'Search query is required.')
  .max(120, 'Search query must be 120 characters or fewer.')

export type ImpersonatableUser = {
  user_id: string
  email: string
  display_name: string
  role: 'customer' | 'partner' | 'affiliate' | 'admin' | 'super_admin'
  status: 'active' | 'suspended' | 'banned' | string
}

const MAX_RESULTS = 20

/** Run the search. Returns `{ rows, error }` — error is a typed string
 *  the page renders into the EmptyState when validation fails. */
export const searchUsersForImpersonation = cache(
  async (rawQuery: string): Promise<{ rows: ImpersonatableUser[]; error?: string }> => {
    const parsed = QuerySchema.safeParse(rawQuery ?? '')
    if (!parsed.success) {
      return { rows: [], error: parsed.error.issues[0]?.message ?? 'Invalid query.' }
    }
    const q = parsed.data
    // Escape SQL LIKE wildcards in the user input so a literal `%` or
    // `_` doesn't widen the match. We then re-wrap with `%` ourselves.
    const escaped = q.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_')
    const pattern = `%${escaped}%`

    const supabase = getServiceSupabase()
    // Join profiles → auth.users on user_id. We need email (auth.users)
    // + display_name/role/status (profiles). The query filters out
    // super_admin + banned + matches on either email OR display_name.
    // ILIKE on both sides with the same escaped pattern.
    const { data, error } = await supabase
      .from('profiles')
      .select(
        'user_id, display_name, role, status, auth_users:auth.users!profiles_user_id_fkey(email)',
      )
      .neq('role', 'super_admin')
      .neq('status', 'banned')
      .or(`display_name.ilike.${pattern},auth_users.email.ilike.${pattern}`)
      .limit(MAX_RESULTS)

    if (error) {
      return { rows: [], error: 'Search is temporarily unavailable. Please try again.' }
    }

    const rows: ImpersonatableUser[] = ((data ?? []) as unknown as Array<{
      user_id: string
      display_name: string
      role: ImpersonatableUser['role']
      status: ImpersonatableUser['status']
      auth_users: { email: string } | null
    }>)
      .filter((r) => r.auth_users?.email)
      .map((r) => ({
        user_id: r.user_id,
        email: r.auth_users!.email,
        display_name: r.display_name,
        role: r.role,
        status: r.status,
      }))

    return { rows }
  },
)
