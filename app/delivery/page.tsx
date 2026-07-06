// /delivery — Delivery Policy.
// Public. RSC. Renders the delivery.md markdown. ISR 24h.

import type { Metadata } from 'next'
import Link from 'next/link'
import { ProsePage, getLegalDoc } from '@features/legal'
import { buildPageMetadata } from '@foundations/metadata'
import styles from './delivery.module.css'

export const revalidate = 86400

export async function generateMetadata(): Promise<Metadata> {
  const doc = await getLegalDoc('delivery', { defaultTitle: 'Delivery Policy' })
  // P0.21 — full OG + Twitter Card via the shared helper.
  return buildPageMetadata({
    title: 'Delivery Policy',
    description: doc.ogDescription ?? 'How Uthena delivers digital products after purchase',
    path: '/delivery',
    type: 'article',
    publishedTime: doc.lastUpdated,
    modifiedTime: doc.lastUpdated,
  })
}

export default async function DeliveryPage() {
  const doc = await getLegalDoc('delivery', { defaultTitle: 'Delivery Policy' })
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: doc.title,
    description: doc.ogDescription ?? 'How Uthena delivers digital products after purchase',
    mainEntityOfPage: { '@type': 'WebPage', '@id': 'https://uthena.com/delivery' },
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
        contactLabel="Need help? Email"
        contactHref="mailto:support@uthena.com"
      />
      <div className={styles.ctaRow}>
        <Link href="/login?next=%2Flibrary" className={styles.cta}>
          Go to your library
        </Link>
        <Link href="/refund-policy" className={styles.linkBtn}>
          Refund Policy
        </Link>
        <Link href="/contact" className={styles.linkBtn}>
          Contact support
        </Link>
      </div>
    </>
  )
}
