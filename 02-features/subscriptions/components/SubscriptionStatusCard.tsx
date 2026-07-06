// SubscriptionStatusCard.tsx — read-only status display.
// Server component. Shows the current state + next renewal date
// + the action buttons (Cancel / Resume / Manage in Stripe).

import {
  SubscriptionRow,
  statusLabel,
  statusColor,
  formatDate,
  PLAN_NAME,
} from '@features/subscriptions'
import { CancelButton } from './CancelButton'
import { ResumeButton } from './ResumeButton'
import { ManageInStripeButton } from './ManageInStripeButton'
import styles from './SubscriptionStatusCard.module.css'

const COLOR_VAR: Record<'success' | 'warn' | 'danger' | 'mute', string> = {
  success: 'var(--success)',
  warn: 'var(--warn)',
  danger: 'var(--danger)',
  mute: 'var(--text-3)',
}

const COLOR_BG: Record<'success' | 'warn' | 'danger' | 'mute', string> = {
  success: 'var(--success-soft)',
  warn: 'var(--warn-soft)',
  danger: 'var(--danger-soft)',
  mute: 'var(--bg-elev-2)',
}

export function SubscriptionStatusCard({ sub }: { sub: SubscriptionRow }) {
  const color = statusColor(sub.status)
  const isSubscriber = sub.status === 'active' || sub.status === 'trialing'
  const showCancel = isSubscriber && !sub.cancel_at_period_end
  const showResume = isSubscriber && sub.cancel_at_period_end
  return (
    <section className={styles.card} aria-label="Subscription status">
      <header className={styles.head}>
        <div>
          <p className={styles.eyebrow}>Current plan</p>
          <h2 className={styles.h2}>{PLAN_NAME}</h2>
        </div>
        <span
          className={styles.pill}
          style={{ color: COLOR_VAR[color], background: COLOR_BG[color] }}
        >
          {statusLabel(sub.status)}
        </span>
      </header>

      <dl className={styles.dl}>
        <div className={styles.row}>
          <dt>Next renewal</dt>
          <dd>
            {isSubscriber && sub.current_period_end
              ? formatDate(sub.current_period_end)
              : '—'}
          </dd>
        </div>
        {sub.cancel_at_period_end && sub.current_period_end && (
          <div className={styles.row}>
            <dt>Ends on</dt>
            <dd className={styles.warn}>{formatDate(sub.current_period_end)}</dd>
          </div>
        )}
        {sub.trial_end && sub.status === 'trialing' && (
          <div className={styles.row}>
            <dt>Trial ends</dt>
            <dd>{formatDate(sub.trial_end)}</dd>
          </div>
        )}
        <div className={styles.row}>
          <dt>Your discount</dt>
          <dd>15% off all PLR orders</dd>
        </div>
      </dl>

      <div className={styles.actions}>
        {showCancel && <CancelButton />}
        {showResume && <ResumeButton />}
        <ManageInStripeButton />
      </div>
    </section>
  )
}
