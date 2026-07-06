// OrderTable.tsx — the main data table on /admin/orders (P14.7).
//
// Columns per spec line 17:
//   order_id · date · customer (name + email) · total · status ·
//   items count · partner share · affiliate handle.
//
// Sort: created_at desc ONLY in v1 (spec OQ line 49 — column-header
// sort is v2). No client JS; row click navigates to
// /admin/orders/[id] (the detail page is its own slice, P14.8).
//
// Empty state: "No orders match these filters" + a Reset link back to
// /admin/orders. Pure RSC.

import Link from 'next/link'
import { formatMoney } from '@foundations/money/cents'
import {
  ORDER_STATUS_LABEL,
  ORDER_STATUS_KIND,
  type OrderRow,
  type ParsedOrderFilters,
} from '../types'
import styles from './OrderTable.module.css'

const PER_PAGE_DEFAULT = 50

function formatOrderDate(iso: string): string {
  // Render as "MMM D, YYYY" + HH:MM (server's local time). Defensive
  // guard against bogus epoch.
  if (!iso || iso.startsWith('1970-')) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const date = d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
  const time = d.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  return `${date} · ${time}`
}

export type OrderTableProps = {
  rows: OrderRow[]
  total: number
  page: number
  perPage?: number
  filters: ParsedOrderFilters
}

export function OrderTable({
  rows,
  total,
  page,
  perPage = PER_PAGE_DEFAULT,
  filters,
}: OrderTableProps) {
  if (rows.length === 0) {
    return (
      <div className={styles.empty}>
        <p className={styles.emptyText}>No orders match these filters.</p>
        <Link href="/admin/orders" className={styles.emptyLink}>
          Reset filters
        </Link>
      </div>
    )
  }

  const startRank = (page - 1) * perPage + 1
  const endRank = startRank + rows.length - 1

  // Stash a one-line active-filter summary for the empty-state hint and
  // the row below the table — useful when the admin clears filters.
  const activeFilterCount =
    Number(filters.status !== null) +
    Number(filters.from !== null || filters.to !== null) +
    Number(filters.customerEmail !== null) +
    Number(filters.affiliateId !== null) +
    Number(filters.productId !== null) +
    Number(filters.partnerId !== null)

  return (
    <>
      <div className={styles.tableScroll}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">Order</th>
              <th scope="col">Date</th>
              <th scope="col">Customer</th>
              <th scope="col">Email</th>
              <th scope="col" data-align="right">
                Total
              </th>
              <th scope="col">Status</th>
              <th scope="col" data-align="right">
                Items
              </th>
              <th scope="col" data-align="right">
                Partner share
              </th>
              <th scope="col">Affiliate</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.order_id} data-status={row.status}>
                <td>
                  <Link
                    href={`/admin/orders/${row.order_id}`}
                    className={styles.orderLink}
                  >
                    #{row.order_id}
                  </Link>
                </td>
                <td>{formatOrderDate(row.created_at)}</td>
                <td>{row.customer_display_name || `User ${row.customer_user_id.slice(0, 8)}`}</td>
                <td className={styles.emailCell}>{row.customer_email}</td>
                <td data-align="right" className={styles.numeric}>
                  {formatMoney(row.total_cents)}
                  <span className={styles.currency}>{row.currency}</span>
                </td>
                <td>
                  <span className={styles.status} data-kind={ORDER_STATUS_KIND[row.status]}>
                    {ORDER_STATUS_LABEL[row.status]}
                  </span>
                </td>
                <td data-align="right" className={styles.numeric}>
                  {row.items_count.toLocaleString('en-US')}
                </td>
                <td data-align="right" className={styles.numeric}>
                  {formatMoney(row.partner_share_cents)}
                </td>
                <td className={styles.handleCell}>
                  {row.affiliate_handle ? `@${row.affiliate_handle}` : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className={styles.summary}>
        Showing {startRank.toLocaleString('en-US')}–{endRank.toLocaleString('en-US')} of{' '}
        {total.toLocaleString('en-US')}
        {activeFilterCount > 0
          ? ` · ${activeFilterCount} filter${activeFilterCount === 1 ? '' : 's'} active`
          : null}
      </p>
    </>
  )
}
