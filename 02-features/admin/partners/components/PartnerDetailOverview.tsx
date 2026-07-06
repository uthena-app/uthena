// PartnerDetailOverview.tsx — the Overview tab content for
// /admin/partners/[id]. Renders the read-only summary the spec calls
// for on the first tab (line 13-15 of
// 01-specs/pages/admin-partner-detail.md):
//
//   - Status badges (kyc, tax, suspended/approved)
//   - Lifetime stats (revenue, sales, courses count, students count,
//     refund rate)
//   - Contact (display_name, email, bio, website_url, payout email
//     masked as `j***@paypal.com`)
//   - Join date, last activity
//
// Slice 1 ships the static masked view. The Reveal interaction
// (with 30s auto-mask + audit row per reveal) is deferred to Slice 2
// (STUB-118). The Reveal RPCs will land alongside the Profile /
// Courses / Sales tabs — Slice 2 has 6 distinct reveal surfaces
// (payout email, tax_id, customer email × 2, KYC front/back).
//
// Pure RSC. No client JS. Token-only CSS.

import { formatDate } from '@features/payouts'
import { formatMoney } from '@foundations/money/cents'
import {
  PARTNER_KYC_LABEL,
  PARTNER_STATUS_LABEL,
  PARTNER_TAX_FORM_LABEL,
} from '../types'
import type { PartnerDetail } from '../queries/getAdminPartnerDetail'
import styles from './PartnerDetailOverview.module.css'

export function PartnerDetailOverview({
  detail,
}: {
  detail: PartnerDetail
}) {
  const statusLabel = PARTNER_STATUS_LABEL[detail.status]
  const kycLabel = PARTNER_KYC_LABEL[detail.kyc_status]
  const taxLabel = PARTNER_TAX_FORM_LABEL[detail.tax_form_status]

  // The royalty pct is null when the partner inherits the platform
  // default. Render `Default` rather than `0%` so the admin knows
  // the difference between "explicitly zero" (would never happen) and
  // "no override".
  const royaltyDisplay =
    detail.royalty_pct_bps === null
      ? 'Default'
      : `${(detail.royalty_pct_bps / 100).toFixed(2)}%`

  return (
    <div className={styles.wrap}>
      {/* Status badges — partner status + KYC + tax */}
      <section className={styles.section} aria-label="Partner status">
        <header className={styles.sectionHeader}>
          <h2 className={styles.h2}>Partner status</h2>
        </header>
        <div className={styles.badgeRow}>
          <span className={styles.status} data-status={detail.status}>
            {statusLabel}
          </span>
          <span className={styles.statusSub} data-status={detail.kyc_status}>
            KYC: {kycLabel}
          </span>
          <span className={styles.statusSub} data-status={detail.tax_form_status}>
            Tax: {taxLabel}
          </span>
        </div>
      </section>

      {/* Lifetime stats — 4-card grid */}
      <section className={styles.section} aria-label="Lifetime stats">
        <header className={styles.sectionHeader}>
          <h2 className={styles.h2}>Lifetime</h2>
        </header>
        <div className={styles.statsRow}>
          <div className={styles.statCard}>
            <p className={styles.statLabel}>Revenue</p>
            <p className={styles.statValue}>
              {formatMoney(detail.lifetime_revenue_cents)}
            </p>
          </div>
          <div className={styles.statCard}>
            <p className={styles.statLabel}>Paid out</p>
            <p className={styles.statValue}>
              {formatMoney(detail.lifetime_paid_out_cents)}
            </p>
          </div>
          <div className={styles.statCard}>
            <p className={styles.statLabel}>Courses</p>
            <p className={styles.statValue}>
              {detail.courses_count.toLocaleString('en-US')}
            </p>
          </div>
          <div className={styles.statCard}>
            <p className={styles.statLabel}>Students</p>
            <p className={styles.statValue}>
              {detail.distinct_buyers_count.toLocaleString('en-US')}
            </p>
          </div>
          <div className={styles.statCard}>
            <p className={styles.statLabel}>Orders</p>
            <p className={styles.statValue}>
              {detail.total_order_count.toLocaleString('en-US')}
            </p>
          </div>
          <div className={styles.statCard}>
            <p className={styles.statLabel}>Refund rate</p>
            <p className={styles.statValue}>
              {(detail.refund_rate * 100).toFixed(2)}%
            </p>
          </div>
        </div>
      </section>

      {/* Contact — masked email + masked payout email */}
      <section className={styles.section} aria-label="Contact">
        <header className={styles.sectionHeader}>
          <h2 className={styles.h2}>Contact</h2>
        </header>
        <dl className={styles.dl}>
          <div className={styles.dlRow}>
            <dt className={styles.dt}>Display name</dt>
            <dd className={styles.dd}>{detail.display_name}</dd>
          </div>
          <div className={styles.dlRow}>
            <dt className={styles.dt}>Email</dt>
            <dd className={styles.dd} data-pii="masked">
              {detail.email_masked}
            </dd>
          </div>
          <div className={styles.dlRow}>
            <dt className={styles.dt}>Payout email</dt>
            <dd className={styles.dd} data-pii="masked">
              {detail.payout_email_masked ?? (
                <span className={styles.unset}>Not configured</span>
              )}
            </dd>
          </div>
          {detail.partner_bio ? (
            <div className={styles.dlRow}>
              <dt className={styles.dt}>Bio</dt>
              <dd className={styles.dd}>{detail.partner_bio}</dd>
            </div>
          ) : null}
          {detail.website_url ? (
            <div className={styles.dlRow}>
              <dt className={styles.dt}>Website</dt>
              <dd className={styles.dd}>
                <a
                  href={detail.website_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={styles.link}
                >
                  {detail.website_url}
                </a>
              </dd>
            </div>
          ) : null}
          {detail.public_slug ? (
            <div className={styles.dlRow}>
              <dt className={styles.dt}>Public slug</dt>
              <dd className={styles.dd}>
                <code className={styles.code}>{detail.public_slug}</code>
              </dd>
            </div>
          ) : null}
        </dl>
        <p className={styles.maskHint}>
          Email + payout email are masked by default. The Reveal
          interaction (with a 30-second auto-mask and an audit-log row
          per reveal) lands in the next slice.
        </p>
      </section>

      {/* Identity + lifecycle */}
      <section className={styles.section} aria-label="Identity">
        <header className={styles.sectionHeader}>
          <h2 className={styles.h2}>Identity</h2>
        </header>
        <dl className={styles.dl}>
          <div className={styles.dlRow}>
            <dt className={styles.dt}>partner.id</dt>
            <dd className={styles.dd}>
              <code className={styles.code}>{detail.partner_id}</code>
            </dd>
          </div>
          <div className={styles.dlRow}>
            <dt className={styles.dt}>user_id</dt>
            <dd className={styles.dd}>
              <code className={styles.code}>{detail.user_id}</code>
            </dd>
          </div>
          <div className={styles.dlRow}>
            <dt className={styles.dt}>Royalty rate</dt>
            <dd className={styles.dd}>{royaltyDisplay}</dd>
          </div>
          <div className={styles.dlRow}>
            <dt className={styles.dt}>Joined</dt>
            <dd className={styles.dd}>{formatDate(detail.created_at)}</dd>
          </div>
          <div className={styles.dlRow}>
            <dt className={styles.dt}>Approved</dt>
            <dd className={styles.dd}>
              {detail.approved_at
                ? formatDate(detail.approved_at)
                : '—'}
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
        </dl>
      </section>
    </div>
  )
}