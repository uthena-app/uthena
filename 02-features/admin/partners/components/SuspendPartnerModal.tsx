// SuspendPartnerModal.tsx — typed "SUSPEND" + required reason
// textarea for suspending an approved partner. Closes on cancel or
// success; on success the parent calls `router.refresh()`.
//
// The reason is required (spec line 39 — "reason textarea (required)
// + typed confirmation") and is stored in the audit row's
// `metadata.reason` so future investigators can correlate the
// suspension with the stated rationale.

'use client'

import { useEffect, useId, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { SUSPEND_PARTNER_CONFIRM } from '@foundations/data/schemas'
import { suspendPartnerAction } from '../actions/suspendPartner'
import styles from './Modal.module.css'

const REASON_MAX_LENGTH = 500

export function SuspendPartnerModal({
  partnerId,
  partnerDisplayName,
  onClose,
}: {
  partnerId: number
  partnerDisplayName: string
  onClose: () => void
}) {
  const router = useRouter()
  const formId = useId()
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const [confirm, setConfirm] = useState('')
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const trimmedReason = reason.trim()
  const canSubmit =
    confirm === SUSPEND_PARTNER_CONFIRM && trimmedReason.length > 0

  useEffect(() => {
    const input = dialogRef.current?.querySelector<HTMLInputElement>('input[name="confirm"]')
    input?.focus()

    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!canSubmit) return
    setError(null)
    startTransition(async () => {
      const res = await suspendPartnerAction({
        id: partnerId,
        confirm: SUSPEND_PARTNER_CONFIRM,
        reason: trimmedReason,
      })
      if (!res.ok) {
        setError(res.error)
        return
      }
      onClose()
      router.refresh()
    })
  }

  return (
    <div
      className={styles.backdrop}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        ref={dialogRef}
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${formId}-title`}
      >
        <h2 id={`${formId}-title`} className={styles.title}>
          Suspend {partnerDisplayName}?
        </h2>

        <div className={styles.partnerMeta}>
          <span>
            Partner: <strong>{partnerDisplayName}</strong>
          </span>
          <span>
            Status will change from <strong>approved</strong> to{' '}
            <strong>suspended</strong>.
          </span>
        </div>

        <form id={formId} onSubmit={onSubmit} className={styles.form}>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>
              Reason <span style={{ color: 'var(--danger)' }}>*</span>
            </span>
            <textarea
              name="reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className={styles.textarea}
              placeholder="Why is this partner being suspended?"
              maxLength={REASON_MAX_LENGTH}
              rows={3}
              required
              aria-required="true"
            />
            <span className={styles.hint}>
              {trimmedReason.length}/{REASON_MAX_LENGTH} characters
            </span>
          </label>

          <label className={styles.confirmField}>
            <span>Type {SUSPEND_PARTNER_CONFIRM} to confirm</span>
            <input
              name="confirm"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className={styles.confirmInput}
              autoComplete="off"
              spellCheck={false}
              aria-label="Confirmation"
              maxLength={SUSPEND_PARTNER_CONFIRM.length}
            />
          </label>
          {error && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}
          <div className={styles.actions}>
            <button
              type="button"
              onClick={onClose}
              className={styles.secondary}
              disabled={isPending}
            >
              Cancel
            </button>
            <button
              type="submit"
              className={styles.danger}
              disabled={!canSubmit || isPending}
            >
              {isPending ? 'Suspending…' : 'Suspend partner'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}