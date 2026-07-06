'use client'

import { useState, useTransition } from 'react'
import { resendVerificationEmailAction } from '../actions/resendVerificationEmail'
import styles from './EmailVerifyBadge.module.css'

const COOLDOWN_MS = 60_000

export function EmailVerifyButton() {
  const [isPending, startTransition] = useTransition()
  const [msg, setMsg] = useState<string | null>(null)
  const [cooldownUntil, setCooldownUntil] = useState(0)
  const onCooldown = Date.now() < cooldownUntil

  const onClick = () => {
    if (onCooldown || isPending) return
    setMsg(null)
    startTransition(async () => {
      const result = await resendVerificationEmailAction()
      setMsg(result.message ?? null)
      setCooldownUntil(Date.now() + COOLDOWN_MS)
    })
  }

  return (
    <span className={styles.btnWrap}>
      <button
        type="button"
        className={styles.resend}
        onClick={onClick}
        disabled={onCooldown || isPending}
        aria-label="Resend verification email"
      >
        {isPending ? 'Sending…' : onCooldown ? 'Sent' : 'Resend'}
      </button>
      {msg && <span className={styles.toast}>{msg}</span>}
    </span>
  )
}
