// getPlatformSettingsFlags.ts — server query. Reads the `flags` jsonb
// column on `platform_settings` and returns a sorted, defensively-coerced
// array of `FeatureFlag`. Used by the Feature flags tab on `/admin/settings`.
//
// Service-role read (admin sees every column). Returns an empty array when
// the row is missing or unreadable; the page falls back to "no flags yet".
//
// Caching: wrapped in React.cache for per-request memoization.
//
// P14.14 (Feature flags).

import 'server-only'
import { cache } from 'react'
import { getServiceSupabase } from '@foundations/data/supabase'
import { loggerFor } from '@foundations/log/pino'
import {
  coerceFeatureFlags,
  sortFlags,
  type FeatureFlags,
} from '../lib/featureFlags'

const log = loggerFor({ component: 'admin.platform-settings.getFlags' })

/**
 * Read the current `flags` array. Always returns a sorted array; never
 * throws. Failures log a warning and return `[]`.
 */
export const getPlatformSettingsFlags = cache(async (): Promise<FeatureFlags> => {
  const supabase = getServiceSupabase()
  const { data, error } = await supabase
    .from('platform_settings')
    .select('flags')
    .eq('id', 1)
    .maybeSingle()

  if (error) {
    log.warn(
      { code: 'platform_settings_flags_read_failed', msg: error.message },
      'getPlatformSettingsFlags: read failed',
    )
    return []
  }
  if (!data) {
    log.warn(
      { code: 'platform_settings_flags_row_missing' },
      'getPlatformSettingsFlags: row missing (returning empty array)',
    )
    return []
  }

  const flagsRaw = (data as unknown as { flags: unknown }).flags
  const coerced = coerceFeatureFlags(flagsRaw)
  // Log a warn if any entries were dropped (sign of corrupted data).
  const rawCount = Array.isArray(flagsRaw) ? flagsRaw.length : 0
  if (rawCount > coerced.length) {
    log.warn(
      {
        code: 'platform_settings_flags_corruption',
        raw_count: rawCount,
        coerced_count: coerced.length,
        dropped: rawCount - coerced.length,
      },
      'getPlatformSettingsFlags: dropped malformed entries from the row',
    )
  }
  return sortFlags(coerced)
})