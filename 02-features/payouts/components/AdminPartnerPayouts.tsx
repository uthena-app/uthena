// AdminPartnerPayouts.tsx — admin's read-only view of one partner's
// payouts. RSC; no client JS.
//
// P6.8 Slice 1 — the per-partner view the admin needs before any
// write actions land (force-adjust / clawback are Slice 2+,
// deferred to STUB-058). The page renders:
//   - Hero: partner identity + lifecycle status + royalty rate
//   - Summary cards: 4 stat tiles (available / locked / paid /
//     pending) + lifetime earned
//   - Recent ledger entries: full history (limit 50, the canonical
//     default from getAdminPartnerPayouts; "Load more" is Slice 2)
//   - Payout requests: full history (limit 50, same default)
//
// Design rules followed:
//   - **No inline colors.** All color is driven by `[data-*]`
//     attribute selectors in the CSS module. (The existing
//     `LedgerRow.tsx` uses inline styles — we don't reuse it here;
//     we inline a token-only variant for the admin context.)
//   - **No inline magic values.** All spacing / type / color via
//     `var(--*)` tokens.
//   - **Empty states are designed.** Both the ledger + requests
//     lists render a one-line message when empty (no generic
//     "no data" copy).
//   - **Defensive about bad DB data.** A corrupted ledger row is
//     dropped by the query, not surfaced as a half-mapped shape.
//     We never re-validate in the component.
//
// PII safety: this component NEVER renders plaintext email,
// plaintext IP, or plaintext user_agent. The display_name is the
// only PII-adjacent identifier surfaced; the partner's payout
// email is not decrypted on this page (it's read via the partner
// settings surface when needed; P6.8 Slice 1 keeps this page
// focused on payouts).

import {
  LEDGER_KIND_LABEL,
  LEDGER_STATUS_LABEL,
  PAYOUT_REQUEST_STATUS_LABEL,
  money,
  formatDate,
  formatDateTime,
} from '../format'
import { PAYOUT_REQUEST_STATUS_VALUES, type PayoutRequestStatus } from '../request-options'
import { PayoutRequestRow } from './PayoutRequestQueue'
import type {
  AdminPartnerInfo,
  AdminPartnerPayoutsResult,
} from '../queries/getAdminPartnerPayouts'
import type { LedgerEntry, LedgerSummary } from '../queries/getPartnerLedger'
import type { AdminPayoutRequest } from '../queries/getAdminPayoutRequests'
import type { PartnerStorageUsage } from '../queries/getPartnerStorageUsage'
import { formatStorageSize } from '../lib/formatStorageSize'
import styles from './AdminPartnerPayouts.module.css'

export function AdminPartnerPayouts({
  result,
  storage,
}: {
  result: AdminPartnerPayoutsResult
  storage: PartnerStorageUsage
}) {
  const { partner, ledger, payoutRequests } = result

  return (
    <article className={styles.page}>
      <PartnerHero partner={partner} />
      <SummaryCards summary={ledger.summary} />
      <StorageSection storage={storage} />
      <LedgerSection entries={ledger.entries} />
      <RequestsSection requests={payoutRequests} />
    </article>
  )
}

// ---------------------------------------------------------------------------
// Hero — partner identity + lifecycle status + royalty rate
// ---------------------------------------------------------------------------

function PartnerHero({ partner }: { partner: AdminPartnerInfo }) {
  const statusLabel = partner.status.charAt(0).toUpperCase() + partner.status.slice(1)
  const royaltyLabel =
    partner.royalty_pct_bps === null
      ? '—'
      : `${(partner.royalty_pct_bps / 100).toFixed(2)}%`
  return (
    <header className={styles.hero}>
      <div className={styles.heroText}>
        <p className={styles.eyebrow}>Partner payouts</p>
        <h1 className={styles.h1}>
          <span className={styles.displayName}>{partner.display_name}</span>
          <span className={styles.partnerId}>#{partner.id}</span>
        </h1>
        <p className={styles.sub}>
          {partner.public_slug ? (
            <>
              <span className={styles.slug}>{partner.public_slug}</span>
              <span className={styles.dot}> · </span>
            </>
          ) : null}
          Member since {formatDate(partner.created_at)}
        </p>
      </div>
      <div className={styles.heroBadges}>
        <span className={styles.statusPill} data-status={partner.status}>
          {statusLabel}
        </span>
        <p className={styles.royalty} aria-label="Royalty rate">
          Royalty: <strong>{royaltyLabel}</strong>
        </p>
        {partner.approved_at && (
          <p className={styles.approved}>
            Approved {formatDate(partner.approved_at)}
          </p>
        )}
      </div>
    </header>
  )
}

