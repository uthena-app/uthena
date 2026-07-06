// RiskScoreBadge.tsx — the per-row risk score pill on the customers list.
// Displays the 0-100 score with a colored band (normal / watch / high /
// severe) matching the spec's color thresholds (line 20). Hover shows
// the three component contributions as a native HTML tooltip.
//
// Pure RSC. No client JS. Token-only CSS via [data-band] attribute
// selectors. The score breakdown is passed as a prop so the parent
// doesn't need to fetch it again.

import { RISK_BAND_LABEL, riskScoreBand } from '../types'
import styles from './RiskScoreBadge.module.css'

export type RiskScoreBadgeProps = {
  score: number
  refundCount: number
  disputeCount: number
  signalSeveritySum: number
  /** When true, renders just the colored pill (no number). */
  compact?: boolean
}

export function RiskScoreBadge({
  score,
  refundCount,
  disputeCount,
  signalSeveritySum,
  compact = false,
}: RiskScoreBadgeProps) {
  const band = riskScoreBand(score)
  const refundC = Math.min(40, refundCount * 8)
  const disputeC = Math.min(40, disputeCount * 20)
  const activityC = Math.min(20, signalSeveritySum)
  const label = `${RISK_BAND_LABEL[band]} · ${score}/100`
  const tooltip = [
    `Risk score: ${score}/100 (${RISK_BAND_LABEL[band]})`,
    `Refund contribution: ${refundC}/40  (${refundCount} refunds × 8, capped)`,
    `Dispute contribution: ${disputeC}/40  (${disputeCount} disputes × 20, capped)`,
    `Activity contribution: ${activityC}/20  (sum of unresolved signal severities, capped)`,
  ].join('\n')

  return (
    <span
      className={styles.badge}
      data-band={band}
      title={tooltip}
      aria-label={`Risk score ${score} of 100, ${RISK_BAND_LABEL[band]} band. Refund ${refundC} of 40. Dispute ${disputeC} of 40. Activity ${activityC} of 20.`}
    >
      <span className={styles.dot} aria-hidden="true" />
      {compact ? null : <span className={styles.value}>{score}</span>}
      <span className={styles.band}>{label}</span>
    </span>
  )
}