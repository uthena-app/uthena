// /library — the buyer's owned content. RSC. Reads via the
// user_accessible_products RPC (single roundtrip) and renders the
// result. No N+1, no per-product queries.
//
// P7.1 Slice 1 — composes <LibraryStats> (2-tile header summary)
// + grouped file vault (one h3 per product, count badge in corner).
// P7.9 — file vault search (filter by product / format / date added).
// URL-driven filters via <VaultFilterBar>; the page reads the URL
// params, runs filterVaultFiles, then re-groups the result with
// groupVaultFilesByProduct so the grouped shape survives filtering.

import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { requireUser } from '@foundations/auth/guards'
import { FILE_KINDS, type FileKind } from '@foundations/data/enums'
import {
  getUserLibrary,
  getUserAccessibleFiles,
  LibraryRow,
  VaultItem,
  EmptyLibraryState,
  LibraryStats,
  groupVaultFilesByProduct,
  filterVaultFiles,
  VaultFilterBar,
  BulkDownloadBar,
  type VaultProductOption,
} from '@features/library'
import {
  getLibraryProgress,
  getContinueWatching,
} from '@features/lms'
import { ContinueWatchingRail } from './ContinueWatchingRail'
import { sensitivePageMetadata } from '@foundations/metadata'
import { LibraryNav } from './LibraryNav'
import styles from './page.module.css'

/** Stable id for the bulk-download form on this page. Used by the
 *  BulkDownloadBar client island to find the form via
 *  `document.getElementById`. */
const BULK_FORM_ID = 'vault-bulk-download-form'

// P0.21 — `noindex` so the library surface isn't indexed. Course
// titles + license tiers in the URL would leak purchase history.
export const metadata: Metadata = sensitivePageMetadata({
  title: 'My library',
  description: 'Your Uthena library — every course you own, with video + downloads.',
  path: '/library',
})
export const dynamic = 'force-dynamic'

type LibrarySearchParams = {
  product?: string
  kind?: string
  since?: string
}

function parseProductId(raw: string | undefined): number | null {
  if (raw == null || raw === '') return null
  const n = Number(raw)
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) return null
  return n
}

function parseKind(raw: string | undefined): FileKind | 'all' {
  if (raw && (FILE_KINDS as readonly string[]).includes(raw)) return raw as FileKind
  return 'all'
}

type SinceFilter = 'all' | 30 | 90 | 365
function parseSince(raw: string | undefined): SinceFilter {
  if (raw === '30') return 30
  if (raw === '90') return 90
  if (raw === '365') return 365
  return 'all'
}

