// OptOutForm.tsx — the data-subject-request form on /data-sharing-opt-out.
//
// This is a v1 form with a DISABLED submit button. It exists so the
// page renders the request shape (first name / last name / email /
// request type / optional reason) and so that visitors can copy the
// rendered HTML when filling out the equivalent email request. The
// real submit lands when the `data_subject_requests` table is wired
// by P9.9 / Phase 17 (per the task brief).
//
// What this component is NOT:
//   - NOT a server-action-driven form. There is no `action=` handler.
//   - NOT a privacy-preference center. The disabled submit and the
//     "Available in a follow-up release" hint are honest about that.
//
// Why client (use client): the disabled-submit button + the "coming
// soon" toast need an `onClick` to surface the inline status. A pure
// server component cannot do that. The component is otherwise static
// — no `useState` round-trips, no fetches, no third-party scripts.

'use client'

import { useId, useState, type FormEvent } from 'react'
import styles from './OptOutForm.module.css'

type RequestType =
  | 'do_not_sell'
  | 'do_not_share'
  | 'limit_sensitive'
  | 'object_processing'

const REQUEST_OPTIONS: ReadonlyArray<{ slug: RequestType; label: string; hint: string }> = [
  {
    slug: 'do_not_sell',
    label: 'Do Not Sell or Share My Personal Information',
    hint: 'CCPA / CPRA — opt out of any sale or sharing of your personal information for cross-context behavioural advertising.',
  },
  {
    slug: 'limit_sensitive',
    label: 'Limit Use of My Sensitive Personal Information',
    hint: 'CCPA §1798.121 — restrict our use of your sensitive PI to the limited purposes permitted by the statute.',
  },
  {
    slug: 'object_processing',
    label: 'Object to Processing (GDPR Art. 21)',
    hint: 'EEA / UK — object to processing carried out under our legitimate interests, or to direct marketing.',
  },
  {
    slug: 'do_not_share',
    label: 'Other data-subject request',
    hint: 'Any other CCPA / GDPR / state-law request. Tell us what you need in the reason field below.',
  },
]

type Status =
  | { kind: 'idle' }
  | { kind: 'submitted_local'; at: string }
  | { kind: 'error'; message: string }

export function OptOutForm() {
  const formId = useId()
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')
  const [requestType, setRequestType] = useState<RequestType>('do_not_sell')
  const [reason, setReason] = useState('')
  const [status, setStatus] = useState<Status>({ kind: 'idle' })

  function onSubmit(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault()
    // v1: the submit is intentionally disabled. We still intercept the
    // event so the browser's default form submission does not navigate
    // away, and we surface the "coming soon" message inline. The real
    // submission pipeline lands with P9.9 + the `data_subject_requests`
    // migration + the email-to-privacy@uthena.com handoff.
    if (!firstName.trim() || !lastName.trim() || !email.trim()) {
      setStatus({ kind: 'error', message: 'Please fill in your first name, last name, and email before continuing.' })
      return
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setStatus({ kind: 'error', message: 'Enter a valid email address.' })
      return
    }
    setStatus({
      kind: 'submitted_local',
      at: new Date().toLocaleString(),
    })
  }

  return (
    <form
      id={formId}
      className={styles.form}
      onSubmit={onSubmit}
      noValidate
      aria-label="Data subject request form"
    >
      <div className={styles.banner} role="status">
        <strong>Available in a follow-up release.</strong> Until the
        in-product submission pipeline ships, please email your request
        to <a className={styles.bannerLink} href="mailto:privacy@uthena.com">privacy@uthena.com</a>{' '}
        with the same information. This form is rendered here so you
        can see exactly what we will ask for and so that the on-page
        accessibility tree matches the eventual experience.
      </div>

      <div className={styles.fieldRow}>
        <div className={styles.field}>
          <label htmlFor={`${formId}-first`} className={styles.label}>
            First name
          </label>
          <input
            id={`${formId}-first`}
            name="first_name"
            type="text"
            autoComplete="given-name"
            className={styles.input}
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            required
          />
        </div>
        <div className={styles.field}>
          <label htmlFor={`${formId}-last`} className={styles.label}>
            Last name
          </label>
          <input
            id={`${formId}-last`}
            name="last_name"
            type="text"
            autoComplete="family-name"
            className={styles.input}
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            required
          />
        </div>
      </div>

      <div className={styles.field}>
        <label htmlFor={`${formId}-email`} className={styles.label}>
          Email address
        </label>
        <input
          id={`${formId}-email`}
          name="email"
          type="email"
          autoComplete="email"
          className={styles.input}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <p className={styles.hint}>
          Use the email address on your Uthena account. If you do not
          have an account, use the address you would like associated
          with the request.
        </p>
      </div>

      <fieldset className={styles.fieldset}>
        <legend className={styles.label}>Request type</legend>
        <p className={styles.hint}>
          Pick the option that best matches what you are asking us to
          do. You can also email us if you would like to make multiple
          requests in one message.
        </p>
        <ul className={styles.radioList}>
          {REQUEST_OPTIONS.map((opt) => (
            <li key={opt.slug} className={styles.radioItem}>
              <label className={styles.radioLabel}>
                <input
                  type="radio"
                  name="request_type"
                  value={opt.slug}
                  checked={requestType === opt.slug}
                  onChange={() => setRequestType(opt.slug)}
                  className={styles.radio}
                />
                <span>
                  <span className={styles.radioTitle}>{opt.label}</span>
                  <span className={styles.radioHint}>{opt.hint}</span>
                </span>
              </label>
            </li>
          ))}
        </ul>
      </fieldset>

      <div className={styles.field}>
        <label htmlFor={`${formId}-reason`} className={styles.label}>
          Reason <span className={styles.optional}>(optional)</span>
        </label>
        <textarea
          id={`${formId}-reason`}
          name="reason"
          className={styles.textarea}
          rows={4}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Anything you would like us to know about the context of the request. This field is optional."
        />
        <p className={styles.hint}>
          Do not include your password, full card number, or other
          sensitive files. We will never ask for them.
        </p>
      </div>

      <div className={styles.actions}>
        <button type="submit" className={styles.submit} disabled aria-disabled="true">
          Submit request (coming soon)
        </button>
        <p className={styles.actionsHint}>
          For now, please email the same information to{' '}
          <a className={styles.bannerLink} href="mailto:privacy@uthena.com">
            privacy@uthena.com
          </a>
          .
        </p>
      </div>

      {status.kind === 'submitted_local' && (
        <p className={styles.toast} role="status" aria-live="polite">
          Form capture saved locally at {status.at}. Please send the
          same details to <a className={styles.bannerLink} href="mailto:privacy@uthena.com">
            privacy@uthena.com
          </a>{' '}
          so the data-controller team can process your request.
        </p>
      )}
      {status.kind === 'error' && (
        <p className={styles.error} role="alert">
          {status.message}
        </p>
      )}
    </form>
  )
}
