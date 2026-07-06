// MaintenanceToggle.tsx — the admin editor for the maintenance mode
// toggle on `/admin/settings → General`.
//
// P14.15 spec: typed "CONFIRM" confirmation modal before the save,
// admin can flip ON/OFF + provide an optional customer-facing message,
// every change writes one audit row. The toggle is destructive-ish
// (it takes the site offline), so the UI requires explicit
// confirmation on the "ON" path. The "OFF" path also requires CONFIRM
// because a malicious insider with admin role could otherwise leave
// the site stuck in maintenance.
//
// State management:
//   - The component owns the local copy of `enabled` + `message` so
//     the user can draft the message before flipping the toggle.
//   - On save: validate via Zod-equivalent client-side checks (the
//     schema lives in @foundations/data/schemas; the action re-validates
//     on the server), then call the server action.
//   - On success: replace local state with the server-canonical
//     response + show a "Saved." banner.
//   - On failure: surface the friendly error inline; do NOT roll back
//     the user's draft (they can fix + retry).

'use client'

import { useId, useState, useTransition } from 'react'
import { Button } from '@foundations/ui/primitives/Button'
import {
  MAINTENANCE_CONFIRM_STRING,
  MAINTENANCE_MESSAGE_MAX_LENGTH,
} from '@foundations/data/schemas'
import { updateMaintenanceAction } from '../actions/updateMaintenanceAction'
import type { MaintenanceState } from '../lib/maintenance'
import styles from './MaintenanceToggle.module.css'

type MaintenanceToggleProps = {
  /** Current maintenance state from the server-rendered query. */
  initial: MaintenanceState
}

const DEFAULT_MESSAGE_PLACEHOLDER =
  'We are performing scheduled maintenance and will be back shortly. Thanks for your patience.'

