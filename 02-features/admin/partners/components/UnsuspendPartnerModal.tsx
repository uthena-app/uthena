// UnsuspendPartnerModal.tsx — typed "UNSUSPEND" confirmation for
// unsuspending a suspended partner (status flips back to
// 'approved' — preserves the original approved_at/approved_by).
//
// No reason textarea — unsuspend is the inverse of suspend and the
// spec (line 40) doesn't require a reason.

'use client'

import { useEffect, useId, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { UNSUSPEND_PARTNER_CONFIRM } from '@foundations/data/schemas'
import { unsuspendPartnerAction } from '../actions/unsuspendPartner'
import styles from './Modal.module.css'

export function UnsuspendPartnerModal({
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
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const canSubmit = confirm === UNSUSPEND_PARTNER_CONFIRM

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
      const res = await unsuspendPartnerAction({
        id: partnerId,
        confirm: UNSUSPEND_PARTNER_CONFIRM,
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
          Unsuspend {partnerDisplayName}?
        </h2>

        <div className={styles.partnerMeta}>
          <span>
            Partner: <strong>{partnerDisplayName}</strong>
          </span>
          <span>
            Status will change from <strong>suspended</strong> to{' '}
            <strong>approved</strong>. Their original approval date is
            preserved.
          </span>
        </div>

        <form id={formId} onSubmit={onSubmit} className={styles.form}>
          <label className={styles.confirmField}>
            <span>Type {UNSUSPEND_PARTNER_CONFIRM} to confirm</span>
            <input
              name="confirm"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className={styles.confirmInput}
              autoComplete="off"
              spellCheck={false}
              aria-label="Confirmation"
              maxLength={UNSUSPEND_PARTNER_CONFIRM.length}
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
              className={styles.primary}
              disabled={!canSubmit || isPending}
            >
              {isPending ? 'Unsuspending…' : 'Unsuspend partner'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}