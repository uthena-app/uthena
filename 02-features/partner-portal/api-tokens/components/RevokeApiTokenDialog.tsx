'use client'

// 02-features/partner-portal/api-tokens/components/RevokeApiTokenDialog.tsx
//
// P12.19 — Per-row revoke confirmation. Client island.
//
// The dialog requires the partner to type the literal "REVOKE"
// before the destructive action unlocks — matching the spec
// `01-specs/pages/partner-settings-api.md` line 77 ("Revoke requires
// typed confirmation"). The server-side Zod schema enforces
// `.literal('REVOKE')` so a tampered client can't bypass the check.
//
// On success the page revalidates (via the server action) and the
// row disappears from the active list.

import { useId, useRef, useState, useTransition } from 'react'
import { Button } from '@foundations/ui/primitives/Button'
import { useToast } from '@foundations/ui/Toast'
import { revokeApiTokenAction } from '../actions/revokeApiToken'
import styles from './RevokeApiTokenDialog.module.css'

export function RevokeApiTokenDialog({
  tokenId,
  tokenName,
  tokenPrefix,
}: {
  tokenId: number
  tokenName: string
  tokenPrefix: string
}) {
  const [open, setOpen] = useState(false)
  const [confirmation, setConfirmation] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const dialogRef = useRef<HTMLDivElement>(null)
  const formId = useId()
  const toast = useToast()
  const matchOk = confirmation === 'REVOKE'

  const close = () => {
    setOpen(false)
    setTimeout(() => {
      setConfirmation('')
      setError(null)
    }, 0)
  }

  const handleRevoke = (e: React.FormEvent) => {
    e.preventDefault()
    if (!matchOk) {
      setError('Please type REVOKE to confirm.')
      return
    }
    setError(null)
    startTransition(async () => {
      const res = await revokeApiTokenAction({
        tokenId: String(tokenId),
        confirmation: 'REVOKE',
      })
      if (!res.ok) {
        setError(res.error)
        return
      }
      toast.success(`Token “${tokenName}” revoked.`)
      close()
    })
  }

  if (!open) {
    return (
      <button
        type="button"
        className={styles.revokeBtn}
        onClick={() => setOpen(true)}
        aria-label={`Revoke token ${tokenName}`}
      >
        Revoke
      </button>
    )
  }

  return (
    <div
      className={styles.overlay}
      role="dialog"
      aria-modal="true"
      aria-labelledby={`${formId}-title`}
      onClick={(e) => {
        if (e.target === dialogRef.current) close()
      }}
      ref={dialogRef}
    >
      <div className={styles.dialog} role="document">
        <h2 id={`${formId}-title`} className={styles.title}>
          Revoke token?
        </h2>
        <p className={styles.lede}>
          You are about to revoke{' '}
          <strong className={styles.tokenName}>{tokenName}</strong>{' '}
          (<code className={styles.tokenPrefix}>{tokenPrefix}</code>). Any
          integrations using this token will stop working immediately. This
          action cannot be undone.
        </p>
        <form onSubmit={handleRevoke} className={styles.form}>
          <label htmlFor={`${formId}-confirm`} className={styles.label}>
            Type <code className={styles.code}>REVOKE</code> to confirm:
          </label>
          <input
            id={`${formId}-confirm`}
            type="text"
            className={styles.input}
            value={confirmation}
            onChange={(e) => setConfirmation(e.target.value)}
            autoFocus
            aria-required="true"
            aria-invalid={confirmation !== '' && !matchOk}
          />
          {error ? (
            <p role="alert" className={styles.error}>
              {error}
            </p>
          ) : null}
          <div className={styles.actions}>
            <Button variant="ghost" type="button" onClick={close}>
              Cancel
            </Button>
            <Button
              variant="primary"
              type="submit"
              disabled={isPending || !matchOk}
            >
              {isPending ? 'Revoking…' : 'Revoke token'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}