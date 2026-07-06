// LedgerRow.tsx — one row of the partner ledger.
//
// P6.3 — accepts the partner's IANA `timezone` so all four dates
// (created_at + locked_until + available_at + paid_at) render in
// the partner's local time. The status pill + amount + kind label
// are unaffected.
//
// P6.4 — the row is now a Next.js `Link` to `/partner/payouts/[id]`,
// giving the partner one click into the ledger entry detail page.
// The whole row is the click target (no separate "View" button
// needed) — single-column-table UX. The `<li>` wrapper preserves
// the list semantics for the parent's `<ul>`.

import Link from 'next/link'
import type { LedgerEntry } from '@features/payouts/queries/getPartnerLedger'
import { LEDGER_KIND_LABEL, LEDGER_STATUS_LABEL, money, formatDate } from '@features/payouts/format'
import styles from './LedgerRow.module.css'

const KIND_COLOR: Record<LedgerEntry['kind'], string> = {
  order_sale: 'var(--success)',
  subscription: 'var(--accent)',
  refund: 'var(--danger)',
  adjustment: 'var(--text-2)',
  payout: 'var(--accent)',
  clawback: 'var(--danger)',
}

export function LedgerRow({
  entry,
  timezone,
}: {
  entry: LedgerEntry
  timezone?: string | null
}) {
  const isCredit = entry.amount_cents > 0
  const href = `/partner/payouts/${entry.id}`
  return (
    <li className={styles.li}>
      <Link
        href={href}
        className={styles.row}
        aria-label={`Open ledger entry ${entry.id} — ${LEDGER_KIND_LABEL[entry.kind] ?? entry.kind}, ${money(entry.amount_cents, entry.currency)}`}
      >
        <div className={styles.dateCol}>
          <p className={styles.date}>{formatDate(entry.created_at, 'en-US', timezone)}</p>
          {entry.locked_until && entry.status === 'locked' && (
            <p className={styles.lockedHint}>Locks {formatDate(entry.locked_until, 'en-US', timezone)}</p>
          )}
          {entry.available_at && entry.status === 'available' && entry.paid_at && (
            <p className={styles.paidHint}>Paid {formatDate(entry.paid_at, 'en-US', timezone)}</p>
          )}
        </div>
        <div className={styles.kindCol}>
          <span className={styles.kind} style={{ color: KIND_COLOR[entry.kind] }}>
            {LEDGER_KIND_LABEL[entry.kind] ?? entry.kind}
          </span>
          {entry.description && <p className={styles.desc}>{entry.description}</p>}
          {entry.order_id && (
            <p className={styles.orderId}>
              Order #{entry.order_id}
            </p>
          )}
        </div>
        <div className={styles.statusCol}>
          <span className={styles.status}>{LEDGER_STATUS_LABEL[entry.status] ?? entry.status}</span>
        </div>
        <div className={styles.amountCol}>
          <p
            className={styles.amount}
            style={{ color: isCredit ? 'var(--success)' : 'var(--danger)' }}
          >
            {isCredit ? '+' : ''}
            {money(entry.amount_cents, entry.currency)}
          </p>
        </div>
      </Link>
    </li>
  )
}
