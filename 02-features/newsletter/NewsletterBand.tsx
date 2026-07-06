'use client'

// NewsletterBand — the marketing newsletter email capture UI.
//
// Used by:
//   - The home page (P0.10) — as a section near the bottom.
//   - The dedicated /newsletter page (P0.11) — as the page's main CTA.
//
// Per spec (P0.10 / P0.11), the real subscribe action is wired in
// Phase 17 (SES adapter + suppression list + double opt-in). This
// component ships the visual shell + a real form so the consent
// gate + email validation can be built on top without UI churn
// later. Today the form prevents default submit and shows an
// inline "we'll be in touch" message.
//
// Defers to STUB-036 ("newsletter subscribe action") — search
// STUBS.md before adding the real action so we don't double-track.

import { useState, type FormEvent } from 'react'
import styles from './NewsletterBand.module.css'

export function NewsletterBand() {
  const [email, setEmail] = useState('')
  const [submitted, setSubmitted] = useState(false)

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!email.trim()) return
    // Phase 17 wires SES here; today the form is a UI placeholder.
    setSubmitted(true)
  }

  return (
    <section
      id="newsletter"
      className={styles.sec}
      aria-labelledby="newsletter-h"
    >
      <div className={styles.band}>
        <div>
          <div className={styles.eyebrow}>Newsletter</div>
          <h3 id="newsletter-h" className={styles.h3}>
            New courses, drops, and <span className={styles.teal}>reseller-only</span> deals.
          </h3>
          <p className={styles.lede}>
            Weekly email. No spam, no fluff. Unsubscribe anytime.
          </p>
        </div>
        {submitted ? (
          <p className={styles.success} role="status">
            We&apos;ll let you know when the next drop ships. In the meantime, browse the catalog.
          </p>
        ) : (
          <form
            className={styles.form}
            onSubmit={onSubmit}
            aria-label="Newsletter signup"
          >
            <label htmlFor="newsletter-email" className="srOnly">
              Email address
            </label>
            <input
              id="newsletter-email"
              type="email"
              name="email"
              placeholder="you@studio.com"
              className={styles.input}
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <button type="submit" className={styles.btn}>
              Subscribe <span className={styles.arrow} aria-hidden>→</span>
            </button>
          </form>
        )}
        <p className={styles.hint}>
          By subscribing you agree to receive marketing emails from Uthena.
          Unsubscribe anytime. We never share your email.
        </p>
      </div>
    </section>
  )
}