// AffiliateTable.tsx — the main data table on /admin/affiliates.
//
// Columns per spec line 17:
//   display_name · handle · email (admin-visible) · status ·
//   lifetime_earned · pending_balance · available_balance ·
//   clicks_30d · conversions_30d · conversion_rate · joined date ·
//   last activity.
//
// Sortable column headers toggle ?sort=… via plain <a> links
// (no client JS). Each row links to /admin/affiliates/[id].
//
// Empty state: "No affiliates match these filters" + a Reset link
// back to /admin/affiliates. Pure RSC.

import Link from 'next/link'
import { formatDate } from '@features/payouts'
import { formatMoney } from '@foundations/money/cents'
import {
  AFFILIATE_SORT_KEYS,
  AFFILIATE_STATUS_LABEL,
  formatConversionRate,
  type AffiliateRow,
  type AffiliateSortKey,
  type ParsedAffiliateFilters,
} from '../types'
import styles from './AffiliateTable.module.css'

const PER_PAGE_DEFAULT = 50

export type AffiliateTableProps = {
  rows: AffiliateRow[]
  total: number
  page: number
  perPage?: number
  sort: AffiliateSortKey
  filters: ParsedAffiliateFilters
}

function sortHref(
  next: AffiliateSortKey,
  current: AffiliateSortKey,
  filters: ParsedAffiliateFilters,
  page: number,
): string {
  const params = new URLSearchParams()
  if (filters.status) params.set('status', filters.status)
  if (filters.joinedFrom) params.set('joinedFrom', filters.joinedFrom)
  if (filters.joinedTo) params.set('joinedTo', filters.joinedTo)
  if (filters.q) params.set('q', filters.q)
  // Switching sort resets to page 1 — the new sort order may shuffle
  // the result set entirely.
  params.set('sort', next)
  if (current === next && page > 1) params.set('page', '1')
  return `/admin/affiliates?${params.toString()}`
}

function nextSortKey(current: AffiliateSortKey, column: AffiliateSortKey): AffiliateSortKey {
  if (!column.startsWith(currentColumnPrefix(column))) return column
  // Toggle asc/desc within the same column family.
  if (current === column) {
    if (column.endsWith('_asc')) {
      const desc = column.replace(/_asc$/, '_desc') as AffiliateSortKey
      if ((AFFILIATE_SORT_KEYS as readonly string[]).includes(desc)) return desc
    }
  }
  return column
}

function currentColumnPrefix(k: AffiliateSortKey): string {
  // e.g. 'earned_desc' -> 'earned'
  const idx = k.lastIndexOf('_')
  return idx > 0 ? k.slice(0, idx) : k
}

function SortHeader({
  label,
  columnKey,
  currentSort,
  filters,
  page,
  align = 'left',
}: {
  label: string
  columnKey: AffiliateSortKey
  currentSort: AffiliateSortKey
  filters: ParsedAffiliateFilters
  page: number
  align?: 'left' | 'right'
}) {
  const next = nextSortKey(currentSort, columnKey)
  const isActive = currentSort === columnKey || currentSort === nextSortKey(currentSort, columnKey)
  const arrow = isActive ? (currentSort.endsWith('_asc') ? '▲' : '▼') : ''
  return (
    <th scope="col" data-align={align}>
      <Link
        href={sortHref(next, currentSort, filters, page)}
        className={styles.sortLink}
        data-active={isActive ? 'true' : 'false'}
        aria-label={`Sort by ${label}${isActive ? (currentSort.endsWith('_asc') ? ' (currently ascending)' : ' (currently descending)') : ''}`}
      >
        <span>{label}</span>
        <span aria-hidden="true" className={styles.arrow}>
          {arrow || '↕'}
        </span>
      </Link>
    </th>
  )
}

export function AffiliateTable({
  rows,
  total,
  page,
  perPage = PER_PAGE_DEFAULT,
  sort,
  filters,
}: AffiliateTableProps) {
  if (rows.length === 0) {
    return (
      <div className={styles.empty}>
        <p className={styles.emptyText}>No affiliates match these filters.</p>
        <Link href="/admin/affiliates" className={styles.emptyLink}>
          Reset filters
        </Link>
      </div>
    )
  }

  const startRank = (page - 1) * perPage + 1
  const endRank = startRank + rows.length - 1

  return (
    <>
      <div className={styles.tableScroll}>
        <table className={styles.table}>
          <thead>
            <tr>
              <SortHeader
                label="Name"
                columnKey="name_asc"
                currentSort={sort}
                filters={filters}
                page={page}
              />
              <th scope="col">Handle</th>
              <th scope="col">Email</th>
              <th scope="col">Status</th>
              <SortHeader
                label="Lifetime earned"
                columnKey="earned_desc"
                currentSort={sort}
                filters={filters}
                page={page}
                align="right"
              />
              <th scope="col" data-align="right">
                Pending
              </th>
              <th scope="col" data-align="right">
                Available
              </th>
              <SortHeader
                label="Clicks (30d)"
                columnKey="clicks_desc"
                currentSort={sort}
                filters={filters}
                page={page}
                align="right"
              />
              <SortHeader
                label="Conv. (30d)"
                columnKey="conversions_desc"
                currentSort={sort}
                filters={filters}
                page={page}
                align="right"
              />
              <th scope="col" data-align="right">
                Conv. rate
              </th>
              <SortHeader
                label="Joined"
                columnKey="activity_desc"
                currentSort={sort}
                filters={filters}
                page={page}
              />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.affiliate_id} data-status={row.status}>
                <td>
                  <Link
                    href={`/admin/affiliates/${row.affiliate_id}`}
                    className={styles.nameLink}
                  >
                    {row.display_name || `Affiliate #${row.affiliate_id}`}
                  </Link>
                </td>
                <td className={styles.handleCell}>@{row.handle}</td>
                <td className={styles.emailCell}>{row.email}</td>
                <td>
                  <span className={styles.status} data-status={row.status}>
                    {AFFILIATE_STATUS_LABEL[row.status]}
                  </span>
                </td>
                <td data-align="right" className={styles.numeric}>
                  {formatMoney(row.lifetime_earned_cents)}
                </td>
                <td data-align="right" className={styles.numeric}>
                  {formatMoney(row.pending_balance_cents)}
                </td>
                <td data-align="right" className={styles.numeric}>
                  {formatMoney(row.available_balance_cents)}
                </td>
                <td data-align="right" className={styles.numeric}>
                  {row.clicks_30d.toLocaleString('en-US')}
                </td>
                <td data-align="right" className={styles.numeric}>
                  {row.conversions_30d.toLocaleString('en-US')}
                </td>
                <td data-align="right" className={styles.numeric}>
                  {formatConversionRate(row.conversions_30d, row.clicks_30d)}
                </td>
                <td>
                  {row.last_activity_at && !row.last_activity_at.startsWith('1970-')
                    ? formatDate(row.last_activity_at)
                    : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className={styles.summary}>
        Showing {startRank.toLocaleString('en-US')}–{endRank.toLocaleString('en-US')} of{' '}
        {total.toLocaleString('en-US')}
      </p>
    </>
  )
}