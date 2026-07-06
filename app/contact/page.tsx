// /contact — Public contact / support page.
// No forms in v1 per spec. Renders a list of mailto-based options
// (config) and a small contact form that opens the user's mail
// client (no server-side state, no PII collected).

import type { Metadata } from 'next'
import { ContactForm, CONTACT_OPTIONS, COMPANY_INFO } from '@features/legal'
import { buildPageMetadata } from '@foundations/metadata'
import styles from './contact.module.css'

// P0.21 — full OG + Twitter Card via the shared helper.
export const metadata: Metadata = buildPageMetadata({
  title: 'Contact',
  description: 'How to reach Uthena — support, sales, privacy, legal, affiliates, partners.',
  path: '/contact',
})

export default function ContactPage() {
  return (
    <main className={styles.page} id="main">
      <header className={styles.header}>
        <h1 className={styles.h1}>Contact</h1>
        <p className={styles.lede}>
          Pick the right inbox for your question. We respond in plain
          English, in the order your message was received.
        </p>
      </header>

      <section className={styles.section} aria-labelledby="contact-options-h">
        <h2 id="contact-options-h" className={styles.sectionH}>
          Direct email
        </h2>
        <ul className={styles.list}>
          {CONTACT_OPTIONS.map((opt) => (
            <li key={opt.email} className={styles.row}>
              <div className={styles.rowMain}>
                <p className={styles.rowLabel}>{opt.label}</p>
                <p className={styles.rowDesc}>{opt.description}</p>
                <p className={styles.rowMeta}>
                  <span className={styles.rowMetaKey}>Response time</span>
                  <span>{opt.responseTime}</span>
                </p>
              </div>
              <a
                className={styles.rowCta}
                href={`mailto:${opt.email}?subject=${opt.subject}`}
              >
                <span className={styles.rowCtaEmail}>{opt.email}</span>
                <span className={styles.rowCtaLabel}>Email</span>
              </a>
            </li>
          ))}
        </ul>
      </section>

      <section className={styles.section} aria-labelledby="contact-form-h">
        <h2 id="contact-form-h" className={styles.sectionH}>
          Or send via your mail app
        </h2>
        <p className={styles.formIntro}>
          The form below opens your mail client with a pre-filled
          message. We do not store or log anything you enter here.
        </p>
        <ContactForm />
      </section>

      <section className={styles.company} aria-label="Company information">
        <h2 className={styles.sectionH}>About Uthena</h2>
        <p className={styles.companyLine}>
          <span className={styles.companyKey}>Legal name:</span>{' '}
          {COMPANY_INFO.legalName}
        </p>
        <p className={styles.companyLine}>
          <span className={styles.companyKey}>Mailing address:</span>{' '}
          {COMPANY_INFO.mailingAddress}
        </p>
      </section>
    </main>
  )
}