// ---------------------------------------------------------------------------
// Summary cards — 4 stat tiles + lifetime
// ---------------------------------------------------------------------------

function SummaryCards({ summary }: { summary: LedgerSummary }) {
  return (
    <section className={styles.summary} aria-label="Payout summary">
      <SummaryCard
        label="Available"
        value={money(summary.available_cents)}
        accent="success"
      />
      <SummaryCard
        label="Locked (refund window)"
        value={money(summary.locked_cents)}
        accent="warn"
      />
      <SummaryCard label="Paid (lifetime)" value={money(summary.paid_cents)} accent="mute" />
      <SummaryCard
        label="Pending payout"
        value={money(summary.pending_payout_cents)}
        accent="accent"
      />
      <p className={styles.lifetime} aria-label="Lifetime earned">
        Lifetime earned: <strong>{money(summary.lifetime_earned_cents)}</strong>
        {summary.next_release_at && (
          <>
            {' · '}
            <span className={styles.muted}>Next release {formatDate(summary.next_release_at)}</span>
          </>
        )}
      </p>
    </section>
  )
}

function SummaryCard({
  label,
  value,
  accent,
}: {
  label: string
  value: string
  accent: 'success' | 'warn' | 'mute' | 'accent'
}) {
  return (
    <div className={styles.summaryCard} data-accent={accent}>
      <p className={styles.summaryLabel}>{label}</p>
      <p className={styles.summaryValue}>{value}</p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Storage section — P7.10 storage quota display
// ---------------------------------------------------------------------------

/**
 * Renders the partner's storage usage:
 *   - Headline: total size + file count + product count
 *   - Per-product breakdown (top N products by size)
 *
 * Two empty states are designed:
 *   - "No files uploaded yet." — when total_bytes=0 AND file_count=0
 *   - The breakdown list renders nothing when by_product is empty
 *     (i.e. when product_count > 0 but every product has 0 bytes;
 *     this happens for partners whose products are still drafts
 *     with no media).
 *
 * Per-product rows render a size-bar (background gradient from
 * the largest product) so the admin can see at a glance which
 * product is hogging the quota. All colors via design tokens.
 */
function StorageSection({ storage }: { storage: PartnerStorageUsage }) {
  const isEmpty = storage.total_bytes === 0 && storage.file_count === 0
  const headline = isEmpty
    ? 'No files uploaded yet.'
    : `${formatStorageSize(storage.total_bytes)} across ${storage.file_count} file${storage.file_count === 1 ? '' : 's'} in ${storage.product_count} product${storage.product_count === 1 ? '' : 's'}`
  const largest = storage.by_product[0]?.size_bytes ?? 0
  return (
    <section className={styles.storage} aria-label="Storage usage">
      <header className={styles.sectionHeader}>
        <h2 className={styles.h2}>Storage usage</h2>
        <p className={styles.sectionSub}>
          {headline}
          {storage.capped && storage.by_product.length > 0
            ? ` · Showing top ${storage.by_product.length} products.`
            : null}
        </p>
      </header>
      {!isEmpty && storage.by_product.length > 0 ? (
        <ul className={styles.storageList}>
          {storage.by_product.map((p) => {
            const pct = largest > 0 ? Math.round((p.size_bytes / largest) * 100) : 0
            return (
              <li
                key={p.product_id}
                className={styles.storageRow}
                data-status={p.product_status}
              >
                <div className={styles.storageMainCol}>
                  <p className={styles.storageTitle}>{p.product_title}</p>
                  <p className={styles.storageMeta}>
                    <span className={styles.storageSlug}>{p.product_slug}</span>
                    <span className={styles.dot}> · </span>
                    <span className={styles.storageFileCount}>
                      {p.file_count} file{p.file_count === 1 ? '' : 's'}
                    </span>
                  </p>
                  <div
                    className={styles.storageBar}
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={pct}
                    aria-label={`${p.product_title} uses ${pct}% of the largest product's storage`}
                  >
                    <div
                      className={styles.storageBarFill}
                      style={{ width: `${pct}%` }}
                      data-fill={pct >= 80 ? 'heavy' : pct >= 40 ? 'mid' : 'light'}
                    />
                  </div>
                </div>
                <p className={styles.storageSize}>{formatStorageSize(p.size_bytes)}</p>
              </li>
            )
          })}
        </ul>
      ) : null}
    </section>
  )
}

// ---------------------------------------------------------------------------
// Ledger section — full history, newest first
// ---------------------------------------------------------------------------

function LedgerSection({ entries }: { entries: LedgerEntry[] }) {
  return (
    <section className={styles.ledger} aria-label="Ledger entries">
      <header className={styles.sectionHeader}>
        <h2 className={styles.h2}>Ledger entries</h2>
        <p className={styles.sectionSub}>
          {entries.length === 0
            ? 'No ledger entries yet.'
            : `Showing ${entries.length} most recent entries. Newest first.`}
        </p>
      </header>
      {entries.length === 0 ? null : (
        <ul className={styles.list}>
          {entries.map((entry) => (
            <AdminLedgerRow key={entry.id} entry={entry} />
          ))}
        </ul>
      )}
    </section>
  )
}

/** Admin-context ledger row. Mirrors the partner `LedgerRow` shape
 *  but with `data-*` attribute-driven colors (no inline styles)
 *  and no Link wrapping — Slice 1 is read-only and the per-entry
 *  admin detail page doesn't exist yet (it's a different route
 *  the admin would want, but the slice scope is the partner view).
 *  When the admin-side per-entry detail ships, swap this for a
 *  Link wrapper. */
function AdminLedgerRow({ entry }: { entry: LedgerEntry }) {
  const isCredit = entry.amount_cents > 0
  return (
    <li className={styles.ledgerRow} data-kind={entry.kind}>
      <div className={styles.ledgerDateCol}>
        <p className={styles.ledgerDate}>{formatDate(entry.created_at)}</p>
        {entry.order_id && (
          <p className={styles.ledgerOrderId}>Order #{entry.order_id}</p>
        )}
      </div>
      <div className={styles.ledgerMainCol}>
        <span className={styles.ledgerKind} data-kind={entry.kind}>
          {LEDGER_KIND_LABEL[entry.kind] ?? entry.kind}
        </span>
        {entry.description && (
          <p className={styles.ledgerDesc}>{entry.description}</p>
        )}
      </div>
      <span className={styles.ledgerStatus} data-status={entry.status}>
        {LEDGER_STATUS_LABEL[entry.status] ?? entry.status}
      </span>
      <p
        className={styles.ledgerAmount}
        data-direction={isCredit ? 'credit' : 'debit'}
      >
        {isCredit ? '+' : ''}
        {money(entry.amount_cents, entry.currency)}
      </p>
    </li>
  )
}

// ---------------------------------------------------------------------------
// Requests section — full history, newest first
// ---------------------------------------------------------------------------

function RequestsSection({ requests }: { requests: AdminPayoutRequest[] }) {
  return (
    <section className={styles.requests} aria-label="Payout requests">
      <header className={styles.sectionHeader}>
        <h2 className={styles.h2}>Payout requests</h2>
        <p className={styles.sectionSub}>
          {requests.length === 0
            ? 'No payout requests yet.'
            : `Showing ${requests.length} most recent requests. Newest first.`}
        </p>
      </header>
      {requests.length === 0 ? null : (
        <ul className={styles.list}>
          {requests.map((req) => (
            <PayoutRequestRow key={req.id} request={req} />
          ))}
        </ul>
      )}
    </section>
  )
}

// Re-export the request status types for the page route's typing.
export { PAYOUT_REQUEST_STATUS_VALUES, type PayoutRequestStatus }