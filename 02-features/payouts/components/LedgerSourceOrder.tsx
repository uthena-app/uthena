// LedgerSourceOrder.tsx — source-order card on the ledger detail page.
//
// P6.4 — surfaces the order that produced this ledger row, when
// `entry.order_id` is set. The partner sees the order id, status,
// money breakdown, and key dates. They do NOT see the buyer's
// email (PII per the spec) — orders.email is intentionally not
// selected in the query (see `getPartnerLedgerEntry.ts`).
//
// When `entry.order_id` is null (e.g. adjustments, partner fee
// reversals), this component renders nothing — the parent page
// handles the "no order linked" affordance.

import type { SourceOrder } from '@features/payouts/queries/getPartnerLedgerEntry'
import { money, formatDateTime, ORDER_STATUS_LABEL } from '@features/payouts/format'
import styles from './LedgerSourceOrder.module.css'

export function LedgerSourceOrder({
  order,
  timezone,
}: {
  order: SourceOrder
  timezone?: string | null
}) {
  const statusLabel = ORDER_STATUS_LABEL[order.status] ?? order.status
  return (
    <section
      className={styles.wrap}
      aria-label={`Source order #${order.id}`}
    >
      <header className={styles.head}>
        <p className={styles.eyebrow}>Source order</p>
        <h2 className={styles.h2}>
          Order <span className={styles.id}>#{order.id}</span>
        </h2>
      </header>

      <dl className={styles.grid}>
        <div className={styles.row}>
          <dt className={styles.term}>Status</dt>
          <dd className={styles.def}>{statusLabel}</dd>
        </div>
        <div className={styles.row}>
          <dt className={styles.term}>Subtotal</dt>
          <dd className={styles.defNum}>
            {money(order.subtotal_cents, order.currency)}
          </dd>
        </div>
        {order.discount_cents > 0 && (
          <div className={styles.row}>
            <dt className={styles.term}>Discount</dt>
            <dd className={styles.defNum}>
              −{money(order.discount_cents, order.currency)}
            </dd>
          </div>
        )}
        {order.tax_cents > 0 && (
          <div className={styles.row}>
            <dt className={styles.term}>Tax</dt>
            <dd className={styles.defNum}>
              {money(order.tax_cents, order.currency)}
            </dd>
          </div>
        )}
        <div className={styles.row}>
          <dt className={styles.term}>Total</dt>
          <dd className={styles.defNumStrong}>
            {money(order.total_cents, order.currency)}
          </dd>
        </div>
        {order.refunded_cents > 0 && (
          <div className={styles.row}>
            <dt className={styles.term}>Refunded</dt>
            <dd className={styles.defNumMuted}>
              {money(order.refunded_cents, order.currency)}
            </dd>
          </div>
        )}
        <div className={styles.row}>
          <dt className={styles.term}>Placed</dt>
          <dd className={styles.def}>
            {formatDateTime(order.created_at, 'en-US', timezone)}
          </dd>
        </div>
        {order.paid_at && (
          <div className={styles.row}>
            <dt className={styles.term}>Paid</dt>
            <dd className={styles.def}>
              {formatDateTime(order.paid_at, 'en-US', timezone)}
            </dd>
          </div>
        )}
        {order.fulfilled_at && (
          <div className={styles.row}>
            <dt className={styles.term}>Fulfilled</dt>
            <dd className={styles.def}>
              {formatDateTime(order.fulfilled_at, 'en-US', timezone)}
            </dd>
          </div>
        )}
      </dl>
    </section>
  )
}
