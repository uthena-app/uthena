// OrdersList — RSC. Renders the table + filters + pagination.
// Filters live in URL searchParams; the page is RSC so the
// client just navigates.
import Link from 'next/link'
import { StatusBadge } from './StatusBadge'
import type { OrderListResult, OrderStatus } from '../queries/getMyOrders'
import styles from './OrdersList.module.css'

const STATUS_OPTIONS: { value: OrderStatus; label: string }[] = [
  { value: 'paid', label: 'Paid' },
  { value: 'pending', label: 'Pending' },
  { value: 'awaiting_payment', label: 'Awaiting payment' },
  { value: 'refunded', label: 'Refunded' },
  { value: 'partially_refunded', label: 'Partially refunded' },
  { value: 'failed', label: 'Failed' },
  { value: 'canceled', label: 'Canceled' },
]

function formatDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}
function formatMoney(cents: number, currency: string): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100)
}

function buildPageUrl(
  page: number,
  pageSize: number,
  selected: OrderStatus[],
  from: string,
  to: string,
): string {
  const params = new URLSearchParams()
  params.set('page', String(page))
  params.set('pageSize', String(pageSize))
  if (selected.length > 0) params.set('status', selected.join(','))
  if (from) params.set('from', from)
  if (to) params.set('to', to)
  return `?${params.toString()}`
}

export function OrdersList({
  result,
  selectedStatuses,
  from,
  to,
}: {
  result: OrderListResult
  selectedStatuses: OrderStatus[]
  from: string
  to: string
}) {
  const { rows, totalCount, page, pageSize, pageCount } = result

  if (totalCount === 0) {
    return (
      <div className={styles.empty}>
        <p className={styles.emptyTitle}>You haven&apos;t bought anything yet</p>
        <p className={styles.emptyLede}>
          Browse the catalog to find a course or digital asset. Your order history will appear here.
        </p>
        <Link href="/browse" className={styles.emptyCta}>
          Browse catalog →
        </Link>
      </div>
    )
  }

  return (
    <div className={styles.wrap}>
      <form className={styles.filters} method="get" action="/account/orders">
        <div className={styles.filterField}>
          <label className={styles.filterLabel}>Status</label>
          <div className={styles.checkboxGroup}>
            {STATUS_OPTIONS.map((opt) => (
              <label key={opt.value} className={styles.checkboxLabel}>
                <input
                  type="checkbox"
                  name="status"
                  value={opt.value}
                  defaultChecked={selectedStatuses.includes(opt.value)}
                />
                <span>{opt.label}</span>
              </label>
            ))}
          </div>
        </div>
        <div className={styles.filterField}>
          <label htmlFor="from" className={styles.filterLabel}>
            From
          </label>
          <input
            id="from"
            type="date"
            name="from"
            defaultValue={from}
            className={styles.dateInput}
          />
        </div>
        <div className={styles.filterField}>
          <label htmlFor="to" className={styles.filterLabel}>
            To
          </label>
          <input id="to" type="date" name="to" defaultValue={to} className={styles.dateInput} />
        </div>
        <input type="hidden" name="pageSize" value={pageSize} />
        <div className={styles.filterActions}>
          <button type="submit" className={styles.applyBtn}>
            Apply
          </button>
          <Link href="/account/orders" className={styles.clearBtn}>
            Clear
          </Link>
        </div>
      </form>

      <table className={styles.table}>
        <thead>
          <tr>
            <th>Order</th>
            <th>Date</th>
            <th>Status</th>
            <th>Items</th>
            <th className={styles.numCol}>Total</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((o) => (
            <tr key={o.id} className={styles.row}>
              <td>
                <Link href={`/account/orders/${o.id}`} className={styles.orderId}>
                  #{o.id}
                </Link>
              </td>
              <td className={styles.muted}>{formatDate(o.created_at)}</td>
              <td>
                <StatusBadge status={o.status} />
              </td>
              <td className={styles.muted}>
                {o.item_count} {o.item_count === 1 ? 'item' : 'items'}
              </td>
              <td className={styles.numCol}>{formatMoney(o.total_cents, o.currency)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <nav className={styles.pagination} aria-label="Pagination">
        <span className={styles.pageInfo}>
          Page {page} of {pageCount} ({totalCount} {totalCount === 1 ? 'order' : 'orders'})
        </span>
        <div className={styles.pageNav}>
          {page > 1 ? (
            <Link
              href={buildPageUrl(page - 1, pageSize, selectedStatuses, from, to)}
              className={styles.pageBtn}
            >
              ← Previous
            </Link>
          ) : (
            <span className={`${styles.pageBtn} ${styles.pageBtnDisabled}`}>← Previous</span>
          )}
          {page < pageCount ? (
            <Link
              href={buildPageUrl(page + 1, pageSize, selectedStatuses, from, to)}
              className={styles.pageBtn}
            >
              Next →
            </Link>
          ) : (
            <span className={`${styles.pageBtn} ${styles.pageBtnDisabled}`}>Next →</span>
          )}
        </div>
      </nav>
    </div>
  )
}
