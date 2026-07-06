// getMaintenanceState.ts — server query for the maintenance-mode state.
//
// Service-role read of the 3 maintenance fields on `platform_settings`.
// Wrapped in React `cache()` for per-request memoization (matches the
// `getPlatformSettingsGeneral` pattern). Fails soft to the canonical
// "off + default message" state on any read error so the admin UI
// never crashes from a missing row.
//
// Used by:
//   1. `/admin/settings` page (renders the MaintenanceToggle island).
//   2. `/maintenance` page (renders the 503 message for direct hits).

import 'server-only'
import { cache } from 'react'
import { getServiceSupabase } from '@foundations/data/supabase'
import { loggerFor } from '@foundations/log/pino'
import { coerceMaintenanceState, type MaintenanceState } from '../lib/maintenance'

const log = loggerFor({ component: 'admin.platform-settings.getMaintenance' })

/**
 * Read the current maintenance state from `platform_settings`. Returns
 * the canonical shape; defensive coercion falls back to the safe
 * defaults on any read failure or malformed row.
 */
export const getMaintenanceState = cache(
  async function getMaintenanceState(): Promise<MaintenanceState> {
    const supabase = getServiceSupabase()
    const { data, error } = await supabase
      .from('platform_settings')
      .select('maintenance_mode, maintenance_started_at, maintenance_message')
      .eq('id', 1)
      .maybeSingle()
    if (error) {
      log.warn(
        { code: 'maintenance_state_read_failed', msg: error.message },
        'getMaintenanceState: read failed',
      )
      return coerceMaintenanceState(null)
    }
    if (!data) {
      // Row missing — migration didn't seed. Fail-soft to off so the
      // admin can still see + use the toggle.
      return coerceMaintenanceState(null)
    }
    return coerceMaintenanceState(data)
  },
)