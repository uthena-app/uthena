// SwitchToUserButton — tiny client island. Calls
// `startImpersonationAction(targetUserId, reason)` and on success
// opens the returned magic link in a NEW tab via window.open with
// `noopener,noreferrer`. The reason field lives in the parent
// ImpersonationSearch's localStorage (key `uthena.impersonation.
// reason.v1`) and is read fresh on each click — no prop drilling.
//
// Disabled state: enabled only when the reason is valid. We surface
// the disabled state via aria-disabled so the button stays focusable
// for keyboard users (native `disabled` removes from tab order).

'use client'

import { useEffect, useState, useTransition } from 'react'
import { startImpersonationAction } from '../actions/startImpersonation'
import { MIN_REASON_LEN, MAX_REASON_LEN } from '../constants'
import styles from './AccountSwitcher.module.css'

const REASON_STORAGE_KEY = 'uthena.impersonation.reason.v1'

function readStoredReason(): string {
  if (typeof window === 'undefined') return ''
  try {
    return window.localStorage.getItem(REASON_STORAGE_KEY) ?? ''
  } catch {
    return ''
  }
}

export function SwitchToUserButton({
  targetUserId,
  targetLabel,
}: {
  targetUserId: string
  targetLabel: string
}) {
  // Re-read localStorage on every render so a typed reason in the
  // search form enables the buttons without a page reload.
  const [reason, setReason] = useState('')
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setReason(readStoredReason())
    // Lightweight polling — re-read every time the tab regains focus
    // so the buttons re-enable as soon as the admin types a reason
    // in the search form.
    const onFocus = () => setReason(readStoredReason())
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [])

  const trimmed = reason.trim()
  const valid = trimmed.length >= MIN_REASON_LEN && trimmed.length <= MAX_REASON_LEN

  const onClick = () => {
    if (!valid || pending) return
    // Re-read fresh — defensive against a stale closure.
    const fresh = readStoredReason().trim()
    if (fresh.length < MIN_REASON_LEN || fresh.length > MAX_REASON_LEN) {
      setError(
        `Type a reason (${MIN_REASON_LEN}–${MAX_REASON_LEN} chars) in the search form above before switching.`,
      )
      return
    }
    setError(null)
    startTransition(async () => {
      const result = await startImpersonationAction(targetUserId, fresh)
      if (!result.ok) {
        setError(result.error)
        return
      }
      // Open the magic link in a new tab. The original admin tab stays
      // admin (its session cookie is untouched). The new tab establishes
      // a session for the target user via /auth/callback.
      window.open(result.actionLink, '_blank', 'noopener,noreferrer')
    })
  }

  return (
    <div className={styles.switchWrap}>
      <button
        type="button"
        className={styles.primaryBtn}
        onClick={onClick}
        disabled={!valid}
        aria-disabled={!valid || pending}
        title={
          valid
            ? `Open a new tab signed in as ${targetLabel}`
            : `Type a reason (${MIN_REASON_LEN}–${MAX_REASON_LEN} chars) to enable`
        }
      >
        {pending ? 'Opening…' : 'Switch to this user'}
      </button>
      {error ? (
        <span className={styles.errorMsg} role="alert">
          {error}
        </span>
      ) : null}
    </div>
  )
}
