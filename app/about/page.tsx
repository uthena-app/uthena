// /about — company info page.

import type { Metadata } from 'next'
import { buildPageMetadata } from '@foundations/metadata'
import styles from './about.module.css'

export const metadata: Metadata = buildPageMetadata({
  title: 'About',
  description: 'About Uthena — wholesale digital products marketplace for resellers, instructors, and affiliates.',
  path: '/about',
})

export default function AboutPage() {
  return (
    <main id="main" className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.h1}>About Uthena</h1>
        <p className={styles.lede}>
          Uthena is a wholesale digital products marketplace. We connect creators who
          produce PLR / MRR / RR video courses, ebooks, and templates with resellers,
          instructors, and affiliates who resell them.
        </p>
      </header>

      <section className={styles.section} aria-labelledby="mission">
        <h2 id="mission" className={styles.sectionH}>Our mission</h2>
        <p>
          To give every independent creator a single home for their digital products, with
          transparent royalty splits, instant global delivery, and an affiliate channel that
          rewards marketers fairly.
        </p>
      </section>

      <section className={styles.section} aria-labelledby="numbers">
        <h2 id="numbers" className={styles.sectionH}>By the numbers</h2>
        <ul className={styles.list}>
          <li>100% digital products (no shipping, no inventory)</li>
          <li>60% revenue share by default — partners can negotiate up to 80%</li>
          <li>$19/mo Personal Access for unlimited streaming + 15% PLR discount</li>
          <li>30+ PLR partners publishing in 2026</li>
        </ul>
      </section>

      <section className={styles.section} aria-labelledby="principles">
        <h2 id="principles" className={styles.sectionH}>How we operate</h2>
        <ul className={styles.list}>
          <li><strong>Plain language.</strong> No upsell loops. No dark patterns.</li>
          <li><strong>Flat fees.</strong> No surprise charges. Affiliates earn the rate they signed up with.</li>
          <li><strong>Own your library.</strong> Once you buy, you have lifetime access to the files you paid for.</li>
          <li><strong>Real support.</strong> A human reads every email.</li>
        </ul>
      </section>

      <section className={styles.section} aria-labelledby="contact">
        <h2 id="contact" className={styles.sectionH}>Get in touch</h2>
        <p>
          For sales or product questions email{' '}
          <a href="mailto:sales@uthena.com" className={styles.link}>sales@uthena.com</a>. For
          partnership inquiries see the <a href="/partner" className={styles.link}>partner program</a>.
          For press or media, see <a href="/press" className={styles.link}>press</a>.
        </p>
      </section>
    </main>
  )
}
