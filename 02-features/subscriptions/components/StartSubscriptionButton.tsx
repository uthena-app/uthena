// StartSubscriptionButton.tsx — opens Stripe Checkout (subscription mode).

'use client'

import { useState, useTransition } from 'react'
import { startSubscriptionAction } from '../actions/startSubscription'

export function StartSubscriptionButton({ disabled }: { disabled?: boolean }) {
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  function onClick() {
    setError(null)
    startTransition(async () => {
      const res = await startSubscriptionAction({})
      if (!res.ok) {
        setError(res.error)
        return
      }
      window.location.href = res.url
    })
  }
  return (
    <div>
      {error && (
        <div
          role="alert"
          style={{
            background: 'var(--danger-soft)',
            border: '1px solid var(--danger-line)',
            color: 'var(--danger)',
            borderRadius: 10,
            padding: '8px 12px',
            fontSize: 13,
            marginBottom: 8,
          }}
        >
          {error}
        </div>
      )}
      <button
        type="button"
        onClick={onClick}
        disabled={disabled || isPending}
        style={{
          width: '100%',
          padding: '14px 16px',
          background: disabled ? 'var(--bg-elev-3)' : 'var(--action)',
          color: disabled ? 'var(--text-3)' : '#1A0E00',
          fontWeight: 600,
          fontSize: 15,
          border: 'none',
          borderRadius: 10,
          cursor: disabled ? 'not-allowed' : 'pointer',
          letterSpacing: '-0.005em',
        }}
        aria-busy={isPending || undefined}
      >
        {isPending ? 'Redirecting…' : 'Start subscription'}
      </button>
      <p style={{ fontSize: 11, color: 'var(--text-3)', textAlign: 'center', margin: '8px 0 0' }}>
        You will be redirected to Stripe to enter your payment details. Cancel anytime.
      </p>
    </div>
  )
}
