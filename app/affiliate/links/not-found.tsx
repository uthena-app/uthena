// /affiliate/links — not-found boundary. Renders when no matching
// sub-route resolves (a stale share URL etc). Keeps the
// affiliate shell + a friendly CTA so deep-links never render a
// generic 404 in the affiliate portal chrome.

import Link from 'next/link'
import { AffiliateShell } from '@features/affiliate-portal'
import styles from './not-found.module.css'

export default function AffiliateLinksNotFound() {
  return (
    <AffiliateShell>
      <section className={styles.card} aria-labelledby="nf-h">
        <p className={styles.eyebrow}>Not found</p>
        <h1 id="nf-h" className={styles.title}>
          That page doesn&apos;t exist.
        </h1>
        <p className={styles.body}>
          If you followed a link here, it might be stale. Head back to the links
          management page.
        </p>
        <div className={styles.actions}>
          <Link href="/affiliate/links" className={styles.cta}>
            Go to affiliate links
          </Link>
          <Link href="/affiliate" className={styles.link}>
            Back to dashboard
          </Link>
        </div>
      </section>
    </AffiliateShell>
  )
}
