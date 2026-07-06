// app/not-found.tsx — route-level 404 surface.
//
// Renders when no Next.js route matches the URL OR when a server component
// calls notFound(). RSC + SSR (no ISR) — every 404 is fresh. No PII is
// echoed back (per error-404.md security §).
//
// This page renders INSIDE the root layout, so SiteHeader + SiteFooter are
// still visible. The page is the friendly dead-end for "this URL doesn't
// resolve to anything we know about" — both a typed-wrong URL and a
// server-side `notFound()` from a route that couldn't find its data.

import type { Metadata } from 'next'
import Link from 'next/link'
import { buildPageMetadata } from '@foundations/metadata'
import { Button } from '@foundations/ui/primitives/Button'
import styles from './not-found.module.css'

// P0.21 — full OG + Twitter Card via the shared helper. `noindex: true`
// because 404s are not canonical content. The canonical path is `/404`
// (the canonical URL the search helpers and OG generator reference),
// but the actual route is dynamic — every URL renders this same UI.
// Per error-404.md §Security: no structured data (BreadcrumbList would
// leak the request shape to crawlers).
export const metadata: Metadata = buildPageMetadata({
  title: 'Page not found',
  description:
    'The page you are looking for may have moved, been retired, or never existed. Search the catalog or head back home.',
  path: '/404',
  noindex: true,
})

export default function NotFound() {
  return (
    <main id="main" className={styles.wrap}>
      <p className={styles.code}>404</p>
      <p className={styles.eyebrow}>Page not found</p>
      <h1 className={styles.h1}>We can&apos;t find that page.</h1>
      <p className={styles.lede}>
        The page you&apos;re looking for may have moved, been retired, or
        never existed. Search the catalog, or head back home.
      </p>

      {/* No-JS search form. Submits as GET to /browse?q=... — works
          without JavaScript (the search overlay on the SiteHeader is the
          JS-enhanced version; this is the canonical fallback). */}
      <form action="/browse" method="GET" className={styles.search} role="search">
        <label htmlFor="not-found-q" className={styles.srOnly}>
          Search the catalog
        </label>
        <input
          id="not-found-q"
          name="q"
          type="search"
          placeholder="Search the catalog"
          autoComplete="off"
          className={styles.searchInput}
        />
        <button type="submit" className={styles.searchSubmit}>
          Search catalog
        </button>
      </form>

      <div className={styles.actions}>
        <Link href="/" aria-label="Go to the homepage">
          <Button variant="secondary">Go home</Button>
        </Link>
        <Link href="/browse" aria-label="Browse the course catalog">
          <Button variant="secondary">Browse catalog</Button>
        </Link>
      </div>

      <p className={styles.support}>
        If you think this is a mistake, email{' '}
        <a
          href="mailto:support@uthena.com?subject=Broken%20link%20on%20uthena.com"
          className={styles.supportLink}
        >
          support@uthena.com
        </a>
        .
      </p>
    </main>
  )
}