export default async function LibraryPage({
  searchParams,
}: {
  searchParams: Promise<LibrarySearchParams>
}) {
  const user = await requireUser('/library')
  if (!user) redirect('/login?next=/library')

  // Next 15: searchParams is a Promise.
  const params = await searchParams
  const productId = parseProductId(params.product)
  const kind = parseKind(params.kind)
  const sinceDays = parseSince(params.since)

  const [library, files, progressMap, continueWatching] = await Promise.all([
    getUserLibrary(),
    getUserAccessibleFiles(),
    getLibraryProgress(),
    getContinueWatching(5),
  ])

  if (library.length === 0) {
    return (
      <main id="main" className={styles.page}>
        <header className={styles.header}>
          <h1 className={styles.h1}>My library</h1>
          <p className={styles.sub}>Hi {user.display_name} — your owned courses show up here.</p>
        </header>
        <EmptyLibraryState />
      </main>
    )
  }

  // Group by access_source for the "Personal Access" rail at the top.
  const subscriptionItems = library.filter((p) => p.access_source === 'subscription')
  const purchaseItems = library.filter((p) => p.access_source !== 'subscription')

  // Build the available-product list for the filter bar from the
  // unfiltered vault rows — the user can only filter to products they
  // actually own (defense in depth: even if the URL contains a
  // product_id the user doesn't own, the filter returns []).
  const seen = new Map<number, string>()
  for (const f of files) {
    if (!seen.has(f.product_id)) seen.set(f.product_id, f.product_title)
  }
  const availableProducts: VaultProductOption[] = Array.from(seen.entries())
    .map(([id, title]) => ({ id, title }))
    // Sort by title (case-insensitive) — same shape as the grouped
    // vault so the chip order matches the heading order on the page.
    .sort((a, b) => a.title.localeCompare(b.title, 'en', { sensitivity: 'base' }))

  // Apply the URL-driven filters (P7.9). The full vault is the input
  // even when filters are active, so the empty / summary / group
  // counts all have a reference point.
  const filteredFiles = filterVaultFiles(files, {
    productId,
    kind: kind === 'all' ? null : kind,
    sinceDays: sinceDays === 'all' ? null : sinceDays,
  })
  const vaultGroups = groupVaultFilesByProduct(filteredFiles)
  const filtersActive = productId != null || kind !== 'all' || sinceDays !== 'all'

  return (
    <main id="main" className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.h1}>My library</h1>
        <p className={styles.sub}>
          Hi {user.display_name} — you have {library.length} {library.length === 1 ? 'course' : 'courses'}.
        </p>
        <LibraryStats stats={{ total_courses: library.length, total_files: files.length }} />
      </header>

      {continueWatching.length > 0 && (
        <ContinueWatchingRail items={continueWatching} />
      )}

      <div className={styles.layout}>
        <LibraryNav />

        <div className={styles.content}>
          {subscriptionItems.length > 0 && (
            <section className={styles.section} aria-label="Personal Access">
              <h2 className={styles.h2}>Personal Access</h2>
              <p className={styles.sectionHint}>
                Included with your subscription. Cancel anytime; access continues until the period ends.
              </p>
              <ul className={styles.list}>
                {subscriptionItems.map((p) => (
                  <li key={p.product_id}>
                    <LibraryRow product={p} progress={progressMap.get(p.product_id) ?? null} />
                  </li>
                ))}
              </ul>
            </section>
          )}

          {purchaseItems.length > 0 && (
            <section className={styles.section} aria-label="Purchased">
              <h2 className={styles.h2}>Purchased</h2>
              <ul className={styles.list}>
                {purchaseItems.map((p) => (
                  <li key={p.product_id}>
                    <LibraryRow product={p} progress={progressMap.get(p.product_id) ?? null} />
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className={styles.section} aria-label="File vault">
            <h2 className={styles.h2}>File vault</h2>
            <p className={styles.sectionHint}>
              Source files, transcripts, and sales materials for everything you own. Generate a
              24h signed link for any file.
            </p>
            {files.length === 0 ? (
              <VaultEmptyState hasLibrary={library.length > 0} />
            ) : (
              <>
                <VaultFilterBar
                  availableProducts={availableProducts}
                  current={{ productId, kind, sinceDays: sinceDays === 'all' ? 'all' : String(sinceDays) as '30' | '90' | '365' }}
                />
                {filtersActive && (
                  <p className={styles.vaultSummary} role="status" aria-live="polite">
                    Showing {filteredFiles.length} of {files.length} files.{' '}
                    <Link href="/library" className={styles.vaultSummaryClear}>
                      Clear filters
                    </Link>
                  </p>
                )}
                {vaultGroups.length === 0 ? (
                  <VaultFilterEmptyState />
                ) : (
                  <>
                    {/*
                      P7.4 — the form wrapping the vault groups. The
                      action points at the route handler that streams
                      the zip; the method is POST so the file_ids
                      can be in the body. The bar above the list is
                      the submit trigger.
                    */}
                    <BulkDownloadBar formId={BULK_FORM_ID} />
                    <form
                      id={BULK_FORM_ID}
                      action="/api/library/bulk-download"
                      method="post"
                      className={styles.bulkForm}
                    >
                      <ul className={styles.vaultGroups}>
                        {vaultGroups.map((g) => (
                          <li key={g.product_id} className={styles.vaultGroup}>
                            <header className={styles.vaultGroupHead}>
                              <h3 className={styles.vaultGroupTitle}>{g.product_title}</h3>
                              <span className={styles.vaultGroupCount}>
                                {g.files.length} {g.files.length === 1 ? 'file' : 'files'}
                              </span>
                            </header>
                            <ul className={styles.vaultList}>
                              {g.files.map((f) => (
                                <VaultItem key={f.id} file={f} />
                              ))}
                            </ul>
                          </li>
                        ))}
                      </ul>
                    </form>
                  </>
                )}
              </>
            )}
          </section>
        </div>
      </div>
    </main>
  )
}

// Two empty states for the file vault:
//   - User has library items but no files attached: friendly explanation.
//   - Edge case: the vault ran empty even though the user has no library
//     items either — already handled by the early-return above, but kept
//     here for defensive typing.
function VaultEmptyState({ hasLibrary }: { hasLibrary: boolean }) {
  return (
    <p className={styles.empty}>
      {hasLibrary
        ? 'No downloadable files for any of your courses yet.'
        : 'No downloadable files yet.'}{' '}
      <Link href="/browse" className={styles.vaultCta}>
        Browse catalog
      </Link>
    </p>
  )
}

// P7.9 — empty state when the user has vault files but the active
// filters exclude all of them. Distinct copy from the "no files at all"
// state because the diagnostic is different ("the filters are too narrow"
// vs "your courses don't have source files attached").
function VaultFilterEmptyState() {
  return (
    <p className={styles.empty}>
      No files match the current filter.{' '}
      <Link href="/library" className={styles.vaultCta}>
        Clear filters
      </Link>
    </p>
  )
}