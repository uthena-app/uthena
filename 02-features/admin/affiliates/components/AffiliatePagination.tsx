// AffiliatePagination.tsx — URL-driven pager for /admin/affiliates.
// Builds prev/next + page-number links with the filter bag preserved.
// Pure RSC. Mirrors PartnerPagination.

import Link from 'next/link'
import type { ParsedAffiliateFilters } from '../types'
import styles from './AffiliatePagination.module.css'

export type AffiliatePaginationProps = {
  total: number
  page: number
  perPage: number
  filters: ParsedAffiliateFilters
  sort: string
}

function pageHref(
  targetPage: number,
  filters: ParsedAffiliateFilters,
  sort: string,
): string {
  const params = new URLSearchParams()
  if (filters.status) params.set('status', filters.status)
  if (filters.joinedFrom) params.set('joinedFrom', filters.joinedFrom)
  if (filters.joinedTo) params.set('joinedTo', filters.joinedTo)
  if (filters.q) params.set('q', filters.q)
  params.set('sort', sort)
  if (targetPage > 1) params.set('page', String(targetPage))
  const qs = params.toString()
  return qs ? `/admin/affiliates?${qs}` : '/admin/affiliates'
}

function buildPageList(page: number, totalPages: number): number[] {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, i) => i + 1)
  }
  // Compact form: 1 … (page-1) page (page+1) … totalPages
  const set = new Set<number>([1, totalPages, page])
  if (page - 1 >= 1) set.add(page - 1)
  if (page + 1 <= totalPages) set.add(page + 1)
  if (page - 2 >= 1) set.add(page - 2)
  if (page + 2 <= totalPages) set.add(page + 2)
  return Array.from(set).sort((a, b) => (a ?? 0) - (b ?? 0))
}

export function AffiliatePagination({
  total,
  page,
  perPage,
  filters,
  sort,
}: AffiliatePaginationProps) {
  if (total <= perPage) return null // single page; skip the pager entirely
  const totalPages = Math.max(1, Math.ceil(total / perPage))
  const pages = buildPageList(page, totalPages)
  const prev = Math.max(1, page - 1)
  const next = Math.min(totalPages, page + 1)

  return (
    <nav className={styles.pager} aria-label="Affiliate pagination">
      {page > 1 ? (
        <Link
          href={pageHref(prev, filters, sort)}
          className={styles.link}
          rel="prev"
          aria-label="Previous page"
        >
          ← Previous
        </Link>
      ) : (
        <span className={styles.disabled} aria-disabled="true">
          ← Previous
        </span>
      )}

      <ul className={styles.pages}>
        {pages.map((p, idx) => {
          const prevPage = pages[idx - 1]
          const showGap = prevPage !== undefined && p - prevPage > 1
          return (
            <li key={p} className={styles.pageItem}>
              {showGap && <span className={styles.gap}>…</span>}
              {p === page ? (
                <span className={styles.current} aria-current="page">
                  {p}
                </span>
              ) : (
                <Link href={pageHref(p, filters, sort)} className={styles.link}>
                  {p}
                </Link>
              )}
            </li>
          )
        })}
      </ul>

      {page < totalPages ? (
        <Link
          href={pageHref(next, filters, sort)}
          className={styles.link}
          rel="next"
          aria-label="Next page"
        >
          Next →
        </Link>
      ) : (
        <span className={styles.disabled} aria-disabled="true">
          Next →
        </span>
      )}
    </nav>
  )
}