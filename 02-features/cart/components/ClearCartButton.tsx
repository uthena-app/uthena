// ClearCartButton.tsx — small "Clear cart" link with confirm dialog.

'use client'

import { useTransition } from 'react'
import { clearCartAction } from '../actions/clearCart'

export function ClearCartButton() {
  const [isPending, startTransition] = useTransition()
  function onClick() {
    if (!window.confirm('Clear all items from your cart?')) return
    startTransition(async () => {
      await clearCartAction({ reason: 'abandoned' })
    })
  }
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={isPending}
      style={{
        alignSelf: 'center',
        background: 'transparent',
        border: 'none',
        color: 'var(--text-3)',
        fontSize: 12,
        cursor: isPending ? 'not-allowed' : 'pointer',
        textDecoration: 'underline',
        padding: 0,
        marginTop: -4,
      }}
    >
      Clear cart
    </button>
  )
}
