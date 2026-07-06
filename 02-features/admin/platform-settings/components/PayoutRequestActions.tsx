// PayoutRequestActions.tsx — client island; right-rail action rail
// for /admin/payouts/[id]. Approve / Deny / Mark paid buttons with
// typed confirmations.

'use client'

import { useState, useTransition } from 'react'
import {
  approvePayoutRequestAction,
  denyPayoutRequestAction,
  markPayoutRequestPaidAction,
} from '@features/payouts/actions/approvePayoutRequest'
import styles from './PayoutRequestActions.module.css'

export type PayoutRequestActionsProps = {
  requestId: number
  status: string
  partnerName: string | null
  amountCents: number
  currency: string
}

export function PayoutRequestActions(props: PayoutRequestActionsProps) {
  const { requestId, status, amountCents, currency } = props
  const [approveConfirm, setApproveConfirm] = useState('')
  const [denyReason, setDenyReason] = useState('')
  const [externalRef, setExternalRef] = useState('')
  const [activeModal, setActiveModal] = useState<'approve' | 'deny' | 'paid' | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [, startTransition] = useTransition()

  const canApprove = status === 'pending'
  const canDeny = status === 'pending' || status === 'approved'
  const canMarkPaid = status === 'approved'

  function handleApprove() {
    if (approveConfirm !== 'APPROVE') return
    setErrorMessage(null)
    startTransition(async () => {
      const result = await approvePayoutRequestAction({ requestId })
      if (result.ok) {
        setActiveModal(null)
        window.location.reload()
      } else {
        setErrorMessage(result.error)
      }
    })
  }

  function handleDeny() {
    if (denyReason.trim().length < 1) {
      setErrorMessage('Provide a denial reason.')
      return
    }
    setErrorMessage(null)
    startTransition(async () => {
      const result = await denyPayoutRequestAction({ requestId, reason: denyReason.trim() })
      if (result.ok) {
        setActiveModal(null)
        window.location.reload()
      } else {
        setErrorMessage(result.error)
      }
    })
  }

  function handleMarkPaid() {
    if (externalRef.trim().length < 1) {
      setErrorMessage('Provide an external reference (PayPal batch id etc.).')
      return
    }
    setErrorMessage(null)
    startTransition(async () => {
      const result = await markPayoutRequestPaidAction({ requestId, externalReference: externalRef.trim() })
      if (result.ok) {
        setActiveModal(null)
        window.location.reload()
      } else {
        setErrorMessage(result.error)
      }
    })
  }

  return (
    <aside className={styles.rail} aria-label="Payout request actions">
      <h2 className={styles.heading}>Actions</h2>

      {errorMessage && (
        <p className={styles.error} role="alert">
          {errorMessage}
        </p>
      )}

      <div className={styles.actions}>
        {canApprove && (
          <button
            type="button"
            className={styles.primaryButton}
            onClick={() => setActiveModal('approve')}
            data-testid="approve-button"
          >
            Approve
          </button>
        )}
        {canDeny && (
          <button
            type="button"
            className={styles.dangerButton}
            onClick={() => setActiveModal('deny')}
            data-testid="deny-button"
          >
            Deny
          </button>
        )}
        {canMarkPaid && (
          <button
            type="button"
            className={styles.successButton}
            onClick={() => setActiveModal('paid')}
            data-testid="mark-paid-button"
          >
            Mark paid
          </button>
        )}
        {!canApprove && !canDeny && !canMarkPaid && (
          <p className={styles.noActions}>No actions available in status "{status}".</p>
        )}
      </div>

      {activeModal === 'approve' && (
        <ModalShell onClose={() => setActiveModal(null)} title="Approve payout">
          <p className={styles.modalBody}>
            Approve payout of <strong>{formatAmount(amountCents, currency)}</strong>? Type
            <code className={styles.code}>APPROVE</code> to confirm.
          </p>
          <input
            type="text"
            value={approveConfirm}
            onChange={(e) => setApproveConfirm(e.target.value)}
            className={styles.input}
            aria-label="Type APPROVE to confirm"
            maxLength={20}
          />
          <div className={styles.modalActions}>
            <button type="button" className={styles.subtleButton} onClick={() => setActiveModal(null)}>
              Cancel
            </button>
            <button
              type="button"
              className={styles.primaryButton}
              onClick={handleApprove}
              disabled={approveConfirm !== 'APPROVE'}
            >
              Confirm approve
            </button>
          </div>
        </ModalShell>
      )}

      {activeModal === 'deny' && (
        <ModalShell onClose={() => setActiveModal(null)} title="Deny payout">
          <p className={styles.modalBody}>
            Denying will release the pending ledger rows back to "available" balance. Provide a
            reason (1-500 chars):
          </p>
          <textarea
            value={denyReason}
            onChange={(e) => setDenyReason(e.target.value)}
            className={styles.textarea}
            rows={4}
            maxLength={500}
            aria-label="Denial reason"
          />
          <div className={styles.modalActions}>
            <button type="button" className={styles.subtleButton} onClick={() => setActiveModal(null)}>
              Cancel
            </button>
            <button type="button" className={styles.dangerButton} onClick={handleDeny}>
              Confirm deny
            </button>
          </div>
        </ModalShell>
      )}

      {activeModal === 'paid' && (
        <ModalShell onClose={() => setActiveModal(null)} title="Mark as paid">
          <p className={styles.modalBody}>
            Mark this payout as paid. Provide the PayPal batch id (or manual reference).
          </p>
          <input
            type="text"
            value={externalRef}
            onChange={(e) => setExternalRef(e.target.value)}
            className={styles.input}
            aria-label="External reference"
            maxLength={200}
          />
          <div className={styles.modalActions}>
            <button type="button" className={styles.subtleButton} onClick={() => setActiveModal(null)}>
              Cancel
            </button>
            <button type="button" className={styles.successButton} onClick={handleMarkPaid}>
              Confirm paid
            </button>
          </div>
        </ModalShell>
      )}
    </aside>
  )
}

function ModalShell(props: { onClose: () => void; title: string; children: React.ReactNode }) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
      className={styles.backdrop}
      onClick={(e) => {
        if (e.target === e.currentTarget) props.onClose()
      }}
    >
      <div className={styles.modal}>
        <h2 id="modal-title" className={styles.modalTitle}>
          {props.title}
        </h2>
        {props.children}
      </div>
    </div>
  )
}

function formatAmount(cents: number, currency: string): string {
  return `${currency} $${(cents / 100).toFixed(2)}`
}
