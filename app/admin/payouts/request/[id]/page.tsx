// /admin/payouts/request/[id] — admin detail view for one payout
// request. RSC; auth-gated via the admin layout's requireRole.
//
// Composes the read query + the right-rail action island (approve /
// deny / mark paid). Returns 404 on missing access.

import { notFound } from 'next/navigation'
import { getAdminPayoutRequestDetail } from '@features/payouts/queries/getAdminPayoutRequestDetail'
import { PAYOUT_REQUEST_STATUS_LABEL, PAYOUT_REQUEST_STATUS_COLOR, formatDateTime, money } from '@features/payouts/format'
import { PayoutRequestActions } from '@features/admin/platform-settings/components/PayoutRequestActions'
import { AdminShell } from '@features/admin'
import styles from './page.module.css'

export const dynamic = 'force-dynamic'

export default async function AdminPayoutRequestDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const idNum = Number(id)
  if (!Number.isInteger(idNum) || idNum <= 0) notFound()

  const detail = await getAdminPayoutRequestDetail(idNum)
  if (!detail) notFound()

  return (
    <AdminShell title={`Payout request #${detail.id}`}>
      <div className={styles.layout}>
        <div className={styles.main}>
          <header className={styles.header}>
            <p className={styles.eyebrow}>
              <a href="/admin/payouts" className={styles.back}>
                ← Back to queue
              </a>
            </p>
            <h1 className={styles.title}>Payout request #{detail.id}</h1>
            <div className={styles.statusRow}>
              <span
                className={styles.statusPill}
                data-color={
                  PAYOUT_REQUEST_STATUS_COLOR[detail.status as keyof typeof PAYOUT_REQUEST_STATUS_COLOR] ?? 'mute'
                }
              >
                {PAYOUT_REQUEST_STATUS_LABEL[detail.status as keyof typeof PAYOUT_REQUEST_STATUS_LABEL] ??
                  detail.status}
              </span>
              <p className={styles.amount}>{money(detail.amountCents)}</p>
            </div>
          </header>

          <section className={styles.section} aria-label="Request details">
            <h2 className={styles.sectionHeading}>Request details</h2>
            <dl className={styles.facts}>
              <div>
                <dt>Partner</dt>
                <dd>
                  {detail.partnerName ? (
                    <a href={`/admin/payouts/partner/${detail.partnerId}`}>
                      {detail.partnerName}
                    </a>
                  ) : (
                    <span className={styles.muted}>Partner #{detail.partnerId}</span>
                  )}
                </dd>
              </div>
              <div>
                <dt>Payout method</dt>
                <dd>PayPal · {detail.payoutMethodTargetMasked}</dd>
              </div>
              <div>
                <dt>Created</dt>
                <dd>{formatDateTime(detail.createdAt)}</dd>
              </div>
              {detail.processedAt && (
                <div>
                  <dt>Processed at</dt>
                  <dd>{formatDateTime(detail.processedAt)}</dd>
                </div>
              )}
              {detail.denialReason && (
                <div>
                  <dt>Denial reason</dt>
                  <dd>{detail.denialReason}</dd>
                </div>
              )}
              <div>
                <dt>Amount</dt>
                <dd>
                  {detail.currency} {money(detail.amountCents)}
                </dd>
              </div>
            </dl>
          </section>

          <section className={styles.section} aria-label="Locked ledger rows">
            <h2 className={styles.sectionHeading}>Locked ledger rows</h2>
            {detail.ledger.length === 0 ? (
              <p className={styles.muted}>No ledger rows (denial would have released them).</p>
            ) : (
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Kind</th>
                    <th>Description</th>
                    <th>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.ledger.map((row) => (
                    <tr key={row.id}>
                      <td>{formatDateTime(row.createdAt)}</td>
                      <td>{row.kind}</td>
                      <td className={styles.desc}>{row.description ?? '—'}</td>
                      <td>
                        {row.amountCents >= 0 ? '+' : ''}
                        {money(row.amountCents)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </div>

        <PayoutRequestActions
          requestId={detail.id}
          status={detail.status}
          partnerName={detail.partnerName}
          amountCents={detail.amountCents}
          currency={detail.currency}
        />
      </div>
    </AdminShell>
  )
}
