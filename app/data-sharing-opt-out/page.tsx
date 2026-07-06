// /data-sharing-opt-out — Data Sharing Opt-Out page.
// Public. RSC. Renders the data-sharing-opt-out.md markdown + the
// OptOutForm client island (CCPA / GDPR request UI). ISR 24h.
//
// P10.6 review pass: form is rendered as the `beforeBody` slot on
// `ProsePage` so the most-actionable surface sits at the top of the
// article (matches the /dmca beforeBody pattern for the agent card).
// The form is currently a disabled-submit (see OptOutForm.tsx); the
// real submission pipeline lands with P9.9 + the `data_subject_requests`
// table + the email-to-privacy@uthena.com handoff.

import type { Metadata } from 'next'
import Link from 'next/link'
import {
  ProsePage,
  OptOutForm,
  getLegalDoc,
} from '@features/legal'
import { buildPageMetadata } from '@foundations/metadata'
import styles from './data-sharing-opt-out.module.css'

export const revalidate = 86400

export async function generateMetadata(): Promise<Metadata> {
  const doc = await getLegalDoc('data-sharing-opt-out', {
    defaultTitle: 'Data Sharing Opt-Out',
  })
  // P0.21 — full OG + Twitter Card via the shared helper. Honors
  // the doc's own noindex flag (for legal docs that aren't meant
  // to be indexed for some reason — usually rare).
  return buildPageMetadata({
    title: 'Data Sharing Opt-Out',
    description:
      doc.ogDescription ??
      'How to opt out of data sale, sharing, or targeted advertising, and exercise your CCPA / GDPR Art. 21 rights',
    path: '/data-sharing-opt-out',
    type: 'article',
    publishedTime: doc.lastUpdated,
    modifiedTime: doc.lastUpdated,
    noindex: doc.noindex,
  })
}

export default async function DataSharingOptOutPage() {
  const doc = await getLegalDoc('data-sharing-opt-out', {
    defaultTitle: 'Data Sharing Opt-Out',
  })
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: doc.title,
    description:
      doc.ogDescription ??
      'How to opt out of data sale, sharing, or targeted advertising, and exercise your CCPA / GDPR Art. 21 rights',
    mainEntityOfPage: {
      '@type': 'WebPage',
      '@id': 'https://uthena.com/data-sharing-opt-out',
    },
    datePublished: doc.lastUpdated,
    dateModified: doc.lastUpdated,
    publisher: { '@type': 'Organization', name: 'Uthena', url: 'https://uthena.com' },
  }
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <ProsePage
        title={doc.title}
        lastUpdated={doc.lastUpdated}
        body={doc.body}
        seeAlso={doc.seeAlso}
        contactLabel="For any other privacy question, email"
        contactHref="mailto:privacy@uthena.com"
        beforeBody={
          <section className={styles.formSection} aria-labelledby="data-subject-form-h">
            <h2 id="data-subject-form-h" className={styles.formHeading}>
              Submit a data-subject request
            </h2>
            <p className={styles.formIntro}>
              Use the form below to ask us not to sell or share your
              personal information (CCPA / CPRA), to limit our use of
              sensitive personal information (CCPA §1798.121), or to
              object to processing carried out under our legitimate
              interests (GDPR Art. 21). The on-page submission is a
              follow-up release — for now, please email the same
              information to <a className={styles.formLink} href="mailto:privacy@uthena.com">
                privacy@uthena.com
              </a>{' '}
              and we will respond within the time required by law.
            </p>
            <OptOutForm />
          </section>
        }
      />
      <div className={styles.ctaRow}>
        <Link href="/privacy" className={styles.linkBtn}>
          Read the Privacy Policy
        </Link>
        <Link href="/login?next=%2Faccount%2Fsettings" className={styles.linkBtn}>
          Manage account settings
        </Link>
      </div>
    </>
  )
}
