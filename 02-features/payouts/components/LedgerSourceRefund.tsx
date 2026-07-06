// LedgerSourceRefund.tsx — refund card on the ledger detail page.
//
// P6.4 — surfaces the refund that produced a `kind='refund'` ledger
// row. Shows the refund id, amount, reason, status, and key dates.
// When `entry.refund_id` is null (and `kind !== 'refund'`), the
// parent page renders nothing for this surface.

import type { SourceRefund } from '@features/payouts/queries/getPartnerLedgerEntry'
import { money, formatDateTime, REFUND_REASON_LABEL } from '@features/payouts/format'
import styles from './LedgerSourceRefund.module.css'

const REFUND_STATUS_LABEL: Record<string, string> = {
  pending: 'Pending',
  succeeded: 'Succeeded',
  failed: 'Failed',
  canceled: 'Canceled',
}

export function LedgerSourceRefund({
  refund,
  timezone,
}: {
  refund: SourceRefund
  timezone?: string | null
}) {
  const reasonLabel = REFUND_REASON_LABEL[refund.reason] ?? refund.reason
  const statusLabel = REFUND_STATUS_LABEL[refund.status] ?? refund.status
  return (
    <section
      className={styles.wrap}
      aria-label={`Refund #${refund.id}`}
    >
      <header className={styles.head}>
        <p className={styles.eyebrow}>Refund</p>
        <h2 className={styles.h2}>
          Refund <span className={styles.id}>#{refund.id}</span>
        </h2>
      </header>

      <dl className={styles.grid}>
        <div className={styles.row}>
          <dt className={styles.term}>Status</dt>
          <dd className={styles.def}>{statusLabel}</dd>
        </div>
        <div className={styles.row}>
          <dt className={styles.term}>Amount</dt>
          <dd className={styles.defNumStrong}>
            −{money(refund.amount_cents, 'USD')}
          </dd>
        </div>
        <div className={styles.row}>
          <dt className={styles.term}>Reason</dt>
          <dd className={styles.def}>{reasonLabel}</dd>
        </div>
        <div className={styles.row}>
          <dt className={styles.term}>Order</dt>
          <dd className={styles.def}>
            <span className={styles.id}>#{refund.order_id}</span>
          </dd>
        </div>
        {refund.stripe_refund_id && (
          <div className={styles.row}>
            <dt className={styles.term}>Stripe refund id</dt>
            <dd className={styles.defMono}>{refund.stripe_refund_id}</dd>
          </div>
        )}
        <div className={styles.row}>
          <dt className={styles.term}>Requested</dt>
          <dd className={styles.def}>
            {formatDateTime(refund.created_at, 'en-US', timezone)}
          </dd>
        </div>
        {refund.approved_at && (
          <div className={styles.row}>
            <dt className={styles.term}>Approved</dt>
            <dd className={styles.def}>
              {formatDateTime(refund.approved_at, 'en-US', timezone)}
            </dd>
          </div>
        )}
        {refund.processed_at && (
          <div className={styles.row}>
            <dt className={styles.term}>Processed</dt>
            <dd className={styles.def}>
              {formatDateTime(refund.processed_at, 'en-US', timezone)}
            </dd>
          </div>
        )}
        {refund.notes && (
          <div className={`${styles.row} ${styles.rowFull}`}>
            <dt className={styles.term}>Notes</dt>
            <dd className={styles.def}>{refund.notes}</dd>
          </div>
        )}
      </dl>
    </section>
  )
}
