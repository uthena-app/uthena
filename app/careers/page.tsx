// /careers — solo-founder note (with a waitlist for future openings).

import type { Metadata } from 'next'
import { buildPageMetadata } from '@foundations/metadata'
import styles from './careers.module.css'

export const metadata: Metadata = buildPageMetadata({
  title: 'Careers',
  description: 'Uthena is currently run by a single founder. Open positions will be listed here when available.',
  path: '/careers',
})

export default function CareersPage() {
  return (
    <main id="main" className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.h1}>Careers</h1>
        <p className={styles.lede}>
          Uthena is currently run by a solo founder. We are not hiring at this moment, but
          we welcome interest from strong generalists who'd thrive in a small, autonomous setup.
        </p>
      </header>

      <section className={styles.section} aria-labelledby="culture">
        <h2 id="culture" className={styles.sectionH}>How we work</h2>
        <p>
          When we do hire, the bar is high. We default to async-first written communication.
          Decisions are reversible until they are not. Speed over polish until polish is
          the bottleneck. We build for cash flow — paid products, profitable partners, no
          vanity metrics. When in doubt, ship.
        </p>
      </section>

      <section className={styles.section} aria-labelledby="future">
        <h2 id="future" className={styles.sectionH}>Future openings</h2>
        <p>
          We're considering a small founding team in late 2026 — likely one or two
          founding engineers, and a partnerships lead. If that sounds like you, send a short
          note about what you'd want to do here:
        </p>
        <p>
          <a href="mailto:founders@uthena.com" className={styles.cta}>
            founders@uthena.com →
          </a>
        </p>
      </section>
    </main>
  )
}
