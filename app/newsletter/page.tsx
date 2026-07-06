// /newsletter — Dedicated landing page for the marketing newsletter.
//
// Public. RSC. The page composes a header (eyebrow + h1 + lede) and
// the same NewsletterBand the home page uses, sourced from
// `@features/newsletter`. No data fetch; static + cached.
//
// Per spec (P0.11), the real subscribe action is wired in Phase 17
// (SES adapter + suppression list + double opt-in). See STUB-036.

import type { Metadata } from 'next'
import { NewsletterBand } from '@features/newsletter'
import { buildPageMetadata } from '@foundations/metadata'
import styles from './newsletter.module.css'

// P0.21 — full OG + Twitter Card via the shared helper.
export const metadata: Metadata = buildPageMetadata({
  title: 'Newsletter',
  description:
    'New PLR courses, weekly drops, and reseller-only deals. One short email a week. Unsubscribe anytime.',
  path: '/newsletter',
})

export default function NewsletterPage() {
  return (
    <main className={styles.page} id="main">
      <header className={styles.header}>
        <div className={styles.eyebrow}>Newsletter</div>
        <h1 className={styles.h1}>
          New courses, drops, and <span className={styles.teal}>reseller-only</span> deals.
        </h1>
        <p className={styles.lede}>
          One short email a week. New PLR / MRR / RR courses, the rare
          bundle drop, and the deals we don&apos;t publish on the home page.
          Unsubscribe in one click.
        </p>
      </header>
      <div className={styles.bandWrap}>
        <NewsletterBand />
      </div>
      <p className={styles.privacyLink}>
        We don&apos;t sell, share, or rent your email.{' '}
        <a href="/privacy" className={styles.link}>
          Read the privacy policy
        </a>
        .
      </p>
    </main>
  )
}