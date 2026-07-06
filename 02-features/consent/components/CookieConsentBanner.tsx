// CookieConsentBanner.tsx — P11.2 client island for the GDPR /
// ePrivacy cookie-consent banner.
//
// Mounted once per page in the root layout. Renders ONLY when
// `getConsentBannerState` resolves `showBanner: true`. Otherwise the
// island returns null and adds zero layout.
//
// Three primary actions:
//   1. Accept all        → analytics=true, marketing=true
//   2. Decline non-essential → analytics=false, marketing=false
//   3. Customize         → toggles reveal (analytics + marketing) +
//                           "Save preferences" button. The toggles
//                           default to whatever the visitor just had
//                           (always off for fresh visitors, since
//                           `essential=true` is forced server-side).
//
// The "Customize" affordance is intentionally the same surface the
// /cookie-preferences page exposes (P11.1), so the visitor's mental
// model is consistent regardless of which entry point they used.
//
// Server trust boundary: every action calls `recordBannerDecisionAction`
// which performs the Zod validation + consent_log write server-side.
// We don't trust the client to enforce the source enum — the server
// schema enforces it.
//
// Focus: the dialog opens with focus on the primary button. ESC does
// NOT dismiss the banner (the visitor must make an explicit choice —
// GDPR requires unambiguous consent). The footer link to /privacy is
// the canonical "I want more info" path.

'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  recordBannerDecisionAction,
  type RecordBannerDecisionResult,
} from '../actions/recordBannerDecision'
import { dispatchConsentChanged } from '../lib/consentEvents'
import styles from './CookieConsentBanner.module.css'

export type CookieConsentBannerProps = {
  /** The `getConsentBannerState` projection. The banner only renders
   *  when `showBanner` is true — but we receive the full shape so the
   *  island doesn't have to recompute the geo/gpc classification
   *  client-side. */
  bannerState: {
    showBanner: boolean
    gpcActive: boolean
    euRegion: boolean | null
    hasPriorDecision: boolean
    consent: { essential: true; analytics: boolean; marketing: boolean }
    reason:
      | 'gpc_active'
      | 'prior_decision_user'
      | 'prior_decision_anon_id'
      | 'show_eu_geo'
      | 'show_unknown_geo'
      | 'hide_non_eu_geo'
  }
  /** When true, the controls render in the "expanded toggles" form on
   *  first paint (instead of the three-button summary). The parent
   *  sets this when re-rendering after the user clicked Customize.
   *  Most invocations start with the summary form and let the user
   *  expand. */
  initiallyExpanded?: boolean
}

const COPY = {
  /** Default copy shown above the toggle row when no special reason
   *  applies. */
  body: 'We use cookies to keep you signed in, remember your cart, and (with your permission) understand how the site is used so we can improve it. Choose what you’re OK with below.',
  /** Shortened copy shown when the visitor is in the EU AND has the
   *  /privacy page one click away. */
  bodyEu: 'You’re in the EU — GDPR + ePrivacy require us to ask before using anything but essential cookies. You can change this anytime via the footer link.',
  customizeAria: 'Show custom toggle preferences',
  acceptAll: 'Accept all',
  decline: 'Decline non-essential',
  customize: 'Customize',
  save: 'Save preferences',
  manageLink: 'Manage cookie preferences',
}

