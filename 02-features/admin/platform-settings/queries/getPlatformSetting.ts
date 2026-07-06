// getPlatformSetting.ts — admin read of one `platform_settings` row.
//
// Service-role read so an admin can see EVERY key (including
// `public_read=false` keys like a future maintenance_mode toggle).
// Returns null when the row is missing or unreadable.
//
// Used by:
//   - /admin/dmca-agent (Slice 1; pre-fills the editor form)
//   - future admin surfaces for other keys (email, maintenance, etc.)
//
// Defensive: the value jsonb shape varies per key. For `dmca_agent`,
// we apply the same 4-field parse that `getDmcaAgent` does; for any
// other key, we return the raw jsonb and let the caller parse it.
//
// Caching: wrapped in `React.cache` so repeated calls within one
// request hit the same memoized result. No long-term cache (admin
// edits should be visible on the next request — the ISR window is
// per-route via `dynamic = 'force-dynamic'` on the page).

import 'server-only'
import { cache } from 'react'
import { getServiceSupabase } from '@foundations/data/supabase'
import { loggerFor } from '@foundations/log/pino'
import type { DmcaAgentContact } from '@features/legal'

const log = loggerFor({ component: 'admin.platform-settings.get' })

/** All known setting keys. Add new keys here as the platform-settings
 *  feature grows. The constant is the source of truth for type-safe
 *  lookups — keeps the admin editor from accidentally hitting a typo. */
export type PlatformSettingKey = 'dmca_agent'

/** Generic read result — `value` is the raw jsonb from the row. */
export type PlatformSettingRow = {
  key: PlatformSettingKey
  value: unknown
  description: string | null
  public_read: boolean
  updated_at: string
  updated_by: string | null
}

/** Read one row by key. Service-role bypasses RLS. Returns null when
 *  the row is missing or unreadable. */
export const getPlatformSetting = cache(async function getPlatformSetting(
  key: PlatformSettingKey,
): Promise<PlatformSettingRow | null> {
  const supabase = getServiceSupabase()

  const { data, error } = await supabase
    .from('app_settings')
    .select('key, value, description, public_read, updated_at, updated_by')
    .eq('key', key)
    .maybeSingle()

  if (error) {
    log.warn(
      { code: 'platform_setting_read_failed', key, msg: error.message },
      'getPlatformSetting: read failed',
    )
    return null
  }
  if (!data) {
    return null
  }
  return data as unknown as PlatformSettingRow
})

/** Strongly-typed read for the `dmca_agent` key. Returns the same
 *  shape that `getDmcaAgent` returns to the public page — so the
 *  admin editor pre-fills with the exact contact the public sees. */
export const getDmcaAgentForAdmin = cache(async function getDmcaAgentForAdmin(): Promise<DmcaAgentContact | null> {
  const row = await getPlatformSetting('dmca_agent')
  if (!row) return null

  const raw = row.value as unknown
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    log.warn(
      { code: 'dmca_agent_admin_bad_shape', actualType: Array.isArray(raw) ? 'array' : typeof raw },
      'getDmcaAgentForAdmin: dmca_agent value is not an object',
    )
    return null
  }
  const obj = raw as Record<string, unknown>
  const name = typeof obj.name === 'string' ? obj.name.trim() : ''
  const email = typeof obj.email === 'string' ? obj.email.trim() : ''
  const mailing = typeof obj.mailing_address === 'string' ? obj.mailing_address.trim() : ''
  const phone = typeof obj.phone === 'string' ? obj.phone.trim() : ''
  if (!name || !email || !mailing) return null
  return { name, email, mailing_address: mailing, phone }
})