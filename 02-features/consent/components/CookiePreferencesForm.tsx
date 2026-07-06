// CookiePreferencesForm.tsx — client island for the granular cookie
// consent toggles on /cookie-preferences.
//
// Two toggles the user can flip (analytics + marketing). Essential is
// always-on with a locked badge — it can't be turned off because the
// site depends on those cookies for cart, auth, etc. Each toggle has
// a one-line description of what data the category collects so the
// user can make an informed decision (GDPR Art. 7 + ePrivacy Directive).
//
// The form is a thin shell around the `updateConsentAction` server
// action. State flow:
//   - `state` holds the local optimistic copy of the consent state
//   - On submit, `pending = true`, the action runs, then either the
//     returned consent is applied to local state OR the error is
//     shown inline with the previous state restored.
//   - The "Save preferences" button is enabled when the form differs
//     from the server-known initial state (so the user doesn't have
//     to save a no-op).
//
// We deliberately DO NOT auto-save on toggle change. The banner-style
// UX of "flip and forget" leaks unconfirmed choices; this form is
// explicit and stores only on Save.

'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { updateConsentAction, type UpdateConsentResult } from '../actions/updateConsent'
import { dispatchConsentChanged } from '../lib/consentEvents'
import styles from './CookiePreferencesForm.module.css'

export type ConsentToggleState = {
  essential: true
  analytics: boolean
  marketing: boolean
}

export type CookiePreferencesFormProps = {
  initial: ConsentToggleState
  /** True when the user has a prior consent row. False for first-time
   *  visitors + anon users (defaults are shown but not yet "theirs"). */
  hasRecord: boolean
  /** True when the user is signed in. Drives the hint copy under the
   *  form ("saved to your account" vs "stored on this device only"). */
  signedIn: boolean
}