export function CookieConsentBanner({
  bannerState,
  initiallyExpanded = false,
}: CookieConsentBannerProps) {
  const router = useRouter()
  const cardRef = useRef<HTMLDivElement | null>(null)
  const primaryRef = useRef<HTMLButtonElement | null>(null)
  const [pending, setPending] = useState(false)
  const [expanded, setExpanded] = useState(initiallyExpanded)
  // Local optimistic copy of the toggles. Initialized to the resolved
  // state (analytics=false, marketing=false for fresh visitors). The
  // server is the source of truth on save — these only become the
  // persisted state after `recordBannerDecisionAction` returns ok.
  const [analytics, setAnalytics] = useState(bannerState.consent.analytics)
  const [marketing, setMarketing] = useState(bannerState.consent.marketing)
  const [error, setError] = useState<string | null>(null)

  // Focus the primary button when the dialog mounts. The reason this
  // matters: after the server decides to render the banner, the
  // visitor's first tab should land on "Accept all" (or "Save" when
  // expanded) so keyboard users don't have to hunt for the focus.
  useEffect(() => {
    if (!bannerState.showBanner) return
    primaryRef.current?.focus()
  }, [bannerState.showBanner])

  const submitDecision = useCallback(
    async (decision: { analytics: boolean; marketing: boolean; source: string }) => {
      if (pending) return
      setError(null)
      setPending(true)
      const result: RecordBannerDecisionResult = await recordBannerDecisionAction({
        analytics: decision.analytics,
        marketing: decision.marketing,
        source: decision.source,
      })
      setPending(false)
      if (!result.ok) {
        setError(
          result.error === 'invalid_input'
            ? 'Please review your selections.'
            : 'Could not save your preferences. Please try again.',
        )
        return
      }
      // P11.3: notify the consent-aware analytics bridge (and any
      // future subscribers) on the same tick — when the user clicks
      // "Decline non-essential" the PostHog SDK flips to opt-out
      // immediately, not on the next RSC refresh.
      dispatchConsentChanged(result.decision)
      // Refresh the route so the layout re-resolves the next render
      // with `showBanner=false` (the prior decision is now in
      // consent_log). Reload via router.refresh — `revalidatePath('/',
      // 'layout')` already nuked the layout cache server-side.
      router.refresh()
    },
    [pending, router],
  )

  if (!bannerState.showBanner) {
    return null
  }

  const reason = bannerState.reason

  return (
    <div
      className={styles.dialog}
      role="presentation"
      data-cookie-banner="root"
      data-banner-reason={reason}
    >
      <div
        ref={cardRef}
        className={styles.card}
        role="dialog"
        aria-modal="false"
        aria-labelledby="cookie-banner-title"
        aria-describedby="cookie-banner-body"
      >
        <p className={styles.eyebrow}>Cookie preferences</p>
        <h2 id="cookie-banner-title" className={styles.title}>
          Choose your cookies
        </h2>
        <p id="cookie-banner-body" className={styles.copy}>
          {reason === 'show_eu_geo' ? COPY.bodyEu : COPY.body}
          {' '}Read our{' '}
          <a href="/privacy">Privacy Policy</a> for the full picture.
        </p>

        {expanded ? (
          <fieldset className={styles.toggles} disabled={pending}>
            <legend className={styles.srOnly}>Cookie categories</legend>

            <div className={styles.toggleRow} data-locked="true">
              <label>
                <span className={styles.toggleName}>Essential</span>
                <span className={styles.toggleHint}>Always on — required for the site to function.</span>
              </label>
              <span aria-hidden className={styles.lockedOn}>
                On
              </span>
            </div>

            <div className={styles.toggleRow}>
              <label>
                <span className={styles.toggleName}>Analytics</span>
                <span className={styles.toggleHint}>PostHog (EU-hosted) — page views + click events.</span>
              </label>
              <input
                type="checkbox"
                role="switch"
                aria-checked={analytics}
                checked={analytics}
                onChange={(e) => setAnalytics(e.target.checked)}
              />
            </div>

            <div className={styles.toggleRow}>
              <label>
                <span className={styles.toggleName}>Marketing</span>
                <span className={styles.toggleHint}>Reserved category — no scripts are loaded today.</span>
              </label>
              <input
                type="checkbox"
                role="switch"
                aria-checked={marketing}
                checked={marketing}
                onChange={(e) => setMarketing(e.target.checked)}
              />
            </div>
          </fieldset>
        ) : null}

        {error ? (
          <div role="alert" className={styles.error}>
            {error}
          </div>
        ) : null}

        <div className={styles.actions}>
          {expanded ? (
            <>
              <button
                ref={primaryRef}
                type="button"
                className={styles.primary}
                disabled={pending}
                onClick={() => submitDecision({ analytics, marketing, source: 'banner_save_preferences' })}
              >
                {pending ? 'Saving…' : COPY.save}
              </button>
              <button
                type="button"
                className={styles.secondary}
                disabled={pending}
                onClick={() => {
                  setExpanded(false)
                  setError(null)
                }}
              >
                Back
              </button>
            </>
          ) : (
            <>
              <button
                ref={primaryRef}
                type="button"
                className={styles.primary}
                disabled={pending}
                onClick={() =>
                  submitDecision({ analytics: true, marketing: true, source: 'banner_accept_all' })
                }
              >
                {pending ? 'Saving…' : COPY.acceptAll}
              </button>
              <button
                type="button"
                className={styles.secondary}
                disabled={pending}
                onClick={() =>
                  submitDecision({
                    analytics: false,
                    marketing: false,
                    source: 'banner_decline_non_essential',
                  })
                }
              >
                {COPY.decline}
              </button>
              <button
                type="button"
                className={styles.secondary}
                disabled={pending}
                aria-expanded={expanded}
                aria-controls="cookie-banner-toggles"
                onClick={() => setExpanded(true)}
              >
                {COPY.customize}
              </button>
            </>
          )}
        </div>

        <p className={styles.footnote}>
          Prefer the full page?{' '}
          <a href="/cookie-preferences">{COPY.manageLink}</a>.
        </p>
      </div>
    </div>
  )
}
