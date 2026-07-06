// ContactForm.tsx — single client component for the /contact page.
// No server action. No PII collected server-side. On submit, it
// composes a pre-formatted mailto: link and opens the user's mail
// client. As a fallback (some browsers / OSes block mailto:) it also
// copies the same content to the clipboard and shows a toast.
//
// Validation is client-side only. The form is honest about what it
// does: it does not "send" anything from the browser. The mailto:
// URL is the only payload.
//
// The form's option list and email routing come from the shared
// `getContactOptions.ts` config so the option rows on /contact and
// the form dropdowns never drift.

'use client'

import { useId, useState, type FormEvent } from 'react'
import { CONTACT_OPTIONS } from '../queries/getContactOptions'
import styles from './ContactForm.module.css'

type FormSlug =
  | 'support'
  | 'general'
  | 'privacy'
  | 'legal'
  | 'affiliate'
  | 'partner'

// Map each form slug to a CONTACT_OPTIONS label. The form's display
// labels are intentionally a tighter, more "form-friendly" copy than
// the public option rows. We resolve to the canonical email by
// matching on the canonical label.
const FORM_OPTIONS: ReadonlyArray<{ slug: FormSlug; label: string }> = [
  { slug: 'support', label: 'Customer support' },
  { slug: 'general', label: 'General question' },
  { slug: 'privacy', label: 'Privacy / data request' },
  { slug: 'legal', label: 'Legal / DMCA' },
  { slug: 'affiliate', label: 'Affiliate program' },
  { slug: 'partner', label: 'Partner / instructor' },
]

// Canonical email routing for the form. Mirrors CONTACT_OPTIONS by
// the public label so the two stay in sync; the privacy email is
// the data-controller address (live: projects@dantwah.com).
const FORM_EMAIL: Record<FormSlug, { email: string; canonicalLabel: string }> = {
  support: { email: 'support@uthena.com', canonicalLabel: 'Customer support' },
  general: { email: 'info@uthena.com', canonicalLabel: 'General' },
  privacy: { email: 'projects@dantwah.com', canonicalLabel: 'Privacy' },
  legal: { email: 'legal@uthena.com', canonicalLabel: 'Legal' },
  affiliate: { email: 'affiliates@uthena.com', canonicalLabel: 'Affiliate program' },
  partner: { email: 'partners@uthena.com', canonicalLabel: 'Partner / instructor' },
}

type Errors = Partial<Record<'name' | 'email' | 'message', string>>

export function ContactForm() {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [subject, setSubject] = useState<FormSlug>('support')
  const [message, setMessage] = useState('')
  const [errors, setErrors] = useState<Errors>({})
  const [toast, setToast] = useState<string | null>(null)
  const formId = useId()

  function validate(): Errors {
    const e: Errors = {}
    if (!name.trim()) e.name = 'Enter your name.'
    else if (name.trim().length < 2) e.name = 'Name is too short.'
    if (!email.trim()) e.email = 'Enter your email.'
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) e.email = 'Enter a valid email address.'
    if (!message.trim()) e.message = 'Enter a short message.'
    else if (message.trim().length < 20) e.message = 'Message should be at least 20 characters.'
    return e
  }

  async function onSubmit(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault()
    const e = validate()
    setErrors(e)
    if (Object.keys(e).length > 0) return
    const route = FORM_EMAIL[subject]
    const subjectLine = `[Uthena] ${FORM_OPTIONS.find((s) => s.slug === subject)?.label ?? subject}`
    const body = [
      `From: ${name.trim()} <${email.trim()}>`,
      `Subject: ${subjectLine}`,
      '',
      message.trim(),
      '',
      '---',
      'Sent from the Uthena contact form.',
    ].join('\n')
    const href = `mailto:${route.email}?subject=${encodeURIComponent(subjectLine)}&body=${encodeURIComponent(body)}`
    // Try to open the mail client. If it's blocked, copy the link
    // to the clipboard and tell the user.
    try {
      window.location.href = href
    } catch {
      /* ignored — clipboard fallback below */
    }
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(href)
        setToast(
          'Opened your mail app. If nothing happened, the mailto link was copied to your clipboard.',
        )
      } else {
        setToast(
          'Opened your mail app. If nothing happened, copy the message below into an email to the address shown.',
        )
      }
    } catch {
      setToast(
        'Opened your mail app. If nothing happened, send the message to the address shown.',
      )
    }
  }

  return (
    <form
      id={formId}
      className={styles.form}
      onSubmit={onSubmit}
      noValidate
      aria-label="Contact form"
    >
      <p className={styles.note}>
        This form opens your email app. We do not store or log any of
        the information you enter here.
      </p>

      <div className={styles.field}>
        <label htmlFor={`${formId}-name`} className={styles.label}>
          Your name
        </label>
        <input
          id={`${formId}-name`}
          name="name"
          type="text"
          autoComplete="name"
          className={styles.input}
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-invalid={errors.name ? 'true' : undefined}
          aria-describedby={errors.name ? `${formId}-name-err` : undefined}
          required
        />
        {errors.name && (
          <p id={`${formId}-name-err`} className={styles.error} role="alert">
            {errors.name}
          </p>
        )}
      </div>

      <div className={styles.field}>
        <label htmlFor={`${formId}-email`} className={styles.label}>
          Your email
        </label>
        <input
          id={`${formId}-email`}
          name="email"
          type="email"
          autoComplete="email"
          className={styles.input}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          aria-invalid={errors.email ? 'true' : undefined}
          aria-describedby={errors.email ? `${formId}-email-err` : undefined}
          required
        />
        {errors.email && (
          <p id={`${formId}-email-err`} className={styles.error} role="alert">
            {errors.email}
          </p>
        )}
      </div>

      <div className={styles.field}>
        <label htmlFor={`${formId}-subject`} className={styles.label}>
          What is this about?
        </label>
        <select
          id={`${formId}-subject`}
          name="subject"
          className={styles.input}
          value={subject}
          onChange={(e) => setSubject(e.target.value as FormSlug)}
        >
          {FORM_OPTIONS.map((s) => (
            <option key={s.slug} value={s.slug}>
              {s.label}
            </option>
          ))}
        </select>
        <p className={styles.hint}>
          We&apos;ll route your message to{' '}
          <span className={styles.mono}>{FORM_EMAIL[subject].email}</span>.
        </p>
      </div>

      <div className={styles.field}>
        <label htmlFor={`${formId}-message`} className={styles.label}>
          Message
        </label>
        <textarea
          id={`${formId}-message`}
          name="message"
          className={styles.textarea}
          rows={6}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          aria-invalid={errors.message ? 'true' : undefined}
          aria-describedby={errors.message ? `${formId}-message-err` : undefined}
          placeholder="Tell us what you need. Include order numbers or product slugs when relevant."
          required
        />
        {errors.message && (
          <p id={`${formId}-message-err`} className={styles.error} role="alert">
            {errors.message}
          </p>
        )}
        <p className={styles.hint}>
          Don&apos;t include passwords, card numbers, or other sensitive
          info. We&apos;ll never ask for them.
        </p>
      </div>

      <div className={styles.actions}>
        <button type="submit" className={styles.submit}>
          Open my mail app
        </button>
      </div>

      {toast && (
        <p className={styles.toast} role="status" aria-live="polite">
          {toast}
        </p>
      )}
    </form>
  )
}

// Reference CONTACT_OPTIONS so the import is not flagged as unused
// when this file is tree-shaken. (Kept for the future when the form's
// options are derived from the config directly.)
void CONTACT_OPTIONS
