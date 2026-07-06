// /library/downloads — the user's audit log of every signed URL mint.
// RSC. Auth-gated. noindex (same surface class as /library).
//
// What this page shows:
//   - Filter strip (kind: all / downloads / streams; window: 30 / 90 /
//     365 days / all time). URL-driven so links share + survive refresh.
//   - Table of rows (one per file_downloads audit row matching the
//     filters). Columns: When / What / Kind / IP (masked) / Device /
//     Edge / Expires.
//   - Empty state when no rows match ("You haven't generated any
//     download links yet." + Browse CTA).
//   - DB-error state when the read fails ("We couldn't load your
//     download history." + support link).
//
// Data flow:
//   - Page reads URL params via Next's async `searchParams` prop.
//   - getDownloadHistory({ since, kind, limit }) returns the entries
//     + echoed filters.
//   - Page renders <DownloadHistoryFilters /> (client island, owns the
//     URL state) + <DownloadHistoryTable /> (RSC, reads the entries
//     we just fetched).

import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { requireUser } from '@foundations/auth/guards'
import {
  getDownloadHistory,
  DEFAULT_HISTORY_WINDOW_DAYS,
  windowSince,
  type DownloadHistoryFilters,
} from '@features/library/queries/getDownloadHistory'
import { DownloadHistoryFilterBar } from '@features/library/components/DownloadHistoryFilters'
import { DownloadHistoryTable } from '@features/library/components/DownloadHistoryTable'
import { sensitivePageMetadata } from '@foundations/metadata'
import styles from './page.module.css'

// P0.21 — `noindex` so download history isn't indexed. The IP + UA
// columns are mildly identifying; the user-agent in particular
// leaks "who you are on this network" history.
export const metadata: Metadata = sensitivePageMetadata({
  title: 'Download history',
  description: 'Every signed URL we have generated for your files.',
  path: '/library/downloads',
})
// User-specific data; never cache.
export const dynamic = 'force-dynamic'

type Params = {
  // Next 15 — async searchParams
  searchParams: Promise<{ kind?: string; days?: string }>
}

export default async function DownloadHistoryPage({ searchParams }: Params) {
  const user = await requireUser('/library/downloads')
  if (!user) redirect('/login?next=/library/downloads')

  const { kind: kindRaw, days: daysRaw } = await searchParams
  const kind = parseKind(kindRaw)
  const windowDays = parseWindowDays(daysRaw)

  const filters: Partial<DownloadHistoryFilters> = {
    since: windowSince(windowDays),
    kind: kind === 'all' ? null : kind,
  }
  const result = await getDownloadHistory(filters)

  const windowLabel = windowDays === 'all' ? 'all time' : `last ${windowDays} days`
  const kindLabel = kind === 'all' ? 'downloads and streams' : `${kind}s`

  return (
    <main id="main" className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.h1}>Download history</h1>
        <p className={styles.sub}>
          Every signed URL we have generated for your files. Lasts 24 hours for
          downloads and 4 hours for streams; the rows stay here so you can see what
          you downloaded, when, and from where.
        </p>
      </header>

      <DownloadHistoryFilterBar />

      {result.total_in_window === -1 ? (
        <ErrorState />
      ) : result.entries.length === 0 ? (
        <EmptyState hasFilters={kind !== 'all' || windowDays !== String(DEFAULT_HISTORY_WINDOW_DAYS)} />
      ) : (
        <>
          <p className={styles.summary}>
            Showing <strong>{result.entries.length}</strong> {result.entries.length === 1 ? 'entry' : 'entries'}
            {' · '}
            <span className={styles.muted}>
              {kindLabel} in the {windowLabel}
            </span>
            {result.entries.length >= result.filters.limit && (
              <span className={styles.truncatedNote}>
                {' · '}
                Showing the most-recent {result.filters.limit} entries. Narrow the
                window to see older ones.
              </span>
            )}
          </p>
          <DownloadHistoryTable entries={result.entries} />
          <p className={styles.footnote}>
            Showing your own data only. IP addresses are masked (last octet hidden);
            user-agents are shortened to browser + OS for readability.{' '}
            <Link href="/contact" className={styles.footnoteLink}>
              Report an issue
            </Link>
          </p>
        </>
      )}
    </main>
  )
}

// ---- local helpers ----

function parseKind(raw: string | undefined): 'all' | 'download' | 'stream' {
  if (raw === 'download' || raw === 'stream') return raw
  return 'all'
}

function parseWindowDays(raw: string | undefined): '30' | '90' | '365' | 'all' {
  if (raw === '30' || raw === '90' || raw === '365' || raw === 'all') return raw
  // The "Last year" chip is the default — matches the spec's
  // "shows every signed URL mint" while bounding the query for p95.
  return '365'
}

// ---- empty / error states ----

function EmptyState({ hasFilters }: { hasFilters: boolean }) {
  return (
    <div className={styles.empty}>
      <p className={styles.emptyTitle}>
        {hasFilters
          ? 'No downloads match the current filter.'
          : "You haven't generated any download links yet."}
      </p>
      <p className={styles.emptyBody}>
        {hasFilters
          ? 'Try widening the window or selecting "All" to see every entry.'
          : 'Head to your file vault and click "Generate link" on any file.'}{' '}
        <Link href="/library" className={styles.emptyCta}>
          Go to library
        </Link>
      </p>
    </div>
  )
}

function ErrorState() {
  return (
    <div className={styles.error} role="alert">
      <p className={styles.emptyTitle}>We could not load your download history.</p>
      <p className={styles.emptyBody}>
        This is usually a temporary read error. Refresh the page, or{' '}
        <Link href="/contact" className={styles.emptyCta}>
          contact support
        </Link>{' '}
        if it keeps happening.
      </p>
    </div>
  )
}
