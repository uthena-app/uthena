// getUserLibrary.ts — read the user's accessible products in a single
// roundtrip via the user_accessible_products SQL function (migration
// 0009). The function unions library_grants + active subscription
// access. No N+1: the page renders this list directly.

import 'server-only'
import { cache } from 'react'
import { getServerSupabase } from '@foundations/data/supabase'
import { getSessionUser } from '@foundations/auth/guards'
import { loggerFor } from '@foundations/log/pino'

const log = loggerFor({ component: 'library.getUserLibrary' })

export type AccessibleProduct = {
  product_id: number
  slug: string
  title: string
  thumbnail_url: string | null
  kind: 'video_course' | 'ebook' | 'template_pack' | 'audio_course' | 'bundle' | 'asset_pack'
  short_description: string
  total_lesson_count: number
  total_duration_seconds: number
  partner_id: number
  partner_slug: string | null
  access_source: 'purchase' | 'admin_grant' | 'free_promo' | 'subscription'
  granted_at: string
}

export const getUserLibrary = cache(async (): Promise<AccessibleProduct[]> => {
  const user = await getSessionUser()
  if (!user) return []
  const supabase = await getServerSupabase()
  // RPC returns a single rowset. PostgREST shapes it as an array.
  // We don't go through a view or PostgREST's embed here because
  // the function is the right unit of caching / RLS-bypass for
  // this access pattern.
  const { data, error } = await supabase.rpc('user_accessible_products', {
    p_user_id: user.id,
  })
  if (error) {
    log.warn({ code: 'get_library_failed', msg: error.message }, 'getUserLibrary failed')
    return []
  }
  return (data ?? []) as AccessibleProduct[]
})
