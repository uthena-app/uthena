// CartLineControls.tsx — client island with two forms: license change
// and remove. Each form posts to its server action via React form
// actions; revalidation refreshes the parent /cart.
//
// P4.2 — `cartItemId` is `number | string` so the same component can
// address both auth-DB rows (bigint id) and anon-cookie refs
// (the synthesized `anon:<product_id>:<license>` string). The action
// layer branches on the type.
//
// P4.4 — **No quantity selector.** The spec calls this out explicitly:
//   "No quantity selector (PLR is per-license, quantity is always 1)"
//   + "Quantity > 1 (always 1; PLR is per-license)" in "Out of scope
//   for v1". The `cart_items.quantity` column + `updateQuantityAction`
//   server action stay in the schema/data layer (future bundle-seats
//   work in P19.11 / Phase 19), but the line-edit UI only renders
//   license + remove. The qty input that lived here was a forward-
//   compat seam that ships dead UI today; removing it honors the spec
//   and keeps the page focused on the actions v1 buyers actually use.

'use client'

import { useTransition, useState } from 'react'
import { updateLicenseAction } from '../actions/updateLicense'
import { removeLineAction } from '../actions/removeLine'

type License = 'plr' | 'mrr' | 'rr' | 'personal'

export function CartLineControls({
  cartItemId,
  currentLicense,
  availableLicenses,
}: {
  cartItemId: number | string
  currentLicense: License
  availableLicenses: License[]
}) {
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function changeLicense(next: License) {
    setError(null)
    startTransition(async () => {
      const res = await updateLicenseAction({ cart_item_id: cartItemId, license: next })
      if (!res.ok) setError(res.error)
    })
  }

  function remove() {
    setError(null)
    if (!window.confirm('Remove this item from your cart?')) return
    startTransition(async () => {
      const res = await removeLineAction({ cart_item_id: cartItemId })
      if (!res.ok) setError(res.error)
    })
  }

  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' }}>
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-3)' }}>
        License:
        <select
          value={currentLicense}
          onChange={(e) => changeLicense(e.target.value as License)}
          disabled={isPending}
          style={selectStyle}
          aria-label="License"
        >
          {availableLicenses.map((l) => (
            <option key={l} value={l}>
              {l.toUpperCase()}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        onClick={remove}
        disabled={isPending}
        style={removeStyle}
        aria-label="Remove item"
      >
        Remove
      </button>
      {error && (
        <span role="alert" style={{ color: 'var(--danger)', fontSize: 12 }}>
          {error}
        </span>
      )}
    </div>
  )
}

const selectStyle: React.CSSProperties = {
  padding: '4px 6px',
  borderRadius: 6,
  border: '1px solid var(--line)',
  background: 'var(--bg-elev-2)',
  color: 'var(--text-1)',
  fontSize: 12,
}

const removeStyle: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: 'var(--text-3)',
  fontSize: 12,
  cursor: 'pointer',
  textDecoration: 'underline',
  padding: 0,
}
