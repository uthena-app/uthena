// ProsePage.tsx — the shared layout shell for legal pages.
//
// Responsibilities:
//   - Render the H1.
//   - Show "Last updated YYYY-MM-DD" if the markdown frontmatter has it.
//   - Render the body (already React nodes) inside a ~720px prose column.
//   - Show a "See also" cross-link list at the bottom (if any).
//   - Render a "Questions? Email ..." mailto line, customizable per page.
//
// This is an RSC. No client JS. No interactivity. The body itself is
// server-rendered React from the safe markdown renderer in
// `queries/getLegalMarkdown.ts`.

import Link from 'next/link'
import type { ReactNode } from 'react'
import styles from './ProsePage.module.css'

type Props = {
  /** The page H1. */
  title: string
  /** Optional last-updated ISO date string. */
  lastUpdated?: string | undefined
  /** The body, as React nodes, from the markdown renderer. */
  body: ReactNode
  /** Cross-link entries rendered as a "See also" footer. */
  seeAlso?: ReadonlyArray<{ label: string; href: string }> | undefined
  /** Mailto label, e.g. "Questions? Email legal@uthena.com". */
  contactLabel?: string
  /** Mailto href, e.g. "mailto:legal@uthena.com". */
  contactHref?: string
  /**
   * Optional content rendered between the page header and the markdown
   * body. Used by `/dmca` to slot in the data-driven DMCA agent
   * contact card (P10.4). The slot is unstyled — components passed
   * in are responsible for their own padding/margin (the agent card
   * includes a 32px bottom margin so it visually separates from the
   * first markdown H2).
   */
  beforeBody?: ReactNode
}

export function ProsePage({
  title,
  lastUpdated,
  body,
  seeAlso,
  contactLabel,
  contactHref,
  beforeBody,
}: Props) {
  return (
    <main className={styles.page} id="main">
      <article className={styles.prose}>
        <header className={styles.header}>
          <h1 className={styles.h1}>{title}</h1>
          {lastUpdated && (
            <p className={styles.meta}>
              <span className={styles.metaLabel}>Last updated</span>
              <time dateTime={lastUpdated}>{formatHumanDate(lastUpdated)}</time>
            </p>
          )}
        </header>
        {beforeBody}
        <div className={styles.body}>{body}</div>
        {seeAlso && seeAlso.length > 0 && (
          <aside className={styles.seeAlso} aria-label="See also">
            <p className={styles.seeAlsoLabel}>See also</p>
            <ul className={styles.seeAlsoList}>
              {seeAlso.map((entry) => (
                <li key={entry.href}>
                  {entry.href.startsWith('http') ? (
                    <a
                      href={entry.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={styles.seeAlsoLink}
                    >
                      {entry.label}
                    </a>
                  ) : (
                    <Link href={entry.href} className={styles.seeAlsoLink}>
                      {entry.label}
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </aside>
        )}
        {contactLabel && contactHref && (
          <p className={styles.footContact}>
            {contactLabel.startsWith('mailto:') ? (
              <a href={contactHref} className={styles.footLink}>
                {contactLabel.replace(/^mailto:/, '')}
              </a>
            ) : (
              <>
                {contactLabel}{' '}
                <a href={contactHref} className={styles.footLink}>
                  {contactHref.replace(/^mailto:/, '')}
                </a>
              </>
            )}
          </p>
        )}
      </article>
    </main>
  )
}

function formatHumanDate(iso: string): string {
  // Render "2026-01-15" as "January 15, 2026". We parse manually to
  // avoid timezone surprises from `new Date(iso)`.
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!m) return iso
  const year = m[1]
  const month = m[2]
  const day = m[3]
  const monthNames = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ]
  const monthIdx = Number.parseInt(month ?? '1', 10) - 1
  const monthName = monthNames[monthIdx] ?? month
  return `${monthName} ${Number.parseInt(day ?? '1', 10)}, ${year}`
}
