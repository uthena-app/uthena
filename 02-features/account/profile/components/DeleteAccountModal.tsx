// DeleteAccountModal — 'use client'. Confirmation modal that
// requires the user to type their email to enable the destructive
// action. Keyboard accessible: Esc to close, focus trap.
'use client'

import { useCallback, useEffect, useId, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@foundations/ui/primitives/Button'
import { deleteMyAccountAction } from '../actions/deleteMyAccount'
import styles from './DeleteAccountModal.module.css'

export function DeleteAccountModal({ email }: { email: string }) {
  const [open, setOpen] = useState(false)
  const [typed, setTyped] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const router = useRouter()
  const dialogRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const titleId = useId()

  const matches =
    typed.trim().length > 0 && typed.trim().toLowerCase() === email.trim().toLowerCase()

  const onClose = useCallback(() => {
    if (isPending) return
    setOpen(false)
    setTyped('')
    setError(null)
  }, [isPending])

  // Esc to close + focus management.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    document.addEventListener('keydown', onKey)
    inputRef.current?.focus()
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const onConfirm = () => {
    if (!matches) return
    setError(null)
    startTransition(async () => {
      const result = await deleteMyAccountAction({ confirmEmail: typed })
      if (!result.ok) {
        if (result.error === 'wrong_email') {
          setError('That does not match your email.')
        } else if (result.error === 'cancel_subscriptions_first') {
          setError(
            'Please cancel your active subscriptions in Settings → Billing before deleting your account.',
          )
        } else if (result.error === 'resolve_payouts_first') {
          setError(
            'You have pending payouts to settle. Please contact support before deleting your account.',
          )
        } else {
          setError('Could not delete your account. Please try again or contact support.')
        }
        return
      }
      setOpen(false)
      router.push(result.redirectTo)
      router.refresh()
    })
  }

  if (!open) {
    return (
      <Button type="button" variant="danger" onClick={() => setOpen(true)}>
        Delete account
      </Button>
    )
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
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={styles.dialog}
      >
        <h2 id={titleId} className={styles.h2}>
          Delete your account?
        </h2>
        <p className={styles.lede}>
          This permanently removes your account. Some data is anonymized (kept for tax/financial
          records), the rest is hard-deleted.
        </p>

        <div className={styles.columns}>
          <div className={styles.col}>
            <h3 className={styles.colH}>Deleted</h3>
            <ul className={styles.list}>
              <li>Your profile, display name, bio, locale, timezone</li>
              <li>Library grants, course progress, bookmarks, reviews</li>
              <li>Active cart items and saved preferences</li>
            </ul>
          </div>
          <div className={styles.col}>
            <h3 className={styles.colH}>Anonymized (7-year record)</h3>
            <ul className={styles.list}>
              <li>Order history — email + user_id replaced with a marker</li>
              <li>Refund records — same marker</li>
              <li>Payout ledger entries that reference your partner</li>
            </ul>
          </div>
        </div>

        <div className={styles.confirmRow}>
          <label htmlFor="confirm_email" className={styles.confirmLabel}>
            Type your email to confirm: <span className={styles.confirmEmail}>{email}</span>
          </label>
          <input
            ref={inputRef}
            id="confirm_email"
            type="email"
            className={styles.confirmInput}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            aria-invalid={error ? 'true' : undefined}
            aria-describedby={error ? 'del_error' : undefined}
          />
        </div>

        {error && (
          <p id="del_error" className={styles.error} role="alert">
            {error}
          </p>
        )}

        <div className={styles.actions}>
          <Button type="button" variant="ghost" onClick={onClose} disabled={isPending}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="danger"
            onClick={onConfirm}
            disabled={!matches || isPending}
            loading={isPending}
          >
            Delete my account
          </Button>
        </div>
      </div>
    </div>
  )
}
