// Hero — the top of the homepage. Two-column grid on desktop
// (1.05fr copy + 0.95fr art cells), stacked on mobile. Mockup-faithful
// to `mockups/home.html` lines 45–83.
//
// The art cells come from `getHomeHeroCells()` — the first 4 published
// products when the catalog has data, otherwise a 4-cell mockup-style
// fallback so the visual hierarchy stays intact on an empty database.
//
// Stats (course count, partner count, paid-out, licenses) come from
// `getPublicProductStats()` so they're dynamic, never hard-coded.

import Link from 'next/link'
import type { PublicProductStats, HeroArtCell } from './queries'
import { formatPaidOutShort, formatPartnerCount } from './format'
import styles from './Hero.module.css'

type Props = {
  stats: PublicProductStats
  artCells: HeroArtCell[]
}

export function Hero({ stats, artCells }: Props) {
  return (
    <section className={styles.hero} aria-labelledby="home-hero-h">
      <div className={styles.copy}>
        <p className={styles.eyebrow}>Marketplace · PLR · MRR</p>
        <h1 id="home-hero-h" className={styles.h1}>
          Whitelabel courses.
          <br />
          Sell them as <span className={styles.teal}>your own</span>.
        </h1>
        <p className={styles.lede}>
          Buy Private Label Rights to top-rated video courses. Rebrand them,
          repackage them, resell them — and keep{' '}
          <span className={styles.monoOrange}>100%</span> of the revenue.
        </p>
        <div className={styles.ctaRow}>
          <Link href="/browse" className={styles.btnPrimary}>
            Discover our courses <span className={styles.arrow} aria-hidden>→</span>
          </Link>
          <Link href="#how-it-works" className={styles.btnSecondary}>
            How it works
          </Link>
        </div>
        <dl className={styles.meta}>
          <div className={styles.metaItem}>
            <b className={styles.metaNum}>{stats.courseCount}</b>
            <span className={styles.metaLabel}>Live courses</span>
          </div>
          <div className={styles.metaItem}>
            <b className={styles.metaNum}>{formatPartnerCount(stats.partnerCount)}</b>
            <span className={styles.metaLabel}>Resellers</span>
          </div>
          <div className={styles.metaItem}>
            <b className={styles.metaNum}>
              <span className={styles.teal}>{formatPaidOutShort(stats.paidOutCents)}</span>
            </b>
            <span className={styles.metaLabel}>Paid out</span>
          </div>
          <div className={styles.metaItem}>
            <b className={styles.metaNum}>PLR / MRR</b>
            <span className={styles.metaLabel}>Licenses</span>
          </div>
        </dl>
      </div>
      <div className={styles.heroArt} aria-hidden="true">
        {artCells.slice(0, 4).map((cell, i) => (
          <div key={`${cell.title}-${i}`} className={styles.cell}>
            <span className={styles.cellName}>{cell.title}</span>
            <span
              className={cell.licenseTag === 'MRR' ? styles.tagMrr : styles.tag}
            >
              {cell.licenseTag}
            </span>
          </div>
        ))}
      </div>
    </section>
  )
}
