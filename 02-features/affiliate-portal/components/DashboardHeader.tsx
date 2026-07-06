// DashboardHeader.tsx — P13.3 dashboard header.
// RSC, zero client JS. Greets the affiliate and surfaces the
// status badge (approved/pending/suspended) next to the handle.
//
// The visual rhythm mirrors the partner dashboard header (eyebrow +
// h1 + lede + status pill), using the teal as the affiliate-role
// accent so the screen distinguishes the three role dashboards at
// a glance.

import styles from './DashboardHeader.module.css'

import type { AffiliateRow, AffiliateProfile } from '../queries/getAffiliateDashboard'

export function DashboardHeader({
  affiliate,
  profile,
}: {
  affiliate: AffiliateRow
  profile: AffiliateProfile
}) {
  const greetingName = profile.displayName || `@${affiliate.handle}`
  const statusLabel =
    affiliate.status === 'approved'
      ? 'Approved'
      : affiliate.status === 'suspended'
        ? 'Suspended'
        : 'Pending review'

  return (
    <header className={styles.header}>
      <p className={styles.eyebrow}>Affiliate portal</p>
      <div className={styles.titleRow}>
        <h1 className={styles.h1}>Hello, {greetingName}</h1>
        <span
          className={styles.statusPill}
          data-status={affiliate.status}
          aria-label={`Affiliate status: ${statusLabel}`}
        >
          {statusLabel}
        </span>
      </div>
      <p className={styles.lede}>
        Your affiliate hub — affiliate link, top products, commissions, and tools.
      </p>
    </header>
  )
}
