// /admin/payouts — admin's full payouts overview: the new
// payout_requests queue (P6.7 Slice 1) + the cross-partner ledger
// view + summary stats.
//
// RSC. Service-role reads via `getAdminLedger` because the admin
// sees every partner's rows. RLS-aware reads via
// `getAdminPayoutRequests` (which itself uses service-role inside
// — the admin sees all rows regardless of the partner RLS policy).
//
// P6.7 Slice 1 (this tick): refactor to use `AdminShell` (matches
// the categories + account-switcher pages), add the
// `PayoutRequestQueue` section above the ledger, remove inline
// `style={{ color }}` per AGENTS.md "no inline colors" rule, accept
// `?status=<value>` URL param to drive the queue filter chips.
//
// P6.7 Slice 2+ (deferred — STUB-057): approve / deny actions on
// each row, "Trigger manual batch" modal, PayPal Mass Payout
// integration, refund queue surface.

import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { requireAdmin } from '@foundations/auth/guards'
import {
  getAdminLedger,
  getAdminPayoutRequests,
  PayoutRequestQueue,
  LEDGER_STATUS_LABEL,
  LEDGER_KIND_LABEL,
  money,
  formatDate,
  type PayoutRequestStatus,
} from '@features/payouts'
import { PAYOUT_REQUEST_STATUS_VALUES } from '@features/payouts/request-options'
import { AdminShell } from '@features/admin'
import { sensitivePageMetadata } from '@foundations/metadata'
import styles from './page.module.css'

// P0.21 — `noindex` (also inherited from /admin layout).
export const metadata: Metadata = sensitivePageMetadata({
  title: 'Payouts',
  description: 'Admin payouts queue — approve, deny, batch payouts.',
  path: '/admin/payouts',
})
export const dynamic = 'force-dynamic'

type SearchParams = { status?: string }

export default async function AdminPayoutsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  // The /admin layout already calls requireRole(['admin', 'super_admin'])
  // — this is belt-and-suspenders so the getAdminPayoutRequests() query
  // is never called by an anon / non-admin caller.
  const user = await requireAdmin()
  if (!user) redirect('/login?next=/admin/payouts')

  const sp = await searchParams
  const rawStatus = sp.status ?? ''
  // Whitelist-only — unknown values fall back to no filter (matches
  // the LedgerFilters parseStatus pattern from P6.3).
  const statusFilter = (PAYOUT_REQUEST_STATUS_VALUES as readonly string[]).includes(rawStatus)
    ? (rawStatus as PayoutRequestStatus)
    : null

  // Two parallel reads: the queue (with status filter applied) +
  // the ledger (always full — ledger has its own URL params handled
  // in a future slice).
  const [requestsResult, ledgerResult] = await Promise.all([
    getAdminPayoutRequests({ status: statusFilter ?? undefined, limit: 50 }),
    getAdminLedger({ limit: 100 }),
  ])

  const { entries, totals } = ledgerResult

  return (
    <AdminShell title="Payouts">
      <header className={styles.header}>
        <h1 className={styles.h1}>Payouts</h1>
        <p className={styles.sub}>Every ledger entry across every partner, plus the payout-requests queue.</p>
      </header>

      <section className={styles.stats} aria-label="Payout stats">
        <StatCard label="Available" value={money(totals.available_cents)} dataAccent="success" />
        <StatCard label="Locked (refund window)" value={money(totals.locked_cents)} dataAccent="warn" />
        <StatCard label="Pending payout" value={money(totals.pending_payout_cents)} dataAccent="mute" />
        <StatCard label="Paid this month" value={money(totals.paid_this_month_cents)} dataAccent="mute" />
      </section>

      <PayoutRequestQueue result={requestsResult} />

      <section className={styles.ledgerSection} aria-label="Ledger">
        <h2 className={styles.h2}>Recent ledger entries</h2>
        {entries.length === 0 ? (
          <p className={styles.empty}>No ledger entries yet.</p>
        ) : (
          <ul className={styles.entries}>
            {entries.map((e) => (
              <li key={e.id} className={styles.entry} data-direction={e.amount_cents > 0 ? 'credit' : 'debit'}>
                <div className={styles.entryMain}>
                  <p className={styles.entryKind}>{LEDGER_KIND_LABEL[e.kind] ?? e.kind}</p>
                  <p className={styles.entryDesc}>
                    {e.description ?? '—'}
                    {e.partner_name ? ` · ${e.partner_name}` : ''}
                  </p>
                </div>
                <p className={styles.entryDate}>{formatDate(e.created_at)}</p>
                <p className={styles.entryStatus}>{LEDGER_STATUS_LABEL[e.status] ?? e.status}</p>
                <p className={styles.entryAmount}>
                  {e.amount_cents > 0 ? '+' : ''}
                  {money(e.amount_cents, e.currency)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={styles.byPartner} aria-label="Top available balances by partner">
        <h2 className={styles.h2}>Top available balances</h2>
        {totals.available_by_partner.length === 0 ? (
          <p className={styles.empty}>No available balances right now.</p>
        ) : (
          <ul className={styles.list}>
            {totals.available_by_partner.map((row) => (
              <li key={row.partner_id} className={styles.listRow}>
                <span className={styles.partnerName}>{row.partner_name ?? `Partner #${row.partner_id}`}</span>
                <span className={styles.partnerAmount}>{money(row.available_cents)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </AdminShell>
  )
}

function StatCard({
  label,
  value,
  dataAccent,
}: {
  label: string
  value: string
  dataAccent: 'success' | 'warn' | 'mute'
}) {
  return (
    <div className={styles.statCard} data-accent={dataAccent}>
      <p className={styles.statLabel}>{label}</p>
      <p className={styles.statValue}>{value}</p>
    </div>
  )
}