// /refund-policy — Refund Policy.
// Public. RSC. Renders the refund-policy.md markdown. ISR 24h.

import type { Metadata } from 'next'
import Link from 'next/link'
import { ProsePage, getLegalDoc } from '@features/legal'
import { buildPageMetadata } from '@foundations/metadata'
import styles from './refund-policy.module.css'

export const revalidate = 86400

export async function generateMetadata(): Promise<Metadata> {
  const doc = await getLegalDoc('refund-policy', { defaultTitle: 'Refund Policy' })
  // P0.21 — full OG + Twitter Card via the shared helper.
  return buildPageMetadata({
    title: 'Refund Policy',
    description: doc.ogDescription ?? "Uthena's 14-day return rights on digital products",
    path: '/refund-policy',
    type: 'article',
    publishedTime: doc.lastUpdated,
    modifiedTime: doc.lastUpdated,
  })
}

export default async function RefundPolicyPage() {
  const doc = await getLegalDoc('refund-policy', { defaultTitle: 'Refund Policy' })
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: doc.title,
    description: doc.ogDescription ?? 'Uthena\'s 14-day return rights on digital products',
    mainEntityOfPage: { '@type': 'WebPage', '@id': 'https://uthena.com/refund-policy' },
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
        contactLabel="Need help with a refund? Email"
        contactHref="mailto:support@uthena.com"
      />
      <div className={styles.ctaRow}>
        <Link href="/login?next=%2Faccount%2Forders" className={styles.cta}>
          Request a refund
        </Link>
        <Link href="/login?next=%2Faccount%2Fsettings" className={styles.linkBtn}>
          Manage subscription
        </Link>
      </div>
    </>
  )
}
