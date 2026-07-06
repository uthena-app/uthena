// listRecentImpersonationSessions — last 20 impersonation sessions
// across all super_admins. Joined with profiles to resolve admin +
// target display names + emails. Used by the recent-sessions list at
// the bottom of /admin/account-switcher.
//
// Reads via the request-scoped RLS-aware client (admin can read
// impersonation_sessions per the `impersonation_sessions_admin_read`
// RLS policy). No service-role escalation needed — the join to
// profiles + auth.users.email uses the same Supabase client.
//
// Cache-deduped per-request.

import 'server-only'
import { cache } from 'react'
import { getServerSupabase } from '@foundations/data/supabase'

const MAX_SESSIONS = 20

export type ImpersonationSessionRow = {
  id: string
  admin_email: string
  admin_display_name: string
  target_display_name: string
  target_email: string
  started_at: string
  ended_at: string | null
  expires_at: string
  reason: string
}

export const listRecentImpersonationSessions = cache(async (): Promise<ImpersonationSessionRow[]> => {
  const supabase = await getServerSupabase()
  const { data, error } = await supabase
    .from('impersonation_sessions')
    .select(
      `
        id,
        admin_id,
        target_user_id,
        expires_at,
        consumed_at,
        ended_at,
        reason,
        created_at,
        admin:profiles!impersonation_sessions_admin_id_fkey(
          display_name,
          auth_users:auth.users!profiles_user_id_fkey(email)
        ),
        target:profiles!impersonation_sessions_target_user_id_fkey(
          display_name,
          auth_users:auth.users!profiles_user_id_fkey(email)
        )
      `,
    )
    .order('created_at', { ascending: false })
    .limit(MAX_SESSIONS)

  if (error || !data) return []

  return (data as unknown as Array<{
    id: string
    expires_at: string
    consumed_at: string | null
    ended_at: string | null
    reason: string
    created_at: string
    admin: { display_name: string; auth_users: { email: string } | null } | null
    target: { display_name: string; auth_users: { email: string } | null } | null
  }>).map((r) => ({
    id: r.id,
    admin_email: r.admin?.auth_users?.email ?? '—',
    admin_display_name: r.admin?.display_name ?? '—',
    target_display_name: r.target?.display_name ?? '—',
    target_email: r.target?.auth_users?.email ?? '—',
    started_at: r.consumed_at ?? r.created_at,
    ended_at: r.ended_at,
    expires_at: r.expires_at,
    reason: r.reason,
  }))
})
