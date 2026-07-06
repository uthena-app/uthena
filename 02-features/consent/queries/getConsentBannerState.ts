// getConsentBannerState.ts — server query that decides whether the
// P11.2 cookie banner should render for the current request.
//
// Combines three signals (in priority order, highest first):
//
//   1. **GPC active** — when the request carries `Sec-GPC: 1`, we
//      auto-decline any non-essential categories. We DON'T show the
//      banner (the visitor has already declined). The state echoes the
//      declined default so the rest of the app (PostHog init) can
//      react without a second roundtrip.
//
//   2. **Prior decision exists** — when the user (or their anon ID)
//      has a row in `consent_log`, the banner is unnecessary. We
//      project the latest row's toggles into the same shape as the
//      page-level `getCurrentConsent` so the rest of the app stays
//      consistent.
//
//   3. **Geo classification** — when no prior decision exists:
//        * EU/EEA/UK/CH country → show the banner.
//        * Unknown country (geo header absent) → also show the
//          banner (the PHASES.md P11.2 contract: "fall-back to show
//          to all" — the safe default under GDPR).
//        * Non-EU country → DON'T show the banner (GDPR doesn't
//          apply; the analytics surface can run by default until
//          the user opts out via /cookie-preferences).
//
// The query is fail-soft at every layer:
//   - Missing headers → empty `Headers` (the helpers handle null).
//   - Auth/supabase errors → `DEFAULT_CONSENT` + don't show banner.
//   - DB errors while looking up the prior decision → no record
//     found → fall through to the geo classification.
//
// PII safety: the projection NEVER includes `ip_hash`, `user_agent`,
// or row `id`. Only the toggle shape + a few diagnostic flags.

'use server'

import { headers } from 'next/headers'
import { getServerSupabase } from '@foundations/data/supabase'
import { DEFAULT_CONSENT } from '@foundations/gdpr/consent.types'
import type { ConsentState } from '@foundations/gdpr/consent.types'
import { isGpcEnabled, isEuCountryCode, readCountryFromHeaders } from '@foundations/gdpr/geo'
import { loggerFor } from '@foundations/log/pino'
import { readAnonId } from '@foundations/gdpr/anon-id'

const log = loggerFor({ component: 'consent.getBannerState' })

export type GetConsentBannerStateResult = {
  /** True when `<CookieConsentBanner>` should render its UI right now. */
  showBanner: boolean
  /** True when the request carried `Sec-GPC: 1` (regardless of
   *  whether we also showed the banner — the GPC flag is sticky
   *  through the lifetime of the request so other surfaces can
   *  honor it). */
  gpcActive: boolean
  /** True when the resolved country is in the EU/EEA/UK/CH set. When
   *  the geo header is absent, this is null (not false — we want to
   *  distinguish "definitely not EU" from "couldn't tell"). */
  euRegion: boolean | null
  /** True when a prior `consent_log` row exists for this user (or
   *  their anon id). When true the banner won't render. */
  hasPriorDecision: boolean
  /** The latest known decision (or `DEFAULT_CONSENT` for fresh
   *  visitors). Always includes `essential: true`. */
  consent: ConsentState
  /** Why the banner-state was resolved to its current shape. Useful
   *  for telemetry + E2E assertions. */
  reason:
    | 'gpc_active'
    | 'prior_decision_user'
    | 'prior_decision_anon_id'
    | 'show_eu_geo'
    | 'show_unknown_geo'
    | 'hide_non_eu_geo'
}

/** Inspect the headers + the visitor's consent_log to decide whether
 *  the cookie banner should render, and project the latest decision
 *  so the page can render consistently with `getCurrentConsent`. */
export async function getConsentBannerState(): Promise<GetConsentBannerStateResult> {
  let headersList: Headers
  try {
    headersList = await headers()
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown'
    log.warn({ code: 'banner_headers_failed', msg }, 'failed to read headers for banner state')
    headersList = new Headers()
  }

  const gpc = isGpcEnabled(headersList)
  const country = readCountryFromHeaders(headersList)
  const euResolved = country ? isEuCountryCode(country) : null

  // GPC short-circuit: auto-decline, no banner.
  if (gpc) {
    return {
      showBanner: false,
      gpcActive: true,
      euRegion: euResolved,
      hasPriorDecision: false,
      consent: { essential: true, analytics: false, marketing: false },
      reason: 'gpc_active',
    }
  }

  // Look for a prior decision: prefers the signed-in user; falls back
  // to the anon_id cookie for the anonymous visitor so two visitors
  // on the same NAT'd IP don't appear as one.
  try {
    const supabase = await getServerSupabase()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (user) {
      const { data, error } = await supabase
        .from('consent_log')
        .select('analytics, marketing')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (!error && data) {
        const analytics =
          typeof data.analytics === 'boolean' ? data.analytics : DEFAULT_CONSENT.analytics
        const marketing =
          typeof data.marketing === 'boolean' ? data.marketing : DEFAULT_CONSENT.marketing
        return {
          showBanner: false,
          gpcActive: false,
          euRegion: euResolved,
          hasPriorDecision: true,
          consent: { essential: true, analytics, marketing },
          reason: 'prior_decision_user',
        }
      }
    }

    const anonId = await readAnonId()
    if (anonId) {
      const { data, error } = await supabase
        .from('consent_log')
        .select('analytics, marketing')
        .eq('anon_id', anonId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (!error && data) {
        const analytics =
          typeof data.analytics === 'boolean' ? data.analytics : DEFAULT_CONSENT.analytics
        const marketing =
          typeof data.marketing === 'boolean' ? data.marketing : DEFAULT_CONSENT.marketing
        return {
          showBanner: false,
          gpcActive: false,
          euRegion: euResolved,
          hasPriorDecision: true,
          consent: { essential: true, analytics, marketing },
          reason: 'prior_decision_anon_id',
        }
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown'
    log.warn({ code: 'banner_lookup_failed', msg }, 'consent_log lookup failed; falling through to geo gate')
  }

  // No prior decision — fall back to the geo gate.
  if (euResolved === true) {
    return {
      showBanner: true,
      gpcActive: false,
      euRegion: true,
      hasPriorDecision: false,
      consent: { ...DEFAULT_CONSENT },
      reason: 'show_eu_geo',
    }
  }
  if (euResolved === null) {
    return {
      showBanner: true,
      gpcActive: false,
      euRegion: null,
      hasPriorDecision: false,
      consent: { ...DEFAULT_CONSENT },
      reason: 'show_unknown_geo',
    }
  }
  return {
    showBanner: false,
    gpcActive: false,
    euRegion: false,
    hasPriorDecision: false,
    consent: { ...DEFAULT_CONSENT },
    reason: 'hide_non_eu_geo',
  }
}
