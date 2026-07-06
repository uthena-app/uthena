// PartnerTable.tsx — the main data table on /admin/partners.
//
// Columns per spec line 17:
//   display_name · email (admin-visible) · status · kyc_status ·
//   tax_form_status · courses count · lifetime revenue ·
//   lifetime paid out · join date · last activity.
//
// Sortable column headers toggle ?sort=… via plain <a> links
// (no client JS). Each row links to /admin/partners/[id].
//
// Empty state: "No partners match these filters" + a Reset link
// back to /admin/partners. Pure RSC.

import Link from 'next/link'
import { formatDate } from '@features/payouts'
import { formatMoney } from '@foundations/money/cents'
import {
  PARTNER_KYC_LABEL,
  PARTNER_SORT_KEYS,
  PARTNER_STATUS_LABEL,
  PARTNER_TAX_FORM_LABEL,
  type PartnerRow,
  type PartnerSortKey,
  type ParsedPartnerFilters,
} from '../types'
import styles from './PartnerTable.module.css'

const PER_PAGE_DEFAULT = 50

export type PartnerTableProps = {
  rows: PartnerRow[]
  total: number
  page: number
  perPage?: number
  sort: PartnerSortKey
  filters: ParsedPartnerFilters
}

function sortHref(
  next: PartnerSortKey,
  current: PartnerSortKey,
  filters: ParsedPartnerFilters,
  page: number,
): string {
  const params = new URLSearchParams()
  if (filters.status) params.set('status', filters.status)
  if (filters.kycStatus) params.set('kycStatus', filters.kycStatus)
  if (filters.taxFormStatus) params.set('taxFormStatus', filters.taxFormStatus)
  if (filters.appliedFrom) params.set('appliedFrom', filters.appliedFrom)
  if (filters.appliedTo) params.set('appliedTo', filters.appliedTo)
  if (filters.q) params.set('q', filters.q)
  // Switching sort resets to page 1 — the new sort order may shuffle
  // the result set entirely.
  params.set('sort', next)
  if (current === next && page > 1) params.set('page', '1')
  return `/admin/partners?${params.toString()}`
}

function nextSortKey(current: PartnerSortKey, column: PartnerSortKey): PartnerSortKey {
  if (!column.startsWith(currentColumnPrefix(column))) return column
  // Toggle asc/desc within the same column family.
  if (current === column) {
    if (column.endsWith('_asc')) {
      const desc = column.replace(/_asc$/, '_desc') as PartnerSortKey
      if ((PARTNER_SORT_KEYS as readonly string[]).includes(desc)) return desc
    }
  }
  return column
}

function currentColumnPrefix(k: PartnerSortKey): string {
  // e.g. 'revenue_desc' -> 'revenue'
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
  columnKey: PartnerSortKey
  currentSort: PartnerSortKey
  filters: ParsedPartnerFilters
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

export function PartnerTable({
  rows,
  total,
  page,
  perPage = PER_PAGE_DEFAULT,
  sort,
  filters,
}: PartnerTableProps) {
  if (rows.length === 0) {
    return (
      <div className={styles.empty}>
        <p className={styles.emptyText}>No partners match these filters.</p>
        <Link href="/admin/partners" className={styles.emptyLink}>
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
              <th scope="col">Email</th>
              <th scope="col">Status</th>
              <th scope="col">KYC</th>
              <th scope="col">Tax form</th>
              <SortHeader
                label="Courses"
                columnKey="courses_desc"
                currentSort={sort}
                filters={filters}
                page={page}
                align="right"
              />
              <SortHeader
                label="Lifetime revenue"
                columnKey="revenue_desc"
                currentSort={sort}
                filters={filters}
                page={page}
                align="right"
              />
              <SortHeader
                label="Lifetime paid out"
                columnKey="paid_desc"
                currentSort={sort}
                filters={filters}
                page={page}
                align="right"
              />
              <SortHeader
                label="Applied"
                columnKey="applied_desc"
                currentSort={sort}
                filters={filters}
                page={page}
              />
              <SortHeader
                label="Last active"
                columnKey="activity_desc"
                currentSort={sort}
                filters={filters}
                page={page}
              />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.partner_id} data-status={row.status}>
                <td>
                  <Link href={`/admin/partners/${row.partner_id}`} className={styles.nameLink}>
                    {row.display_name || `Partner #${row.partner_id}`}
                  </Link>
                </td>
                <td className={styles.emailCell}>{row.email}</td>
                <td>
                  <span className={styles.status} data-status={row.status}>
                    {PARTNER_STATUS_LABEL[row.status]}
                  </span>
                </td>
                <td>
                  <span className={styles.kyc} data-kyc={row.kyc_status}>
                    {PARTNER_KYC_LABEL[row.kyc_status]}
                  </span>
                </td>
                <td>
                  <span className={styles.taxForm} data-tax={row.tax_form_status}>
                    {PARTNER_TAX_FORM_LABEL[row.tax_form_status]}
                  </span>
                </td>
                <td data-align="right" className={styles.numeric}>
                  {row.courses_count.toLocaleString('en-US')}
                </td>
                <td data-align="right" className={styles.numeric}>
                  {formatMoney(row.lifetime_revenue_cents)}
                </td>
                <td data-align="right" className={styles.numeric}>
                  {formatMoney(row.lifetime_paid_out_cents)}
                </td>
                <td>{formatDate(row.applied_at)}</td>
                <td>
                  {row.last_active_at && !row.last_active_at.startsWith('1970-')
                    ? formatDate(row.last_active_at)
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