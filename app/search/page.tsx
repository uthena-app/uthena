// Search results — `/search?q=...`. P0.19.
//
// Public full-page search results. Lands users who submit a query
// through the SiteHeader's pill input (P0.2 — the existing form
// already posts to `/search`) or who navigate to `/search?q=…`
// directly. Renders the same `ProductCard` grid as `/browse` so the
// catalog surface stays visually consistent.
//
// Reuses the P0.4 `searchPublishedProducts` query (same
// tokenization, same RLS matrix, same newest-first ordering).
// Limit is bumped from the overlay's 8 to this page's 60 so the
// full-page view actually shows a usable result list.
//
// Three designed empty states:
//   1. No `q` at all              → "Type to search" + Browse CTA
//   2. `q` but no matches        → "No matches for X" + Browse CTA
//   3. `q` with N>0 matches       → header + count + grid
//
// Why no filters / pagination: the overlay's "type-to-search"
// filter is the search experience; this page is the same
// experience in long form. Pagination at scale is a P19.10
// follow-up; for v1, 60 results is the cap.

import type { Metadata } from 'next'
import Link from 'next/link'
import { z } from 'zod'
import { searchPublishedProducts } from '@features/search/queries'
import { ProductCard } from '@features/catalog/ProductCard'
import { getSubscriptionCatalogAccess } from '@features/library/queries/getSubscriptionCatalogAccess'
import { EmptyState } from '@foundations/ui/primitives/EmptyState'
import { buildPageMetadata } from '@foundations/metadata'
import styles from './search.module.css'

export const revalidate = 60

/** Page size — matches `BROWSE_PAGE_SIZE` in catalog/format.ts. */
const SEARCH_PAGE_SIZE = 60

/** Zod schema for the URL params. `q` is required for a real search;
 *  min 1 char (whitespace-only fails `.trim()`'d downstream) + max 120
 *  (matches the `/api/search` route handler). */
const SearchParams = z.object({
  q: z.string().min(1).max(120).optional(),
})

