// SiteFooter.tsx — global footer, present on every page.
//
// Structure (matches mockups/home.html lines 257–300):
//   1. <ftr>              — light zone (var(--footer-bg)) on top of the
//                            otherwise-dark page; sits below <main> with
//                            var(--s-9) top margin to separate it.
//   2. <container>        — max-width wrapper, same width as header.
//   3. <grid>             — 4 columns: brand+pay (1.4fr) · Marketplace ·
//                            Earn · Company. Collapses to 2×2 ≤ 880px,
//                            stacks ≤ 640px.
//   4. <bottom>           — hairline divider + copyright + tagline row.
//
// Server component. All copy is data-driven from `./lib/footerCopy`.
// No client JS — the footer has no interactivity. The brand wordmark
// is a plain link so it shows the standard focus ring.

import Link from 'next/link'
import {
  FOOTER_COLUMNS,
  FOOTER_BRAND_LINE,
  FOOTER_COPYRIGHT,
  FOOTER_TAGLINE,
  PAYMENT_CHIPS,
} from './lib/footerCopy'
import styles from './SiteFooter.module.css'

export function SiteFooter() {
  return (
    <footer className={styles.footer}>
      <div className={styles.container}>
        <div className={styles.grid}>
          {/* ----- Column 1: brand + tagline + pay chips ----- */}
          <div className={styles.brandCol}>
            <Link href="/" className={styles.logo} aria-label="Uthena home">
              <span className={styles.logoWord}>Uthena</span>
              <span className={styles.logoDot} aria-hidden>
                .
              </span>
            </Link>
            <p className={styles.brandLine}>{FOOTER_BRAND_LINE}</p>
            <div className={styles.pay} aria-label="Accepted payment methods">
              {PAYMENT_CHIPS.map((chip) => (
                <span key={chip} className={styles.chip}>
                  {chip}
                </span>
              ))}
            </div>
          </div>

          {/* ----- Columns 2–4: nav groups ----- */}
          {FOOTER_COLUMNS.map((col) => (
            <div key={col.heading} className={styles.col}>
              <h2 className={styles.colHead}>{col.heading}</h2>
              <ul className={styles.list}>
                {col.links.map((link) => (
                  <li key={`${col.heading}-${link.label}`}>
                    <Link href={link.href} className={styles.link}>
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* ----- Bottom bar: copyright + tagline ----- */}
        <div className={styles.bottom}>
          <span className={styles.bottomText}>{FOOTER_COPYRIGHT}</span>
          <span className={styles.bottomTagline}>{FOOTER_TAGLINE}</span>
        </div>
      </div>
    </footer>
  )
}