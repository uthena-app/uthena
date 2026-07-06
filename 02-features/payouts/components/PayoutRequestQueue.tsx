// PayoutRequestQueue.tsx — server component. Admin's read-only
// view of the payout_requests queue with status filter chips.
//
// P6.7 Slice 1 — first tick of the admin payouts queue. Slice 2+
// (deferred to STUB-057) will add approve / deny actions on each
// row, the "Trigger manual batch" modal, and the PayPal Mass Payout
// integration.
//
// Pattern mirrors P6.3's `<LedgerFilters>` + `<LedgerRow>` shape:
//   - Server component reads the data + parses the URL filter.
//   - Status filter is URL-driven via `?status=<value>` so the chip
//     strip is bookmarkable + shareable + survives page reload.
//   - The chip strip uses the `data-active="true"` attribute pattern
//     so CSS controls the visual active state — no inline styles.
//   - The row uses the `data-status="<value>"` attribute pattern so
//     CSS controls the status pill color (success / warn / danger /
//     mute) — matches the P6.4 `LedgerTimeline` pattern.
//
// PII safety: this component renders the MASKED PayPal email
// snapshot (already on the row). It does NOT render any plaintext
// PII. The status pill copy uses the canonical
// `PAYOUT_REQUEST_STATUS_LABEL` (added to format.ts).

import Link from 'next/link'
import { money, formatDate, PAYOUT_REQUEST_STATUS_LABEL } from '../format'
import {
  PAYOUT_REQUEST_STATUS_VALUES,
  type PayoutRequestStatus,
} from '../request-options'
import type { AdminPayoutRequest, AdminPayoutRequestsResult } from '../queries/getAdminPayoutRequests'
import styles from './PayoutRequestQueue.module.css'

const STATUS_FILTER_VALUES: readonly PayoutRequestStatus[] = PAYOUT_REQUEST_STATUS_VALUES

export function PayoutRequestQueue({
  result,
}: {
  /** Output of `getAdminPayoutRequests()`. The page already
   *  fetched it; the queue component is a pure renderer. */
  result: AdminPayoutRequestsResult
}) {
  const { requests, counts, filters } = result

  return (
    <section className={styles.section} aria-label="Payout requests">
      <header className={styles.header}>
        <h2 className={styles.h2}>Payout requests</h2>
        <p className={styles.sub}>
          Partner-initiated payout requests. {counts.pending > 0
            ? `${counts.pending} pending — review and approve, deny, or process via PayPal.`
            : 'No pending requests right now.'}
        </p>
      </header>

      {/* Status filter chips — URL-driven via ?status= */}
      <nav className={styles.chipStrip} aria-label="Filter by status">
        <FilterChip
          label="All"
          href={buildFilterHref(null)}
          count={counts.total}
          active={filters.status === null}
        />
        {STATUS_FILTER_VALUES.map((status) => {
          const count = counts[status]
          return (
            <FilterChip
              key={status}
              label={PAYOUT_REQUEST_STATUS_LABEL[status] ?? status}
              href={buildFilterHref(status)}
              count={count}
              active={filters.status === status}
            />
          )
        })}
      </nav>

      {/* List. Empty states branch on "no requests at all" vs
          "no requests match the filter" so the copy is honest. */}
      {requests.length === 0 ? (
        <p className={styles.empty}>
          {filters.status === null
            ? 'No payout requests yet. Partners will appear here when they request a payout.'
            : (() => {
                const label = PAYOUT_REQUEST_STATUS_LABEL[filters.status] ?? 'matching'
                return `No ${label.toLowerCase()} requests.`
              })()}
        </p>
      ) : (
        <ul className={styles.list}>
          {requests.map((req) => (
            <PayoutRequestRow key={req.id} request={req} />
          ))}
        </ul>
      )}
    </section>
  )
}

// ---------------------------------------------------------------------------
// Sub-components (internal — not exported)
// ---------------------------------------------------------------------------

function FilterChip({
  label,
  href,
  count,
  active,
}: {
  label: string
  href: string
  count: number
  active: boolean
}) {
  return (
    <Link
      href={href}
      className={styles.chip}
      data-active={active ? 'true' : 'false'}
      aria-pressed={active}
    >
      <span className={styles.chipLabel}>{label}</span>
      <span className={styles.chipCount}>{count}</span>
    </Link>
  )
}

function PayoutRequestRow({ request }: { request: AdminPayoutRequest }) {
  const status = request.status as PayoutRequestStatus
  return (
    <li className={styles.row} data-status={status}>
      <div className={styles.rowMain}>
        <p className={styles.rowPartner}>
          <Link
            href={`/admin/payouts/partner/${request.partner_id}`}
            className={styles.rowPartnerLink}
            aria-label={`Open partner #${request.partner_id} payouts detail`}
          >
            {request.partner_name ?? `Partner #${request.partner_id}`}
          </Link>
          <span className={styles.rowId}>#{request.id}</span>
        </p>
        <p className={styles.rowMethod} aria-label="PayPal">
          PayPal: <span className={styles.mono}>{request.payout_method_target_masked}</span>
        </p>
      </div>
      <p className={styles.rowAmount} data-direction="credit">
        {money(request.amount_cents, request.currency)}
      </p>
      <p className={styles.rowDate}>{formatDate(request.created_at)}</p>
      <span className={styles.statusPill} data-status={status}>
        {PAYOUT_REQUEST_STATUS_LABEL[status] ?? status}
      </span>
      <Link
        href={`/admin/payouts/request/${request.id}`}
        className={styles.rowAction}
        aria-label={`Review request #${request.id}`}
      >
        Review →
      </Link>
    </li>
  )
}

/**
 * P6.8 — exported for reuse by the per-partner admin detail page
 * (`AdminPartnerPayouts`). Same shape + styling as the row inside
 * `<PayoutRequestQueue>`; the only difference is the caller (a
 * different RSC tree). The row renders the masked PayPal snapshot
 * from the row — never plaintext — and the status pill via the
 * `[data-status]` attribute selector.
 */
export { PayoutRequestRow }

// ---------------------------------------------------------------------------
// URL helper — keep the filter URL canonical (no `?status=` when All is
// the active filter; strip trailing `?` if it's the only param).
// ---------------------------------------------------------------------------
function buildFilterHref(status: PayoutRequestStatus | null): string {
  const params = new URLSearchParams()
  if (status) params.set('status', status)
  const qs = params.toString()
  return qs ? `/admin/payouts?${qs}` : '/admin/payouts'
}