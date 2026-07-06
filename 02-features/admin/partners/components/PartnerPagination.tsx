// PartnerPagination.tsx — URL-driven pager for /admin/partners.
// Builds prev/next + page-number links with the filter bag preserved.
// Pure RSC.

import Link from 'next/link'
import type { ParsedPartnerFilters } from '../types'
import styles from './PartnerPagination.module.css'

export type PartnerPaginationProps = {
  total: number
  page: number
  perPage: number
  filters: ParsedPartnerFilters
  sort: string
}

function pageHref(
  targetPage: number,
  filters: ParsedPartnerFilters,
  sort: string,
): string {
  const params = new URLSearchParams()
  if (filters.status) params.set('status', filters.status)
  if (filters.kycStatus) params.set('kycStatus', filters.kycStatus)
  if (filters.taxFormStatus) params.set('taxFormStatus', filters.taxFormStatus)
  if (filters.appliedFrom) params.set('appliedFrom', filters.appliedFrom)
  if (filters.appliedTo) params.set('appliedTo', filters.appliedTo)
  if (filters.q) params.set('q', filters.q)
  params.set('sort', sort)
  if (targetPage > 1) params.set('page', String(targetPage))
  const qs = params.toString()
  return qs ? `/admin/partners?${qs}` : '/admin/partners'
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

export function PartnerPagination({
  total,
  page,
  perPage,
  filters,
  sort,
}: PartnerPaginationProps) {
  const totalPages = Math.max(1, Math.ceil(total / perPage))
  if (totalPages <= 1) return null

  const pages = buildPageList(page, totalPages)
  const hasPrev = page > 1
  const hasNext = page < totalPages

  // Build with "…" gaps
  const items: Array<{ kind: 'page'; n: number } | { kind: 'gap' }> = []
  for (let i = 0; i < pages.length; i++) {
    const n = pages[i]
    if (n === undefined) continue
    const prev = pages[i - 1]
    if (i > 0 && prev !== undefined && n - prev > 1) items.push({ kind: 'gap' })
    items.push({ kind: 'page', n })
  }

  return (
    <nav className={styles.nav} aria-label="Partner pagination">
      {hasPrev ? (
        <Link href={pageHref(page - 1, filters, sort)} className={styles.link} rel="prev">
          ← Previous
        </Link>
      ) : (
        <span className={`${styles.link} ${styles.disabled}`} aria-disabled="true">
          ← Previous
        </span>
      )}

      <ol className={styles.pages}>
        {items.map((it, idx) =>
          it.kind === 'gap' ? (
            <li key={`gap-${idx}`} className={styles.gap} aria-hidden="true">
              …
            </li>
          ) : (
            <li key={`p-${it.n}`}>
              {it.n === page ? (
                <span className={`${styles.page} ${styles.current}`} aria-current="page">
                  {it.n}
                </span>
              ) : (
                <Link href={pageHref(it.n, filters, sort)} className={styles.page}>
                  {it.n}
                </Link>
              )}
            </li>
          ),
        )}
      </ol>

      {hasNext ? (
        <Link href={pageHref(page + 1, filters, sort)} className={styles.link} rel="next">
          Next →
        </Link>
      ) : (
        <span className={`${styles.link} ${styles.disabled}`} aria-disabled="true">
          Next →
        </span>
      )}
    </nav>
  )
}