export function MaintenanceToggle({ initial }: MaintenanceToggleProps) {
  const formId = useId()
  const [enabled, setEnabled] = useState(initial.enabled)
  const [message, setMessage] = useState(initial.message)
  const [confirmInput, setConfirmInput] = useState('')
  const [showConfirm, setShowConfirm] = useState(false)
  const [pendingEnabled, setPendingEnabled] = useState<boolean | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const targetEnabled = pendingEnabled ?? enabled

  // Has the draft diverged from the saved state?
  const messageDirty = message.trim() !== initial.message.trim()
  const isDirty = targetEnabled !== initial.enabled || (targetEnabled && messageDirty)

  function handleToggleClick(nextEnabled: boolean) {
    setError(null)
    setSuccess(null)
    setPendingEnabled(nextEnabled)
    setConfirmInput('')
    setShowConfirm(true)
  }

  function handleCancelConfirm() {
    setShowConfirm(false)
    setPendingEnabled(null)
    setConfirmInput('')
  }

  function handleConfirmSave() {
    if (pendingEnabled === null) return
    const target = pendingEnabled

    setError(null)
    setSuccess(null)
    setShowConfirm(false)

    startTransition(async () => {
      const res = await updateMaintenanceAction({
        enabled: target,
        message: target ? message : '',
        confirm: confirmInput,
      })
      if (!res.ok) {
        setError(res.error)
        setShowConfirm(false)
        setPendingEnabled(null)
        return
      }
      // Replace local copy with server-canonical.
      setEnabled(res.enabled)
      setMessage(res.message)
      setPendingEnabled(null)
      setConfirmInput('')
      setSuccess(
        res.changed
          ? target
            ? 'Maintenance mode is ON. Non-admin routes now return 503.'
            : 'Maintenance mode is OFF. All routes are reachable.'
          : 'No changes — values match the current settings.',
      )
    })
  }

  return (
    <section className={styles.card} aria-labelledby={`${formId}-title`}>
      <header className={styles.header}>
        <h2 id={`${formId}-title`} className={styles.title}>
          Maintenance mode
        </h2>
        <span
          className={[styles.pill, enabled ? styles.pillOn : styles.pillOff].join(' ')}
          data-active={enabled ? 'true' : 'false'}
          aria-label={enabled ? 'Maintenance is on' : 'Maintenance is off'}
        >
          {enabled ? 'ON' : 'OFF'}
        </span>
      </header>

      <p className={styles.intro}>
        When maintenance mode is on, every non-admin route returns a 503 page that displays
        your message. Admin routes (<code>/admin/*</code>) stay accessible so an admin can
        flip the toggle back off. Toggling requires typed confirmation.
      </p>

      <div className={styles.row}>
        <label htmlFor={`${formId}-enabled`} className={styles.label}>
          Status
        </label>
        <div className={styles.toggleRow}>
          <button
            id={`${formId}-enabled`}
            type="button"
            role="switch"
            aria-checked={targetEnabled}
            data-active={targetEnabled ? 'true' : 'false'}
            className={styles.toggleSwitch}
            onClick={() => handleToggleClick(!targetEnabled)}
            disabled={isPending}
          >
            <span className={styles.toggleKnob} aria-hidden="true" />
            <span className={styles.toggleText}>{targetEnabled ? 'On' : 'Off'}</span>
          </button>
          <span className={styles.hint}>
            {targetEnabled
              ? 'Site is offline for non-admins.'
              : 'Site is reachable for everyone.'}
          </span>
        </div>
      </div>

      <div className={styles.row}>
        <label htmlFor={`${formId}-message`} className={styles.label}>
          Customer-facing message
        </label>
        <textarea
          id={`${formId}-message`}
          name="maintenance_message"
          rows={4}
          maxLength={MAINTENANCE_MESSAGE_MAX_LENGTH}
          placeholder={DEFAULT_MESSAGE_PLACEHOLDER}
          className={styles.textarea}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          disabled={!targetEnabled}
          aria-describedby={`${formId}-message-hint`}
        />
        <p id={`${formId}-message-hint`} className={styles.hint}>
          Shown on the 503 page when maintenance is on. Leave blank to use the default
          message. Max {MAINTENANCE_MESSAGE_MAX_LENGTH} characters.
          {' '}
          <span className={styles.charCount}>
            {message.length} / {MAINTENANCE_MESSAGE_MAX_LENGTH}
          </span>
        </p>
      </div>

      {error && (
        <p className={styles.alertError} role="alert">
          {error}
        </p>
      )}
      {success && (
        <p className={styles.success} role="status">
          {success}
        </p>
      )}

      <div className={styles.actions}>
        <Button
          type="button"
          variant={targetEnabled ? 'primary' : 'secondary'}
          size="md"
          loading={isPending}
          disabled={!isDirty && targetEnabled === initial.enabled}
          onClick={() => handleToggleClick(!initial.enabled)}
        >
          {initial.enabled ? 'Turn maintenance OFF' : 'Turn maintenance ON'}
        </Button>
        <span className={styles.meta}>
          {isDirty ? (
            <>Unsaved changes — click the button to confirm.</>
          ) : (
            <>All changes saved.</>
          )}
        </span>
      </div>

      {showConfirm && (
        <div className={styles.modalBackdrop} role="dialog" aria-modal="true" aria-labelledby={`${formId}-confirm-title`}>
          <div className={styles.modal}>
            <h3 id={`${formId}-confirm-title`} className={styles.modalTitle}>
              {pendingEnabled ? 'Turn maintenance mode ON?' : 'Turn maintenance mode OFF?'}
            </h3>
            <p className={styles.modalBody}>
              {pendingEnabled
                ? 'Non-admin visitors will see the 503 page until you turn this off. Type the confirmation below to proceed.'
                : 'The site will return to normal for all visitors. Type the confirmation below to proceed.'}
            </p>
            <label htmlFor={`${formId}-confirm-input`} className={styles.modalLabel}>
              Type <code>{MAINTENANCE_CONFIRM_STRING}</code> to confirm:
            </label>
            <input
              id={`${formId}-confirm-input`}
              type="text"
              autoComplete="off"
              spellCheck={false}
              className={styles.modalInput}
              value={confirmInput}
              onChange={(e) => setConfirmInput(e.target.value)}
              autoFocus
              aria-describedby={`${formId}-confirm-hint`}
            />
            <p id={`${formId}-confirm-hint`} className={styles.modalHint}>
              The confirmation is case-sensitive. Copy-paste works.
            </p>
            <div className={styles.modalActions}>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={handleCancelConfirm}
                disabled={isPending}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant={pendingEnabled ? 'primary' : 'secondary'}
                size="sm"
                onClick={handleConfirmSave}
                disabled={isPending || confirmInput !== MAINTENANCE_CONFIRM_STRING}
                loading={isPending}
              >
                {pendingEnabled ? 'Turn ON' : 'Turn OFF'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}