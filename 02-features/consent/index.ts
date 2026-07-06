// Barrel export for the consent feature. Public API:
//   - getCurrentConsent (P11.1 server query)
//   - updateConsentAction (P11.1 server action)
//   - CookiePreferencesForm (P11.1 client island)
//   - getConsentBannerState (P11.2 server query — banner visibility)
//   - recordBannerDecisionAction (P11.2 server action)
//   - CookieConsentBanner (P11.2 client island)
//   - ConsentAwareAnalytics (P11.3 client island — wires consent to PostHog)
//   - consentEvents (P11.3 — shared event constant + dispatch helper)
//
// Server-side callers import the query + action; client components
// import only the form + banner. No re-exports of internal helpers —
// keep the surface minimal so callers don't accidentally bypass the
// wrapper functions.

export { getCurrentConsent } from './queries/getCurrentConsent'
export type { GetCurrentConsentResult } from './queries/getCurrentConsent'

export { getConsentBannerState } from './queries/getConsentBannerState'
export type { GetConsentBannerStateResult } from './queries/getConsentBannerState'

export { updateConsentAction } from './actions/updateConsent'
export type { UpdateConsentResult } from './actions/updateConsent'

export { recordBannerDecisionAction } from './actions/recordBannerDecision'
export type { RecordBannerDecisionResult } from './actions/recordBannerDecision'

export { CookiePreferencesForm } from './components/CookiePreferencesForm'
export type {
  CookiePreferencesFormProps,
  ConsentToggleState,
} from './components/CookiePreferencesForm'

export { CookieConsentBanner } from './components/CookieConsentBanner'
export type { CookieConsentBannerProps } from './components/CookieConsentBanner'

export { ConsentAwareAnalytics } from './components/ConsentAwareAnalytics'
export type { ConsentAwareAnalyticsProps } from './components/ConsentAwareAnalytics'

export {
  CONSENT_CHANGED_EVENT,
  dispatchConsentChanged,
} from './lib/consentEvents'
export type { ConsentChangedDetail } from './lib/consentEvents'
