// RefundPagination.tsx — URL-driven pager for /admin/refunds.
// Builds prev/next + page-number links with the filter bag preserved.
// Pure RSC. Mirrors OrderPagination.

import Link from 'next/link'
import type { ParsedRefundFilters } from '../types'
import styles from './RefundPagination.module.css'

export type RefundPaginationProps = {
  total: number
  page: number
  perPage: number
  filters: ParsedRefundFilters
}

function pageHref(
  targetPage: number,
  filters: ParsedRefundFilters,
): string {
  const params = new URLSearchParams()
  if (filters.status) params.set('status', filters.status)
  if (filters.from) params.set('from', filters.from)
  if (filters.to) params.set('to', filters.to)
  if (filters.customerEmail) params.set('customerEmail', filters.customerEmail)
  if (filters.productId !== null) params.set('productId', String(filters.productId))
  if (targetPage > 1) params.set('page', String(targetPage))
  const qs = params.toString()
  return qs ? `/admin/refunds?${qs}` : '/admin/refunds'
}

function buildPageList(page: number, totalPages: number): number[] {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, i) => i + 1)
  }
  const set = new Set<number>([1, totalPages, page])
  if (page - 1 >= 1) set.add(page - 1)
  if (page + 1 <= totalPages) set.add(page + 1)
  if (page - 2 >= 1) set.add(page - 2)
  if (page + 2 <= totalPages) set.add(page + 2)
  return Array.from(set).sort((a, b) => (a ?? 0) - (b ?? 0))
}

export function RefundPagination({
  total,
  page,
  perPage,
  filters,
}: RefundPaginationProps) {
  if (total <= perPage) return null
  const totalPages = Math.max(1, Math.ceil(total / perPage))
  const pages = buildPageList(page, totalPages)
  const prev = Math.max(1, page - 1)
  const next = Math.min(totalPages, page + 1)

  return (
    <nav className={styles.pager} aria-label="Refund pagination">
      {page > 1 ? (
        <Link
          href={pageHref(prev, filters)}
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
                <Link href={pageHref(p, filters)} className={styles.link}>
                  {p}
                </Link>
              )}
            </li>
          )
        })}
      </ul>

      {page < totalPages ? (
        <Link
          href={pageHref(next, filters)}
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