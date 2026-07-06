// CouponForm.tsx — small client form for typing + applying a coupon
// code on /checkout. Calls `applyCouponAction` and shows inline success /
// error. When a coupon is applied, swaps to the AppliedCouponBadge view
// (the label + a Remove button that calls `removeCouponAction`).
//
// P4.5 redesign — replaced the inline-styles implementation with a
// token-only CSS module + the shared Button primitive (per AGENTS.md
// "All UI must use design tokens"). The component is now a
// "controlled" island: the parent passes the initial applied state
// (read from `cart_items.coupon_id` server-side) and the form manages
// its own optimistic state on top.

'use client'

import { useState, useTransition } from 'react'
import { applyCouponAction } from '../actions/applyCoupon'
import { removeCouponAction } from '../actions/removeCoupon'
import { Button } from '@foundations/ui/primitives/Button'
import styles from './CouponForm.module.css'

export type CouponFormProps = {
  /** Optional: the coupon code + label currently applied (from the parent
   *  server-side read of `cart_items.coupon_id`). When provided, the form
   *  starts in the "applied" view; when omitted, the form starts empty. */
  applied?: { code: string; label: string } | null
}

export function CouponForm({ applied }: CouponFormProps) {
  const [appliedState, setAppliedState] = useState(applied ?? null)
  const [code, setCode] = useState('')
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const [isPending, startTransition] = useTransition()

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!code.trim()) return
    setMessage(null)
    startTransition(async () => {
      const res = await applyCouponAction({ code: code.trim() })
      if (!res.ok) {
        setMessage({ kind: 'err', text: res.error })
        return
      }
      setMessage({ kind: 'ok', text: `${res.discount_label} applied.` })
      setAppliedState({ code: code.trim().toUpperCase(), label: res.discount_label })
      setCode('')
    })
  }

  function remove() {
    setMessage(null)
    startTransition(async () => {
      const res = await removeCouponAction()
      if (!res.ok) {
        setMessage({ kind: 'err', text: res.error })
        return
      }
      setAppliedState(null)
      setMessage({ kind: 'ok', text: 'Coupon removed.' })
    })
  }

  if (appliedState) {
    return (
      <div className={styles.wrap}>
        <p className={styles.label}>Coupon code</p>
        <div className={styles.applied} role="status" aria-live="polite">
          <span className={styles.appliedCode}>{appliedState.code}</span>
          <span className={styles.appliedLabel}>{appliedState.label}</span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={remove}
            disabled={isPending}
            aria-label={`Remove coupon ${appliedState.code}`}
          >
            Remove
          </Button>
        </div>
        {message && (
          <p
            role={message.kind === 'err' ? 'alert' : 'status'}
            className={`${styles.message} ${
              message.kind === 'ok' ? styles.messageOk : styles.messageErr
            }`}
          >
            {message.text}
          </p>
        )}
      </div>
    )
  }

  return (
    <form onSubmit={submit} className={styles.wrap}>
      <label className={styles.label} htmlFor="coupon-input">
        Coupon code
      </label>
      <div className={styles.row}>
        <input
          id="coupon-input"
          className={styles.input}
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="CODE"
          disabled={isPending}
          autoComplete="off"
          spellCheck={false}
          inputMode="text"
        />
        <Button
          type="submit"
          variant="secondary"
          size="sm"
          disabled={isPending || !code.trim()}
        >
          {isPending ? 'Applying…' : 'Apply'}
        </Button>
      </div>
      {message && (
        <p
          role={message.kind === 'err' ? 'alert' : 'status'}
          className={`${styles.message} ${
            message.kind === 'ok' ? styles.messageOk : styles.messageErr
          }`}
        >
          {message.text}
        </p>
      )}
    </form>
  )
}