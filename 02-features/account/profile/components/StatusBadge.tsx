// StatusBadge — small status pill with semantic colors.
// Uses design tokens; no inline colors.
//
// Tone split:
//   - paid                → success (green)
//   - fulfilled           → success (green)
//   - pending             → info (blue)
//   - awaiting_payment    → info (blue)
//   - refunded            → neutral gray (the order is fully closed out)
//   - partially_refunded  → warn (amber) — money has moved, but not all of it
//   - failed              → danger (red)
//   - canceled            → danger (red)
//   - fraudulent          → danger (red, stronger emphasis)
//   - unknown fallback    → info (gray-blue "pending"-ish)
import styles from './StatusBadge.module.css'

export type StatusTone = 'paid' | 'pending' | 'failed' | 'refund' | 'partial' | 'fraud'

const STATUS_LABELS: Record<string, { label: string; tone: StatusTone }> = {
  paid: { label: 'Paid', tone: 'paid' },
  fulfilled: { label: 'Fulfilled', tone: 'paid' },
  pending: { label: 'Pending', tone: 'pending' },
  awaiting_payment: { label: 'Awaiting payment', tone: 'pending' },
  failed: { label: 'Failed', tone: 'failed' },
  canceled: { label: 'Canceled', tone: 'failed' },
  refunded: { label: 'Refunded', tone: 'refund' },
  partially_refunded: { label: 'Partially refunded', tone: 'partial' },
  fraudulent: { label: 'Fraudulent', tone: 'fraud' },
}

export function StatusBadge({ status }: { status: string }) {
  const meta = STATUS_LABELS[status] ?? { label: status, tone: 'pending' as StatusTone }
  return <span className={`${styles.badge} ${styles[meta.tone]}`}>{meta.label}</span>
}
