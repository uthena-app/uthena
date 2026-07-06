// getDmcaAgent.ts — reads the DMCA designated agent's contact info
// from `platform_settings.dmca_agent`.
//
// The public read of this row is RLS-gated (`platform_settings_public_read`
// policy, requires `public_read = true`). The query projects ONLY the
// public-safe fields (name, email, mailing_address, phone) — never the
// admin-internal columns (`description`, `updated_by`, `updated_at`).
//
// This is the v1 replacement for the hard-coded placeholder block that
// previously lived in `04-platform/emails/legal/dmca.md`. Admins edit
// the value via `/admin/dmca-agent` (P10.4).
//
// Caching: the result is wrapped in `React.cache` so repeated calls
// within a single request hit the same memoized result. The `/dmca`
// page sets `revalidate = 86400` (24h ISR) at the route level — this
// query's cache() layer is the per-request optimization, not the
// long-term caching strategy.
//
// Returns `null` when the row is missing or malformed (defensive — the
// `/dmca` page falls back to a friendly "configure in admin" notice
// instead of crashing).
//
// Used by: app/dmca/page.tsx (public render).

import 'server-only'
import { cache } from 'react'
import { getServerSupabase } from '@foundations/data/supabase'
import { loggerFor } from '@foundations/log/pino'

const log = loggerFor({ component: 'legal.getDmcaAgent' })

export type DmcaAgentContact = {
  /** Designated agent's full legal name (per § 512(c)). */
  name: string
  /** Designated agent's email address. */
  email: string
  /** Designated agent's mailing address (per § 512(c) registration). */
  mailing_address: string
  /** Designated agent's phone number, optional — empty string when not set. */
  phone: string
}

/**
 * Read the DMCA designated agent contact from `platform_settings`.
 * Returns `null` when the row is missing, unreadable, or the JSONB
 * shape doesn't match the expected 4-field contract.
 *
 * Pure-ish (calls Supabase once). Cached per-request via React.cache.
 */
export const getDmcaAgent = cache(async function getDmcaAgent(): Promise<DmcaAgentContact | null> {
  const supabase = await getServerSupabase()

  // Project ONLY the public-safe columns. Admin-internal columns
  // (description, updated_by, updated_at) intentionally NEVER cross
  // the wire to a public caller — the public read code path is a
  // strict allowlist.
  const { data, error } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', 'dmca_agent')
    .eq('public_read', true)
    .maybeSingle()

  if (error) {
    // DB error — fail-closed. The /dmca page falls back to its
    // friendly "configure in admin" notice.
    log.warn(
      { code: 'dmca_agent_read_failed', msg: error.message },
      'getDmcaAgent: platform_settings read failed',
    )
    return null
  }

  if (!data) {
    // Row missing or public_read flipped off. The migration seeds a
    // default row, so this branch only fires on a freshly-provisioned
    // environment before the seed ran, or if an admin deliberately
    // hid the row. Either way: null is the correct response.
    log.info({ code: 'dmca_agent_row_missing' }, 'getDmcaAgent: dmca_agent row missing or hidden')
    return null
  }

  // The `value` column is jsonb; PostgREST returns parsed JSON. We
  // coerce defensively: a row with a malformed value (e.g. someone
  // hand-edited it to a string or a number) must not crash the page.
  const raw = data.value as unknown
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    log.warn(
      { code: 'dmca_agent_bad_shape', actualType: Array.isArray(raw) ? 'array' : typeof raw },
      'getDmcaAgent: dmca_agent value is not an object',
    )
    return null
  }

  const obj = raw as Record<string, unknown>

  // Required: name + email + mailing_address. These are non-empty
  // strings per the spec's acceptance criterion. Empty values fail
  // closed so the page can render the "configure in admin" fallback
  // rather than show a half-filled card.
  const name = typeof obj.name === 'string' ? obj.name.trim() : ''
  const email = typeof obj.email === 'string' ? obj.email.trim() : ''
  const mailing = typeof obj.mailing_address === 'string' ? obj.mailing_address.trim() : ''
  const phone = typeof obj.phone === 'string' ? obj.phone.trim() : ''

  if (!name || !email || !mailing) {
    log.warn(
      { code: 'dmca_agent_required_missing', hasName: !!name, hasEmail: !!email, hasMailing: !!mailing },
      'getDmcaAgent: dmca_agent is missing a required field',
    )
    return null
  }

  return {
    name,
    email,
    mailing_address: mailing,
    phone,
  }
})