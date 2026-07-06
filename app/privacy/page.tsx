// /privacy — Privacy Policy.
// Public. RSC. Renders the privacy.md markdown. ISR 24h.

import type { Metadata } from 'next'
import { ProsePage, getLegalDoc } from '@features/legal'
import { buildPageMetadata } from '@foundations/metadata'

export const revalidate = 86400

export async function generateMetadata(): Promise<Metadata> {
  const doc = await getLegalDoc('privacy', { defaultTitle: 'Privacy Policy' })
  // P0.21 — full OG + Twitter Card via the shared helper.
  return buildPageMetadata({
    title: 'Privacy Policy',
    description: doc.ogDescription ?? 'How Uthena collects, uses, and protects your data.',
    path: '/privacy',
    type: 'article',
    publishedTime: doc.lastUpdated,
    modifiedTime: doc.lastUpdated,
    noindex: doc.noindex,
  })
}

export default async function PrivacyPage() {
  const doc = await getLegalDoc('privacy', { defaultTitle: 'Privacy Policy' })
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: doc.title,
    description: doc.ogDescription ?? 'How Uthena collects, uses, and protects your data',
    mainEntityOfPage: { '@type': 'WebPage', '@id': 'https://uthena.com/privacy' },
    datePublished: doc.lastUpdated,
    dateModified: doc.lastUpdated,
    publisher: {
      '@type': 'Organization',
      name: 'Uthena',
      url: 'https://uthena.com',
    },
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
        contactLabel="Questions about your privacy? Email"
        contactHref="mailto:privacy@uthena.com"
      />
    </>
  )
}
