// LedgerSummary.tsx — 4 stat cards: Available, Locked, Paid, Lifetime earned.
//
// P6.3 — accepts the partner's IANA `timezone` so the "Next release"
// hint date renders in their local time. The number formatting is
// unaffected (dates only).

import type { LedgerSummary as LedgerSummaryData } from '@features/payouts/queries/getPartnerLedger'
import { money, formatDate } from '@features/payouts/format'
import styles from './LedgerSummary.module.css'

export function LedgerSummary({
  summary,
  currency = 'USD',
  timezone,
}: {
  summary: LedgerSummaryData
  currency?: string
  timezone?: string | null
}) {
  return (
    <div className={styles.grid}>
      <StatCard label="Available" value={money(summary.available_cents, currency)} accent="success" />
      <StatCard
        label="Locked"
        value={money(summary.locked_cents, currency)}
        hint={summary.next_release_at ? `Next release ${formatDate(summary.next_release_at, 'en-US', timezone)}` : 'No upcoming releases'}
        accent="warn"
      />
      <StatCard label="Paid" value={money(summary.paid_cents, currency)} accent="mute" />
      <StatCard label="Lifetime earned" value={money(summary.lifetime_earned_cents, currency)} accent="mute" />
    </div>
  )
}

function StatCard({
  label,
  value,
  hint,
  accent,
}: {
  label: string
  value: string
  hint?: string
  accent: 'success' | 'warn' | 'mute'
}) {
  const colorVar = accent === 'success' ? 'var(--success)' : accent === 'warn' ? 'var(--warn)' : 'var(--heading)'
  return (
    <div className={styles.card}>
      <p className={styles.label}>{label}</p>
      <p className={styles.value} style={{ color: colorVar }}>{value}</p>
      {hint && <p className={styles.hint}>{hint}</p>}
    </div>
  )
}