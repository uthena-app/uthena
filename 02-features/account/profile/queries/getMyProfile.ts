import 'server-only'
import { getServerSupabase } from '@foundations/data/supabase'
import type { ProfileWithEmail } from '../types'

/** Read the current user's profile + auth state. Server-only.
 *  RLS on `profiles` allows the user to read their own row. The
 *  `auth.users` row is accessed indirectly via `supabase.auth.getUser()`. */
export async function getMyProfile(): Promise<ProfileWithEmail | null> {
  const supabase = await getServerSupabase()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null

  // Two reads in parallel — both are small, RLS-bounded, and the
  // profile query is a single-row lookup on the unique user_id index.
  const [profileRes, _] = await Promise.all([
    supabase
      .from('profiles')
      .select('user_id, display_name, avatar_url, bio, locale, timezone, role, created_at, updated_at')
      .eq('user_id', user.id)
      .maybeSingle(),
    Promise.resolve(null), // placeholder for any future parallel read
  ])

  if (profileRes.error || !profileRes.data) {
    return null
  }

  return {
    ...(profileRes.data as Omit<ProfileWithEmail, 'email' | 'email_verified'>),
    email: user.email ?? '',
    email_verified: Boolean(user.email_confirmed_at),
  }
}