export function CookiePreferencesForm({
  initial,
  hasRecord,
  signedIn,
}: CookiePreferencesFormProps) {
  const router = useRouter()
  const [state, setState] = useState<ConsentToggleState>(initial)
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<Date | null>(hasRecord ? new Date() : null)

  // Dirty when the form differs from the initial state.
  const isDirty = state.analytics !== initial.analytics || state.marketing !== initial.marketing
  const canSave = isDirty && !pending

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSave) return
    setError(null)
    startTransition(async () => {
      const result: UpdateConsentResult = await updateConsentAction({
        analytics: state.analytics,
        marketing: state.marketing,
      })
      if (!result.ok) {
        setError(result.error === 'invalid_input' ? 'Please review your selections.' : 'Could not save your preferences. Please try again.')
        // Revert local state to the last known server-side value.
        setState(initial)
        return
      }
      // Sync local copy to the server's confirmed state.
      setState(result.consent)
      setSavedAt(new Date())
      // P11.3: notify the consent-aware analytics bridge (and any
      // future subscribers) on the same tick — the user's cookie
      // consent just changed and PostHog needs to flip opt-in/out
      // immediately, not wait for the next RSC refresh.
      dispatchConsentChanged(result.consent)
      // Refresh the route so any RSC consumers (the footer banner copy
      // in a future tick, the privacy page summary, etc.) pick up
      // the change.
      router.refresh()
    })
  }

  const onReset = () => {
    setState(initial)
    setError(null)
  }

  return (
    <form className={styles.form} onSubmit={onSubmit} noValidate>
      <fieldset className={styles.fieldset} disabled={pending}>
        <legend className={styles.srOnly}>Cookie categories</legend>

        {/* Essential — always on, locked. */}
        <div className={styles.row} data-locked="true">
          <div className={styles.rowMain}>
            <div className={styles.rowHead}>
              <h3 className={styles.rowTitle}>Essential</h3>
              <span className={styles.lockedBadge} aria-label="Always on">Always on</span>
            </div>
            <p className={styles.rowDesc}>
              Required for the site to function. Includes your session cookie, cart cookie,
              security tokens, and CSRF protection. These cannot be turned off.
            </p>
          </div>
          <div className={styles.toggleSlot} aria-hidden>
            <span className={styles.toggleOnLocked} />
          </div>
        </div>

        {/* Analytics — user-toggleable. */}
        <div className={styles.row}>
          <div className={styles.rowMain}>
            <div className={styles.rowHead}>
              <h3 className={styles.rowTitle}>Analytics</h3>
              <span className={styles.tagOff} data-on={state.analytics}>Off</span>
            </div>
            <p className={styles.rowDesc}>
              Helps us understand how visitors use the site so we can improve it. We use
              PostHog (EU-hosted) to collect page views, click events, and anonymized
              session recordings. No personally identifiable information is sent.
            </p>
          </div>
          <label className={styles.toggleLabel}>
            <span className={styles.srOnly}>Analytics cookies</span>
            <input
              type="checkbox"
              role="switch"
              aria-checked={state.analytics}
              checked={state.analytics}
              onChange={(e) => setState((s) => ({ ...s, analytics: e.target.checked }))}
              className={styles.toggleInput}
            />
            <span className={styles.toggle} data-on={state.analytics} aria-hidden />
          </label>
        </div>

        {/* Marketing — user-toggleable. Reserved category. */}
        <div className={styles.row}>
          <div className={styles.rowMain}>
            <div className={styles.rowHead}>
              <h3 className={styles.rowTitle}>Marketing</h3>
              <span className={styles.tagOff} data-on={state.marketing}>Off</span>
            </div>
            <p className={styles.rowDesc}>
              Reserved for future ad-network integrations (Meta Pixel, Google Ads conversion
              tracking, affiliate redirect attribution). No marketing scripts are loaded
              today. Turning this on now keeps your preference saved for when they are.
            </p>
          </div>
          <label className={styles.toggleLabel}>
            <span className={styles.srOnly}>Marketing cookies</span>
            <input
              type="checkbox"
              role="switch"
              aria-checked={state.marketing}
              checked={state.marketing}
              onChange={(e) => setState((s) => ({ ...s, marketing: e.target.checked }))}
              className={styles.toggleInput}
            />
            <span className={styles.toggle} data-on={state.marketing} aria-hidden />
          </label>
        </div>
      </fieldset>

      {error ? (
        <div role="alert" className={styles.error}>
          {error}
        </div>
      ) : null}

      <div className={styles.actions}>
        <button type="submit" className={styles.submit} disabled={!canSave} aria-busy={pending}>
          {pending ? 'Saving…' : 'Save preferences'}
        </button>
        <button
          type="button"
          className={styles.reset}
          onClick={onReset}
          disabled={!isDirty || pending}
        >
          Reset
        </button>
      </div>

      <p className={styles.footnote}>
        {signedIn ? (
          <>
            Your preferences are saved to your account and apply across every device where
            you sign in.
          </>
        ) : (
          <>
            You aren&apos;t signed in, so your preferences are stored with a hashed
            identifier on this device. <a className={styles.inlineLink} href="/login?next=/cookie-preferences">Sign in</a> to save them to your account.
          </>
        )}
        {savedAt ? (
          <>
            {' '}Last saved {formatSavedAt(savedAt)}.
          </>
        ) : null}
      </p>
    </form>
  )
}

function formatSavedAt(d: Date): string {
  // Tiny, server-safe relative formatter — we already use this helper
  // elsewhere; keep it self-contained here so the island doesn't pull
  // a server-only module.
  const diffMs = Date.now() - d.getTime()
  const sec = Math.round(diffMs / 1000)
  if (sec < 60) return 'just now'
  const min = Math.round(sec / 60)
  if (min < 60) return `${min} minute${min === 1 ? '' : 's'} ago`
  const hr = Math.round(min / 60)
  if (hr < 24) return `${hr} hour${hr === 1 ? '' : 's'} ago`
  const day = Math.round(hr / 24)
  return `${day} day${day === 1 ? '' : 's'} ago`
}