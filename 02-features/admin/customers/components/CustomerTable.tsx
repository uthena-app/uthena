// CustomerTable.tsx — the main data table on /admin/customers.
//
// Columns per spec line 17:
//   display_name · email (admin-visible) · role · signup_date ·
//   lifetime_spend · order_count · library_size · last_active ·
//   status · risk_score (with hover tooltip breakdown).
//
// Sortable column headers toggle ?sort=…&dir=… via plain <a> links
// (no client JS). Each row links to /admin/customers/[id].
//
// Empty state: "No customers match these filters" + a Reset link
// back to /admin/customers. Pure RSC.

import Link from 'next/link'
import { formatDate } from '@features/payouts'
import { formatMoney } from '@foundations/money/cents'
import {
  CUSTOMER_SORT_KEYS,
  DEFAULT_CUSTOMER_SORT,
  type CustomerRow,
  type CustomerSortKey,
  type ParsedCustomerFilters,
} from '../types'
import { RiskScoreBadge } from './RiskScoreBadge'
import styles from './CustomerTable.module.css'

const PER_PAGE_DEFAULT = 50

export type CustomerTableProps = {
  rows: CustomerRow[]
  total: number
  page: number
  perPage?: number
  sort: CustomerSortKey
  filters: ParsedCustomerFilters
}

function sortHref(
  next: CustomerSortKey,
  current: CustomerSortKey,
  filters: ParsedCustomerFilters,
  page: number,
): string {
  const params = new URLSearchParams()
  if (filters.role) params.set('role', filters.role)
  if (filters.status) params.set('status', filters.status)
  if (filters.signupFrom) params.set('signupFrom', filters.signupFrom)
  if (filters.signupTo) params.set('signupTo', filters.signupTo)
  if (filters.spendMinCents !== null) params.set('spendMinCents', String(filters.spendMinCents))
  if (filters.spendMaxCents !== null) params.set('spendMaxCents', String(filters.spendMaxCents))
  if (filters.riskMin !== null) params.set('riskMin', String(filters.riskMin))
  if (filters.riskMax !== null) params.set('riskMax', String(filters.riskMax))
  if (filters.q) params.set('q', filters.q)
  // Switching sort resets to page 1 — the new sort order may shuffle
  // the result set entirely.
  params.set('sort', next)
  if (current === next && page > 1) params.set('page', '1')
  return `/admin/customers?${params.toString()}`
}

function nextSortKey(current: CustomerSortKey, column: CustomerSortKey): CustomerSortKey {
  if (!column.startsWith(currentColumnPrefix(column))) return column
  // Toggle asc/desc within the same column family.
  if (current === column) {
    if (column.endsWith('_asc')) {
      const desc = column.replace(/_asc$/, '_desc') as CustomerSortKey
      if ((CUSTOMER_SORT_KEYS as readonly string[]).includes(desc)) return desc
    }
  }
  return column
}

function currentColumnPrefix(k: CustomerSortKey): string {
  // e.g. 'spend_desc' -> 'spend'
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
  columnKey: CustomerSortKey
  currentSort: CustomerSortKey
  filters: ParsedCustomerFilters
  page: number
  align?: 'left' | 'right'
}) {
  const next = nextSortKey(currentSort, columnKey)
  const isActive = currentSort === columnKey || currentSort === nextSortKey(currentSort, columnKey)
  const arrow = isActive
    ? currentSort.endsWith('_asc')
      ? '▲'
      : '▼'
    : ''
  return (
    <th scope="col" data-align={align}>
      <Link
        href={sortHref(next, currentSort, filters, page)}
        className={styles.sortLink}
        data-active={isActive ? 'true' : 'false'}
        aria-label={`Sort by ${label}${isActive ? (currentSort.endsWith('_asc') ? ' (currently ascending)' : ' (currently descending)') : ''}`}
      >
        <span>{label}</span>
        <span aria-hidden="true" className={styles.arrow}>{arrow || '↕'}</span>
      </Link>
    </th>
  )
}

export function CustomerTable({
  rows,
  total,
  page,
  perPage = PER_PAGE_DEFAULT,
  sort,
  filters,
}: CustomerTableProps) {
  if (rows.length === 0) {
    return (
      <div className={styles.empty}>
        <p className={styles.emptyText}>No customers match these filters.</p>
        <Link href="/admin/customers" className={styles.emptyLink}>
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
              <SortHeader label="Name" columnKey="name_asc" currentSort={sort} filters={filters} page={page} />
              <SortHeader label="Email" columnKey="email_asc" currentSort={sort} filters={filters} page={page} />
              <th scope="col">Role</th>
              <SortHeader label="Signup" columnKey="signup_desc" currentSort={sort} filters={filters} page={page} />
              <SortHeader label="Lifetime spend" columnKey="spend_desc" currentSort={sort} filters={filters} page={page} align="right" />
              <SortHeader label="Orders" columnKey="orders_desc" currentSort={sort} filters={filters} page={page} align="right" />
              <SortHeader label="Library" columnKey="library_desc" currentSort={sort} filters={filters} page={page} align="right" />
              <SortHeader label="Last active" columnKey="last_active_desc" currentSort={sort} filters={filters} page={page} />
              <th scope="col">Status</th>
              <SortHeader label="Risk" columnKey="risk_desc" currentSort={sort} filters={filters} page={page} />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.user_id} data-status={row.status}>
                <td>
                  <Link href={`/admin/customers/${row.user_id}`} className={styles.nameLink}>
                    {row.display_name}
                  </Link>
                </td>
                <td className={styles.emailCell}>{row.email}</td>
                <td>
                  <span className={styles.role} data-role={row.role}>
                    {row.role}
                  </span>
                </td>
                <td>{formatDate(row.signup_date)}</td>
                <td data-align="right" className={styles.numeric}>
                  {formatMoney(row.lifetime_spend_cents)}
                </td>
                <td data-align="right" className={styles.numeric}>
                  {row.order_count.toLocaleString('en-US')}
                </td>
                <td data-align="right" className={styles.numeric}>
                  {row.library_size.toLocaleString('en-US')}
                </td>
                <td>
                  {row.last_active_at && !row.last_active_at.startsWith('1970-')
                    ? formatDate(row.last_active_at)
                    : '—'}
                </td>
                <td>
                  <span className={styles.status} data-status={row.status}>
                    {row.status}
                  </span>
                </td>
                <td>
                  <RiskScoreBadge
                    score={row.risk_score}
                    refundCount={row.risk_refund_count}
                    disputeCount={row.risk_dispute_count}
                    signalSeveritySum={row.risk_signal_severity_sum}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className={styles.summary}>
        Showing {startRank.toLocaleString('en-US')}–{endRank.toLocaleString('en-US')} of{' '}
        {total.toLocaleString('en-US')}
        {sort !== DEFAULT_CUSTOMER_SORT ? ` · sorted by ${sort.replace('_', ' ')}` : null}
      </p>
    </>
  )
}