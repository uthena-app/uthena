// CustomerDetailOverview.tsx — the Overview tab content for
// /admin/customers/[id]. Renders the read-only summary the spec
// calls for on the first tab (line 11-23 of
// 01-specs/pages/admin-customer-detail.md):
//
//   - Status badge (active / suspended / banned)
//   - Lifetime stats (spend / orders / library / refund rate)
//   - Risk score with breakdown (reuses RiskScoreBadge from P14.1)
//   - Contact (email masked + first-seen IP masked)
//   - Signup date + last active
//
// Slice 1 ships the static masked view. The Reveal interaction
// (with 30s auto-mask + audit row) is deferred to Slice 2 — the
// reveal RPCs already exist (migration 0053) and Slice 2 will
// compose them as a client island.
//
// Pure RSC. No client JS. Token-only CSS.

import { formatDate } from '@features/payouts'
import { formatMoney } from '@foundations/money/cents'
import { RiskScoreBadge } from './RiskScoreBadge'
import type { CustomerDetail } from '../queries/getAdminCustomerDetail'
import styles from './CustomerDetailOverview.module.css'

export function CustomerDetailOverview({
  detail,
}: {
  detail: CustomerDetail
}) {
  // Format the status label — match the P14.1 list-page pattern.
  const statusLabel = detail.status.charAt(0).toUpperCase() + detail.status.slice(1)

  // Build the suspension / ban banner only when there's something
  // to surface. The Status badge itself is always rendered; the
  // banner is a secondary callout with the reason + timestamps.
  const stateBanner = buildStateBanner(detail)

  return (
    <div className={styles.wrap}>
      {/* Status + state banner */}
      <section className={styles.section} aria-label="Account status">
        <header className={styles.sectionHeader}>
          <h2 className={styles.h2}>Account status</h2>
          <span className={styles.status} data-status={detail.status}>
            {statusLabel}
          </span>
        </header>
        {stateBanner ? (
          <div className={styles.stateBanner} data-status={detail.status}>
            {stateBanner}
          </div>
        ) : null}
        {detail.warnings_count > 0 ? (
          <p className={styles.warnings}>
            {detail.warnings_count} prior{' '}
            {detail.warnings_count === 1 ? 'warning' : 'warnings'} on this account.
          </p>
        ) : null}
      </section>

      {/* Lifetime stats — 4-card grid */}
      <section className={styles.section} aria-label="Lifetime stats">
        <header className={styles.sectionHeader}>
          <h2 className={styles.h2}>Lifetime</h2>
        </header>
        <div className={styles.statsRow}>
          <div className={styles.statCard}>
            <p className={styles.statLabel}>Spend</p>
            <p className={styles.statValue}>
              {formatMoney(detail.lifetime_spend_cents)}
            </p>
          </div>
          <div className={styles.statCard}>
            <p className={styles.statLabel}>Orders</p>
            <p className={styles.statValue}>
              {detail.order_count.toLocaleString('en-US')}
            </p>
          </div>
          <div className={styles.statCard}>
            <p className={styles.statLabel}>Library</p>
            <p className={styles.statValue}>
              {detail.library_size.toLocaleString('en-US')}
            </p>
          </div>
          <div className={styles.statCard}>
            <p className={styles.statLabel}>Refund rate</p>
            <p className={styles.statValue}>
              {detail.refund_rate.toFixed(2)}%
            </p>
          </div>
        </div>
      </section>

      {/* Risk score + breakdown */}
      <section className={styles.section} aria-label="Risk score">
        <header className={styles.sectionHeader}>
          <h2 className={styles.h2}>Risk</h2>
        </header>
        <RiskScoreBadge
          score={detail.risk_score}
          refundCount={detail.risk_refund_count}
          disputeCount={detail.risk_dispute_count}
          signalSeveritySum={detail.risk_signal_severity_sum}
        />
        <p className={styles.riskHint}>
          Hover the badge for the per-component breakdown. Band thresholds:{' '}
          0–30 Normal, 31–60 Watch, 61–80 High, 81–100 Severe.
        </p>
      </section>

      {/* Contact + identity — masked display */}
      <section className={styles.section} aria-label="Contact">
        <header className={styles.sectionHeader}>
          <h2 className={styles.h2}>Contact</h2>
        </header>
        <dl className={styles.dl}>
          <div className={styles.dlRow}>
            <dt className={styles.dt}>Email</dt>
            <dd className={styles.dd} data-pii="masked">
              {detail.email_masked ?? '—'}
            </dd>
          </div>
          <div className={styles.dlRow}>
            <dt className={styles.dt}>First-seen IP</dt>
            <dd className={styles.dd} data-pii="masked">
              {detail.first_seen_ip_masked ?? '—'}
            </dd>
          </div>
          <div className={styles.dlRow}>
            <dt className={styles.dt}>Signup date</dt>
            <dd className={styles.dd}>{formatDate(detail.signup_date)}</dd>
          </div>
          <div className={styles.dlRow}>
            <dt className={styles.dt}>Last sign-in</dt>
            <dd className={styles.dd}>
              {detail.last_sign_in_at ? formatDate(detail.last_sign_in_at) : '—'}
            </dd>
          </div>
          <div className={styles.dlRow}>
            <dt className={styles.dt}>Last active</dt>
            <dd className={styles.dd}>
              {detail.last_active_at &&
              !detail.last_active_at.startsWith('1970-')
                ? formatDate(detail.last_active_at)
                : '—'}
            </dd>
          </div>
          <div className={styles.dlRow}>
            <dt className={styles.dt}>Role</dt>
            <dd className={styles.dd}>
              <span className={styles.role} data-role={detail.role}>
                {detail.role}
              </span>
            </dd>
          </div>
        </dl>
        <p className={styles.maskHint}>
          Email + IP are masked by default. The Reveal interaction (with a
          30-second auto-mask and an audit-log row per reveal) lands in
          the next slice.
        </p>
      </section>
    </div>
  )
}

function buildStateBanner(detail: CustomerDetail): string | null {
  if (detail.status === 'suspended') {
    const until = detail.suspended_until ? ` until ${formatDate(detail.suspended_until)}` : ''
    const reason = detail.suspended_reason ? ` — "${detail.suspended_reason}"` : ''
    const since = detail.suspended_at ? ` since ${formatDate(detail.suspended_at)}` : ''
    return `Suspended${since}${until}${reason}`
  }
  if (detail.status === 'banned') {
    const reason = detail.banned_reason ? ` — "${detail.banned_reason}"` : ''
    const since = detail.banned_at ? ` since ${formatDate(detail.banned_at)}` : ''
    return `Banned${since}${reason}. Ban is irreversible in v1.`
  }
  return null
}