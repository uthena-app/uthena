import 'server-only'
import { getServerSupabase } from '@foundations/data/supabase'

/** Returns "Member since {month YYYY}" for the given user. Server-only. */
export async function getMemberSince(userId: string): Promise<string> {
  const supabase = await getServerSupabase()
  const { data } = await supabase
    .from('profiles')
    .select('created_at')
    .eq('user_id', userId)
    .maybeSingle()
  if (!data?.created_at) return 'Member since recently'
  const d = new Date(data.created_at)
  return `Member since ${d.toLocaleString('en-US', { month: 'long', year: 'numeric' })}`
}
