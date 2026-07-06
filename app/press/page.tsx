// /press — media / press kit page.

import type { Metadata } from 'next'
import { buildPageMetadata } from '@foundations/metadata'
import styles from './press.module.css'

export const metadata: Metadata = buildPageMetadata({
  title: 'Press',
  description: 'Press kit, brand assets, and media contact for Uthena.',
  path: '/press',
})

export default function PressPage() {
  return (
    <main id="main" className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.h1}>Press</h1>
        <p className={styles.lede}>
          Media inquiries, brand assets, and quick facts about Uthena.
        </p>
      </header>

      <section className={styles.section} aria-labelledby="contact">
        <h2 id="contact" className={styles.sectionH}>Media contact</h2>
        <p>
          Email <a href="mailto:press@uthena.com" className={styles.link}>press@uthena.com</a> with
          your outlet, deadline, and angle. We respond within one business day.
        </p>
      </section>

      <section className={styles.section} aria-labelledby="boilerplate">
        <h2 id="boilerplate" className={styles.sectionH}>Boilerplate</h2>
        <p>
          Uthena is a wholesale digital products marketplace for resellers, instructors, and
          affiliates. Founded in 2026, Uthena connects creators of PLR / MRR / RR video courses,
          ebooks, and templates with a global audience of resellers. Uthena's mission is to give
          every independent creator a single home for their digital products, with transparent
          royalty splits, instant global delivery, and an affiliate channel that rewards
          marketers fairly.
        </p>
      </section>

      <section className={styles.section} aria-labelledby="facts">
        <h2 id="facts" className={styles.sectionH}>Quick facts</h2>
        <ul className={styles.list}>
          <li><strong>Founded:</strong> 2026</li>
          <li><strong>Headquarters:</strong> Ho Chi Minh City, Vietnam</li>
          <li><strong>Founders:</strong> Klaas (solo founder)</li>
          <li><strong>Funding:</strong> Self-funded</li>
          <li><strong>Product:</strong> Digital marketplace (PLR courses, ebooks, templates)</li>
        </ul>
      </section>

      <section className={styles.section} aria-labelledby="assets">
        <h2 id="assets" className={styles.sectionH}>Brand assets</h2>
        <p>
          Logo, color tokens, and product mockups are available below. Do not alter the logo,
          change colors, or place it on busy backgrounds without written permission.
        </p>
        <p>
          For high-resolution assets, email <a href="mailto:press@uthena.com" className={styles.link}>press@uthena.com</a>.
        </p>
      </section>
    </main>
  )
}
