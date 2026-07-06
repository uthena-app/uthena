// Server-only helper for GDPR consent. Used by the consent action
// (PH11), the cookie banner (P11.2), the data-export route, the
// data-delete route, and the audit log.
//
// This file is marked `'use server'` — Next.js requires every export
// to be an async function. The `ConsentState` type + `DEFAULT_CONSENT`
// constant live in `./consent.types.ts` (a non-`'use server'` module)
// so they're importable from client islands + tests without dragging
// this server-only file into the client bundle.

'use server'

import { loggerFor } from '@foundations/log/pino'
import { getServiceSupabase } from '@foundations/data/supabase'
import type { ConsentState } from './consent.types'

export type { ConsentState }

/** Where the consent decision originated. Drives the banner decision's
 *  audit metadata + the analytics path (banner-originated events skip
 *  the geo-gating that explicit page visits don't). */
export type ConsentSource =
  | 'banner_accept_all'
  | 'banner_decline_non_essential'
  | 'banner_save_preferences'
  | 'page_save_preferences' // /cookie-preferences form (P11.1 surface)
  | 'gpc_auto_decline' // Browser sent Sec-GPC: 1
  | 'auto_default' // Banner never shown (geo header missing → "show all" → defaulted)

/** Optional metadata captured at decision time. Each field is purely
 *  diagnostic; none of it is required for the consent to be valid. */
export type ConsentMetadata = {
  /** Two-letter country code from the CDN's geo header (when present).
   *  Never stored when absent. */
  country?: string | null
  /** True when the request carried `Sec-GPC: 1` at decision time. */
  gpc?: boolean | null
  /** Where the decision came from. */
  source: ConsentSource
  /** Anon ID cookie value at decision time — used for the anon-paths
   *  attribution so two anonymous visitors on the same NAT'd IP don't
   *  collapse into one record. Null for signed-in decisions. */
  anonId?: string | null
}

const log = loggerFor({ component: 'gdpr' })

/** Record the user's consent decision. Idempotent (every call writes a
 *  new row — the audit trail is append-only). Fail-soft: a DB error
 *  logs a warn and returns false; the page-level action treats this as
 *  an unknown failure (the user-facing copy says "Could not save").
 *
 *  PII safety: the IP argument is hashed before insert by this helper
 *  (we never store the raw IP). The optional `anonId` is a UUID that
 *  we generated server-side — it's used to correlate the visitor's
 *  decisions across anonymous sessions, but is NOT personally
 *  identifying on its own (it expires in {@link ANON_ID_MAX_AGE_SECONDS}
 *  and never leaves our infra). The country + GPC flags are diagnostic
 *  metadata only. */
export async function recordConsent(
  userId: string | null,
  state: ConsentState,
  ip: string,
  userAgent: string,
  metadata: ConsentMetadata = { source: 'page_save_preferences' },
): Promise<{ ok: boolean }> {
  const supabase = getServiceSupabase()
  const { error } = await supabase.from('consent_log').insert({
    user_id: userId,
    analytics: state.analytics,
    marketing: state.marketing,
    ip_hash: hashIp(ip),
    user_agent: userAgent,
    country: metadata.country ?? null,
    gpc: metadata.gpc === true,
    source: metadata.source,
    anon_id: metadata.anonId ?? null,
  })
  if (error) {
    log.error({ error: error.message, source: metadata.source }, 'failed to record consent')
    return { ok: false }
  }
  log.info(
    {
      userId: userId ? 'present' : null,
      analytics: state.analytics,
      marketing: state.marketing,
      source: metadata.source,
      country: metadata.country ?? null,
      gpc: metadata.gpc === true,
    },
    'consent recorded',
  )
  return { ok: true }
}

/** Hash an IP for storage — we never store raw IPs in the consent log.
 *  Lightweight non-cryptographic hash (32-bit FNV-style). For real
 *  PII defense we'd HMAC with a server secret, but the bytes-on-disk
 *  goal (no raw IPv4 in the DB) is met here with zero infra. */
function hashIp(ip: string): string {
  let h = 0
  for (let i = 0; i < ip.length; i++) h = ((h << 5) - h + ip.charCodeAt(i)) | 0
  return `ip_${(h >>> 0).toString(16)}`
}
