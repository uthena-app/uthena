// /dmca — DMCA Notice-and-Takedown.
// Public. RSC. Renders the dmca.md markdown + the data-driven agent
// contact card (P10.4). ISR 24h.

import type { Metadata } from 'next'
import {
  ProsePage,
  getLegalDoc,
  DmcaAgentCard,
  getDmcaAgent,
} from '@features/legal'
import { buildPageMetadata } from '@foundations/metadata'

export const revalidate = 86400

export async function generateMetadata(): Promise<Metadata> {
  const doc = await getLegalDoc('dmca', { defaultTitle: 'DMCA Notice-and-Takedown' })
  // P0.21 — full OG + Twitter Card via the shared helper.
  return buildPageMetadata({
    title: 'DMCA Notice-and-Takedown',
    description: doc.ogDescription ?? 'How to report copyright infringement on Uthena',
    path: '/dmca',
    type: 'article',
    publishedTime: doc.lastUpdated,
    modifiedTime: doc.lastUpdated,
    noindex: doc.noindex,
  })
}

export default async function DmcaPage() {
  // P10.4 — read the agent contact AND the markdown in parallel.
  // Both are wrapped in React.cache (per-request); the page sets
  // revalidate = 86400 for the long-term ISR window.
  const [doc, agent] = await Promise.all([
    getLegalDoc('dmca', { defaultTitle: 'DMCA Notice-and-Takedown' }),
    getDmcaAgent(),
  ])
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: doc.title,
    description: doc.ogDescription ?? 'How to report copyright infringement on Uthena',
    mainEntityOfPage: { '@type': 'WebPage', '@id': 'https://uthena.com/dmca' },
    datePublished: doc.lastUpdated,
    dateModified: doc.lastUpdated,
    publisher: {
      '@type': 'Organization',
      name: 'Uthena',
      url: 'https://uthena.com',
    },
  }
  // Counter-notice contact — prefers the agent's email when the row
  // is set, falls back to the legal@uthena.com address from the page
  // spec's open question §2 (the agent's email and the counter-notice
  // inbox are the same; per spec the agent routes both).
  const counterEmail = agent?.email ?? 'legal@uthena.com'
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
        contactLabel="Send counter-notices to"
        contactHref={`mailto:${counterEmail}`}
        beforeBody={<DmcaAgentCard agent={agent} />}
      />
    </>
  )
}