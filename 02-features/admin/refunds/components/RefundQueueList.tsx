// RefundQueueList.tsx — the main FIFO list on /admin/refunds (P14.9).
//
// Columns per spec line 18:
//   refund id (R-12345 format) · customer (name + email) · order #
//   · amount · reason · requested_at · age (Xh ago / Xd ago) ·
//   status badge.
//
// Sort: FIFO by `requested_at asc` (enforced at the RPC layer).
// SLA callout (spec line 64): refunds with `requested_at < now() -
// interval '24 hours'` get an amber border + "Overdue" badge via
// the `data-overdue` attribute selector. The age formatter handles
// seconds → minutes → hours → days conversion; the overdue threshold
// is shared via `isRefundOverdue()` from `../types.ts`.
//
// No client JS; row click navigates to
// `/admin/refunds?refundId=<id>` so the URL is shareable (the
// detail panel reads `?refundId=` to know which row to render).
// Empty state matches OrderTable's: "No refund requests match these
// filters" + a Reset link back to /admin/refunds.

import Link from 'next/link'
import { formatMoney } from '@foundations/money/cents'
import {
  REFUND_STATUS_LABEL,
  REFUND_STATUS_KIND,
  REFUND_REASON_LABEL,
  isRefundOverdue,
  formatRefundAge,
  type ParsedRefundFilters,
  type RefundQueueRow,
} from '../types'
import styles from './RefundQueueList.module.css'

const PER_PAGE_DEFAULT = 25

function formatRefundId(id: number): string {
  // Display as `R-12345` per spec line 18 (admin-facing format).
  return `R-${id.toLocaleString('en-US')}`
}

function formatOrderRef(id: number): string {
  return `#${id.toLocaleString('en-US')}`
}

function ageSeconds(iso: string, nowMs: number): number {
  const ms = Date.parse(iso)
  if (!Number.isFinite(ms)) return 0
  return Math.max(0, Math.floor((nowMs - ms) / 1000))
}

export type RefundQueueListProps = {
  rows: RefundQueueRow[]
  total: number
  page: number
  perPage?: number
  filters: ParsedRefundFilters
  /** Optional refund id to mark as the active row in the list. */
  activeRefundId?: number | null
}

export function RefundQueueList({
  rows,
  total,
  page,
  perPage = PER_PAGE_DEFAULT,
  filters,
  activeRefundId,
}: RefundQueueListProps) {
  if (rows.length === 0) {
    return (
      <div className={styles.empty}>
        <p className={styles.emptyText}>No refund requests match these filters.</p>
        <Link href="/admin/refunds" className={styles.emptyLink}>
          Reset filters
        </Link>
      </div>
    )
  }

  const startRank = (page - 1) * perPage + 1
  const endRank = startRank + rows.length - 1

  const activeFilterCount =
    Number(filters.status !== null) +
    Number(filters.from !== null || filters.to !== null) +
    Number(filters.customerEmail !== null) +
    Number(filters.productId !== null)

  // Compute the SLA badge once per render — the `nowMs` is captured
  // server-side so all rows render against the same reference time.
  const nowMs = Date.now()

  return (
    <>
      <div className={styles.tableScroll}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">Refund</th>
              <th scope="col">Customer</th>
              <th scope="col">Order</th>
              <th scope="col" data-align="right">
                Amount
              </th>
              <th scope="col">Reason</th>
              <th scope="col">Requested</th>
              <th scope="col">Age</th>
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const overdue = row.status === 'pending' && isRefundOverdue(row.requested_at, new Date(nowMs))
              const isActive = activeRefundId !== null && activeRefundId !== undefined && row.refund_id === activeRefundId
              const rowHref = buildRowHref(row.refund_id, filters, page)
              return (
                <tr
                  key={row.refund_id}
                  data-status={row.status}
                  data-overdue={overdue ? 'true' : 'false'}
                  data-active={isActive ? 'true' : 'false'}
                >
                  <td>
                    <Link href={rowHref} className={styles.refundLink}>
                      {formatRefundId(row.refund_id)}
                    </Link>
                  </td>
                  <td>
                    <span className={styles.customerName}>
                      {row.customer_display_name || '—'}
                    </span>
                    <span className={styles.customerEmail}>{row.customer_email}</span>
                  </td>
                  <td>
                    <Link href={`/admin/orders/${row.order_id}`} className={styles.orderLink}>
                      {formatOrderRef(row.order_id)}
                    </Link>
                  </td>
                  <td data-align="right" className={styles.numeric}>
                    {formatMoney(row.amount_cents)}
                    <span className={styles.currency}>{row.currency}</span>
                  </td>
                  <td>
                    <span className={styles.reason}>
                      {REFUND_REASON_LABEL[row.reason]}
                    </span>
                    {row.proof_filename ? (
                      <span className={styles.proofTag} title="Proof file attached">
                        📎 {row.proof_filename}
                      </span>
                    ) : null}
                  </td>
                  <td className={styles.requestedAt}>
                    {formatRequestedAt(row.requested_at)}
                  </td>
                  <td>
                    <span className={styles.age}>
                      {formatRefundAge(ageSeconds(row.requested_at, nowMs))}
                    </span>
                    {overdue ? (
                      <span className={styles.overdueBadge}>Overdue</span>
                    ) : null}
                  </td>
                  <td>
                    <span className={styles.status} data-kind={REFUND_STATUS_KIND[row.status]}>
                      {REFUND_STATUS_LABEL[row.status]}
                    </span>
                  </td>
                </tr>
              )
            })}
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

/**
 * Builds the row-click href. Preserves the active filter bag +
 * page so the detail panel renders inside the right context. The
 * URL becomes `/admin/refunds?refundId=<id>&status=...&page=...`.
 */
function buildRowHref(
  refundId: number,
  filters: ParsedRefundFilters,
  page: number,
): string {
  const params = new URLSearchParams()
  params.set('refundId', String(refundId))
  if (filters.status) params.set('status', filters.status)
  if (filters.from) params.set('from', filters.from)
  if (filters.to) params.set('to', filters.to)
  if (filters.customerEmail) params.set('customerEmail', filters.customerEmail)
  if (filters.productId !== null) params.set('productId', String(filters.productId))
  if (page > 1) params.set('page', String(page))
  return `/admin/refunds?${params.toString()}`
}

/**
 * Renders the requested_at timestamp as "MMM D · HH:MM" (server local
 * time). Defensive against null / bogus-epoch.
 */
function formatRequestedAt(iso: string): string {
  if (!iso || iso.startsWith('1970-')) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const date = d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  })
  const time = d.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  return `${date} · ${time}`
}