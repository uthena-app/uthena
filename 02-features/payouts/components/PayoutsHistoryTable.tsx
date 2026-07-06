// PayoutsHistoryTable.tsx — P12.14 partner payouts history surface.
//
// Renders one row per PayPal Mass Payout batch that included this
// partner. Newest first (the RPC sorts by MAX(paid_at) DESC).
//
// Spec: `01-specs/pages/instructor-payouts.md` —
// "Payouts history | id, period_start, period_end, amount_cents,
//  currency, paypal_batch_id, status, created_at, commission_count
//  | payout_ledger where kind='payout_paid' OR grouped payout batches
//  | table".
//
// The spec says `kind='payout_paid'` but the data model uses
// `kind='payout'` (status='paid' + a paypal_payout_batch_id) — the
// grouped-batch interpretation in the spec ("OR grouped payout
// batches") matches what the data actually looks like. See the
// implementation notes for the rationale.
//
// Visual treatment per spec acceptance criteria:
//   - "Paid" amounts are visually muted (mono number, --text-2 color)
//     but the row is fully visible (no opacity / no greyed-out bg).
//   - The PayPal batch ID is displayed in mono font so the partner
//     can copy it for PayPal support.
//   - Empty state when no payouts yet: friendly copy pointing at the
//     14-day refund window (matches the P6.6 RequestPayoutButton copy).
//
// RSC component. No client JS shipped (the parent page is RSC and
// this surface is read-only — no filtering, no export, no actions).

import type { PayoutBatch } from '@features/payouts/queries/getPartnerPayoutsHistory'
import { money, formatDate } from '@features/payouts/format'
import styles from './PayoutsHistoryTable.module.css'

export function PayoutsHistoryTable({
  batches,
  timezone,
  currency = 'USD',
}: {
  batches: PayoutBatch[]
  timezone?: string | null
  /** Currency to render amounts in. Defaults to USD (matches the v1
   *  spec — multi-currency display is explicitly out of scope per
   *  the spec's "What this page does NOT do" section). */
  currency?: string
}) {
  if (batches.length === 0) {
    return (
      <p className={styles.empty}>
        Your first payout will appear here after your first sale clears the 14-day
        refund window.
      </p>
    )
  }

  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th scope="col" className={styles.thLeft}>
              Period
            </th>
            <th scope="col" className={styles.thRight}>
              Commissions
            </th>
            <th scope="col" className={styles.thRight}>
              Net amount
            </th>
            <th scope="col" className={styles.thLeft}>
              PayPal batch
            </th>
          </tr>
        </thead>
        <tbody>
          {batches.map((batch) => (
            <tr key={batch.paypalPayoutBatchId} className={styles.row} data-status="paid">
              <td className={styles.tdLeft}>
                <p className={styles.period}>
                  {formatDate(batch.periodStart, 'en-US', timezone)}
                </p>
                <p className={styles.periodTo}>to {formatDate(batch.periodEnd, 'en-US', timezone)}</p>
              </td>
              <td className={styles.tdRight}>
                <span className={styles.commissions}>{batch.commissionCount}</span>
              </td>
              <td className={styles.tdRight}>
                <span className={styles.amount}>
                  {money(batch.amountCents, batch.currency || currency)}
                </span>
              </td>
              <td className={styles.tdLeft}>
                <code className={styles.batchId}>{batch.paypalPayoutBatchId}</code>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
