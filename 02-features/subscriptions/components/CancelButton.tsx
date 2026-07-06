// CancelButton.tsx — client island with typed-confirm modal.

'use client'

import { useState, useTransition } from 'react'
import { cancelAtPeriodEndAction } from '../actions/cancelAtPeriodEnd'

export function CancelButton() {
  const [isPending, startTransition] = useTransition()
  const [open, setOpen] = useState(false)
  const [confirmText, setConfirmText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const matches = confirmText === 'CANCEL'

  function submit() {
    if (!matches) return
    setError(null)
    startTransition(async () => {
      const res = await cancelAtPeriodEndAction({})
      if (!res.ok) { setError(res.error); return }
      setOpen(false); setConfirmText('')
    })
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} disabled={isPending} style={btnStyle('secondary')}>
        Cancel at period end
      </button>
      {open && (
        <div role="dialog" aria-modal="true" aria-labelledby="cancel-title" style={overlayStyle}>
          <div style={dialogStyle}>
            <h3 id="cancel-title" style={{ margin: '0 0 8px', fontSize: 18, color: 'var(--heading)' }}>
              Cancel subscription?
            </h3>
            <p style={{ color: 'var(--text-2)', fontSize: 14, lineHeight: 1.5, margin: '0 0 16px' }}>
              Your subscription stays active until the end of the current billing period.
              You can resume any time before then. To confirm, type <strong>CANCEL</strong> below.
            </p>
            <input
              type="text" value={confirmText}
              onChange={(e) => setConfirmText(e.target.value.toUpperCase())}
              autoFocus aria-label="Type CANCEL to confirm"
              style={{ width: '100%', padding: '8px 10px', background: 'var(--bg-elev-2)', color: 'var(--text-1)', border: '1px solid var(--line)', borderRadius: 6, fontSize: 14, marginBottom: 12, letterSpacing: '0.05em' }}
            />
            {error && <p role="alert" style={{ color: 'var(--danger)', fontSize: 13, margin: '0 0 12px' }}>{error}</p>}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button type="button" onClick={() => { setOpen(false); setConfirmText(''); setError(null) }} disabled={isPending} style={btnStyle('secondary')}>
                Keep subscription
              </button>
              <button type="button" onClick={submit} disabled={!matches || isPending} style={btnStyle('danger')}>
                {isPending ? 'Canceling…' : 'Confirm cancel'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function btnStyle(variant: 'primary' | 'secondary' | 'danger'): React.CSSProperties {
  const base: React.CSSProperties = { padding: '8px 14px', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' }
  if (variant === 'primary') return { ...base, background: 'var(--action)', color: '#1A0E00', border: 'none' }
  if (variant === 'danger') return { ...base, background: 'var(--danger)', color: '#fff', border: 'none' }
  return { ...base, background: 'transparent', color: 'var(--text-1)', border: '1px solid var(--line-strong)' }
}

const overlayStyle: React.CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 16 }
const dialogStyle: React.CSSProperties = { background: 'var(--bg-elev-1)', border: '1px solid var(--line)', borderRadius: 12, padding: 24, maxWidth: 440, width: '100%' }
