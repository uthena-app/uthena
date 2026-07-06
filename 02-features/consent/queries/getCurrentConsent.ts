// getCurrentConsent.ts — read the user's most-recent cookie-consent
// decision from `consent_log`.
//
// P11.1 spec: the page at `/cookie-preferences` needs to show the user's
// existing toggles so they're not starting from scratch every visit.
// The canonical source is `consent_log` (the audit trail of every consent
// change). We read the latest row for the current user and project it
// down to the toggle shape the UI needs.
//
// Anon path: consent_log rows with `user_id = NULL` would be visible
// to every anon via the `consent_log_self_read` policy, so we
// intentionally do NOT read for anon users. Anon visitors see
// `DEFAULT_CONSENT` (essential on, analytics off, marketing off) —
// their preferences live in client state (cookie / localStorage) until
// P11.2 wires the banner + anon ID cookie.
//
// PII safety: this query only ever selects the boolean columns. It
// never selects `ip_hash`, `user_agent`, or `id` — those are
// admin-internal. Even if the query is logged, the log payload is just
// a `present: boolean` flag.

'use server'

import { loggerFor } from '@foundations/log/pino'
import { getServerSupabase } from '@foundations/data/supabase'
import { DEFAULT_CONSENT } from '@foundations/gdpr/consent.types'
import type { ConsentState } from '@foundations/gdpr/consent.types'

const log = loggerFor({ component: 'consent.getCurrent' })

export type GetCurrentConsentResult =
  | { ok: true; consent: ConsentState; hasRecord: boolean }
  | { ok: false; error: 'unknown' }

/** Read the latest consent decision for the signed-in user. Returns
 *  `DEFAULT_CONSENT` + `hasRecord: false` for anon visitors and for
 *  signed-in users with no prior consent row. The query is
 *  fail-soft: a DB error → `DEFAULT_CONSENT` + `hasRecord: false`
 *  (the page renders the default state, not an error block — losing
 *  your last saved preference is not a page-fatal event). */
export async function getCurrentConsent(): Promise<GetCurrentConsentResult> {
  const supabase = await getServerSupabase()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  // Anon: no server-side read (see file header). The UI uses the
  // default state and a "Sign in to save across devices" hint.
  if (!user) {
    return { ok: true, consent: { ...DEFAULT_CONSENT }, hasRecord: false }
  }

  const { data, error } = await supabase
    .from('consent_log')
    .select('analytics, marketing, created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    log.warn({ code: 'consent_read_failed', msg: error.message }, 'consent read failed')
    return { ok: true, consent: { ...DEFAULT_CONSENT }, hasRecord: false }
  }

  if (!data) {
    return { ok: true, consent: { ...DEFAULT_CONSENT }, hasRecord: false }
  }

  // Defensive coercion: if a row exists but one of the booleans is
  // nullish (shouldn't happen — the schema is NOT NULL — but defensive
  // mapping is cheaper than a 500), fall back to the safe default for
  // that single field. essential is always true (the schema locks it).
  const analytics = typeof data.analytics === 'boolean' ? data.analytics : DEFAULT_CONSENT.analytics
  const marketing = typeof data.marketing === 'boolean' ? data.marketing : DEFAULT_CONSENT.marketing

  return {
    ok: true,
    consent: { essential: true, analytics, marketing },
    hasRecord: true,
  }
}