// Resend-verification client island. Used on the /verify-email expired
// branch to give the user a single button that re-sends the verification
// email. Mirrors the pattern of the P1.2/P1.4 cooldowns: server
// returns `rateLimited.retryAfterSeconds`, the form disables the
// button + shows a live countdown until the limit expires.
//
// The button is shown only when the page renders the expired branch —
// the page reads `getSessionUser()` and gates the form on (a) signed in
// AND (b) `email_confirmed_at IS NULL`. If the page reaches the form
// component, the conditions are met.
//
// On success: a 4s "Check your inbox" toast appears. The user stays
// on /verify-email so they can click the new link without losing
// context. On rate-limit: inline cooldown ("Try again in Xm Ys"). On
// generic error: inline error message ("Couldn't send email — try
// again").

'use client'

import { useEffect, useState, useTransition } from 'react'
import { Button } from '@foundations/ui/primitives/Button'
import { resendVerificationEmailAction } from './actions'
import styles from './ResendVerificationForm.module.css'

const TOAST_DURATION_MS = 4000

function formatRetryAfter(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  const rem = s % 60
  return rem === 0 ? `${m}m` : `${m}m ${rem}s`
}

export function ResendVerificationForm() {
  const [pending, startTransition] = useTransition()
  const [serverError, setServerError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [cooldownUntil, setCooldownUntil] = useState<number | null>(null)
  const [now, setNow] = useState<number>(() => Date.now())

  // Live countdown — tick once per second while a cooldown is active.
  // Cheap (no network, no re-fetch); purely visual.
  useEffect(() => {
    if (cooldownUntil == null) return
    const remaining = cooldownUntil - now
    if (remaining <= 0) {
      setCooldownUntil(null)
      return
    }
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [cooldownUntil, now])

  // Auto-dismiss the success toast after 4s. The timer is cleared on
  // unmount + on each new submit so a second successful send resets
  // the window rather than the toast being cut short by an unrelated
  // re-render.
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), TOAST_DURATION_MS)
    return () => clearTimeout(t)
  }, [toast])

  const cooldownRemaining = cooldownUntil == null ? 0 : Math.max(0, cooldownUntil - now)
  const cooldownActive = cooldownRemaining > 0

  function onSubmit() {
    setServerError(null)
    const fd = new FormData()
    startTransition(async () => {
      const res = await resendVerificationEmailAction(fd)
      if (res.ok) {
        setToast(res.message ?? 'Email sent.')
      } else {
        setServerError(res.error)
        if (res.rateLimited) {
          setCooldownUntil(Date.now() + res.rateLimited.retryAfterSeconds * 1000)
          setNow(Date.now())
        }
      }
    })
  }

  return (
    <div className={styles.wrap}>
      {cooldownActive && (
        <p className={styles.cooldownNotice} role="status" aria-live="polite">
          <span className={styles.cooldownLabel}>Try again in</span>
          <span className={styles.cooldownCount}>
            {formatRetryAfter(Math.ceil(cooldownRemaining / 1000))}
          </span>
        </p>
      )}
      {toast && (
        <p className={styles.toast} role="status" aria-live="polite">
          {toast}
        </p>
      )}
      {serverError && (
        <p className={styles.serverError} role="alert" aria-live="assertive">
          {serverError}
        </p>
      )}
      <Button
        type="button"
        onClick={onSubmit}
        loading={pending}
        fullWidth
        disabled={cooldownActive || pending}
        aria-disabled={cooldownActive || pending}
      >
        Resend verification email
      </Button>
    </div>
  )
}