// getPlatformSettingsGeneral.ts — admin read of the General section
// of `platform_settings`.
//
// P14.12 (Platform settings editor — Slice 1). The page at
// `/admin/settings` reads this and renders a form so an admin can
// edit the 3 PHASES.md-resolves-STUB fields:
//   - default_royalty_pct_bps
//   - plr_subscriber_discount_pct_bps
//   - default_refund_window_days
// Plus 3 email-display fields (support_email, legal_email) that are
// read-only on this page (separate editors in Slices 2+).
//
// Service-role read so admin sees every column. Returns null when
// the row is missing or unreadable; the page falls back to defaults.
//
// Caching: wrapped in React.cache for per-request memoization.

import 'server-only'
import { cache } from 'react'
import { getServiceSupabase } from '@foundations/data/supabase'
import { loggerFor } from '@foundations/log/pino'
import {
  REFUND_WINDOW_DAYS,
  REFUND_WINDOW_DAYS_MIN,
  REFUND_WINDOW_DAYS_MAX,
} from '@foundations/money/refund-window'

const log = loggerFor({ component: 'admin.platform-settings.getGeneral' })

/** Canonical shape the editor + formatters consume. */
export type PlatformSettingsGeneral = {
  default_royalty_pct_bps: number
  plr_subscriber_discount_pct_bps: number
  default_refund_window_days: number
  default_currency: 'USD' | 'EUR' | 'GBP'
  support_email: string | null
  legal_email: string | null
  hero_title: string | null
  hero_subtitle: string | null
  /** ISO timestamp of the most recent edit. */
  updated_at: string
  /** Display name of the most recent admin editor (best-effort, may be null). */
  updated_by_display_name: string | null
}

type PlatformSettingsRow = {
  default_royalty_pct_bps: number | null
  plr_subscriber_discount_pct_bps: number | null
  default_refund_window_days: number | null
  default_currency: string | null
  support_email: string | null
  legal_email: string | null
  hero_title: string | null
  hero_subtitle: string | null
  updated_at: string | null
  updated_by: string | null
}

/** Defensive coercion for the 3 bps fields. Bad values fall back to
 *  the column default OR — for `default_refund_window_days` — the
 *  hard-coded constant. */
function coerceBps(v: unknown, fallback: number): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > 10000) {
    return fallback
  }
  return v
}

function coerceDays(v: unknown): number {
  if (
    typeof v !== 'number' ||
    !Number.isInteger(v) ||
    v < REFUND_WINDOW_DAYS_MIN ||
    v > REFUND_WINDOW_DAYS_MAX
  ) {
    return REFUND_WINDOW_DAYS
  }
  return v
}

function coerceCurrency(v: unknown): 'USD' | 'EUR' | 'GBP' {
  if (v === 'USD' || v === 'EUR' || v === 'GBP') return v
  return 'USD'
}

/** Read the platform_settings row + the latest editor's display name. */
export const getPlatformSettingsGeneral = cache(
  async function getPlatformSettingsGeneral(): Promise<PlatformSettingsGeneral | null> {
    const supabase = getServiceSupabase()
    const { data, error } = await supabase
      .from('platform_settings')
      .select(
        'default_royalty_pct_bps, plr_subscriber_discount_pct_bps, default_refund_window_days, default_currency, support_email, legal_email, hero_title, hero_subtitle, updated_at, updated_by',
      )
      .eq('id', 1)
      .maybeSingle()
    if (error) {
      log.warn(
        { code: 'platform_settings_read_failed', msg: error.message },
        'getPlatformSettingsGeneral: read failed',
      )
      return null
    }
    if (!data) return null
    const row = data as unknown as PlatformSettingsRow

    // Best-effort lookup of the last editor's display name. Fail-soft
    // to null (the page renders "Unknown" or hides the row).
    let updatedByDisplayName: string | null = null
    if (row.updated_by) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('display_name')
        .eq('id', row.updated_by)
        .maybeSingle()
      if (
        profile &&
        typeof (profile as unknown as { display_name?: unknown }).display_name === 'string'
      ) {
        updatedByDisplayName = (profile as unknown as { display_name: string }).display_name
      }
    }

    return {
      default_royalty_pct_bps: coerceBps(row.default_royalty_pct_bps, 3000),
      plr_subscriber_discount_pct_bps: coerceBps(row.plr_subscriber_discount_pct_bps, 1500),
      default_refund_window_days: coerceDays(row.default_refund_window_days),
      default_currency: coerceCurrency(row.default_currency),
      support_email: typeof row.support_email === 'string' ? row.support_email : null,
      legal_email: typeof row.legal_email === 'string' ? row.legal_email : null,
      hero_title: typeof row.hero_title === 'string' ? row.hero_title : null,
      hero_subtitle: typeof row.hero_subtitle === 'string' ? row.hero_subtitle : null,
      updated_at: typeof row.updated_at === 'string' ? row.updated_at : new Date().toISOString(),
      updated_by_display_name: updatedByDisplayName,
    }
  },
)