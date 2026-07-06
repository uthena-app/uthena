// /faq — Public FAQ page.
// RSC. Loads the grouped FAQ source, renders them as a keyboard
// accordion. ISR 24h.

import type { Metadata } from 'next'
import { FaqAccordion, listFaqs } from '@features/legal'
import { buildPageMetadata } from '@foundations/metadata'
import styles from './faq.module.css'

export const revalidate = 86400

export async function generateMetadata(): Promise<Metadata> {
  const groups = await listFaqs()
  const totalEntries = groups.reduce((sum, g) => sum + g.entries.length, 0)
  const description =
    totalEntries > 0
      ? `Answers to ${totalEntries} common questions about Uthena — ordering, lifetime access, PLR/MRR licenses, refunds, and instructor participation.`
      : 'Answers to common questions about Uthena — ordering, lifetime access, PLR/MRR licenses, refunds, and instructor participation.'
  // P0.21 — full OG + Twitter Card via the shared helper.
  return buildPageMetadata({
    title: 'FAQ',
    description,
    path: '/faq',
  })
}

export default async function FaqPage() {
  const groups = await listFaqs()

  // FAQPage JSON-LD — one entry per question, grouped under the page.
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: groups.flatMap((g) =>
      g.entries.map((e) => ({
        '@type': 'Question',
        name: e.question,
        acceptedAnswer: { '@type': 'Answer', text: answerToPlainText(e.answer) },
      })),
    ),
  }

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <main className={styles.page} id="main">
        <header className={styles.header}>
          <h1 className={styles.h1}>Frequently asked questions</h1>
          <p className={styles.lede}>
            Answers to common questions about ordering, lifetime access,
            licenses, refunds, and instructor participation. If your
            question is not here, <a href="/contact">contact us</a>.
          </p>
        </header>
        <FaqAccordion groups={groups} />
      </main>
    </>
  )
}

/**
 * Best-effort plain-text extraction from the React answer body for
 * JSON-LD. We can't render React to text without a renderer, so we
 * shallow-walk the tree. Good enough for the SEO "Answer" string.
 */
function answerToPlainText(node: unknown): string {
  if (node == null || typeof node === 'boolean') return ''
  if (typeof node === 'string') return node
  if (typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(answerToPlainText).join('')
  if (typeof node === 'object') {
    const n = node as { type?: unknown; props?: { children?: unknown } }
    if (n.type === 'br') return '\n'
    if ('props' in n && n.props && 'children' in n.props) {
      return answerToPlainText(n.props.children)
    }
  }
  return ''
}
