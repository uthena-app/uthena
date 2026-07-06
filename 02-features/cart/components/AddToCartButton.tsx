// AddToCartButton.tsx — client form for adding a product to the cart.
// Posts to the addToCartAction via a React form action.
//
// On success, fires `uthena:cart:open` + `uthena:cart:changed` so
// the global CartDrawer (P4.1) slides in and refreshes its data
// (per spec: "Add-to-cart from any page slides the drawer in").
// On auth-required, routes the user to /login?next=/cart so the
// post-login flow lands them back where they intended.

'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@foundations/ui/primitives/Button'
import { addToCartAction } from '../actions/addToCart'
import {
  CART_CHANGED_EVENT,
  CART_OPEN_EVENT,
  type CartChangedDetail,
} from '../cartEvents'

type License = 'plr' | 'mrr' | 'rr' | 'personal'

export function AddToCartButton({
  productId,
  defaultLicense = 'plr' as License,
  availableLicenses = ['plr', 'mrr', 'rr', 'personal'] as License[],
  primary = false,
}: {
  productId: number
  defaultLicense?: License
  availableLicenses?: License[]
  /** When true, render as a sidebar primary button (uses the orange action color). */
  primary?: boolean
}) {
  const router = useRouter()
  const [license, setLicense] = useState<License>(defaultLicense)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    startTransition(async () => {
      const res = await addToCartAction({
        product_id: productId,
        license,
        quantity: 1,
      })
      if (!res.ok) {
        if (res.requireAuth) {
          router.push(`/login?next=/cart`)
          return
        }
        setError(res.error)
        return
      }
      // Tell the rest of the app: an item was just added. The CartDrawer
      // listens for both events — open to slide in, changed to refresh
      // its data. The header cart-count badge updates via the RSC
      // revalidation the action already triggers (revalidatePath).
      window.dispatchEvent(new CustomEvent(CART_OPEN_EVENT))
      const detail: CartChangedDetail = { count: -1 }
      window.dispatchEvent(new CustomEvent(CART_CHANGED_EVENT, { detail }))
    })
  }

  return (
    <form onSubmit={onSubmit} style={{ display: 'contents' }}>
      <select
        aria-label="License"
        value={license}
        onChange={(e) => setLicense(e.target.value as License)}
        disabled={isPending}
        style={{
          padding: '6px 8px',
          borderRadius: 8,
          border: '1px solid var(--line)',
          background: 'var(--bg-elev-2)',
          color: 'var(--text-1)',
          fontSize: 13,
        }}
      >
        {availableLicenses.map((l) => (
          <option key={l} value={l}>
            {l.toUpperCase()}
          </option>
        ))}
      </select>
      <Button
        type="submit"
        variant={primary ? 'primary' : 'secondary'}
        size="sm"
        loading={isPending}
      >
        Add to cart
      </Button>
      {error && (
        <span role="alert" style={{ color: 'var(--danger)', fontSize: 12 }}>
          {error}
        </span>
      )}
    </form>
  )
}
