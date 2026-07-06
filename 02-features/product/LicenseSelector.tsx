'use client'

// LicenseSelector — the license-tier radio + Add to cart CTA inside
// the product detail page's `pinfo` column. Mockup-faithful to
// `mockups/product.html` lines 79–99 and `mockups/styles/main.css`
// lines 285–292:
//
//   License type
//   ( ) Lifetime Access + PLR License    [PLR]  Resell under your brand…  $57
//   (•) Lifetime Access + MRR License    [MRR]  Your buyers can also…    $149
//   [            Add to cart →            ]
//
// **Why a client component.** The radio state is local UI state (the
// selected tier changes which price the form submits). The form
// posts to the existing `addToCartAction` server action; on success
// it navigates to /cart; on auth-required it redirects to
// /login?next=/cart. The pattern mirrors the existing
// `AddToCartButton` component but with the radio affordance inline
// instead of a `<select>`.
//
// **License tag color DNA.** PLR / Personal get the teal background
// (identity color — the license is for the buyer's own use or their
// direct brand). MRR / RR get the orange background (action color —
// the license unlocks a secondary marketplace of buyers). This
// matches the product card pill logic in `ProductCard.tsx` and the
// design DNA noted in the mockup's `.lic-tag.mrr` selector.
//
// **Defensive shape.** When the product has only one active pricing
// tier, the radio group collapses to a single static row (no radio
// input — there's nothing to choose between) and the tag + price
// inline. When the product has zero active tiers, the component
// shows a "No pricing available" message and hides the Add to cart
// button.

import { useId, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { addToCartAction } from '@features/cart/actions/addToCart'
import { CART_CHANGED_EVENT, CART_OPEN_EVENT } from '@features/cart/cartEvents'
import { LICENSE_LABELS, LICENSE_DESCRIPTIONS } from '@features/cart/format'
import { formatMoneyShort } from '@foundations/money/cents'
import { Button } from '@foundations/ui/primitives/Button'
import type { Currency, LicenseTier, PricingTier } from '@features/catalog/queries'
import styles from './LicenseSelector.module.css'

/** Map a license tier to its tag color DNA class (teal vs orange). */
const LICENSE_TAG_DNA: Record<LicenseTier, 'teal' | 'orange'> = {
  plr: 'teal',
  mrr: 'orange',
  rr: 'orange',
  personal: 'teal',
}

type Props = {
  productId: number
  /** All active pricing tiers for this product. */
  tiers: PricingTier[]
  /** Default license tier's slug (drives initial radio selection). */
  defaultLicense: LicenseTier | null
  /** Currency — for the per-tier price label. */
  currency: Currency
}

export function LicenseSelector({ productId, tiers, defaultLicense, currency }: Props) {
  const router = useRouter()
  const headingId = useId()
  const activeTiers = tiers.filter((t) => t.is_active)
  const initial = defaultLicense ?? activeTiers[0]?.license ?? null
  const [selected, setSelected] = useState<LicenseTier | null>(initial)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  if (activeTiers.length === 0) {
    return (
      <div className={styles.empty}>
        <h4 id={headingId} className={styles.eyebrow}>
          License type
        </h4>
        <p className={styles.emptyMsg}>No pricing available right now.</p>
      </div>
    )
  }

  const selectedTier = activeTiers.find((t) => t.license === selected) ?? activeTiers[0]

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!selected) return
    setError(null)
    startTransition(async () => {
      const res = await addToCartAction({
        product_id: productId,
        license: selected,
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
      // P4.1: "Add-to-cart from any page slides the drawer in."
      // Fire the same window events the dedicated AddToCartButton
      // uses so the global CartDrawer slides in + refreshes data.
      // The header cart-count badge updates via the action's own
      // revalidatePath('/', 'layout') — no extra dispatch needed.
      window.dispatchEvent(new CustomEvent(CART_OPEN_EVENT))
      window.dispatchEvent(
        new CustomEvent(CART_CHANGED_EVENT, { detail: { count: -1 } }),
      )
    })
  }

  return (
    <form className={styles.form} onSubmit={onSubmit} aria-labelledby={headingId}>
      <h4 id={headingId} className={styles.eyebrow}>
        License type
      </h4>
      <div className={styles.radios} role="radiogroup" aria-label="License type">
        {activeTiers.map((tier) => {
          const tagClass = LICENSE_TAG_DNA[tier.license]
          const isSelected = selected === tier.license
          const tagLabel = LICENSE_LABELS[tier.license] ?? tier.license.toUpperCase()
          const desc = LICENSE_DESCRIPTIONS[tier.license] ?? ''
          // The radio <input> is visually hidden but stays in the tab
          // order so keyboard users can arrow between options. The
          // label visually contains the check affordance.
          return (
            <label
              key={tier.id}
              className={`${styles.option} ${isSelected ? styles.optionSel : ''}`.trim()}
            >
              <input
                type="radio"
                name="license"
                value={tier.license}
                checked={isSelected}
                onChange={() => setSelected(tier.license)}
                className={styles.radio}
                disabled={isPending}
              />
              <span className={styles.optionBody}>
                <span className={styles.optionHead}>
                  <span className={styles.optionName}>Lifetime Access + {tagLabel} License</span>
                  <span
                    className={`${styles.tag} ${
                      tagClass === 'orange' ? styles.tagOrange : styles.tagTeal
                    }`.trim()}
                  >
                    {tagLabel === 'PLR' ? 'PLR' : tagLabel === 'MRR' ? 'MRR' : tagLabel}
                  </span>
                </span>
                {desc && <span className={styles.optionDesc}>{desc}</span>}
              </span>
              <span className={styles.optionPrice}>
                {formatMoneyShort(tier.price_cents, currency)}
              </span>
            </label>
          )
        })}
      </div>

      <Button
        type="submit"
        variant="primary"
        size="lg"
        fullWidth
        loading={isPending}
        iconRight={<span aria-hidden>→</span>}
        disabled={!selectedTier}
      >
        Add to cart
      </Button>

      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
    </form>
  )
}