type SearchParamsResult = z.infer<typeof SearchParams>

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>
}): Promise<Metadata> {
  const sp = await searchParams
  const q = (sp.q ?? '').trim()
  // Empty q → neutral metadata. Non-empty q → query echoed in title.
  // Both cases: canonical = `/search` (no q) so the search experience
  // doesn't pollute the index with per-query duplicates.
  // `robots: noindex` because search results are user-driven and not
  // canonical content. (Matches Google + Bing guidance for internal
  // search result pages.)
  // P0.21 — full OG + Twitter Card via the shared helper, with
  // `noindex: true` baked in (search result pages are
  // user-driven, not canonical content).
  const title = q ? `${q} — Search` : 'Search'
  const description = q
    ? `Search results for "${q}" across every published course on Uthena.`
    : 'Search every published PLR / MRR course on Uthena.'
  // The helper builds the canonical, OG, and Twitter Card. We
  // override `alternates.canonical` to drop the `?q=` so the
  // canonical is the bare `/search` URL (per-query duplicates
  // would otherwise pollute the index).
  const metadata = buildPageMetadata({
    title,
    description,
    path: '/search',
    noindex: true,
  })
  metadata.alternates = { canonical: '/search' }
  return metadata
}

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>
}) {
  const sp: SearchParamsResult = SearchParams.parse(await searchParams)
  const rawQ = sp.q ?? ''
  // The query helper does its own .trim() + tokenize; we trim once
  // here so the empty-state branch fires on whitespace-only input.
  const q = rawQ.trim()

  // ----- Empty state 1: no query -------------------------------------
  // A user landed on /search with nothing typed (e.g. clicked the
  // SiteHeader pill without entering text, or hit /search directly).
  // Show a calm prompt + a path forward (browse all + the same
  // pill they'd see in the header).
  if (q.length === 0) {
    return (
      <main id="main" className={styles.page}>
        <header className={styles.header}>
          <p className={styles.eyebrow}>Search</p>
          <h1 className={styles.h1}>
            Find your <span className={styles.h1Accent}>next course</span>
          </h1>
          <p className={styles.lede}>
            Search across every published course on Uthena by title or short
            description. Type a query in the bar above to start.
          </p>
        </header>
        <EmptyState
          title="Type a query to search."
          description="Try a topic (e.g. “AI marketing”), a category (e.g. “personal branding”), or a course name. Results show up instantly."
          action={
            <Link href="/browse" className={styles.linkBtn}>
              Browse the catalog
            </Link>
          }
        />
      </main>
    )
  }

  // Real query — run the search. The query helper handles tokenization,
  // wildcard sanitization, the 6-token cap, and RLS filtering. It returns
  // up to SEARCH_PAGE_SIZE published products ordered newest-first.
  // Subscription access is fetched in parallel for the P8.2 badge.
  const [products, subscriptionAccess] = await Promise.all([
    searchPublishedProducts(q, SEARCH_PAGE_SIZE),
    getSubscriptionCatalogAccess(),
  ])
  const count = products.length

  // ----- Empty state 2: query but no matches -------------------------
  // Echo the query back so the user knows their input was received.
  // The hint nudges them toward a broader search; the CTA is the
  // canonical "browse everything" fallback.
  if (count === 0) {
    return (
      <main id="main" className={styles.page}>
        <header className={styles.header}>
          <p className={styles.eyebrow}>Search</p>
          <h1 className={styles.h1}>
            No matches for{' '}
            <span className={styles.queryEcho}>&ldquo;{q}&rdquo;</span>
          </h1>
          <p className={styles.lede}>
            We couldn&rsquo;t find a course matching that query. Try a broader
            search, or browse the full catalog.
          </p>
        </header>
        <EmptyState
          title={`No courses match "${q}".`}
          description="Check your spelling, try a shorter or broader query, or browse the catalog to see everything."
          action={
            <Link href="/browse" className={styles.linkBtn}>
              Browse the catalog
            </Link>
          }
        />
      </main>
    )
  }

  // ----- Real results ------------------------------------------------
  // Header echoes the query, active-query chip lets the user clear the
  // search in one click (links to /search with no q). Count + grid
  // match the catalog family rhythm.
  return (
    <main id="main" className={styles.page}>
      <header className={styles.header}>
        <p className={styles.eyebrow}>Search</p>
        <h1 className={styles.h1}>
          Results for{' '}
          <span className={styles.queryEcho}>&ldquo;{q}&rdquo;</span>
        </h1>
        <p className={styles.lede}>
          {count} {count === 1 ? 'course' : 'courses'} matched your search.
        </p>
        <div className={styles.filterChips} role="group" aria-label="Active search">
          <Link
            href="/search"
            className={`${styles.chip} ${styles.chipOn}`}
            aria-label={`Clear search: ${q}`}
          >
            Search: {q} <span className={styles.chipX} aria-hidden>✕</span>
          </Link>
        </div>
      </header>

      <div className={styles.resultsHead}>
        <p className={styles.count} aria-live="polite">
          {count} {count === 1 ? 'course' : 'courses'}
        </p>
      </div>

      <div className={styles.grid}>
        {products.map((p) => (
          <ProductCard
            key={p.id}
            product={p}
            subscriptionIncluded={subscriptionAccess.productIds.has(p.id)}
          />
        ))}
      </div>

      {/* Tail CTA — mirrors the /bundles pattern: a quiet link to the
          full catalog for buyers who didn't find what they wanted
          via search. Same shape, same tone. */}
      <p className={styles.tailCta}>
        Didn&rsquo;t find what you were looking for?{' '}
        <Link href="/browse" className={styles.tailLink}>
          Browse the full catalog →
        </Link>
      </p>
    </main>
  )
}
