// ResumeButton.tsx — one-click resume. No confirmation modal —
// resume is reversible (the user can cancel again).

'use client'

import { useTransition } from 'react'
import { resumeSubscriptionAction } from '../actions/resumeSubscription'

export function ResumeButton() {
  const [isPending, startTransition] = useTransition()
  function onClick() {
    startTransition(async () => {
      await resumeSubscriptionAction({})
    })
  }
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={isPending}
      style={{
        padding: '8px 14px',
        borderRadius: 8,
        fontSize: 13,
        fontWeight: 600,
        background: 'var(--accent)',
        color: '#0E1012',
        border: 'none',
        cursor: isPending ? 'not-allowed' : 'pointer',
      }}
    >
      {isPending ? 'Resuming…' : 'Resume subscription'}
    </button>
  )
}
