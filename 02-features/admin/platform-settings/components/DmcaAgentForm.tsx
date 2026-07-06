'use client'

// DmcaAgentForm — the editor for `platform_settings.dmca_agent`.
// Renders 4 fields (name, email, mailing_address, optional phone),
// pre-fills from the current row, validates via Zod (on the server
// action), and surfaces success / error states inline. The form
// previews the public-facing card alongside the inputs so the admin
// can see exactly what visitors will read on /dmca.

import { useId, useState, useTransition } from 'react'
import { Button } from '@foundations/ui/primitives/Button'
import { Input } from '@foundations/ui/primitives/Button'
import { updateDmcaAgentAction } from '../actions/updateDmcaAgent'
import type { DmcaAgentContact } from '@features/legal'
import styles from './DmcaAgentForm.module.css'

type DmcaAgentFormProps = {
  /** Current agent contact from `platform_settings`. `null` when the
   *  row is missing or malformed (rare; the migration seeds a default). */
  initial: DmcaAgentContact | null
  /** Last-updated ISO timestamp from the row. `null` when no row. */
  updatedAt: string | null
}

const EMPTY: DmcaAgentContact = {
  name: '',
  email: '',
  mailing_address: '',
  phone: '',
}

export function DmcaAgentForm({ initial, updatedAt }: DmcaAgentFormProps) {
  const start = initial ?? EMPTY
  const formId = useId()
  const [name, setName] = useState(start.name)
  const [email, setEmail] = useState(start.email)
  const [mailingAddress, setMailingAddress] = useState(start.mailing_address)
  const [phone, setPhone] = useState(start.phone)
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [success, setSuccess] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setFieldErrors({})
    setSuccess(null)
    startTransition(async () => {
      const res = await updateDmcaAgentAction({
        name: name.trim(),
        email: email.trim(),
        mailing_address: mailingAddress.trim(),
        phone: phone.trim(),
      })
      if (!res.ok) {
        setError(res.error)
        if (res.fieldErrors) setFieldErrors(res.fieldErrors)
        return
      }
      const stamp = formatUpdatedAt(res.updatedAt)
      setSuccess(
        stamp
          ? `Saved — public page will reflect this within 24h (ISR window). Last updated ${stamp}.`
          : 'Saved — public page will reflect this within 24h (ISR window).',
      )
    })
  }

  function onReset() {
    setName(start.name)
    setEmail(start.email)
    setMailingAddress(start.mailing_address)
    setPhone(start.phone)
    setError(null)
    setFieldErrors({})
    setSuccess(null)
  }

  // Live preview — mirrors the public DmcaAgentCard so the admin sees
  // exactly what visitors will read. Empty strings are tolerated; the
  // preview never renders the card if a required field is blank.
  const previewable =
    name.trim().length > 0 &&
    email.trim().length > 0 &&
    mailingAddress.trim().length > 0

  return (
    <form id={formId} className={styles.form} onSubmit={onSubmit} noValidate>
      <p className={styles.intro}>
        This contact is required for U.S. Copyright Office § 512(c) compliance. The public{' '}
        <a href="/dmca" target="_blank" rel="noopener noreferrer">
          /dmca
        </a>{' '}
        page reads this row directly — changes appear within the page&apos;s 24-hour ISR window
        (or on the next request after the action runs).
      </p>

      <div className={styles.row}>
        <label htmlFor={`${formId}-name`} className={styles.label}>
          Designated agent name
          <span className={styles.required} aria-hidden="true">*</span>
        </label>
        <input
          id={`${formId}-name`}
          name="name"
          className={[styles.input, fieldErrors.name ? styles.inputError : ''].filter(Boolean).join(' ')}
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          maxLength={120}
          autoComplete="off"
          aria-invalid={fieldErrors.name ? 'true' : undefined}
          aria-describedby={fieldErrors.name ? `${formId}-name-err` : undefined}
        />
        {fieldErrors.name && (
          <p id={`${formId}-name-err`} className={styles.fieldError} role="alert">
            {fieldErrors.name}
          </p>
        )}
      </div>

      <div className={styles.row}>
        <label htmlFor={`${formId}-email`} className={styles.label}>
          Designated agent email
          <span className={styles.required} aria-hidden="true">*</span>
        </label>
        <input
          id={`${formId}-email`}
          name="email"
          type="email"
          inputMode="email"
          className={[styles.input, fieldErrors.email ? styles.inputError : ''].filter(Boolean).join(' ')}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          maxLength={254}
          autoComplete="off"
          aria-invalid={fieldErrors.email ? 'true' : undefined}
          aria-describedby={fieldErrors.email ? `${formId}-email-err` : undefined}
        />
        {fieldErrors.email && (
          <p id={`${formId}-email-err`} className={styles.fieldError} role="alert">
            {fieldErrors.email}
          </p>
        )}
        <p className={styles.hint}>Counter-notices route to this same address.</p>
      </div>

      <div className={styles.row}>
        <label htmlFor={`${formId}-mailing`} className={styles.label}>
          Mailing address
          <span className={styles.required} aria-hidden="true">*</span>
        </label>
        <textarea
          id={`${formId}-mailing`}
          name="mailing_address"
          className={[styles.textarea, fieldErrors.mailing_address ? styles.inputError : ''].filter(Boolean).join(' ')}
          value={mailingAddress}
          onChange={(e) => setMailingAddress(e.target.value)}
          required
          maxLength={500}
          rows={3}
          aria-invalid={fieldErrors.mailing_address ? 'true' : undefined}
          aria-describedby={fieldErrors.mailing_address ? `${formId}-mailing-err` : undefined}
        />
        {fieldErrors.mailing_address && (
          <p id={`${formId}-mailing-err`} className={styles.fieldError} role="alert">
            {fieldErrors.mailing_address}
          </p>
        )}
        <p className={styles.hint}>
          The address filed with the U.S. Copyright Office. Multi-line is fine (use newlines).
        </p>
      </div>

      <div className={styles.row}>
        <label htmlFor={`${formId}-phone`} className={styles.label}>
          Phone
          <span className={styles.optional}>(optional)</span>
        </label>
        <Input
          id={`${formId}-phone`}
          name="phone"
          className={[styles.input, fieldErrors.phone ? styles.inputError : ''].filter(Boolean).join(' ')}
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          maxLength={40}
          autoComplete="off"
          error={fieldErrors.phone}
          hint="§ 512(c) does not require a phone — leave blank if not provided."
        />
      </div>

      {previewable && (
        <div className={styles.preview} aria-label="Live preview">
          <span className={styles.previewLabel}>Preview — what visitors see</span>
          <div className={styles.previewRow}>
            <span className={styles.previewKey}>Name</span>
            <span className={styles.previewValue}>{name.trim() || '—'}</span>
          </div>
          <div className={styles.previewRow}>
            <span className={styles.previewKey}>Email</span>
            <span className={styles.previewValue}>{email.trim() || '—'}</span>
          </div>
          <div className={styles.previewRow}>
            <span className={styles.previewKey}>Mailing</span>
            <span className={styles.previewValue}>
              {mailingAddress.trim().split('\n').map((line, i, arr) => (
                <span key={i}>
                  {line}
                  {i < arr.length - 1 ? <br /> : null}
                </span>
              ))}
            </span>
          </div>
          {phone.trim() ? (
            <div className={styles.previewRow}>
              <span className={styles.previewKey}>Phone</span>
              <span className={styles.previewValue}>{phone.trim()}</span>
            </div>
          ) : null}
        </div>
      )}

      {error && (
        <p className={styles.alertError} role="alert">
          {error}
        </p>
      )}
      {success && (
        <p className={styles.success} role="status">
          {success}
        </p>
      )}

      <div className={styles.actions}>
        <Button type="submit" variant="primary" size="md" loading={isPending}>
          {isPending ? 'Saving…' : 'Save changes'}
        </Button>
        <button
          type="button"
          onClick={onReset}
          className={styles.resetBtn}
          disabled={isPending}
        >
          Reset
        </button>
        {updatedAt && (
          <span className={styles.meta}>
            Last saved: <span className={styles.metaUpdated}>{formatUpdatedAt(updatedAt)}</span>
          </span>
        )}
      </div>
    </form>
  )
}

function formatUpdatedAt(iso: string): string {
  // Render the timestamp as a human-readable date (UTC). The row's
  // updated_at is timestamptz; Date parses it losslessly.
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  // Use a stable, locale-independent format that matches the
  // Last-updated convention used elsewhere on the site.
  const yyyy = d.getUTCFullYear()
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(d.getUTCDate()).padStart(2, '0')
  const hh = String(d.getUTCHours()).padStart(2, '0')
  const mi = String(d.getUTCMinutes()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd} ${hh}:${mi} UTC`
}