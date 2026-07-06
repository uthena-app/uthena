// ApprovePartnerModal.tsx — typed "APPROVE" confirmation for
// approving a pending partner. Closes on cancel or success; on
// success the parent calls `router.refresh()` to pick up the
// fresh partners row.
//
// Matches the DeleteCategoryModal pattern (typed input +
// disabled-until-match + ESC-to-close + auto-focus on mount).
// Submits via `approvePartnerAction` and surfaces typed errors
// inline.
//
// Pure 'use client' island — the parent (PartnerActionRail) is
// the only server-rendered surface that imports it.

'use client'

import { useEffect, useId, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  APPROVE_PARTNER_CONFIRM,
} from '@foundations/data/schemas'
import { approvePartnerAction } from '../actions/approvePartner'
import styles from './Modal.module.css'

export function ApprovePartnerModal({
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

  const canSubmit = confirm === APPROVE_PARTNER_CONFIRM

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
      const res = await approvePartnerAction({
        id: partnerId,
        confirm: APPROVE_PARTNER_CONFIRM,
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
          Approve {partnerDisplayName}?
        </h2>

        <div className={styles.partnerMeta}>
          <span>
            Partner: <strong>{partnerDisplayName}</strong>
          </span>
          <span>
            Status will change from <strong>pending</strong> to{' '}
            <strong>approved</strong>.
          </span>
        </div>

        <form id={formId} onSubmit={onSubmit} className={styles.form}>
          <label className={styles.confirmField}>
            <span>Type {APPROVE_PARTNER_CONFIRM} to confirm</span>
            <input
              name="confirm"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className={styles.confirmInput}
              autoComplete="off"
              spellCheck={false}
              aria-label="Confirmation"
              maxLength={APPROVE_PARTNER_CONFIRM.length}
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
              {isPending ? 'Approving…' : 'Approve partner'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}