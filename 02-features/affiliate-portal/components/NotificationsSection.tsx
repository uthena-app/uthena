'use client'

// NotificationsSection — /affiliate/settings Notifications section.
//
// Client island for the spec's "Notifications" section
// (`affiliate-settings.md` §Data + §Acceptance §5).
//
// **The 4 toggles (per spec line 71 + line 17-20):**
//   - affiliate_updates_opt_in        (default: false) — marketing opt-in
//   - commission_notifications_opt_in (default: true)  — commission events
//   - payout_notifications_opt_in     (default: true)  — payout sent emails
//   - monthly_digest_opt_in           (default: true)  — monthly summary
//
// **Toggle shape:** each toggle is a `<button role="switch">`
// (NOT an `<input type="checkbox">`) — the canonical a11y pattern
// for atomic toggle buttons. The button carries an
// `aria-label="<title> (on|off)"` so screen readers announce the
// state, and `aria-checked` mirrors the visual state.
//
// **Behavior per spec §Acceptance §5:**
//   "Each notification toggle is independent; flipping one does
//    not affect the others; the four defaults are ..."
//   → each toggle is a separate client patch; one toggle's save
//    doesn't batch with another.
//
// **Behavior per spec line 69:**
//   "Inline edits ... save within 300ms; on failure the field
//    reverts and a toast shows the error"
//   → each toggle fires the server action immediately on click
//   (no extra debounce — toggles are atomic, not text inputs).
//   On failure, the toggle reverts + a toast surfaces the error.

import { useState, useTransition } from 'react'
import {
  updateAffiliateNotificationPrefsAction,
  type UpdateAffiliateNotificationPrefsResult,
} from '../actions/settings/updateAffiliateNotificationPrefsAction'
import styles from './NotificationsSection.module.css'

type NotificationsSectionProps = {
  initial: {
    affiliateUpdatesOptIn: boolean
    commissionNotificationsOptIn: boolean
    payoutNotificationsOptIn: boolean
    monthlyDigestOptIn: boolean
  }
}

type ToggleKey = keyof NotificationsSectionProps['initial']

const TOGGLES: ReadonlyArray<{
  key: ToggleKey
  col: 'affiliate_updates_opt_in' | 'commission_notifications_opt_in' | 'payout_notifications_opt_in' | 'monthly_digest_opt_in'
  title: string
  description: string
  variant: 'marketing' | 'transactional'
}> = [
  {
    key: 'affiliateUpdatesOptIn',
    col: 'affiliate_updates_opt_in',
    title: 'Affiliate program updates',
    description:
      'Occasional platform news, new features, and promotions from the affiliate program.',
    variant: 'marketing',
  },
  {
    key: 'commissionNotificationsOptIn',
    col: 'commission_notifications_opt_in',
    title: 'Commission events',
    description:
      'A daily digest of new commissions you earned. Defaults to on so you never miss a sale.',
    variant: 'transactional',
  },
  {
    key: 'payoutNotificationsOptIn',
    col: 'payout_notifications_opt_in',
    title: 'Payout sent',
    description:
      'An email when a payout is sent to your PayPal. Defaults to on — you always know when money moves.',
    variant: 'transactional',
  },
  {
    key: 'monthlyDigestOptIn',
    col: 'monthly_digest_opt_in',
    title: 'Monthly digest',
    description:
      'A monthly summary of your clicks, conversions, and earnings. Sent on the 1st at 9am local time.',
    variant: 'transactional',
  },
]

export function NotificationsSection({ initial }: NotificationsSectionProps) {
  const [prefs, setPrefs] =
    useState<NotificationsSectionProps['initial']>(initial)
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null)
  const [pendingKey, setPendingKey] = useState<ToggleKey | null>(null)
  const [, startTransition] = useTransition()

  function showToast(kind: 'ok' | 'err', msg: string) {
    setToast({ kind, msg })
    window.setTimeout(() => setToast(null), 2400)
  }

  function toggle(key: ToggleKey) {
    const next = !prefs[key]
    const before = prefs[key]
    // Optimistic update + revert on failure (per spec line 69).
    setPrefs((prev) => ({ ...prev, [key]: next }))
    setPendingKey(key)
    const col = TOGGLES.find((t) => t.key === key)!.col
    startTransition(async () => {
      const result: UpdateAffiliateNotificationPrefsResult =
        await updateAffiliateNotificationPrefsAction({ [col]: next })
      setPendingKey(null)
      if (!result.ok) {
        setPrefs((prev) => ({ ...prev, [key]: before }))
        showToast('err', result.error)
        return
      }
      showToast('ok', next ? 'Notifications on.' : 'Notifications off.')
    })
  }

  return (
    <section
      className={styles.section}
      aria-labelledby="affiliate-notifications-heading"
    >
      <header className={styles.header}>
        <h2 id="affiliate-notifications-heading" className={styles.heading}>
          Notifications
        </h2>
        <p className={styles.subheading}>
          Choose which emails we send. Transactional emails (commissions +
          payouts) default to on so you never miss money. Marketing emails
          default to off.
        </p>
      </header>

      <ul className={styles.toggleList}>
        {TOGGLES.map((t) => {
          const on = prefs[t.key]
          const isPending = pendingKey === t.key
          return (
            <li key={t.key} className={styles.toggleRow}>
              <div className={styles.toggleText}>
                <p className={styles.toggleTitle}>{t.title}</p>
                <p className={styles.toggleDescription}>{t.description}</p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={on}
                aria-label={`${t.title} (${on ? 'on' : 'off'})`}
                aria-busy={isPending || undefined}
                onClick={() => toggle(t.key)}
                className={[
                  styles.toggle,
                  styles[`toggle_${t.variant}`],
                  on ? styles.toggleOn : styles.toggleOff,
                  isPending ? styles.togglePending : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
              >
                <span className={styles.toggleThumb} aria-hidden="true" />
              </button>
            </li>
          )
        })}
      </ul>

      {toast && (
        <p
          className={toast.kind === 'ok' ? styles.toastOk : styles.toastErr}
          role={toast.kind === 'ok' ? 'status' : 'alert'}
          aria-live="polite"
        >
          {toast.msg}
        </p>
      )}
    </section>
  )
}