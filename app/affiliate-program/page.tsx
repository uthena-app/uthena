// /affiliate-program — public marketing page for the affiliate program.
//
// Redirects marketing traffic to /signup?next=/affiliate/onboarding.

import type { Metadata } from 'next'
import Link from 'next/link'
import { buildPageMetadata } from '@foundations/metadata'
import styles from './affiliate-program.module.css'

export const metadata: Metadata = buildPageMetadata({
  title: 'Affiliate program',
  description: 'Earn recurring commissions by referring buyers to Uthena. Up to 30% commission on every sale.',
  path: '/affiliate-program',
})

const BENEFITS = [
  {
    title: 'Recurring commissions',
    body: 'Earn 30% on every sale for the first 12 months, then 15% for as long as the customer stays subscribed. Lifetime commissions on one-time purchases.',
  },
  {
    title: 'Real-time dashboard',
    body: 'Live clicks, conversions, EPC, and conversion rates. Payout history. Custom affiliate links per product.',
  },
  {
    title: 'Mini-shop',
    body: 'Get a public /u/your-handle page so buyers can browse your curated catalog in one click.',
  },
  {
    title: 'Monthly payouts',
    body: 'PayPal or bank transfer. $50 minimum. Sent the 1st business day of each month for the previous month.',
  },
  {
    title: 'Free to join',
    body: 'No signup fee. No quota. No expiration on your links.',
  },
  {
    title: 'Quality creative',
    body: 'Product mockups, comparison tables, and email swipe copy you can use as-is or remix.',
  },
]

const FAQ = [
  {
    q: 'How much can I earn?',
    a: 'Top affiliates earn $5K-$15K/month. Your earnings scale with your audience and your craft — the better your fit, the higher your conversion rate.',
  },
  {
    q: 'Do I need to be a public figure?',
    a: 'No. Many of our best affiliates are course creators, list builders, and niche newsletter writers. If you have an audience of any size, you can refer.',
  },
  {
    q: 'Are there banned promotional methods?',
    a: 'Yes: spam (email or SMS to people who have not opted in), paid search bidding on our brand terms, and cookie-stuffing. Everything else is fair game.',
  },
  {
    q: 'When do I get paid?',
    a: 'Payouts are sent the 1st business day of each month for commissions earned in the previous month (after the 30-day refund window). You must have ≥ $50 in pending commissions to qualify.',
  },
]

export default function AffiliateProgramPage() {
  return (
    <main id="main" className={styles.page}>
      <header className={styles.hero}>
        <p className={styles.eyebrow}>Affiliate program</p>
        <h1 className={styles.h1}>Earn recurring revenue<br />for recommending products you trust.</h1>
        <p className={styles.lede}>
          Promote Uthena's wholesale digital products to your audience. Earn 30% on every
          sale for 12 months, plus lifetime commissions on one-time purchases.
        </p>
        <div className={styles.ctaRow}>
          <Link href="/signup?next=/affiliate/onboarding" className={styles.primaryButton}>
            Apply now
          </Link>
          <Link href="/affiliate/onboarding" className={styles.secondaryButton}>
            How it works
          </Link>
        </div>
      </header>

      <section className={styles.benefits} aria-labelledby="benefits-h">
        <h2 id="benefits-h" className={styles.sectionH}>What you get</h2>
        <ul className={styles.benefitGrid}>
          {BENEFITS.map((b) => (
            <li key={b.title} className={styles.benefitCard}>
              <h3 className={styles.benefitTitle}>{b.title}</h3>
              <p className={styles.benefitBody}>{b.body}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className={styles.faq} aria-labelledby="faq-h">
        <h2 id="faq-h" className={styles.sectionH}>FAQ</h2>
        <dl className={styles.faqList}>
          {FAQ.map((item) => (
            <div key={item.q} className={styles.faqItem}>
              <dt className={styles.faqQ}>{item.q}</dt>
              <dd className={styles.faqA}>{item.a}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className={styles.cta} aria-labelledby="cta-h">
        <h2 id="cta-h" className={styles.ctaH}>Ready to apply?</h2>
        <p className={styles.ctaBody}>
          Approval is same-day for most applicants. We require a public profile (site, list,
          social channel) and a basic fitness check.
        </p>
        <Link href="/signup?next=/affiliate/onboarding" className={styles.primaryButton}>
          Apply now
        </Link>
      </section>
    </main>
  )
}
