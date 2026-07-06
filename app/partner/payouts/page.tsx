// /partner/payouts — partner's own payout ledger + summary.
// RSC. RLS gates the read; the page renders whatever the partner
// can see.
//
// P6.3 — URL-driven status + kind + sort filters, partner-timezone
// date display. Filter chips live in the client `LedgerFilters`
// island; the page reads `?status=&kind=&sort=` and feeds them into
// `getPartnerLedger()`. The summary aggregate stays unfiltered by
// design — the partner's "Available / Locked / Paid" headline
// numbers reflect their full financial state regardless of the
// current ledger filter.
//
// P12.14 — adds the "Payout history" section: one row per PayPal
// Mass Payout batch. Lives between the summary cards and the
// request-payout card so the partner sees headline → batches →
// request flow without scrolling.

import type { Metadata } from 'next'
import { requirePartner } from '@foundations/auth/guards'
import {
  getPartnerLedger,
  getPendingPayoutRequest,
  getPartnerPayoutsHistory,
  LedgerRow,
  LedgerSummaryCards,
  LedgerFilters,
  ExportCsvButton,
  RequestPayoutButton,
  PayoutsHistoryTable,
  type LedgerFilterOptions,
  type LedgerSort,
} from '@features/payouts'
import { sensitivePageMetadata } from '@foundations/metadata'
import styles from './page.module.css'

// P0.21 — `noindex` so the partner payouts surface isn't indexed.
export const metadata: Metadata = sensitivePageMetadata({
  title: 'Payouts',
  description: 'Your Uthena partner payouts — ledger, available, paid out.',
  path: '/partner/payouts',
})
export const dynamic = 'force-dynamic'

// Helpers for parsing the raw `searchParams` (string | string[] |
// undefined) into the typed LedgerFilterOptions. Kept local to
// the page — not worth lifting to a foundation module until a
// second consumer needs them.
function firstParam(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0]
  return value
}

function parseStatus(value: string | undefined): LedgerFilterOptions['status'] {
  switch (value) {
    case 'accruing':
    case 'pending_payout':
    case 'locked':
    case 'available':
    case 'paid':
    case 'void':
      return value
    default:
      return undefined
  }
}

function parseKind(value: string | undefined): LedgerFilterOptions['kind'] {
  switch (value) {
    case 'order_sale':
    case 'subscription':
    case 'refund':
    case 'adjustment':
    case 'payout':
    case 'clawback':
      return value
    default:
      return undefined
  }
}

function parseSort(value: string | undefined): LedgerSort {
  if (value === 'amount' || value === 'kind') return value
  return 'date'
}

export default async function PartnerPayoutsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const user = await requirePartner()

  // Read + normalize URL params. We await the searchParams promise
  // (Next.js 15 made it async). The Zod schema in getPartnerLedger
  // is the final defensive gate — anything we let through here is
  // re-validated server-side.
  const sp = await searchParams
  const status = parseStatus(firstParam(sp.status))
  const kind = parseKind(firstParam(sp.kind))
  const sort = parseSort(firstParam(sp.sort))

  const result = await getPartnerLedger({ status, kind, sort })

  // P6.6 — read the partner's most-recent pending payout request in
  // parallel with the ledger read (both are RLS-gated reads on the
  // partner's own rows; the partner.id from getPartnerLedger isn't
  // needed here because getPendingPayoutRequest looks up its own
  // partner row keyed off the session user_id).
  //
  // P12.14 — also read the payouts history (one row per PayPal Mass
  // Payout batch) in parallel with the other two reads. All three
  // are independent — Promise.all keeps the page render under its
  // p95 budget.
  const [pending, payoutsHistory] = await Promise.all([
    getPendingPayoutRequest(),
    getPartnerPayoutsHistory(),
  ])

  if (!result) {
    // requirePartner() would have redirected if not a partner, but
    // a partner row might still be missing (race during onboarding).
    return (
      <main id="main" className={styles.page}>
        <h1 className={styles.h1}>Payouts</h1>
        <p className={styles.empty}>Your partner profile is being set up. Refresh in a few seconds.</p>
      </main>
    )
  }

  const { entries, summary, timezone } = result
  const filterActive = Boolean(status || kind)

  return (
    <main id="main" className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.h1}>Payouts</h1>
        <p className={styles.sub}>
          {user.display_name} — your lifetime earnings, in flight, and recent payouts.
        </p>
      </header>

      <LedgerSummaryCards summary={summary} timezone={timezone} />

      {/* P12.14 — Payout history: one row per PayPal Mass Payout batch.
          Lives between the summary cards and the request-payout card so
          the partner sees headline → batches → request flow without
          scrolling. The payoutsHistory array comes from the parallel
          read above; an empty array renders the friendly empty-state
          copy inside <PayoutsHistoryTable />. */}
      <section className={styles.historySection} aria-label="Payout history">
        <header className={styles.historyHead}>
          <h2 className={styles.h2}>Payout history</h2>
          <p className={styles.historyHint}>
            Each row is one PayPal Mass Payout batch — multiple commissions bundled together.
          </p>
        </header>
        <PayoutsHistoryTable batches={payoutsHistory} timezone={timezone} />
      </section>

      {/* P6.6 — the "Request payout" affordance. The page passes the
          available balance + any pending request; the button resolves
          its own state from those props (no double-reads in the
          browser). See `02-features/payouts/components/
          RequestPayoutButton.tsx` for the state machine. */}
      <section className={styles.requestSection} aria-label="Request payout">
        <h2 className={styles.h2}>Request payout</h2>
        <RequestPayoutButton
          availableCents={summary.available_cents}
          pendingRequest={
            pending
              ? {
                  id: pending.id,
                  amountCents: pending.amount_cents,
                  currency: pending.currency,
                  maskedPaypal: pending.payout_method_target_masked,
                  createdAt: pending.created_at,
                }
              : null
          }
        />
      </section>

      <section className={styles.ledgerSection} aria-label="Ledger">
        <header className={styles.ledgerHead}>
          <h2 className={styles.h2}>Recent ledger entries</h2>
          <p className={styles.ledgerHint}>
            Sales start as <strong>locked</strong> for the 14-day refund window, then move
            to <strong>available</strong>. The daily cron flips the status.
          </p>
        </header>

        <LedgerFilters
          currentStatus={status}
          currentKind={kind}
          currentSort={sort}
        />

        <div className={styles.toolbar}>
          <ExportCsvButton />
        </div>

        {filterActive && entries.length > 0 && (
          <p className={styles.filterCount} role="status">
            Showing {entries.length} filtered {entries.length === 1 ? 'entry' : 'entries'}.
          </p>
        )}

        {entries.length === 0 ? (
          <p className={styles.empty}>
            {filterActive
              ? 'No ledger entries match the current filter.'
              : 'Your first sale will appear here.'}
          </p>
        ) : (
          <ul className={styles.list}>
            {entries.map((entry) => (
              <LedgerRow key={entry.id} entry={entry} timezone={timezone} />
            ))}
          </ul>
        )}
      </section>
    </main>
  )
}