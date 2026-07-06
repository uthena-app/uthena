// /partner/payouts/[id] — partner ledger entry detail page.
// RSC. RLS gates the read; the page renders whatever the partner
// can see. Composes feature components from @features/payouts —
// no business logic here.
//
// P6.4 — shows the individual ledger row with:
//   - Hero header (kind, amount, status pill, dates)
//   - Status timeline (4-milestone locked-window visualizer)
//   - Source order card (when entry.order_id is set)
//   - Refund card (when entry.refund_id is set OR kind='refund')
//   - "Back to ledger" link
//
// 404 when:
//   - The id is not a positive integer
//   - The user is not signed in (redirected to /login by
//     requirePartner before this code runs)
//   - The user is not a partner (redirected to /403 by
//     requirePartner before this code runs)
//   - RLS returns no row (entry doesn't exist OR is owned by
//     another partner — we can't distinguish, so we 404 either
//     way to avoid leaking existence)

import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { requirePartner } from '@foundations/auth/guards'
import {
  getPartnerLedgerEntry,
  LedgerTimeline,
  LedgerSourceOrder,
  LedgerSourceRefund,
  LEDGER_KIND_LABEL,
  LEDGER_STATUS_LABEL,
  money,
  formatDateTime,
} from '@features/payouts'
import { sensitivePageMetadata } from '@foundations/metadata'
import styles from './page.module.css'

// P0.21 — `noindex` so partner payout detail isn't indexed.
export const metadata: Metadata = sensitivePageMetadata({
  title: 'Ledger entry',
  description: 'Detailed view of a single partner payout ledger entry.',
  path: '/partner/payouts/[id]',
})
export const dynamic = 'force-dynamic'

type Props = { params: Promise<{ id: string }> }

export default async function PartnerLedgerEntryDetailPage({ params }: Props) {
  await requirePartner()
  const { id } = await params
  // getPartnerLedgerEntry validates + parses the id; pass the raw
  // string so an invalid id (e.g. "/partner/payouts/abc") returns
  // null and the page renders 404.
  const detail = await getPartnerLedgerEntry(id)
  if (!detail) {
    notFound()
  }

  const { entry, order, refund, timezone } = detail
  const isCredit = entry.amount_cents > 0
  const kindLabel = LEDGER_KIND_LABEL[entry.kind] ?? entry.kind
  const statusLabel = LEDGER_STATUS_LABEL[entry.status] ?? entry.status

  return (
    <main id="main" className={styles.page}>
      <nav className={styles.crumb} aria-label="Breadcrumb">
        <Link href="/partner/payouts" className={styles.crumbLink}>
          ← All ledger entries
        </Link>
      </nav>

      <header className={styles.hero}>
        <div className={styles.heroText}>
          <p className={styles.eyebrow}>Ledger entry</p>
          <h1 className={styles.h1}>
            <span className={styles.kindLabel} data-kind={entry.kind}>
              {kindLabel}
            </span>{' '}
            <span className={styles.h1Id}>#{entry.id}</span>
          </h1>
          <p className={styles.sub}>
            {entry.description ?? `Logged ${formatDateTime(entry.created_at, 'en-US', timezone)}`}
          </p>
        </div>

        <div className={styles.heroNumbers}>
          <p
            className={styles.amount}
            data-direction={isCredit ? 'credit' : 'debit'}
          >
            {isCredit ? '+' : ''}
            {money(entry.amount_cents, entry.currency)}
          </p>
          <span className={styles.statusPill} data-status={entry.status}>
            {statusLabel}
          </span>
        </div>
      </header>

      <LedgerTimeline entry={entry} timezone={timezone} />

      {order && <LedgerSourceOrder order={order} timezone={timezone} />}

      {refund && <LedgerSourceRefund refund={refund} timezone={timezone} />}

      {/* Surface the partner's underlying references when the
          joins returned null (e.g. the source order was deleted
          but the ledger row was preserved). Avoids the partner
          seeing a "blank" detail page when an upstream record
          goes missing. */}
      {!order && entry.order_id && (
        <section className={styles.missingCard} aria-label="Source order">
          <p className={styles.missingEyebrow}>Source order</p>
          <p className={styles.missingText}>
            Order #{entry.order_id} — this order is no longer available to view.
          </p>
        </section>
      )}
      {!refund && entry.kind === 'refund' && (
        <section className={styles.missingCard} aria-label="Refund">
          <p className={styles.missingEyebrow}>Refund</p>
          <p className={styles.missingText}>
            The refund that produced this ledger row is no longer available to view.
          </p>
        </section>
      )}

      <dl className={styles.meta}>
        {entry.royalty_pct_bps !== null && (
          <div className={styles.metaRow}>
            <dt className={styles.metaTerm}>Royalty rate (snapshot)</dt>
            <dd className={styles.metaDef}>{(entry.royalty_pct_bps / 100).toFixed(2)}%</dd>
          </div>
        )}
        {entry.paypal_payout_batch_id && (
          <div className={styles.metaRow}>
            <dt className={styles.metaTerm}>PayPal batch</dt>
            <dd className={styles.metaDefMono}>{entry.paypal_payout_batch_id}</dd>
          </div>
        )}
        {entry.stripe_transfer_id && (
          <div className={styles.metaRow}>
            <dt className={styles.metaTerm}>Stripe transfer</dt>
            <dd className={styles.metaDefMono}>{entry.stripe_transfer_id}</dd>
          </div>
        )}
        {entry.order_item_id && (
          <div className={styles.metaRow}>
            <dt className={styles.metaTerm}>Order item</dt>
            <dd className={styles.metaDef}>#{entry.order_item_id}</dd>
          </div>
        )}
      </dl>
    </main>
  )
}
