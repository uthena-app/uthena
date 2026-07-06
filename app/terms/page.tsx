// /terms — Terms of Service.
// Public. RSC. Renders the terms.md markdown. ISR 24h.

import type { Metadata } from 'next'
import { ProsePage, getLegalDoc } from '@features/legal'
import { buildPageMetadata } from '@foundations/metadata'

export const revalidate = 86400

export async function generateMetadata(): Promise<Metadata> {
  const doc = await getLegalDoc('terms', { defaultTitle: 'Terms of Service' })
  // P0.21 — full OG + Twitter Card via the shared helper.
  return buildPageMetadata({
    title: 'Terms of Service',
    description: doc.ogDescription ?? 'The rules of using Uthena.com — terms every user agrees to.',
    path: '/terms',
    type: 'article',
    publishedTime: doc.lastUpdated,
    modifiedTime: doc.lastUpdated,
    noindex: doc.noindex,
  })
}

export default async function TermsPage() {
  const doc = await getLegalDoc('terms', { defaultTitle: 'Terms of Service' })
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: doc.title,
    description: doc.ogDescription ?? 'The rules of using Uthena.com',
    mainEntityOfPage: { '@type': 'WebPage', '@id': 'https://uthena.com/terms' },
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
        contactLabel="Questions about these terms? Email"
        contactHref="mailto:info@uthena.com"
      />
    </>
  )
}
